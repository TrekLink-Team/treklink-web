import { OrganizationStatus, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccountsService } from '../auth';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ORGANIZATION_STATUS_CHANGED } from './organization-events';
import { MembersRepository } from './members.repository';
import { OrganizationLifecycle } from './organization-lifecycle';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';

const tx = { tx: true } as unknown as Prisma.TransactionClient;

describe('OrganizationsService.assertActive (FR-CON-02, for rentals 2.1)', () => {
  let organizations: { findStatus: jest.Mock };
  let service: OrganizationsService;

  beforeEach(() => {
    organizations = { findStatus: jest.fn().mockResolvedValue(OrganizationStatus.ACTIVE) };
    service = new OrganizationsService(
      organizations as unknown as OrganizationsRepository,
      {} as MembersRepository,
      {} as AccountsService,
      {} as OrganizationLifecycle,
    );
  });

  it('passes an ACTIVE organization, reading in the caller transaction', async () => {
    await expect(service.assertActive('org-1', tx)).resolves.toBeUndefined();
    expect(organizations.findStatus).toHaveBeenCalledWith('org-1', tx);
  });

  it.each([
    OrganizationStatus.PENDING,
    OrganizationStatus.REJECTED,
    OrganizationStatus.SUSPENDED,
    OrganizationStatus.CLOSED,
  ])('refuses a %s organization with 409 ORGANIZATION_NOT_ACTIVE', async (status) => {
    organizations.findStatus.mockResolvedValue(status);
    await expect(service.assertActive('org-1')).rejects.toMatchObject({
      errorCode: ErrorCode.ORGANIZATION_NOT_ACTIVE,
      message: `Your organization cannot request devices while it is ${status}.`,
    });
  });

  it('answers 404 for an unknown organization', async () => {
    organizations.findStatus.mockResolvedValue(null);
    await expect(service.assertActive('org-9')).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
  });
});

describe('OrganizationsService.lockActive (rentals api-design 01 against a closing)', () => {
  let organizations: { lockStatus: jest.Mock; findStatus: jest.Mock };
  let service: OrganizationsService;

  beforeEach(() => {
    organizations = {
      lockStatus: jest.fn().mockResolvedValue(OrganizationStatus.ACTIVE),
      findStatus: jest.fn(),
    };
    service = new OrganizationsService(
      organizations as unknown as OrganizationsRepository,
      {} as MembersRepository,
      {} as AccountsService,
      {} as OrganizationLifecycle,
    );
  });

  it('passes an ACTIVE organization, reading under the lock in the caller transaction', async () => {
    await expect(service.lockActive('org-1', tx)).resolves.toBeUndefined();
    expect(organizations.lockStatus).toHaveBeenCalledWith('org-1', tx);
    expect(organizations.findStatus).not.toHaveBeenCalled();
  });

  it('refuses an organization a committed closing left CLOSED with 409 ORGANIZATION_NOT_ACTIVE', async () => {
    organizations.lockStatus.mockResolvedValue(OrganizationStatus.CLOSED);
    await expect(service.lockActive('org-1', tx)).rejects.toMatchObject({
      errorCode: ErrorCode.ORGANIZATION_NOT_ACTIVE,
      message: 'Your organization cannot request devices while it is CLOSED.',
    });
  });

  it('answers 404 for an unknown organization', async () => {
    organizations.lockStatus.mockResolvedValue(null);
    await expect(service.lockActive('org-9', tx)).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
  });
});

describe('OrganizationsRepository.lockStatus', () => {
  it('reads the status FOR SHARE in the transaction, null for an unknown id', async () => {
    const $queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ status: OrganizationStatus.ACTIVE }])
      .mockResolvedValueOnce([]);
    const client = { $queryRaw } as unknown as Prisma.TransactionClient;
    const repository = new OrganizationsRepository({} as PrismaService);

    await expect(repository.lockStatus('org-1', client)).resolves.toBe(OrganizationStatus.ACTIVE);
    await expect(repository.lockStatus('org-9', client)).resolves.toBeNull();
    const [sql, id] = $queryRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(sql.join('?')).toMatch(/SELECT status FROM organizations WHERE id = \? FOR SHARE/);
    expect(id).toBe('org-1');
  });
});

describe('OrganizationsRepository.findStatus', () => {
  it('reads the status, null for an unknown id, on the shared client or a transaction', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ status: OrganizationStatus.ACTIVE })
      .mockResolvedValueOnce(null);
    const prisma = { organization: { findUnique } };
    const repository = new OrganizationsRepository(prisma as unknown as PrismaService);

    await expect(repository.findStatus('org-1')).resolves.toBe(OrganizationStatus.ACTIVE);
    await expect(
      repository.findStatus('org-9', prisma as unknown as Prisma.TransactionClient),
    ).resolves.toBeNull();
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'org-1' }, select: { status: true } });
  });
});

describe('OrganizationsService reads for the counter handover (screen 5.4)', () => {
  const STAFF = { id: 'u-staff', roles: ['STAFF'], organizationId: null };
  const MEMBER = { id: 'u-mgr', roles: ['ORG_MANAGER'], organizationId: 'org-1' };
  const OTHER = { id: 'u-x', roles: ['ORG_MANAGER'], organizationId: 'org-2' };
  let organizations: Record<string, jest.Mock>;
  let members: Record<string, jest.Mock>;
  let service: OrganizationsService;

  beforeEach(() => {
    organizations = {
      findStatus: jest.fn().mockResolvedValue(OrganizationStatus.ACTIVE),
      findSummary: jest.fn().mockResolvedValue({ id: 'org-1', channelKeyVersion: 2 }),
      channelKeyVersion: jest.fn().mockResolvedValue(2),
      party: jest.fn().mockResolvedValue({
        id: 'org-1',
        code: 'ORG-0001',
        legalName: 'Acme Trek',
        taxCode: '0109876543',
        address: '12 Le Loi, Da Lat',
        masterContractRef: 'MC-2026-017',
        ndaSigned: true,
        softwareLicenceSigned: true,
      }),
    };
    members = {
      membersOf: jest.fn().mockResolvedValue([
        { id: 'm-1', userId: 'u-mgr', role: 'MANAGER', deactivatedAt: null },
        { id: 'm-2', userId: 'u-op', role: 'OPERATOR', deactivatedAt: null },
      ]),
      findLiveMember: jest.fn().mockResolvedValue({ role: 'MANAGER' }),
    };
    const accounts = {
      contactCard: jest.fn().mockResolvedValue([
        {
          id: 'u-mgr',
          email: 'mgr@acme.vn',
          fullName: 'Nguyen Van A',
          isActive: true,
          passwordSet: true,
        },
        // An invited account is active from creation and waits only for its password.
        {
          id: 'u-op',
          email: 'op@acme.vn',
          fullName: 'Le Thi B',
          isActive: true,
          passwordSet: false,
        },
      ]),
    };
    service = new OrganizationsService(
      organizations as unknown as OrganizationsRepository,
      members as unknown as MembersRepository,
      accounts as unknown as AccountsService,
      {} as OrganizationLifecycle,
    );
  });

  it('lists members with names, and an invitation pending while the account is inactive', async () => {
    await expect(service.membersOf('org-1', false, STAFF)).resolves.toEqual([
      expect.objectContaining({
        userId: 'u-mgr',
        fullName: 'Nguyen Van A',
        invitationPending: false,
      }),
      expect.objectContaining({ userId: 'u-op', role: 'OPERATOR', invitationPending: true }),
    ]);
    expect(members.membersOf).toHaveBeenCalledWith('org-1', false);
  });

  it('does not show a deactivated member as an invitation pending', async () => {
    members.membersOf.mockResolvedValueOnce([
      {
        id: 'm-3',
        userId: 'u-op',
        role: 'OPERATOR',
        deactivatedAt: new Date('2026-10-20T03:15:00Z'),
      },
    ]);
    await expect(service.membersOf('org-1', true, STAFF)).resolves.toEqual([
      expect.objectContaining({ userId: 'u-op', invitationPending: false }),
    ]);
  });

  it("answers 404 for another organization's members and summary", async () => {
    await expect(service.membersOf('org-1', false, OTHER)).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
    await expect(service.summary('org-1', OTHER)).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
    await expect(service.summary('org-1', MEMBER)).resolves.toMatchObject({ channelKeyVersion: 2 });
  });

  it('reads Party B of the handover note in the caller transaction', async () => {
    const tx = {} as never;
    await expect(service.handoverParty('org-1', tx)).resolves.toMatchObject({
      legalName: 'Acme Trek',
      taxCode: '0109876543',
      masterContractRef: 'MC-2026-017',
    });
    expect(organizations.party).toHaveBeenCalledWith('org-1', tx);
  });

  it('tells a live Manager from an Operator or a former member', async () => {
    await expect(service.isActiveManager('org-1', 'u-mgr')).resolves.toBe(true);
    members.findLiveMember.mockResolvedValueOnce({ role: 'OPERATOR' });
    await expect(service.isActiveManager('org-1', 'u-op')).resolves.toBe(false);
    members.findLiveMember.mockResolvedValueOnce(null);
    await expect(service.isActiveManager('org-1', 'u-gone')).resolves.toBe(false);
  });
});

describe('OrganizationsService for rentals 3.2 (suspendForDefault, emailContact)', () => {
  const AT = new Date('2026-11-30T03:00:00.000Z');
  let organizations: Record<string, jest.Mock>;
  let mail: { send: jest.Mock };
  let emitted: [string, Record<string, unknown>][];
  let service: OrganizationsService;

  beforeEach(() => {
    organizations = {
      lockById: jest.fn().mockResolvedValue({ status: OrganizationStatus.ACTIVE, version: 4 }),
      update: jest.fn().mockResolvedValue({ id: 'org-1' }),
      addTransition: jest.fn().mockResolvedValue({}),
      contactEmail: jest.fn().mockResolvedValue('manager@example.com'),
    };
    mail = { send: jest.fn().mockResolvedValue(undefined) };
    emitted = [];
    const events = {
      emitAfterCommit: (name: string, payload: Record<string, unknown>) =>
        emitted.push([name, payload]),
    };
    service = new OrganizationsService(
      organizations as unknown as OrganizationsRepository,
      {} as MembersRepository,
      {} as AccountsService,
      new OrganizationLifecycle(
        organizations as unknown as OrganizationsRepository,
        events as unknown as TransactionalEvents,
      ),
      mail,
    );
  });

  it('suspends an ACTIVE organization by SYSTEM with a transition naming the contract', async () => {
    await expect(service.suspendForDefault('org-1', 'RC-2026-0001', AT, tx)).resolves.toBe(true);
    expect(organizations.update).toHaveBeenCalledWith(
      'org-1',
      4,
      {
        suspensionReason: 'Contract RC-2026-0001 defaulted',
        status: OrganizationStatus.SUSPENDED,
        statusChangedAt: AT,
      },
      tx,
    );
    expect(organizations.addTransition).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        fromStatus: OrganizationStatus.ACTIVE,
        toStatus: OrganizationStatus.SUSPENDED,
        actorId: null,
        reason: 'Contract RC-2026-0001 defaulted',
      },
      tx,
    );
    expect(emitted).toEqual([
      [
        ORGANIZATION_STATUS_CHANGED,
        {
          organizationId: 'org-1',
          from: OrganizationStatus.ACTIVE,
          to: OrganizationStatus.SUSPENDED,
        },
      ],
      [
        AUDIT_RECORD,
        expect.objectContaining({
          actorId: null,
          actorRoles: [],
          action: 'organization.suspended',
          before: { status: OrganizationStatus.ACTIVE },
        }),
      ],
    ]);
  });

  it('leaves an organization that is not ACTIVE, or one that is gone, as it is', async () => {
    organizations.lockById.mockResolvedValueOnce({ status: OrganizationStatus.SUSPENDED });
    await expect(service.suspendForDefault('org-1', 'RC-2026-0001', AT, tx)).resolves.toBe(false);
    organizations.lockById.mockResolvedValueOnce(null);
    await expect(service.suspendForDefault('org-1', 'RC-2026-0001', AT, tx)).resolves.toBe(false);
    expect(organizations.update).not.toHaveBeenCalled();
    expect(organizations.addTransition).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it('emails the contact address, and reports a failed send without throwing', async () => {
    await expect(service.emailContact('org-1', 'Subject', 'Text')).resolves.toBe(true);
    expect(mail.send).toHaveBeenCalledWith({
      to: 'manager@example.com',
      subject: 'Subject',
      text: 'Text',
    });
    mail.send.mockRejectedValueOnce(new Error('SMTP down'));
    await expect(service.emailContact('org-1', 'Subject', 'Text')).resolves.toBe(false);
    await service.emailContact('org-1', 'Subject', 'Text', tx);
    expect(organizations.contactEmail).toHaveBeenLastCalledWith('org-1', tx);
  });
});

describe('OrganizationsService.suspendFromCompliance (task 2.10, api-design 30)', () => {
  const AT = new Date('2026-10-30T03:00:00.000Z');
  const ADMIN: Caller = { id: 'u-admin', roles: ['ADMIN'], organizationId: null };
  let organizations: Record<string, jest.Mock>;
  let service: OrganizationsService;

  beforeEach(() => {
    organizations = {
      lockById: jest.fn().mockResolvedValue({ status: OrganizationStatus.ACTIVE, version: 4 }),
      update: jest.fn().mockResolvedValue({ id: 'org-1' }),
      addTransition: jest.fn().mockResolvedValue({}),
    };
    service = new OrganizationsService(
      organizations as unknown as OrganizationsRepository,
      {} as MembersRepository,
      {} as AccountsService,
      {} as OrganizationLifecycle,
      { send: jest.fn() },
    );
  });

  it('suspends an ACTIVE organization, naming the Admin and the compliance reason', async () => {
    await service.suspendFromCompliance('org-1', 'Compliance case CMP-0002: Stolen', ADMIN, AT, tx);
    expect(organizations.update).toHaveBeenCalledWith(
      'org-1',
      4,
      {
        status: OrganizationStatus.SUSPENDED,
        statusChangedAt: AT,
        suspensionReason: 'Compliance case CMP-0002: Stolen',
      },
      tx,
    );
    expect(organizations.addTransition).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        fromStatus: OrganizationStatus.ACTIVE,
        toStatus: OrganizationStatus.SUSPENDED,
        actorId: 'u-admin',
        reason: 'Compliance case CMP-0002: Stolen',
      },
      tx,
    );
  });

  it('answers 404 for an unknown organization', async () => {
    organizations.lockById.mockResolvedValueOnce(null);
    await expect(service.suspendFromCompliance('org-9', 'x', ADMIN, AT, tx)).rejects.toMatchObject({
      errorCode: 'NOT_FOUND',
    });
    expect(organizations.update).not.toHaveBeenCalled();
  });

  it('answers 409 INVALID_STATE_TRANSITION for an organization that is not ACTIVE', async () => {
    organizations.lockById.mockResolvedValueOnce({
      status: OrganizationStatus.SUSPENDED,
      version: 2,
    });
    await expect(service.suspendFromCompliance('org-1', 'x', ADMIN, AT, tx)).rejects.toMatchObject({
      errorCode: 'INVALID_STATE_TRANSITION',
    });
    expect(organizations.update).not.toHaveBeenCalled();
    expect(organizations.addTransition).not.toHaveBeenCalled();
  });
});
