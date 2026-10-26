import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { CONTRACT_STATUS_CHANGED, ContractLifecycleService } from './contract-lifecycle.service';
import { ContractRow, ContractsRepository } from './contracts.repository';

const tx = { tx: true } as unknown as Prisma.TransactionClient;
const NOW = new Date('2026-10-25T02:00:00.000Z');
const STAFF = { id: 'staff-1', roles: ['STAFF'], organizationId: null };

const contract = (overrides: Partial<ContractRow> = {}): ContractRow => ({
  id: 'c-1',
  code: 'RC-2026-0001',
  organizationId: 'org-1',
  planType: PlanType.MONTHLY,
  quantity: 5,
  status: ContractStatus.REQUESTED,
  version: 3,
  ...overrides,
});

describe('ContractLifecycleService.apply', () => {
  let contracts: { lockById: jest.Mock; transition: jest.Mock };
  let events: { emitAfterCommit: jest.Mock };
  let service: ContractLifecycleService;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    contracts = {
      lockById: jest.fn().mockResolvedValue(contract()),
      transition: jest.fn().mockResolvedValue(true),
    };
    events = { emitAfterCommit: jest.fn() };
    service = new ContractLifecycleService(
      contracts as unknown as ContractsRepository,
      events as unknown as TransactionalEvents,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('locks the row, writes the change by compare-and-set and announces it after commit (REQ-UBI-01)', async () => {
    await expect(
      service.apply('c-1', ContractStatus.REQUESTED, ContractStatus.APPROVED, null, STAFF, tx),
    ).resolves.toEqual(contract({ status: ContractStatus.APPROVED, version: 4 }));

    expect(contracts.lockById).toHaveBeenCalledWith('c-1', tx);
    expect(contracts.transition).toHaveBeenCalledWith(
      'c-1',
      {
        from: ContractStatus.REQUESTED,
        to: ContractStatus.APPROVED,
        version: 3,
        actorId: 'staff-1',
        reason: null,
        at: NOW,
      },
      tx,
    );
    expect(events.emitAfterCommit).toHaveBeenCalledWith(CONTRACT_STATUS_CHANGED, {
      contractId: 'c-1',
      organizationId: 'org-1',
      from: ContractStatus.REQUESTED,
      to: ContractStatus.APPROVED,
      at: NOW,
    });
    expect(events.emitAfterCommit).toHaveBeenCalledWith(AUDIT_RECORD, {
      actorId: 'staff-1',
      actorRoles: ['STAFF'],
      organizationId: 'org-1',
      action: 'contract.approved',
      subjectType: 'RentalContract',
      subjectId: 'c-1',
      before: { status: ContractStatus.REQUESTED },
      after: { status: ContractStatus.APPROVED, reason: null },
    });
  });

  it('records a job transition as SYSTEM with a camel-case audit action', async () => {
    contracts.lockById.mockResolvedValue(contract({ status: ContractStatus.ACTIVE }));

    await service.apply(
      'c-1',
      ContractStatus.ACTIVE,
      ContractStatus.RETURN_DUE,
      'Day plan ended',
      null,
      tx,
    );

    expect(contracts.transition).toHaveBeenCalledWith(
      'c-1',
      expect.objectContaining({ actorId: null, reason: 'Day plan ended' }),
      tx,
    );
    expect(events.emitAfterCommit).toHaveBeenCalledWith(
      AUDIT_RECORD,
      expect.objectContaining({ actorId: null, actorRoles: [], action: 'contract.returnDue' }),
    );
  });

  it('refuses a pair outside D-035 before touching the row (409 INVALID_STATE_TRANSITION)', async () => {
    await expect(
      service.apply('c-1', ContractStatus.REQUESTED, ContractStatus.ACTIVE, null, STAFF, tx),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      message: 'A REQUESTED contract cannot become ACTIVE.',
    });
    expect(contracts.lockById).not.toHaveBeenCalled();
  });

  it('refuses when the locked row is no longer in the expected state', async () => {
    contracts.lockById.mockResolvedValue(contract({ status: ContractStatus.CANCELLED }));

    await expect(
      service.apply('c-1', ContractStatus.REQUESTED, ContractStatus.APPROVED, null, STAFF, tx),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      message: 'A CANCELLED contract cannot become APPROVED.',
    });
    expect(contracts.transition).not.toHaveBeenCalled();
  });

  it('refuses when the compare-and-set loses, and announces nothing', async () => {
    contracts.transition.mockResolvedValue(false);

    await expect(
      service.apply('c-1', ContractStatus.REQUESTED, ContractStatus.APPROVED, null, STAFF, tx),
    ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_STATE_TRANSITION });
    expect(events.emitAfterCommit).not.toHaveBeenCalled();
  });
});
