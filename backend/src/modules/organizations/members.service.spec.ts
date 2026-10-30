import { MemberRole, OrganizationStatus, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AccountsService, MEMBER_DEACTIVATED } from '../auth';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { MembersRepository } from './members.repository';
import { MembersService } from './members.service';
import { OrganizationsRepository } from './organizations.repository';
import { RosterRepository } from './roster.repository';

const TX = { tx: true } as unknown as Prisma.TransactionClient;
const AT = new Date('2026-10-30T03:00:00.000Z');
const MANAGER: Caller = { id: 'u-mgr', roles: ['ORG_MANAGER'], organizationId: 'org-1' };

const memberRow = (id: string, role: MemberRole, deactivatedAt: Date | null = null) => ({
  id,
  userId: `u-${id}`,
  role,
  deactivatedAt,
});
// `canSignIn` false is an invitation still waiting for its password: active, no password set.
const card = (id: string, canSignIn: boolean) => ({
  id,
  email: `${id}@example.com`,
  fullName: `Name ${id}`,
  phoneNumber: null,
  isActive: true,
  passwordSet: canSignIn,
});

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainException) return error.errorCode;
    throw error;
  }
  return 'NONE';
};

describe('MembersService (organizations 2.5, api-design 13 to 15)', () => {
  let organizations: { lockById: jest.Mock };
  let members: Record<string, jest.Mock>;
  let roster: { clearMember: jest.Mock };
  let accounts: Record<string, jest.Mock>;
  let emitted: [string, Record<string, unknown>][];
  let service: MembersService;

  beforeEach(() => {
    organizations = {
      lockById: jest.fn().mockResolvedValue({ id: 'org-1', status: OrganizationStatus.ACTIVE }),
    };
    members = {
      addMember: jest.fn().mockImplementation((row: { userId: string; role: MemberRole }) => ({
        id: 'm-new',
        userId: row.userId,
        role: row.role,
        deactivatedAt: null,
      })),
      findInOrganization: jest.fn(),
      liveManagerUserIds: jest.fn().mockResolvedValue([]),
      setRole: jest.fn().mockImplementation((id: string, role: MemberRole) => memberRow(id, role)),
      markDeactivated: jest
        .fn()
        .mockImplementation((id: string, at: Date) => memberRow(id, MemberRole.OPERATOR, at)),
    };
    roster = { clearMember: jest.fn().mockResolvedValue(0) };
    accounts = {
      createOrganizationAccount: jest.fn().mockImplementation((input: { email: string }) => ({
        id: 'u-new',
        email: input.email,
        fullName: 'New Member',
        isActive: true,
        passwordSet: false,
        roles: [],
      })),
      setOrganizationRole: jest.fn().mockResolvedValue({
        id: 'u-m-2',
        email: 'm-2@example.com',
        fullName: 'Name m-2',
        isActive: true,
        passwordSet: true,
        roles: [],
      }),
      deactivateOrganizationAccount: jest.fn().mockResolvedValue({
        id: 'u-m-2',
        email: 'm-2@example.com',
        fullName: 'Name m-2',
        isActive: false,
        passwordSet: true,
        roles: [],
      }),
      contactCard: jest.fn().mockResolvedValue([]),
    };
    emitted = [];
    const events = {
      transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX),
      emitAfterCommit: (name: string, payload: Record<string, unknown>) =>
        emitted.push([name, payload]),
    };
    service = new MembersService(
      organizations as unknown as OrganizationsRepository,
      members as unknown as MembersRepository,
      roster as unknown as RosterRepository,
      accounts as unknown as AccountsService,
      events as unknown as TransactionalEvents,
    );
  });

  // Managers m-1 (the signed-in one) and m-2, with the given activation of each account.
  const twoManagers = (firstActive: boolean, secondActive: boolean) => {
    members.findInOrganization.mockResolvedValue(memberRow('m-2', MemberRole.MANAGER));
    members.liveManagerUserIds.mockResolvedValue(['u-m-1', 'u-m-2']);
    accounts.contactCard.mockResolvedValue([
      card('u-m-1', firstActive),
      card('u-m-2', secondActive),
    ]);
  };

  describe('invite (api-design 13)', () => {
    const INPUT = {
      email: 'operator@example.com',
      fullName: 'Pham Van D',
      phoneNumber: '0907654321',
      role: MemberRole.OPERATOR,
    };

    it('creates the account, the membership and an audit record in one transaction', async () => {
      const view = await service.invite('org-1', INPUT, MANAGER);

      expect(organizations.lockById).toHaveBeenCalledWith('org-1', TX);
      expect(accounts.createOrganizationAccount).toHaveBeenCalledWith(
        {
          email: 'operator@example.com',
          fullName: 'Pham Van D',
          phone: '0907654321',
          role: 'ORG_OPERATOR',
          createdById: 'u-mgr',
        },
        TX,
      );
      expect(members.addMember).toHaveBeenCalledWith(
        {
          organizationId: 'org-1',
          userId: 'u-new',
          role: MemberRole.OPERATOR,
          invitedById: 'u-mgr',
        },
        TX,
      );
      expect(view).toEqual({
        id: 'm-new',
        userId: 'u-new',
        email: 'operator@example.com',
        fullName: 'New Member',
        role: MemberRole.OPERATOR,
        invitationPending: true,
        deactivatedAt: null,
      });
      expect(emitted).toEqual([
        [
          AUDIT_RECORD,
          expect.objectContaining({
            actorId: 'u-mgr',
            organizationId: 'org-1',
            action: 'member.invited',
            subjectType: 'Member',
            subjectId: 'm-new',
            after: { memberId: 'm-new', role: MemberRole.OPERATOR },
          }),
        ],
      ]);
    });

    it('invites a Manager through the Manager role and sends no phone when none is given', async () => {
      await service.invite(
        'org-1',
        { email: 'a@example.com', fullName: 'A', role: MemberRole.MANAGER },
        MANAGER,
      );
      expect(accounts.createOrganizationAccount).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'ORG_MANAGER', phone: null }),
        TX,
      );
    });

    it('also works while the organization is SUSPENDED', async () => {
      organizations.lockById.mockResolvedValue({
        id: 'org-1',
        status: OrganizationStatus.SUSPENDED,
      });
      await expect(service.invite('org-1', INPUT, MANAGER)).resolves.toMatchObject({ id: 'm-new' });
    });

    it.each([OrganizationStatus.PENDING, OrganizationStatus.REJECTED, OrganizationStatus.CLOSED])(
      'refuses an organization that is %s with MSG28 and writes nothing',
      async (status) => {
        organizations.lockById.mockResolvedValue({ id: 'org-1', status });
        const error = await service.invite('org-1', INPUT, MANAGER).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(DomainException);
        expect((error as DomainException).errorCode).toBe(ErrorCode.INVALID_STATE_TRANSITION);
        expect((error as DomainException).message).toBe(
          `This cannot be done while it is ${status}.`,
        );
        expect(accounts.createOrganizationAccount).not.toHaveBeenCalled();
        expect(emitted).toEqual([]);
      },
    );

    it("answers 404 for an organization that is not the caller's, before any read", async () => {
      expect(await codeOf(service.invite('org-9', INPUT, MANAGER))).toBe(ErrorCode.NOT_FOUND);
      expect(
        await codeOf(service.invite('org-1', INPUT, { ...MANAGER, organizationId: null })),
      ).toBe(ErrorCode.NOT_FOUND);
      expect(organizations.lockById).not.toHaveBeenCalled();
    });

    it('answers 404 when the organization row is gone', async () => {
      organizations.lockById.mockResolvedValue(null);
      expect(await codeOf(service.invite('org-1', INPUT, MANAGER))).toBe(ErrorCode.NOT_FOUND);
    });

    it('passes the email conflict of auth through (MSG10)', async () => {
      accounts.createOrganizationAccount.mockRejectedValue(
        new DomainException(409, ErrorCode.CONFLICT_UNIQUE, 'a@example.com is already registered.'),
      );
      expect(await codeOf(service.invite('org-1', INPUT, MANAGER))).toBe(ErrorCode.CONFLICT_UNIQUE);
      expect(members.addMember).not.toHaveBeenCalled();
    });

    it('answers a racing unique violation as CONFLICT_UNIQUE and rethrows anything else', async () => {
      members.addMember.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      expect(await codeOf(service.invite('org-1', INPUT, MANAGER))).toBe(ErrorCode.CONFLICT_UNIQUE);

      members.addMember.mockRejectedValueOnce(new Error('connection lost'));
      await expect(service.invite('org-1', INPUT, MANAGER)).rejects.toThrow('connection lost');
    });
  });

  describe('changeRole (api-design 14)', () => {
    it('promotes an Operator through auth and the membership and records the change', async () => {
      members.findInOrganization.mockResolvedValue(memberRow('m-2', MemberRole.OPERATOR));

      const view = await service.changeRole('org-1', 'm-2', MemberRole.MANAGER, MANAGER);

      expect(accounts.setOrganizationRole).toHaveBeenCalledWith(
        'u-m-2',
        'ORG_MANAGER',
        TX,
        'u-mgr',
      );
      expect(members.setRole).toHaveBeenCalledWith('m-2', MemberRole.MANAGER, TX);
      expect(view).toMatchObject({
        id: 'm-2',
        role: MemberRole.MANAGER,
        email: 'm-2@example.com',
        invitationPending: false,
      });
      expect(emitted).toEqual([
        [
          AUDIT_RECORD,
          expect.objectContaining({
            action: 'member.roleChanged',
            subjectId: 'm-2',
            before: { memberId: 'm-2', role: MemberRole.OPERATOR },
            after: { memberId: 'm-2', role: MemberRole.MANAGER },
          }),
        ],
      ]);
    });

    it('demotes a Manager while another active Manager remains', async () => {
      twoManagers(true, true);
      const view = await service.changeRole('org-1', 'm-2', MemberRole.OPERATOR, MANAGER);
      expect(view.role).toBe(MemberRole.OPERATOR);
      expect(members.setRole).toHaveBeenCalledWith('m-2', MemberRole.OPERATOR, TX);
    });

    it('refuses to demote the last active Manager (AC-03) and writes nothing', async () => {
      members.findInOrganization.mockResolvedValue(memberRow('m-1', MemberRole.MANAGER));
      members.liveManagerUserIds.mockResolvedValue(['u-m-1']);
      accounts.contactCard.mockResolvedValue([card('u-m-1', true)]);

      const error = await service
        .changeRole('org-1', 'm-1', MemberRole.OPERATOR, MANAGER)
        .catch((e: unknown) => e);

      expect((error as DomainException).errorCode).toBe(ErrorCode.LAST_MANAGER);
      expect((error as DomainException).message).toBe(
        'The organization must keep at least one Manager.',
      );
      expect(accounts.setOrganizationRole).not.toHaveBeenCalled();
      expect(members.setRole).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    });

    it('does not count a Manager who has not set a password as another active Manager', async () => {
      members.findInOrganization.mockResolvedValue(memberRow('m-1', MemberRole.MANAGER));
      members.liveManagerUserIds.mockResolvedValue(['u-m-1', 'u-m-2']);
      accounts.contactCard.mockResolvedValue([card('u-m-1', true), card('u-m-2', false)]);
      expect(await codeOf(service.changeRole('org-1', 'm-1', MemberRole.OPERATOR, MANAGER))).toBe(
        ErrorCode.LAST_MANAGER,
      );
    });

    it('lets a pending Manager be demoted, since nobody can sign in as them', async () => {
      members.findInOrganization.mockResolvedValue(memberRow('m-2', MemberRole.MANAGER));
      members.liveManagerUserIds.mockResolvedValue(['u-m-1', 'u-m-2']);
      accounts.contactCard.mockResolvedValue([card('u-m-1', true), card('u-m-2', false)]);
      await expect(
        service.changeRole('org-1', 'm-2', MemberRole.OPERATOR, MANAGER),
      ).resolves.toMatchObject({ role: MemberRole.OPERATOR });
    });

    it('changes nothing when the member already has the role', async () => {
      members.findInOrganization.mockResolvedValue(memberRow('m-2', MemberRole.OPERATOR));
      accounts.contactCard.mockResolvedValue([card('u-m-2', true)]);

      const view = await service.changeRole('org-1', 'm-2', MemberRole.OPERATOR, MANAGER);

      expect(view).toMatchObject({
        id: 'm-2',
        role: MemberRole.OPERATOR,
        email: 'u-m-2@example.com',
      });
      expect(accounts.setOrganizationRole).not.toHaveBeenCalled();
      expect(members.setRole).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    });

    it('answers a view without names when the account card is gone', async () => {
      members.findInOrganization.mockResolvedValue(memberRow('m-2', MemberRole.OPERATOR));
      accounts.contactCard.mockResolvedValue([]);
      await expect(
        service.changeRole('org-1', 'm-2', MemberRole.OPERATOR, MANAGER),
      ).resolves.toMatchObject({ email: null, fullName: null, invitationPending: false });
    });

    it('answers 404 for an unknown member, one of another organization and a deactivated one', async () => {
      members.findInOrganization.mockResolvedValueOnce(null);
      expect(await codeOf(service.changeRole('org-1', 'm-9', MemberRole.MANAGER, MANAGER))).toBe(
        ErrorCode.NOT_FOUND,
      );
      expect(members.findInOrganization).toHaveBeenCalledWith('org-1', 'm-9', TX);

      members.findInOrganization.mockResolvedValueOnce(memberRow('m-3', MemberRole.OPERATOR, AT));
      expect(await codeOf(service.changeRole('org-1', 'm-3', MemberRole.MANAGER, MANAGER))).toBe(
        ErrorCode.NOT_FOUND,
      );
    });

    it('refuses a CLOSED organization and another organization', async () => {
      organizations.lockById.mockResolvedValue({ id: 'org-1', status: OrganizationStatus.CLOSED });
      expect(await codeOf(service.changeRole('org-1', 'm-2', MemberRole.MANAGER, MANAGER))).toBe(
        ErrorCode.INVALID_STATE_TRANSITION,
      );
      expect(await codeOf(service.changeRole('org-2', 'm-2', MemberRole.MANAGER, MANAGER))).toBe(
        ErrorCode.NOT_FOUND,
      );
    });
  });

  describe('deactivate (api-design 15)', () => {
    it('ends the account, marks the member, clears the shifts and emits member.deactivated', async () => {
      members.findInOrganization.mockResolvedValue(memberRow('m-2', MemberRole.OPERATOR));

      const view = await service.deactivate('org-1', 'm-2', 'Left the company', MANAGER, AT);

      expect(accounts.deactivateOrganizationAccount).toHaveBeenCalledWith(
        'u-m-2',
        'Left the company',
        MANAGER,
        TX,
        AT,
      );
      expect(members.markDeactivated).toHaveBeenCalledWith('m-2', AT, TX);
      expect(roster.clearMember).toHaveBeenCalledWith('m-2', AT, TX);
      expect(view).toMatchObject({ id: 'm-2', deactivatedAt: AT, invitationPending: false });
      expect(emitted).toEqual([
        [MEMBER_DEACTIVATED, { userId: 'u-m-2' }],
        [
          AUDIT_RECORD,
          expect.objectContaining({
            action: 'member.deactivated',
            subjectId: 'm-2',
            after: { memberId: 'm-2', deactivatedAt: AT, reason: 'Left the company' },
          }),
        ],
      ]);
    });

    it('uses a default reason when none is given and records no reason', async () => {
      members.findInOrganization.mockResolvedValue(memberRow('m-2', MemberRole.OPERATOR));

      await service.deactivate('org-1', 'm-2', undefined, MANAGER, AT);

      expect(accounts.deactivateOrganizationAccount).toHaveBeenCalledWith(
        'u-m-2',
        'Deactivated by a Manager',
        MANAGER,
        TX,
        AT,
      );
      expect(emitted[1][1]).toMatchObject({ after: { reason: null } });
    });

    it('defaults the time to now', async () => {
      members.findInOrganization.mockResolvedValue(memberRow('m-2', MemberRole.OPERATOR));
      await service.deactivate('org-1', 'm-2', undefined, MANAGER);
      expect(members.markDeactivated).toHaveBeenCalledWith('m-2', expect.any(Date), TX);
    });

    it('lets a Manager deactivate themselves while another active Manager remains', async () => {
      twoManagers(true, true);
      await expect(
        service.deactivate('org-1', 'm-2', undefined, MANAGER, AT),
      ).resolves.toMatchObject({
        id: 'm-2',
      });
    });

    it('refuses to deactivate the last active Manager (AC-03) and writes nothing', async () => {
      members.findInOrganization.mockResolvedValue(memberRow('m-1', MemberRole.MANAGER));
      members.liveManagerUserIds.mockResolvedValue(['u-m-1']);
      accounts.contactCard.mockResolvedValue([card('u-m-1', true)]);

      expect(await codeOf(service.deactivate('org-1', 'm-1', undefined, MANAGER, AT))).toBe(
        ErrorCode.LAST_MANAGER,
      );
      expect(accounts.deactivateOrganizationAccount).not.toHaveBeenCalled();
      expect(members.markDeactivated).not.toHaveBeenCalled();
      expect(roster.clearMember).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    });

    it('answers 404 for an unknown or already deactivated member and refuses a CLOSED organization', async () => {
      members.findInOrganization.mockResolvedValueOnce(null);
      expect(await codeOf(service.deactivate('org-1', 'm-9', undefined, MANAGER, AT))).toBe(
        ErrorCode.NOT_FOUND,
      );

      members.findInOrganization.mockResolvedValueOnce(memberRow('m-3', MemberRole.OPERATOR, AT));
      expect(await codeOf(service.deactivate('org-1', 'm-3', undefined, MANAGER, AT))).toBe(
        ErrorCode.NOT_FOUND,
      );

      organizations.lockById.mockResolvedValue({ id: 'org-1', status: OrganizationStatus.CLOSED });
      expect(await codeOf(service.deactivate('org-1', 'm-2', undefined, MANAGER, AT))).toBe(
        ErrorCode.INVALID_STATE_TRANSITION,
      );
      expect(await codeOf(service.deactivate('org-2', 'm-2', undefined, MANAGER, AT))).toBe(
        ErrorCode.NOT_FOUND,
      );
    });
  });
});
