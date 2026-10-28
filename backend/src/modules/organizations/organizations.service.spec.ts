import { OrganizationStatus, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccountsService } from '../auth';
import { MembersRepository } from './members.repository';
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
        { id: 'u-mgr', email: 'mgr@acme.vn', fullName: 'Nguyen Van A', isActive: true },
        { id: 'u-op', email: 'op@acme.vn', fullName: 'Le Thi B', isActive: false },
      ]),
    };
    service = new OrganizationsService(
      organizations as unknown as OrganizationsRepository,
      members as unknown as MembersRepository,
      accounts as unknown as AccountsService,
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

  it("answers 404 for another organization's members and summary", async () => {
    await expect(service.membersOf('org-1', false, OTHER)).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
    await expect(service.summary('org-1', OTHER)).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
    await expect(service.summary('org-1', MEMBER)).resolves.toMatchObject({ channelKeyVersion: 2 });
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
  let service: OrganizationsService;

  beforeEach(() => {
    organizations = {
      lockById: jest.fn().mockResolvedValue({ status: OrganizationStatus.ACTIVE, version: 4 }),
      update: jest.fn().mockResolvedValue({ id: 'org-1' }),
      addTransition: jest.fn().mockResolvedValue({}),
      contactEmail: jest.fn().mockResolvedValue('manager@example.com'),
    };
    mail = { send: jest.fn().mockResolvedValue(undefined) };
    service = new OrganizationsService(
      organizations as unknown as OrganizationsRepository,
      {} as MembersRepository,
      {} as AccountsService,
      mail,
    );
  });

  it('suspends an ACTIVE organization by SYSTEM with a transition naming the contract', async () => {
    await expect(service.suspendForDefault('org-1', 'RC-2026-0001', AT, tx)).resolves.toBe(true);
    expect(organizations.update).toHaveBeenCalledWith(
      'org-1',
      4,
      { status: OrganizationStatus.SUSPENDED, statusChangedAt: AT },
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
  });

  it('leaves an organization that is not ACTIVE, and one another change won', async () => {
    organizations.lockById.mockResolvedValueOnce({ status: OrganizationStatus.SUSPENDED });
    await expect(service.suspendForDefault('org-1', 'RC-2026-0001', AT, tx)).resolves.toBe(false);
    organizations.update.mockResolvedValueOnce(null);
    await expect(service.suspendForDefault('org-1', 'RC-2026-0001', AT, tx)).resolves.toBe(false);
    expect(organizations.addTransition).not.toHaveBeenCalled();
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
  });
});
