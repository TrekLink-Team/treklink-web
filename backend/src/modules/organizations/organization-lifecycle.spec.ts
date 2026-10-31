import { OrganizationStatus, Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ORGANIZATION_STATUS_CHANGED } from './organization-events';
import { canTransition, invalidState, OrganizationLifecycle } from './organization-lifecycle';
import { OrganizationsRepository } from './organizations.repository';

const TX = { tx: true } as unknown as Prisma.TransactionClient;
const AT = new Date('2026-10-30T03:00:00.000Z');
const ADMIN = { id: 'u-admin', roles: ['ADMIN'], organizationId: null };

const STATUSES = Object.values(OrganizationStatus);
// The lifecycle of D-035 (design §2): the only moves that exist.
const ALLOWED: Record<OrganizationStatus, OrganizationStatus[]> = {
  PENDING: ['ACTIVE', 'REJECTED'],
  ACTIVE: ['SUSPENDED', 'CLOSED'],
  SUSPENDED: ['ACTIVE'],
  REJECTED: [],
  CLOSED: [],
};

describe('canTransition (organizations 1.2, D-035)', () => {
  it.each(STATUSES.flatMap((from) => STATUSES.map((to) => [from, to] as const)))(
    '%s to %s',
    (from, to) => {
      expect(canTransition(from, to)).toBe(ALLOWED[from].includes(to));
    },
  );

  it('names the status the organization is in when a change is refused', () => {
    const error = invalidState(OrganizationStatus.CLOSED);
    expect(error.errorCode).toBe(ErrorCode.INVALID_STATE_TRANSITION);
    expect(error.getStatus()).toBe(409);
    expect(error.message).toBe('This cannot be done while it is CLOSED.');
  });
});

describe('OrganizationLifecycle.transition (organizations 1.2, REQ-UBI-01, FR-ORG-07)', () => {
  let organizations: Record<string, jest.Mock>;
  let emitted: [string, Record<string, unknown>][];
  let lifecycle: OrganizationLifecycle;

  const current = (status: OrganizationStatus) => ({ id: 'org-1', status, version: 3 });
  const input = (overrides: Record<string, unknown> = {}) => ({
    expectedVersion: 3,
    at: AT,
    actor: ADMIN,
    reason: 'Unpaid balance',
    audit: 'organization.suspended',
    ...overrides,
  });

  beforeEach(() => {
    organizations = {
      lockById: jest.fn().mockResolvedValue(current(OrganizationStatus.ACTIVE)),
      update: jest.fn().mockImplementation((id: string, version: number, data: object) => ({
        id,
        version: version + 1,
        ...data,
      })),
      addTransition: jest.fn().mockResolvedValue({}),
    };
    emitted = [];
    const events = {
      emitAfterCommit: (name: string, payload: Record<string, unknown>) =>
        emitted.push([name, payload]),
    };
    lifecycle = new OrganizationLifecycle(
      organizations as unknown as OrganizationsRepository,
      events as unknown as TransactionalEvents,
    );
  });

  it('locks the row, compares and sets the version, writes one transition and tells the listeners', async () => {
    const saved = await lifecycle.transition(
      'org-1',
      OrganizationStatus.SUSPENDED,
      input({ data: { suspensionReason: 'Unpaid balance' } }),
      TX,
    );

    expect(organizations.lockById).toHaveBeenCalledWith('org-1', TX);
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
      {
        organizationId: 'org-1',
        fromStatus: OrganizationStatus.ACTIVE,
        toStatus: OrganizationStatus.SUSPENDED,
        actorId: 'u-admin',
        reason: 'Unpaid balance',
      },
      TX,
    );
    expect(saved).toMatchObject({ status: OrganizationStatus.SUSPENDED, version: 4 });
    expect(emitted).toEqual([
      [
        ORGANIZATION_STATUS_CHANGED,
        {
          organizationId: 'org-1',
          from: OrganizationStatus.ACTIVE,
          to: OrganizationStatus.SUSPENDED,
          reason: 'Unpaid balance',
        },
      ],
      [
        AUDIT_RECORD,
        {
          actorId: 'u-admin',
          actorRoles: ['ADMIN'],
          organizationId: 'org-1',
          action: 'organization.suspended',
          subjectType: 'Organization',
          subjectId: 'org-1',
          before: { status: OrganizationStatus.ACTIVE },
          after: { status: OrganizationStatus.SUSPENDED, reason: 'Unpaid balance' },
        },
      ],
    ]);
  });

  it('writes SYSTEM, with no roles, for a change no account made', async () => {
    await lifecycle.transition(
      'org-1',
      OrganizationStatus.SUSPENDED,
      input({ actor: null, reason: null }),
      TX,
    );
    expect(organizations.addTransition).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: null, reason: null }),
      TX,
    );
    expect(emitted[1][1]).toMatchObject({ actorId: null, actorRoles: [] });
  });

  it('answers 404 for an organization that is not there', async () => {
    organizations.lockById.mockResolvedValue(null);
    const error = await lifecycle
      .transition('org-9', OrganizationStatus.SUSPENDED, input(), TX)
      .catch((e: unknown) => e);
    expect((error as DomainException).errorCode).toBe(ErrorCode.NOT_FOUND);
    expect(organizations.update).not.toHaveBeenCalled();
  });

  it.each(
    STATUSES.flatMap((from) =>
      STATUSES.filter((to) => !ALLOWED[from].includes(to)).map((to) => [from, to] as const),
    ),
  )('refuses %s to %s with 409 INVALID_STATE_TRANSITION and writes nothing', async (from, to) => {
    organizations.lockById.mockResolvedValue(current(from));
    const error = await lifecycle.transition('org-1', to, input(), TX).catch((e: unknown) => e);
    expect((error as DomainException).errorCode).toBe(ErrorCode.INVALID_STATE_TRANSITION);
    expect((error as DomainException).message).toBe(`This cannot be done while it is ${from}.`);
    expect(organizations.update).not.toHaveBeenCalled();
    expect(organizations.addTransition).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it('runs the rule of the caller on the locked row before anything is written', async () => {
    const guard = jest.fn().mockResolvedValue(undefined);
    await lifecycle.transition('org-1', OrganizationStatus.CLOSED, input({ guard }), TX);
    expect(guard).toHaveBeenCalledWith(current(OrganizationStatus.ACTIVE), TX);

    guard.mockRejectedValueOnce(
      new DomainException(
        409,
        ErrorCode.OPEN_CONTRACTS,
        'This cannot be done while it has open contracts.',
      ),
    );
    organizations.update.mockClear();
    const error = await lifecycle
      .transition('org-1', OrganizationStatus.CLOSED, input({ guard }), TX)
      .catch((e: unknown) => e);
    expect((error as DomainException).errorCode).toBe(ErrorCode.OPEN_CONTRACTS);
    expect(organizations.update).not.toHaveBeenCalled();
  });

  it('does not run the rule of the caller for a pair the table refuses', async () => {
    const guard = jest.fn();
    organizations.lockById.mockResolvedValue(current(OrganizationStatus.CLOSED));
    await lifecycle
      .transition('org-1', OrganizationStatus.ACTIVE, input({ guard }), TX)
      .catch(() => undefined);
    expect(guard).not.toHaveBeenCalled();
  });

  it('answers 409 STALE_VERSION when another change was saved first, and writes no transition', async () => {
    organizations.update.mockResolvedValue(null);
    const error = await lifecycle
      .transition('org-1', OrganizationStatus.SUSPENDED, input(), TX)
      .catch((e: unknown) => e);
    expect((error as DomainException).errorCode).toBe(ErrorCode.STALE_VERSION);
    expect(organizations.addTransition).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });
});
