import { createMongoAbility } from '@casl/ability';
import { OrganizationStatus, Prisma } from '@prisma/client';
import { Caller, PolicyAbility } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AccountsService, MEMBER_DEACTIVATED } from '../auth';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { API_KEY_REVOKED } from './api-key-events';
import { ApiKeysRepository } from './api-keys.repository';
import { FIELD_STATION_REVOKED } from './field-station-events';
import { FieldStationsRepository } from './field-stations.repository';
import { MembersRepository } from './members.repository';
import { ORGANIZATION_STATUS_CHANGED } from './organization-events';
import { OrganizationLifecycle } from './organization-lifecycle';
import { OrganizationStatusService } from './organization-status.service';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';
import { OrganizationExitCheck } from './ports/exit-checks.port';

const TX = { tx: true } as unknown as Prisma.TransactionClient;
const AT = new Date('2026-10-30T03:00:00.000Z');
const ADMIN: Caller = { id: 'u-admin', roles: ['ADMIN'], organizationId: null };
const STAFF: Caller = { id: 'u-staff', roles: ['STAFF'], organizationId: null };
const MANAGER: Caller = { id: 'u-mgr', roles: ['ORG_MANAGER'], organizationId: 'org-1' };
const OPERATOR: Caller = { id: 'u-op', roles: ['ORG_OPERATOR'], organizationId: 'org-1' };
const OTHER_MANAGER: Caller = { id: 'u-mgr-9', roles: ['ORG_MANAGER'], organizationId: 'org-9' };

// The seeded rules the history read looks at: Staff and Admin read any organization, a member its own,
// and only the Manager holds `organization.history.read.own` (migration 20261030210000).
const OWN = (caller: Caller) => ({ id: caller.organizationId });
const abilityOf = (caller: Caller, history = caller.roles.includes('ORG_MANAGER')) =>
  createMongoAbility(
    caller.organizationId === null
      ? [{ action: 'read', subject: 'Organization' }]
      : [
          { action: 'read', subject: 'Organization', conditions: OWN(caller) },
          ...(history
            ? [{ action: 'readHistory', subject: 'Organization', conditions: OWN(caller) }]
            : []),
        ],
  ) as unknown as PolicyAbility;
const transitionsOf = (service: OrganizationStatusService, id: string, caller: Caller) =>
  service.transitions(id, caller, abilityOf(caller));

const row = (status: OrganizationStatus, version = 3) => ({
  id: 'org-1',
  code: 'ORG-0007',
  legalName: 'ACME Trek Co., Ltd.',
  status,
  version,
  verifiedAt: AT,
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

describe('OrganizationStatusService (organizations 2.4, api-design 08 to 11, UC-07)', () => {
  let organizations: Record<string, jest.Mock>;
  let members: Record<string, jest.Mock>;
  let apiKeys: Record<string, jest.Mock>;
  let stations: Record<string, jest.Mock>;
  let accounts: Record<string, jest.Mock>;
  let organizationsService: { emailContact: jest.Mock };
  let checks: OrganizationExitCheck[];
  let emitted: [string, Record<string, unknown>][];
  let service: OrganizationStatusService;

  const build = (exitChecks: OrganizationExitCheck[] | undefined = checks) => {
    const events = {
      transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX),
      emitAfterCommit: (name: string, payload: Record<string, unknown>) =>
        emitted.push([name, payload]),
    };
    return new OrganizationStatusService(
      new OrganizationLifecycle(
        organizations as unknown as OrganizationsRepository,
        events as unknown as TransactionalEvents,
      ),
      organizations as unknown as OrganizationsRepository,
      organizationsService as unknown as OrganizationsService,
      members as unknown as MembersRepository,
      apiKeys as unknown as ApiKeysRepository,
      stations as unknown as FieldStationsRepository,
      accounts as unknown as AccountsService,
      events as unknown as TransactionalEvents,
      exitChecks,
    );
  };

  // A check whose two answers are mocks, so the test can read how they were called.
  interface MockedCheck {
    canReactivate: jest.Mock;
    canClose: jest.Mock;
  }
  const exitCheck = (overrides: Partial<MockedCheck> = {}): MockedCheck => ({
    canReactivate: jest.fn().mockResolvedValue(null),
    canClose: jest.fn().mockResolvedValue(null),
    ...overrides,
  });

  beforeEach(() => {
    organizations = {
      lockById: jest.fn().mockResolvedValue(row(OrganizationStatus.ACTIVE)),
      update: jest.fn().mockImplementation((id: string, version: number, data: object) => ({
        ...row(OrganizationStatus.ACTIVE),
        id,
        version: version + 1,
        ...data,
      })),
      addTransition: jest.fn().mockResolvedValue({}),
      findStatus: jest.fn().mockResolvedValue(OrganizationStatus.ACTIVE),
      transitionsOf: jest.fn().mockResolvedValue([]),
    };
    members = {
      membersOf: jest.fn().mockResolvedValue([]),
      markDeactivated: jest.fn().mockResolvedValue({}),
    };
    apiKeys = { revokeAllActive: jest.fn().mockResolvedValue([]) };
    stations = { revokeAllActive: jest.fn().mockResolvedValue([]) };
    accounts = {
      deactivateOrganizationAccount: jest.fn().mockResolvedValue({}),
      contactCard: jest.fn().mockResolvedValue([]),
    };
    organizationsService = { emailContact: jest.fn().mockResolvedValue(true) };
    checks = [];
    emitted = [];
    service = build();
  });

  describe('suspend (api-design 08)', () => {
    it('suspends an ACTIVE organization with the reason, and emails its Manager', async () => {
      const saved = await service.suspend('org-1', 'Unpaid balance', 3, ADMIN, AT);

      expect(organizations.update).toHaveBeenCalledWith(
        'org-1',
        3,
        {
          suspensionReason: 'Unpaid balance',
          status: OrganizationStatus.SUSPENDED,
          statusChangedAt: AT,
        },
        TX,
      );
      expect(organizations.addTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          fromStatus: OrganizationStatus.ACTIVE,
          toStatus: OrganizationStatus.SUSPENDED,
          actorId: 'u-admin',
          reason: 'Unpaid balance',
        }),
        TX,
      );
      expect(saved.version).toBe(4);
      expect(emitted.map(([name]) => name)).toEqual([ORGANIZATION_STATUS_CHANGED, AUDIT_RECORD]);
      expect(emitted[1][1]).toMatchObject({ action: 'organization.suspended' });
      expect(organizationsService.emailContact).toHaveBeenCalledWith(
        'org-1',
        'Your TrekLink organization ORG-0007 is suspended',
        expect.stringContaining('ACME Trek Co., Ltd. was suspended: Unpaid balance'),
      );
    });

    it('refuses an organization that is not ACTIVE, a stale version and an unknown id, and sends no email', async () => {
      organizations.lockById.mockResolvedValueOnce(row(OrganizationStatus.PENDING));
      expect(await codeOf(service.suspend('org-1', 'x', 3, ADMIN, AT))).toBe(
        ErrorCode.INVALID_STATE_TRANSITION,
      );
      organizations.update.mockResolvedValueOnce(null);
      expect(await codeOf(service.suspend('org-1', 'x', 2, ADMIN, AT))).toBe(
        ErrorCode.STALE_VERSION,
      );
      organizations.lockById.mockResolvedValueOnce(null);
      expect(await codeOf(service.suspend('org-9', 'x', 3, ADMIN, AT))).toBe(ErrorCode.NOT_FOUND);
      expect(organizationsService.emailContact).not.toHaveBeenCalled();
    });

    it('defaults the time to now', async () => {
      await service.suspend('org-1', 'x', 3, ADMIN);
      expect(organizations.update).toHaveBeenCalledWith(
        'org-1',
        3,
        expect.objectContaining({ statusChangedAt: expect.any(Date) as unknown }),
        TX,
      );
    });
  });

  describe('reactivate (api-design 09)', () => {
    beforeEach(() => {
      organizations.lockById.mockResolvedValue(row(OrganizationStatus.SUSPENDED));
    });

    it('returns a SUSPENDED organization to ACTIVE when no check reports anything, clearing the reason', async () => {
      const billing = exitCheck();
      const rentals = exitCheck();
      checks = [billing, rentals];
      service = build();

      await service.reactivate('org-1', 3, ADMIN, AT);

      expect(billing.canReactivate).toHaveBeenCalledWith('org-1', TX);
      expect(rentals.canReactivate).toHaveBeenCalledWith('org-1', TX);
      expect(organizations.update).toHaveBeenCalledWith(
        'org-1',
        3,
        { suspensionReason: null, status: OrganizationStatus.ACTIVE, statusChangedAt: AT },
        TX,
      );
      expect(emitted[1][1]).toMatchObject({ action: 'organization.reactivated' });
      expect(organizationsService.emailContact).toHaveBeenCalledWith(
        'org-1',
        'Your TrekLink organization ORG-0007 is active again',
        expect.stringContaining('is active again'),
      );
    });

    it('answers 409 BALANCE_OUTSTANDING with the check message when something is outstanding, and writes nothing', async () => {
      checks = [
        exitCheck({
          canReactivate: jest.fn().mockResolvedValue({
            code: 'BALANCE_OUTSTANDING',
            message: 'This cannot be done while it has open balances.',
          }),
        }),
      ];
      service = build();

      const error = await service.reactivate('org-1', 3, ADMIN, AT).catch((e: unknown) => e);

      expect((error as DomainException).errorCode).toBe(ErrorCode.BALANCE_OUTSTANDING);
      expect((error as DomainException).getStatus()).toBe(409);
      expect((error as DomainException).message).toBe(
        'This cannot be done while it has open balances.',
      );
      expect(organizations.update).not.toHaveBeenCalled();
      expect(organizationsService.emailContact).not.toHaveBeenCalled();
    });

    it('stops at the first check that blocks', async () => {
      const first = exitCheck({
        canReactivate: jest.fn().mockResolvedValue({ code: 'BALANCE_OUTSTANDING', message: 'm' }),
      });
      const second = exitCheck();
      checks = [first, second];
      service = build();
      await service.reactivate('org-1', 3, ADMIN, AT).catch(() => undefined);
      expect(second.canReactivate).not.toHaveBeenCalled();
    });

    it('refuses an organization that is not SUSPENDED, including a PENDING one, before any check runs', async () => {
      const check = exitCheck();
      checks = [check];
      service = build();
      for (const status of [
        OrganizationStatus.ACTIVE,
        OrganizationStatus.PENDING,
        OrganizationStatus.REJECTED,
        OrganizationStatus.CLOSED,
      ]) {
        organizations.lockById.mockResolvedValueOnce(row(status));
        expect(await codeOf(service.reactivate('org-1', 3, ADMIN, AT))).toBe(
          ErrorCode.INVALID_STATE_TRANSITION,
        );
      }
      expect(check.canReactivate).not.toHaveBeenCalled();
    });

    it('is never blocked when no module provides a check', async () => {
      service = build(undefined);
      await expect(service.reactivate('org-1', 3, ADMIN, AT)).resolves.toMatchObject({
        version: 4,
      });
    });

    it('defaults the time to now', async () => {
      await service.reactivate('org-1', 3, ADMIN);
      expect(organizations.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('close (api-design 10, REQ-EVT-06)', () => {
    it('closes an ACTIVE organization, deactivating its members and revoking its keys and stations, and tells each listener', async () => {
      members.membersOf.mockResolvedValue([
        { id: 'm-1', userId: 'u-1', role: 'MANAGER', deactivatedAt: null },
        { id: 'm-2', userId: 'u-2', role: 'OPERATOR', deactivatedAt: null },
      ]);
      apiKeys.revokeAllActive.mockResolvedValue(['k-1', 'k-2']);
      stations.revokeAllActive.mockResolvedValue([{ id: 'fs-1', mqttUsername: 'fs-org-0007-1' }]);
      const rentals = exitCheck();
      checks = [rentals];
      service = build();

      const saved = await service.close('org-1', 'Customer request', 3, ADMIN, AT);

      expect(rentals.canClose).toHaveBeenCalledWith('org-1', TX);
      expect(organizations.update).toHaveBeenCalledWith(
        'org-1',
        3,
        { status: OrganizationStatus.CLOSED, statusChangedAt: AT },
        TX,
      );
      expect(saved.version).toBe(4);
      expect(members.membersOf).toHaveBeenCalledWith('org-1', false, TX);
      expect(accounts.deactivateOrganizationAccount).toHaveBeenNthCalledWith(
        1,
        'u-1',
        'Customer request',
        ADMIN,
        TX,
        AT,
      );
      expect(accounts.deactivateOrganizationAccount).toHaveBeenCalledTimes(2);
      expect(members.markDeactivated).toHaveBeenCalledWith('m-1', AT, TX);
      expect(members.markDeactivated).toHaveBeenCalledWith('m-2', AT, TX);
      expect(apiKeys.revokeAllActive).toHaveBeenCalledWith('org-1', 'u-admin', AT, TX);
      expect(stations.revokeAllActive).toHaveBeenCalledWith('org-1', 'u-admin', AT, TX);
      expect(emitted.map(([name, payload]) => [name, payload])).toEqual([
        [ORGANIZATION_STATUS_CHANGED, expect.objectContaining({ to: OrganizationStatus.CLOSED })],
        [AUDIT_RECORD, expect.objectContaining({ action: 'organization.closed' })],
        [MEMBER_DEACTIVATED, { userId: 'u-1' }],
        [MEMBER_DEACTIVATED, { userId: 'u-2' }],
        [API_KEY_REVOKED, { organizationId: 'org-1', apiKeyId: 'k-1' }],
        [API_KEY_REVOKED, { organizationId: 'org-1', apiKeyId: 'k-2' }],
        [
          FIELD_STATION_REVOKED,
          { organizationId: 'org-1', fieldStationId: 'fs-1', mqttUsername: 'fs-org-0007-1' },
        ],
      ]);
      expect(organizationsService.emailContact).not.toHaveBeenCalled();
    });

    it('closes an organization with nothing to wind down', async () => {
      await expect(service.close('org-1', 'Stopped trading', 3, ADMIN, AT)).resolves.toBeDefined();
      expect(accounts.deactivateOrganizationAccount).not.toHaveBeenCalled();
      expect(emitted.map(([name]) => name)).toEqual([ORGANIZATION_STATUS_CHANGED, AUDIT_RECORD]);
    });

    it('answers 409 OPEN_CONTRACTS when a check reports a contract, and winds nothing down', async () => {
      checks = [
        exitCheck({
          canClose: jest.fn().mockResolvedValue({
            code: 'OPEN_CONTRACTS',
            message: 'This cannot be done while it has open contracts.',
          }),
        }),
      ];
      service = build();
      members.membersOf.mockResolvedValue([
        { id: 'm-1', userId: 'u-1', role: 'MANAGER', deactivatedAt: null },
      ]);

      const error = await service.close('org-1', 'x', 3, ADMIN, AT).catch((e: unknown) => e);

      expect((error as DomainException).errorCode).toBe(ErrorCode.OPEN_CONTRACTS);
      expect((error as DomainException).message).toBe(
        'This cannot be done while it has open contracts.',
      );
      expect(organizations.update).not.toHaveBeenCalled();
      expect(accounts.deactivateOrganizationAccount).not.toHaveBeenCalled();
      expect(apiKeys.revokeAllActive).not.toHaveBeenCalled();
      expect(stations.revokeAllActive).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    });

    it('refuses an organization that is not ACTIVE, such as a SUSPENDED one, before any check runs', async () => {
      const check = exitCheck();
      checks = [check];
      service = build();
      for (const status of [
        OrganizationStatus.SUSPENDED,
        OrganizationStatus.PENDING,
        OrganizationStatus.REJECTED,
        OrganizationStatus.CLOSED,
      ]) {
        organizations.lockById.mockResolvedValueOnce(row(status));
        expect(await codeOf(service.close('org-1', 'x', 3, ADMIN, AT))).toBe(
          ErrorCode.INVALID_STATE_TRANSITION,
        );
      }
      expect(check.canClose).not.toHaveBeenCalled();
    });

    it('is never blocked when no module provides a check, and defaults the time to now', async () => {
      service = build(undefined);
      await expect(service.close('org-1', 'x', 3, ADMIN)).resolves.toMatchObject({ version: 4 });
    });
  });

  describe('transitions (api-design 11)', () => {
    const rows = [
      {
        fromStatus: null,
        toStatus: OrganizationStatus.PENDING,
        actorId: 'u-mgr',
        reason: null,
        createdAt: AT,
      },
      {
        fromStatus: OrganizationStatus.PENDING,
        toStatus: OrganizationStatus.ACTIVE,
        actorId: 'u-admin',
        reason: null,
        createdAt: AT,
      },
      {
        fromStatus: OrganizationStatus.ACTIVE,
        toStatus: OrganizationStatus.SUSPENDED,
        actorId: null,
        reason: 'Contract RC-2026-0042 defaulted',
        createdAt: AT,
      },
      {
        fromStatus: OrganizationStatus.SUSPENDED,
        toStatus: OrganizationStatus.ACTIVE,
        actorId: 'u-gone',
        reason: null,
        createdAt: AT,
      },
    ];

    beforeEach(() => {
      organizations.transitionsOf.mockResolvedValue(rows);
      accounts.contactCard.mockResolvedValue([
        { id: 'u-mgr', fullName: 'Nguyen Van A' },
        { id: 'u-admin', fullName: 'Tran Thi B' },
      ]);
    });

    it('lists the history with who made each change, SYSTEM for none', async () => {
      const result = await transitionsOf(service, 'org-1', STAFF);

      expect(accounts.contactCard).toHaveBeenCalledWith(['u-mgr', 'u-admin', 'u-gone']);
      expect(result).toEqual([
        {
          fromStatus: null,
          toStatus: 'PENDING',
          actor: 'Nguyen Van A',
          reason: null,
          createdAt: AT,
        },
        {
          fromStatus: 'PENDING',
          toStatus: 'ACTIVE',
          actor: 'Tran Thi B',
          reason: null,
          createdAt: AT,
        },
        {
          fromStatus: 'ACTIVE',
          toStatus: 'SUSPENDED',
          actor: 'SYSTEM',
          reason: 'Contract RC-2026-0042 defaulted',
          createdAt: AT,
        },
        {
          fromStatus: 'SUSPENDED',
          toStatus: 'ACTIVE',
          actor: 'Unknown account',
          reason: null,
          createdAt: AT,
        },
      ]);
    });

    it("lets a Manager read its own organization's history, and answers 404 for another or a missing one", async () => {
      await expect(transitionsOf(service, 'org-1', MANAGER)).resolves.toHaveLength(4);
      expect(await codeOf(transitionsOf(service, 'org-9', MANAGER))).toBe(ErrorCode.NOT_FOUND);
      organizations.findStatus.mockResolvedValueOnce(null);
      expect(await codeOf(transitionsOf(service, 'org-1', ADMIN))).toBe(ErrorCode.NOT_FOUND);
    });

    it('answers Staff and Admin for any organization', async () => {
      await expect(transitionsOf(service, 'org-1', STAFF)).resolves.toHaveLength(4);
      await expect(transitionsOf(service, 'org-1', ADMIN)).resolves.toHaveLength(4);
    });

    it("refuses an Org Operator its own organization's history with 403, before anything is read", async () => {
      const refusal = await transitionsOf(service, 'org-1', OPERATOR).catch(
        (error: unknown) => error,
      );

      expect(refusal).toBeInstanceOf(DomainException);
      expect((refusal as DomainException).getStatus()).toBe(403);
      expect((refusal as DomainException).errorCode).toBe(ErrorCode.FORBIDDEN);
      expect(organizations.findStatus).not.toHaveBeenCalled();
      expect(organizations.transitionsOf).not.toHaveBeenCalled();
    });

    it('follows the permission, not the role name: an Admin can withdraw it or grant it', async () => {
      const withdrawn = await service
        .transitions('org-1', MANAGER, abilityOf(MANAGER, false))
        .catch((error: unknown) => error);
      expect((withdrawn as DomainException).errorCode).toBe(ErrorCode.FORBIDDEN);

      await expect(
        service.transitions('org-1', OPERATOR, abilityOf(OPERATOR, true)),
      ).resolves.toHaveLength(4);
    });

    it("answers another organization's Manager 404, as the module does for a foreign id", async () => {
      expect(await codeOf(transitionsOf(service, 'org-1', OTHER_MANAGER))).toBe(
        ErrorCode.NOT_FOUND,
      );
      expect(organizations.transitionsOf).not.toHaveBeenCalled();
    });
  });
});
