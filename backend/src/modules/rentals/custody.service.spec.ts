import { Prisma } from '@prisma/client';
import { ContractsRepository } from './contracts.repository';
import { CustodyService } from './custody.service';
import { GroupsRepository } from './groups.repository';
import { GroupsService } from './groups.service';

const AT = new Date('2026-11-12T03:00:00Z');
const tx = {} as Prisma.TransactionClient;
const ROWS = [
  { id: 'row-1', deviceId: 'dev-1' },
  { id: 'row-2', deviceId: 'dev-2' },
];
const REPLACEMENT = { id: 'row-9', deviceId: 'dev-9' };
const GROUP = { id: 'group-a', name: 'North trail', parentId: 'root' };

describe('CustodyService.closeCustody (rentals design §11 and §13.2)', () => {
  let calls: string[];
  let contracts: Record<
    'setLostAt' | 'markReleased' | 'markCheckedIn' | 'resolveOpenFaults',
    jest.Mock
  >;
  let assignments: Record<
    | 'lockTree'
    | 'openAssignments'
    | 'lockGroups'
    | 'lockDevices'
    | 'endAssignments'
    | 'find'
    | 'openAssignment',
    jest.Mock
  >;
  let groups: { emitGroupChange: jest.Mock };
  let service: CustodyService;

  const recorded = (name: string, value?: unknown) =>
    jest.fn().mockImplementation(() => {
      calls.push(name);
      return Promise.resolve(value);
    });

  beforeEach(() => {
    calls = [];
    contracts = {
      setLostAt: recorded('setLostAt'),
      markReleased: recorded('markReleased'),
      markCheckedIn: recorded('markCheckedIn'),
      resolveOpenFaults: recorded('resolveOpenFaults'),
    };
    assignments = {
      lockTree: recorded('lockTree'),
      // dev-2 also has an open assignment through another contract row, which must stay open.
      openAssignments: recorded('openAssignments', [
        { id: 'asg-1', groupId: GROUP.id, deviceId: 'dev-1', contractDeviceId: 'row-1' },
        { id: 'asg-other', groupId: 'group-b', deviceId: 'dev-2', contractDeviceId: 'row-x' },
      ]),
      lockGroups: recorded('lockGroups'),
      lockDevices: recorded('lockDevices'),
      endAssignments: recorded('endAssignments'),
      find: recorded('find', GROUP),
      openAssignment: recorded('openAssignment'),
    };
    groups = { emitGroupChange: jest.fn() };
    service = new CustodyService(
      contracts as unknown as ContractsRepository,
      assignments as unknown as GroupsRepository,
      groups as unknown as GroupsService,
    );
  });

  it('takes the tree, group and device locks in that order before any custody write', async () => {
    await service.closeCustody('org-a', ROWS, { reason: 'CHECKED_IN', actorId: 'op' }, AT, tx);
    expect(calls.slice(0, 4)).toEqual(['lockTree', 'openAssignments', 'lockGroups', 'lockDevices']);
    expect(assignments.lockTree).toHaveBeenCalledWith('org-a', tx);
    // Only assignments of the closed rows are locked and ended.
    expect(assignments.lockGroups).toHaveBeenCalledWith('org-a', [GROUP.id], tx);
    expect(assignments.lockDevices).toHaveBeenCalledWith(['dev-1', 'dev-2'], tx);
    expect(assignments.endAssignments).toHaveBeenCalledWith(['asg-1'], 'CHECKED_IN', AT, tx);
    expect(contracts.markCheckedIn).toHaveBeenCalledWith(['row-1', 'row-2'], AT, 'op', tx);
    expect(contracts.resolveOpenFaults).toHaveBeenCalledWith(
      ['row-1', 'row-2'],
      'CHECKED_IN',
      AT,
      tx,
    );
    expect(groups.emitGroupChange).toHaveBeenCalledWith('org-a', 'dev-1', null);
    expect(groups.emitGroupChange).toHaveBeenCalledTimes(1);
  });

  it('still takes the tree lock and resolves faults when no row has an open assignment', async () => {
    assignments.openAssignments.mockResolvedValue([]);
    await service.closeCustody('org-a', ROWS, { reason: 'RELEASED', actorId: 'staff' }, AT, tx);
    expect(assignments.lockTree).toHaveBeenCalled();
    expect(assignments.lockGroups).toHaveBeenCalledWith('org-a', [], tx);
    expect(contracts.markReleased).toHaveBeenCalledWith(['row-1', 'row-2'], AT, 'staff', tx);
    expect(contracts.markCheckedIn).not.toHaveBeenCalled();
    expect(contracts.resolveOpenFaults).toHaveBeenCalledWith(
      ['row-1', 'row-2'],
      'RELEASED',
      AT,
      tx,
    );
    expect(assignments.endAssignments).not.toHaveBeenCalled();
    expect(groups.emitGroupChange).not.toHaveBeenCalled();
  });

  it('records a confirmed loss per row without checking it in', async () => {
    const confirmedAt = new Date('2026-11-11T10:00:00Z');
    await service.closeCustody('org-a', ROWS, { reason: 'LOST', confirmedAt }, AT, tx);
    expect(contracts.setLostAt.mock.calls).toEqual([
      ['row-1', confirmedAt, tx],
      ['row-2', confirmedAt, tx],
    ]);
    expect(contracts.markCheckedIn).not.toHaveBeenCalled();
    expect(contracts.markReleased).not.toHaveBeenCalled();
    expect(contracts.resolveOpenFaults).toHaveBeenCalledWith(['row-1', 'row-2'], 'LOST', AT, tx);
    expect(assignments.endAssignments).toHaveBeenCalledWith(['asg-1'], 'LOST', AT, tx);
  });

  it.each([true, false])(
    'moves the group assignment to the replacement and checks in the old row only when returned (%s)',
    async (checkedIn) => {
      await service.closeCustody(
        'org-a',
        [ROWS[0]],
        { reason: 'REPLACED', actorId: 'op', checkedIn, replacement: REPLACEMENT },
        AT,
        tx,
      );
      expect(assignments.lockDevices).toHaveBeenCalledWith(['dev-1', 'dev-9'], tx);
      expect(contracts.markCheckedIn).toHaveBeenCalledTimes(checkedIn ? 1 : 0);
      expect(contracts.resolveOpenFaults).toHaveBeenCalledWith(['row-1'], 'REPLACED', AT, tx);
      expect(assignments.endAssignments).toHaveBeenCalledWith(['asg-1'], 'REPLACED', AT, tx);
      expect(assignments.find).toHaveBeenCalledWith('org-a', GROUP.id, tx);
      expect(assignments.openAssignment).toHaveBeenCalledWith(
        { groupId: GROUP.id, deviceId: 'dev-9', contractDeviceId: 'row-9', assignedById: 'op' },
        AT,
        tx,
      );
      expect(groups.emitGroupChange.mock.calls).toEqual([
        ['org-a', 'dev-1', null],
        ['org-a', 'dev-9', GROUP],
      ]);
    },
  );

  it('fails the replacement when the assigned group is gone, so the caller rolls back', async () => {
    assignments.find.mockResolvedValue(null);
    await expect(
      service.closeCustody(
        'org-a',
        [ROWS[0]],
        { reason: 'REPLACED', actorId: 'op', checkedIn: true, replacement: REPLACEMENT },
        AT,
        tx,
      ),
    ).rejects.toThrow('An open device assignment has no live group.');
    expect(assignments.openAssignment).not.toHaveBeenCalled();
  });
});
