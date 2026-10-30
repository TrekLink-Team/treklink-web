import { ConfigService } from '@nestjs/config';
import { AccountType, AuthEventType, OtpPurpose, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { AccountsRepository, AccountView } from './accounts.repository';
import { AccountsService } from './accounts.service';
import { OneTimeCodeService } from './one-time-code.service';
import { PasswordFlowsService } from './password-flows.service';
import { CLIENT } from './testing/auth-fixtures';

const tx = { tx: true } as unknown as Prisma.TransactionClient;
const NOW = new Date('2026-10-24T03:00:00.000Z');
const ADMIN = { id: 'admin-1', roles: ['ADMIN'], organizationId: null };
const ISSUED = { code: '739104', lifetimeMs: 72 * 3_600_000 };

const view = (overrides: Partial<AccountView> = {}): AccountView => ({
  id: 'staff-1',
  email: 'staff@treklink.vn',
  fullName: 'Tran Thi B',
  phoneNumber: null,
  accountType: AccountType.TREKLINK,
  isActive: true,
  lastLoginAt: null,
  createdAt: NOW,
  roles: ['STAFF'],
  ...overrides,
});

describe('AccountsService', () => {
  let accounts: Record<string, jest.Mock>;
  let codes: { issue: jest.Mock };
  let passwords: { sendCode: jest.Mock };
  let events: { transaction: jest.Mock; emitAfterCommit: jest.Mock };
  let service: AccountsService;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    accounts = {
      pageTreklinkAccounts: jest.fn().mockResolvedValue([[view()], 1]),
      create: jest.fn().mockResolvedValue({ id: 'staff-2' }),
      findTreklinkAccount: jest.fn().mockResolvedValue(view()),
      lockAdminChanges: jest.fn().mockResolvedValue(undefined),
      countActiveAdmins: jest.fn().mockResolvedValue(2),
      replaceRole: jest.fn().mockResolvedValue(undefined),
      updateProfile: jest.fn().mockResolvedValue(undefined),
      setActive: jest.fn().mockResolvedValue(undefined),
      revokeAllUserTokens: jest.fn().mockResolvedValue(undefined),
      insertAuthEvent: jest.fn().mockResolvedValue(undefined),
      activeStaffIds: jest.fn().mockResolvedValue(['staff-1']),
    };
    codes = { issue: jest.fn().mockResolvedValue(ISSUED) };
    passwords = { sendCode: jest.fn().mockResolvedValue(undefined) };
    events = {
      transaction: jest.fn((work: (client: Prisma.TransactionClient) => unknown) => work(tx)),
      emitAfterCommit: jest.fn(),
    };
    const config = {
      get: jest.fn((key: string) => (key === 'DEFAULT_PAGE_SIZE' ? 20 : 100)),
    };
    service = new AccountsService(
      accounts as unknown as AccountsRepository,
      codes as unknown as OneTimeCodeService,
      passwords as unknown as PasswordFlowsService,
      events as unknown as TransactionalEvents,
      config as unknown as ConfigService<ValidatedEnvironment, true>,
    );
  });

  afterEach(() => jest.useRealTimers());

  const audited = () => events.emitAfterCommit.mock.calls.map(([, event]) => event as object);

  describe('list (api-design 09)', () => {
    it('pages TrekLink accounts with the filters and the default page size', async () => {
      await expect(service.list({ q: 'tran', isActive: true })).resolves.toEqual({
        items: [view()],
        pageNumber: 1,
        pageSize: 20,
        totalCount: 1,
        totalPages: 1,
      });
      expect(accounts.pageTreklinkAccounts).toHaveBeenCalledWith(
        { q: 'tran', isActive: true },
        0,
        20,
      );
    });

    it('refuses a page size above MAX_PAGE_SIZE', async () => {
      await expect(service.list({ pageSize: 101 })).rejects.toMatchObject({
        errorCode: ErrorCode.VALIDATION_FAILED,
      });
    });
  });

  describe('create (api-design 10)', () => {
    it('creates the account without a password, invites it and audits the creation', async () => {
      accounts.findTreklinkAccount.mockResolvedValue(view({ id: 'staff-2' }));

      await expect(
        service.create(
          ADMIN,
          { email: 'staff2@treklink.vn', fullName: 'Le Van C', role: 'STAFF' },
          CLIENT,
        ),
      ).resolves.toEqual(view({ id: 'staff-2' }));

      expect(accounts.create).toHaveBeenCalledWith(
        {
          email: 'staff2@treklink.vn',
          fullName: 'Le Van C',
          accountType: AccountType.TREKLINK,
          roleKeys: ['STAFF'],
          createdById: 'admin-1',
        },
        tx,
      );
      expect(codes.issue).toHaveBeenCalledWith('staff-2', OtpPurpose.SET_PASSWORD, NOW, tx);
      expect(passwords.sendCode).toHaveBeenCalledWith(
        view({ id: 'staff-2' }),
        OtpPurpose.SET_PASSWORD,
        ISSUED,
      );
      expect(events.emitAfterCommit).toHaveBeenCalledWith(
        AUDIT_RECORD,
        expect.objectContaining({
          action: 'account.create',
          subjectId: 'staff-2',
          actorId: 'admin-1',
          after: { email: 'staff@treklink.vn', role: 'STAFF' },
        }),
      );
    });

    it('sends nothing when the email is already registered (MSG10)', async () => {
      accounts.create.mockRejectedValue(new Error('conflict'));

      await expect(
        service.create(ADMIN, { email: 'a@treklink.vn', fullName: 'A', role: 'ADMIN' }, CLIENT),
      ).rejects.toThrow('conflict');
      expect(passwords.sendCode).not.toHaveBeenCalled();
    });
  });

  describe('update (api-design 11)', () => {
    it('changes the profile without taking the Admin lock when the role is not sent', async () => {
      accounts.findTreklinkAccount
        .mockResolvedValueOnce(view())
        .mockResolvedValueOnce(view({ fullName: 'Tran Thi C', phoneNumber: '0901234567' }));

      await expect(
        service.update(
          ADMIN,
          'staff-1',
          { fullName: 'Tran Thi C', phoneNumber: '0901234567' },
          CLIENT,
        ),
      ).resolves.toMatchObject({ fullName: 'Tran Thi C' });

      expect(accounts.lockAdminChanges).not.toHaveBeenCalled();
      expect(accounts.replaceRole).not.toHaveBeenCalled();
      expect(accounts.updateProfile).toHaveBeenCalledWith(
        'staff-1',
        { fullName: 'Tran Thi C', phoneNumber: '0901234567' },
        tx,
      );
      expect(audited()).toContainEqual(
        expect.objectContaining({
          action: 'account.update',
          before: { fullName: 'Tran Thi B', phoneNumber: null, roles: ['STAFF'] },
          after: { fullName: 'Tran Thi C', phoneNumber: '0901234567', roles: ['STAFF'] },
        }),
      );
    });

    it('promotes Staff to Admin under the lock (FR-AUTH-06)', async () => {
      await service.update(ADMIN, 'staff-1', { role: 'ADMIN' }, CLIENT);

      expect(accounts.lockAdminChanges).toHaveBeenCalledWith(tx);
      expect(accounts.countActiveAdmins).not.toHaveBeenCalled();
      expect(accounts.replaceRole).toHaveBeenCalledWith('staff-1', 'ADMIN', 'admin-1', tx);
      expect(accounts.updateProfile).not.toHaveBeenCalled();
    });

    it('leaves an unchanged role alone', async () => {
      await service.update(ADMIN, 'staff-1', { role: 'STAFF' }, CLIENT);
      expect(accounts.replaceRole).not.toHaveBeenCalled();
    });

    it('demotes another Admin while a second Admin stays active', async () => {
      accounts.findTreklinkAccount.mockResolvedValue(view({ id: 'admin-2', roles: ['ADMIN'] }));

      await service.update(ADMIN, 'admin-2', { role: 'STAFF' }, CLIENT);
      expect(accounts.replaceRole).toHaveBeenCalledWith('admin-2', 'STAFF', 'admin-1', tx);
    });

    it('demotes an inactive Admin without counting', async () => {
      accounts.findTreklinkAccount.mockResolvedValue(
        view({ id: 'admin-2', roles: ['ADMIN'], isActive: false }),
      );

      await service.update(ADMIN, 'admin-2', { role: 'STAFF' }, CLIENT);
      expect(accounts.countActiveAdmins).not.toHaveBeenCalled();
    });

    it('refuses to remove the caller own Admin role (SELF_DEMOTION, MSG39)', async () => {
      accounts.findTreklinkAccount.mockResolvedValue(view({ id: 'admin-1', roles: ['ADMIN'] }));

      await expect(
        service.update(ADMIN, 'admin-1', { role: 'STAFF' }, CLIENT),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.SELF_DEMOTION,
        message: 'You cannot remove your own Admin role.',
      });
      expect(accounts.replaceRole).not.toHaveBeenCalled();
    });

    it('refuses to demote the last active Admin (LAST_ADMIN, MSG37)', async () => {
      accounts.findTreklinkAccount.mockResolvedValue(view({ id: 'admin-2', roles: ['ADMIN'] }));
      accounts.countActiveAdmins.mockResolvedValue(1);

      await expect(
        service.update(ADMIN, 'admin-2', { role: 'STAFF' }, CLIENT),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.LAST_ADMIN,
        message: 'At least one Admin must stay active.',
      });
    });

    it('answers 404 for an account that is not a TrekLink account', async () => {
      accounts.findTreklinkAccount.mockResolvedValue(null);

      await expect(
        service.update(ADMIN, 'member-1', { fullName: 'X' }, CLIENT),
      ).rejects.toMatchObject({ errorCode: ErrorCode.NOT_FOUND, message: 'Account not found.' });
    });
  });

  describe('deactivate (api-design 12)', () => {
    it('deactivates, ends every session, records the event and audits the reason (FR-AUTH-07)', async () => {
      await expect(
        service.deactivate(ADMIN, 'staff-1', 'Left the company', CLIENT),
      ).resolves.toMatchObject({ id: 'staff-1', isActive: false });

      expect(accounts.lockAdminChanges).toHaveBeenCalledWith(tx);
      expect(accounts.setActive).toHaveBeenCalledWith('staff-1', false, tx);
      expect(accounts.revokeAllUserTokens).toHaveBeenCalledWith('staff-1', NOW, tx);
      expect(accounts.insertAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'staff-1', type: AuthEventType.ACCOUNT_DEACTIVATED }),
        tx,
      );
      expect(audited()).toContainEqual(
        expect.objectContaining({
          action: 'account.deactivate',
          after: { isActive: false, reason: 'Left the company' },
        }),
      );
    });

    it('deactivates an Admin while another Admin stays active', async () => {
      accounts.findTreklinkAccount.mockResolvedValue(view({ id: 'admin-2', roles: ['ADMIN'] }));

      await service.deactivate(ADMIN, 'admin-2', 'Moved on', CLIENT);
      expect(accounts.setActive).toHaveBeenCalledWith('admin-2', false, tx);
    });

    it('refuses to deactivate the last active Admin (LAST_ADMIN)', async () => {
      accounts.findTreklinkAccount.mockResolvedValue(view({ id: 'admin-1', roles: ['ADMIN'] }));
      accounts.countActiveAdmins.mockResolvedValue(1);

      await expect(service.deactivate(ADMIN, 'admin-1', 'Leaving', CLIENT)).rejects.toMatchObject({
        errorCode: ErrorCode.LAST_ADMIN,
      });
      expect(accounts.setActive).not.toHaveBeenCalled();
    });

    it('changes nothing for an account that is already inactive', async () => {
      accounts.findTreklinkAccount.mockResolvedValue(view({ isActive: false }));

      await expect(service.deactivate(ADMIN, 'staff-1', 'Again', CLIENT)).resolves.toMatchObject({
        isActive: false,
      });
      expect(accounts.setActive).not.toHaveBeenCalled();
      expect(events.emitAfterCommit).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown account', async () => {
      accounts.findTreklinkAccount.mockResolvedValue(null);

      await expect(service.deactivate(ADMIN, 'x', 'r', CLIENT)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
    });
  });

  describe('reactivate (api-design 13)', () => {
    it('reactivates an inactive account and records the event', async () => {
      accounts.findTreklinkAccount.mockResolvedValue(view({ isActive: false }));

      await expect(service.reactivate(ADMIN, 'staff-1', CLIENT)).resolves.toMatchObject({
        isActive: true,
      });
      expect(accounts.setActive).toHaveBeenCalledWith('staff-1', true, tx);
      expect(accounts.insertAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: AuthEventType.ACCOUNT_REACTIVATED }),
        tx,
      );
      expect(audited()).toContainEqual(expect.objectContaining({ action: 'account.reactivate' }));
    });

    it('changes nothing for an active account, and answers 404 for an unknown one', async () => {
      await expect(service.reactivate(ADMIN, 'staff-1', CLIENT)).resolves.toMatchObject({
        isActive: true,
      });
      expect(accounts.setActive).not.toHaveBeenCalled();

      accounts.findTreklinkAccount.mockResolvedValue(null);
      await expect(service.reactivate(ADMIN, 'x', CLIENT)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
    });
  });

  it('reads the active Staff ids for incidents inside the caller transaction (D-079)', async () => {
    await expect(service.activeStaffIds(tx)).resolves.toEqual(['staff-1']);
    expect(accounts.activeStaffIds).toHaveBeenCalledWith(tx);
  });
});
