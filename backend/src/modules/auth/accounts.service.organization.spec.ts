import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccountType, AuthEventType, OtpPurpose, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { AccountsRepository } from './accounts.repository';
import { AccountsService, ORGANIZATION_INVITATION_ISSUED } from './accounts.service';
import { OneTimeCodeService } from './one-time-code.service';
import { PasswordFlowsService } from './password-flows.service';
import { anAccount } from './testing/auth-fixtures';

const tx = { tx: true } as unknown as Prisma.TransactionClient;
const NOW = new Date('2026-10-26T03:00:00.000Z');
const ISSUED = { code: '480213', lifetimeMs: 72 * 3_600_000 };
const MANAGER = { id: 'manager-1', roles: ['ORG_MANAGER'], organizationId: 'org-1' };

const member = anAccount({
  id: 'member-1',
  email: 'operator@acme-trek.vn',
  fullName: 'Le Van C',
  accountType: AccountType.ORGANIZATION,
  passwordHash: null,
  roles: ['ORG_OPERATOR'],
});

describe('AccountsService, services for other modules (auth task 5.2, design §5)', () => {
  let accounts: Record<string, jest.Mock>;
  let codes: { issue: jest.Mock };
  let passwords: { sendCode: jest.Mock };
  let emitter: { emit: jest.Mock };
  let prisma: { $transaction: jest.Mock };
  let events: TransactionalEvents;
  let service: AccountsService;

  beforeEach(() => {
    accounts = {
      create: jest.fn().mockResolvedValue(member),
      findById: jest.fn().mockResolvedValue(member),
      replaceRole: jest.fn().mockResolvedValue(undefined),
      setActive: jest.fn().mockResolvedValue(undefined),
      revokeAllUserTokens: jest.fn().mockResolvedValue(undefined),
      insertAuthEvent: jest.fn().mockResolvedValue(undefined),
      contactCards: jest.fn().mockResolvedValue([{ id: 'member-1' }]),
    };
    codes = { issue: jest.fn().mockResolvedValue(ISSUED) };
    passwords = { sendCode: jest.fn().mockResolvedValue(undefined) };
    emitter = { emit: jest.fn() };
    prisma = {
      $transaction: jest.fn((work: (client: Prisma.TransactionClient) => Promise<unknown>) =>
        work(tx),
      ),
    };
    events = new TransactionalEvents(
      prisma as unknown as PrismaService,
      emitter as unknown as EventEmitter2,
    );
    service = new AccountsService(
      accounts as unknown as AccountsRepository,
      codes as unknown as OneTimeCodeService,
      passwords as unknown as PasswordFlowsService,
      events,
      {} as ConfigService<ValidatedEnvironment, true>,
    );
  });

  const emitted = (name: string): unknown[] =>
    (emitter.emit.mock.calls as [string, unknown][])
      .filter(([event]) => event === name)
      .map(([, payload]) => payload);

  describe('createOrganizationAccount (REQ-EVT-06, FR-ORG-02)', () => {
    const input = {
      email: 'operator@acme-trek.vn',
      fullName: 'Le Van C',
      phone: '0901234567',
      role: 'ORG_OPERATOR' as const,
      createdById: 'manager-1',
    };

    it('creates the account without a password and sends the invitation after commit', async () => {
      const created = await events.transaction((client) =>
        service.createOrganizationAccount(input, client, NOW),
      );

      expect(created).toEqual({
        id: 'member-1',
        email: 'operator@acme-trek.vn',
        fullName: 'Le Van C',
        isActive: true,
        passwordSet: false,
        roles: ['ORG_OPERATOR'],
      });
      expect(created).not.toHaveProperty('passwordHash');
      expect(accounts.create).toHaveBeenCalledWith(
        {
          email: 'operator@acme-trek.vn',
          fullName: 'Le Van C',
          phoneNumber: '0901234567',
          accountType: AccountType.ORGANIZATION,
          roleKeys: ['ORG_OPERATOR'],
          createdById: 'manager-1',
        },
        tx,
      );
      expect(codes.issue).toHaveBeenCalledWith('member-1', OtpPurpose.SET_PASSWORD, NOW, tx);
      expect(emitted(ORGANIZATION_INVITATION_ISSUED)).toEqual([
        { userId: 'member-1', email: 'operator@acme-trek.vn', issued: ISSUED },
      ]);
    });

    it('sends no invitation when the caller transaction rolls back', async () => {
      prisma.$transaction.mockImplementation(
        async (work: (client: Prisma.TransactionClient) => Promise<unknown>) => {
          await work(tx);
          throw new Error('membership insert failed');
        },
      );

      await expect(
        events.transaction((client) => service.createOrganizationAccount(input, client, NOW)),
      ).rejects.toThrow('membership insert failed');
      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it('creates a Guest-registered Manager with no phone and no creator', async () => {
      await service.createOrganizationAccount(
        { email: 'm@acme.vn', fullName: 'Manager', role: 'ORG_MANAGER' },
        tx,
      );
      expect(accounts.create).toHaveBeenCalledWith(
        expect.objectContaining({
          phoneNumber: null,
          createdById: null,
          roleKeys: ['ORG_MANAGER'],
        }),
        tx,
      );
      expect(codes.issue).toHaveBeenCalledWith(
        'member-1',
        OtpPurpose.SET_PASSWORD,
        expect.any(Date),
        tx,
      );
    });

    it('lets a duplicate email fail as the repository refuses it', async () => {
      accounts.create.mockRejectedValue(
        Object.assign(new Error('taken'), { errorCode: ErrorCode.CONFLICT_UNIQUE }),
      );
      await expect(service.createOrganizationAccount(input, tx, NOW)).rejects.toMatchObject({
        errorCode: ErrorCode.CONFLICT_UNIQUE,
      });
      expect(codes.issue).not.toHaveBeenCalled();
    });
  });

  it('emails the SET_PASSWORD code when the invitation event arrives', async () => {
    await service.sendOrganizationInvitation({
      userId: 'member-1',
      email: 'operator@acme-trek.vn',
      issued: ISSUED,
    });
    expect(passwords.sendCode).toHaveBeenCalledWith(
      { id: 'member-1', email: 'operator@acme-trek.vn' },
      OtpPurpose.SET_PASSWORD,
      ISSUED,
    );
  });

  describe('setOrganizationRole (FR-AUTH-06)', () => {
    it('replaces the role with the actor recorded', async () => {
      await expect(
        service.setOrganizationRole('member-1', 'ORG_MANAGER', tx, 'manager-1'),
      ).resolves.toMatchObject({ id: 'member-1', roles: ['ORG_MANAGER'] });
      expect(accounts.replaceRole).toHaveBeenCalledWith('member-1', 'ORG_MANAGER', 'manager-1', tx);
    });

    it('changes nothing when the account already holds the role, and records no actor by default', async () => {
      await service.setOrganizationRole('member-1', 'ORG_OPERATOR', tx);
      expect(accounts.replaceRole).not.toHaveBeenCalled();

      await service.setOrganizationRole('member-1', 'ORG_MANAGER', tx);
      expect(accounts.replaceRole).toHaveBeenCalledWith('member-1', 'ORG_MANAGER', null, tx);
    });

    it.each([
      ['an unknown account', null],
      ['a TrekLink account', anAccount()],
      ['a soft-deleted account', { ...member, deletedAt: NOW }],
    ])('answers 404 for %s', async (_label, account) => {
      accounts.findById.mockResolvedValue(account);
      await expect(service.setOrganizationRole('x', 'ORG_MANAGER', tx)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
    });
  });

  describe('deactivateOrganizationAccount (FR-AUTH-07, REQ-EVT-07)', () => {
    it('deactivates, revokes every session, records the event and audits after commit', async () => {
      await expect(
        events.transaction((client) =>
          service.deactivateOrganizationAccount(
            'member-1',
            'left the company',
            MANAGER,
            client,
            NOW,
          ),
        ),
      ).resolves.toMatchObject({ id: 'member-1', isActive: false });

      expect(accounts.setActive).toHaveBeenCalledWith('member-1', false, tx);
      expect(accounts.revokeAllUserTokens).toHaveBeenCalledWith('member-1', NOW, tx);
      expect(accounts.insertAuthEvent).toHaveBeenCalledWith(
        {
          userId: 'member-1',
          email: 'operator@acme-trek.vn',
          type: AuthEventType.ACCOUNT_DEACTIVATED,
          ip: null,
          userAgent: null,
        },
        tx,
      );
      expect(emitted(AUDIT_RECORD)).toEqual([
        {
          actorId: 'manager-1',
          actorRoles: ['ORG_MANAGER'],
          organizationId: 'org-1',
          action: 'account.deactivate',
          subjectType: 'Account',
          subjectId: 'member-1',
          before: { isActive: true },
          after: { isActive: false, reason: 'left the company' },
        },
      ]);
    });

    it('records SYSTEM when no actor is given, at the current time by default', async () => {
      await events.transaction((client) =>
        service.deactivateOrganizationAccount('member-1', 'organization closed', null, client),
      );
      expect(emitted(AUDIT_RECORD)[0]).toMatchObject({
        actorId: null,
        actorRoles: [],
        organizationId: null,
      });
      expect(accounts.revokeAllUserTokens).toHaveBeenCalledWith('member-1', expect.any(Date), tx);
    });

    it('changes nothing for an account that is already inactive', async () => {
      accounts.findById.mockResolvedValue({ ...member, isActive: false });
      await expect(
        service.deactivateOrganizationAccount('member-1', 'again', MANAGER, tx, NOW),
      ).resolves.toMatchObject({ isActive: false });
      expect(accounts.setActive).not.toHaveBeenCalled();
      expect(accounts.insertAuthEvent).not.toHaveBeenCalled();
    });
  });

  describe('contactCard (incidents)', () => {
    it('reads the cards of the given accounts', async () => {
      await expect(service.contactCard(['member-1'])).resolves.toEqual([{ id: 'member-1' }]);
      expect(accounts.contactCards).toHaveBeenCalledWith(['member-1']);
    });

    it('answers an empty list without a query', async () => {
      await expect(service.contactCard([])).resolves.toEqual([]);
      expect(accounts.contactCards).not.toHaveBeenCalled();
    });
  });
});
