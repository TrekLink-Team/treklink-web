import { EventEmitter2 } from '@nestjs/event-emitter';
import { GroupExit, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OrganizationsService } from '../organizations';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ContractsRepository } from './contracts.repository';
import { GroupsRepository } from './groups.repository';
import { GroupsService } from './groups.service';

const day = (value: string) => new Date(`${value}T00:00:00Z`);

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g1',
    parentId: null,
    name: 'North',
    label: null,
    startsOn: null,
    endsOn: null,
    areaNote: null,
    version: 3,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    _count: { assignments: 2 },
    ...overrides,
  };
}

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('GroupsService branches', () => {
  const manager = { id: 'manager', organizationId: 'org', roles: ['ORG_MANAGER'] };
  const staff = { id: 'staff', organizationId: null, roles: ['STAFF'] };
  const tx = {} as Prisma.TransactionClient;
  const topology = [
    { id: 'root', parentId: null },
    { id: 'child', parentId: 'root' },
    { id: 'leaf', parentId: 'child' },
    { id: 'sibling', parentId: null },
  ];

  function setup(maxDepth = 3) {
    const groups = {
      lockTree: jest.fn(),
      lockGroups: jest.fn(),
      lockDevices: jest.fn(),
      list: jest.fn().mockResolvedValue([]),
      topology: jest.fn().mockResolvedValue(topology),
      find: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn().mockResolvedValue([]),
      openAssignments: jest.fn().mockResolvedValue([]),
      endAssignments: jest.fn(),
      openAssignment: jest.fn(),
    };
    const parameters = { getUncached: jest.fn().mockResolvedValue(maxDepth) };
    const organizations = { assertCanUseRentalGroups: jest.fn() };
    const contracts = { liveRowsOfOrganization: jest.fn().mockResolvedValue([]) };
    const emitter = new EventEmitter2();
    const emit = jest.spyOn(emitter, 'emit');
    const events = new TransactionalEvents(
      {
        $transaction: (work: (client: Prisma.TransactionClient) => Promise<unknown>) => work(tx),
      } as unknown as PrismaService,
      emitter,
    );
    const service = new GroupsService(
      groups as unknown as GroupsRepository,
      parameters as unknown as ParameterService,
      organizations as unknown as OrganizationsService,
      events,
      contracts as unknown as ContractsRepository,
    );
    return { service, groups, parameters, organizations, contracts, emit };
  }

  describe('tree', () => {
    it('needs an organization id when the caller has none', async () => {
      const { service, groups } = setup();
      await expect(service.tree(staff)).rejects.toMatchObject({
        errorCode: ErrorCode.VALIDATION_FAILED,
      });
      expect(groups.list).not.toHaveBeenCalled();
    });

    it('lets Staff read any organization without the rental groups gate', async () => {
      const { service, groups, organizations } = setup();
      await service.tree(staff, 'other-org');
      expect(groups.list).toHaveBeenCalledWith('other-org');
      expect(organizations.assertCanUseRentalGroups).not.toHaveBeenCalled();
    });

    it('checks the gate for an organization member and ignores the requested id', async () => {
      const { service, groups, organizations } = setup();
      await service.tree(manager, 'other-org');
      expect(organizations.assertCanUseRentalGroups).toHaveBeenCalledWith('org');
      expect(groups.list).toHaveBeenCalledWith('org');
    });

    it('nests children under their parent with day strings and the device count', async () => {
      const { service, groups } = setup(2);
      groups.list.mockResolvedValue([
        row({ id: 'a', name: 'A', startsOn: day('2026-12-01'), endsOn: day('2026-12-31') }),
        row({ id: 'b', parentId: 'a', name: 'B', _count: { assignments: 0 } }),
      ]);
      const result = await service.tree(manager);
      expect(result.maxDepth).toBe(2);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0]).toMatchObject({
        id: 'a',
        startsOn: '2026-12-01',
        endsOn: '2026-12-31',
        deviceCount: 2,
      });
      expect(result.groups[0].children).toEqual([
        expect.objectContaining({
          id: 'b',
          startsOn: null,
          endsOn: null,
          deviceCount: 0,
          children: [],
        }),
      ]);
    });
  });

  describe('subgroupIds', () => {
    it('answers not found for a group outside the organization', async () => {
      const { service } = setup();
      await expect(service.subgroupIds('org', 'missing')).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
    });

    it('returns the group and every descendant but not a sibling', async () => {
      const { service } = setup();
      await expect(service.subgroupIds('org', 'child')).resolves.toEqual(
        new Set(['child', 'leaf']),
      );
    });
  });

  describe('create', () => {
    it('refuses a caller without an organization before opening a transaction', async () => {
      const { service, groups } = setup();
      await expect(service.create({ name: 'X' }, staff)).rejects.toMatchObject({
        errorCode: ErrorCode.FORBIDDEN,
      });
      expect(groups.lockTree).not.toHaveBeenCalled();
    });

    it('refuses an end date before the start date', async () => {
      const { service, groups } = setup();
      await expect(
        service.create({ name: 'X', startsOn: '2026-12-10', endsOn: '2026-12-09' }, manager),
      ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_FAILED });
      expect(groups.create).not.toHaveBeenCalled();
    });

    it('accepts an end on the same day as the start', async () => {
      const { service, groups } = setup();
      groups.create.mockResolvedValue(
        row({ startsOn: day('2026-12-10'), endsOn: day('2026-12-10') }),
      );
      await expect(
        service.create({ name: 'X', startsOn: '2026-12-10', endsOn: '2026-12-10' }, manager),
      ).resolves.toMatchObject({ startsOn: '2026-12-10', endsOn: '2026-12-10' });
    });

    it('creates a top level group without locking a parent and audits it after commit', async () => {
      const { service, groups, emit } = setup();
      groups.create.mockResolvedValue(row());
      const result = await service.create({ name: 'North' }, manager);
      expect(groups.lockGroups).not.toHaveBeenCalled();
      expect(groups.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org',
          parentId: null,
          startsOn: null,
          endsOn: null,
          createdById: 'manager',
        }),
        tx,
      );
      expect(result).toMatchObject({ id: 'g1', deviceCount: 2 });
      expect(emit).toHaveBeenCalledWith(
        AUDIT_RECORD,
        expect.objectContaining({
          action: 'group.created',
          subjectId: 'g1',
          actorId: 'manager',
          before: undefined,
        }),
      );
    });

    it('locks the parent and creates under it when there is room', async () => {
      const { service, groups } = setup();
      groups.create.mockResolvedValue(row({ parentId: 'root' }));
      await service.create({ name: 'South', parentId: 'root' }, manager);
      expect(groups.lockGroups).toHaveBeenCalledWith('org', ['root'], tx);
      expect(groups.create).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'root' }), tx);
    });

    it('answers not found for a parent outside the organization', async () => {
      const { service, groups } = setup();
      await expect(
        service.create({ name: 'X', parentId: 'elsewhere' }, manager),
      ).rejects.toMatchObject({ errorCode: ErrorCode.NOT_FOUND });
      expect(groups.create).not.toHaveBeenCalled();
    });

    it('turns a unique name violation into CONFLICT_UNIQUE and emits nothing', async () => {
      const { service, groups, emit } = setup();
      groups.create.mockRejectedValue(uniqueViolation());
      await expect(service.create({ name: 'North' }, manager)).rejects.toMatchObject({
        errorCode: ErrorCode.CONFLICT_UNIQUE,
      });
      expect(emit).not.toHaveBeenCalled();
    });

    it('rethrows any other write failure unchanged', async () => {
      const { service, groups } = setup();
      groups.create.mockRejectedValue(new Error('connection lost'));
      await expect(service.create({ name: 'North' }, manager)).rejects.toThrow('connection lost');
    });
  });

  describe('update', () => {
    const current = row({
      id: 'child',
      parentId: 'root',
      startsOn: day('2026-12-01'),
      endsOn: day('2026-12-31'),
    });

    it('answers not found for a group outside the organization', async () => {
      const { service, groups } = setup();
      groups.find.mockResolvedValue(null);
      await expect(
        service.update('missing', { expectedVersion: 3 }, manager),
      ).rejects.toMatchObject({ errorCode: ErrorCode.NOT_FOUND });
      expect(groups.update).not.toHaveBeenCalled();
    });

    it('refuses a stale version without writing', async () => {
      const { service, groups } = setup();
      groups.find.mockResolvedValue(current);
      await expect(service.update('child', { expectedVersion: 2 }, manager)).rejects.toMatchObject({
        errorCode: ErrorCode.STALE_VERSION,
      });
      expect(groups.update).not.toHaveBeenCalled();
    });

    it('locks the group and the new parent together', async () => {
      const { service, groups } = setup();
      groups.find.mockResolvedValue(current);
      groups.update.mockResolvedValue(current);
      await service.update('child', { expectedVersion: 3, parentId: 'sibling' }, manager);
      expect(groups.lockGroups).toHaveBeenCalledWith('org', ['child', 'sibling'], tx);
    });

    it('locks only the group when the parent is not part of the request', async () => {
      const { service, groups } = setup();
      groups.find.mockResolvedValue(current);
      groups.update.mockResolvedValue(current);
      await service.update('child', { expectedVersion: 3, name: 'Renamed' }, manager);
      expect(groups.lockGroups).toHaveBeenCalledWith('org', ['child'], tx);
    });

    it('keeps the stored dates when the request leaves them out and bumps the version', async () => {
      const { service, groups, emit } = setup();
      groups.find.mockResolvedValue(current);
      groups.update.mockResolvedValue(row({ id: 'child', version: 4, name: 'Renamed' }));
      await service.update('child', { expectedVersion: 3, name: 'Renamed' }, manager);
      expect(groups.update).toHaveBeenCalledWith(
        'org',
        'child',
        expect.objectContaining({
          name: 'Renamed',
          startsOn: current.startsOn,
          endsOn: current.endsOn,
          version: { increment: 1 },
        }),
        tx,
      );
      const audit = emit.mock.calls.find(([name]) => name === AUDIT_RECORD)?.[1] as {
        action: string;
        subjectId: string;
        before: unknown;
      };
      expect(audit).toMatchObject({ action: 'group.updated', subjectId: 'child' });
      expect(audit.before).toMatchObject({ startsOn: '2026-12-01', version: 3 });
    });

    it('checks a new end date against the stored start date', async () => {
      const { service, groups } = setup();
      groups.find.mockResolvedValue(current);
      await expect(
        service.update('child', { expectedVersion: 3, endsOn: '2026-11-30' }, manager),
      ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_FAILED });
      expect(groups.update).not.toHaveBeenCalled();
    });

    it('clears a date when the request sends null', async () => {
      const { service, groups } = setup();
      groups.find.mockResolvedValue(current);
      groups.update.mockResolvedValue(row({ id: 'child' }));
      await service.update('child', { expectedVersion: 3, endsOn: null }, manager);
      expect(groups.update).toHaveBeenCalledWith(
        'org',
        'child',
        expect.objectContaining({ endsOn: null, startsOn: current.startsOn }),
        tx,
      );
    });

    it('skips the depth check when the parent does not change', async () => {
      const { service, groups, parameters } = setup();
      groups.find.mockResolvedValue(current);
      groups.update.mockResolvedValue(current);
      await service.update('child', { expectedVersion: 3, parentId: 'root' }, manager);
      expect(parameters.getUncached).not.toHaveBeenCalled();
    });

    it('refuses to move a group under its own subgroup even when the cap has room', async () => {
      const { service, groups } = setup(10);
      groups.find.mockResolvedValue(row({ id: 'root', parentId: null }));
      const error = await service
        .update('root', { expectedVersion: 3, parentId: 'leaf' }, manager)
        .then(
          () => new Error('update did not throw'),
          (caught: unknown) => caught as Error,
        );
      expect(error).toMatchObject({ errorCode: ErrorCode.GROUP_DEPTH_EXCEEDED });
      expect(error.message).toContain('outside this group and its subgroups');
      expect(groups.update).not.toHaveBeenCalled();
    });

    it('refuses a move that pushes the subtree past the cap and names the cap', async () => {
      const { service, groups } = setup(2);
      groups.find.mockResolvedValue(row({ id: 'root', parentId: null }));
      const error = await service
        .update('root', { expectedVersion: 3, parentId: 'sibling' }, manager)
        .then(
          () => new Error('update did not throw'),
          (caught: unknown) => caught as Error,
        );
      expect(error).toMatchObject({ errorCode: ErrorCode.GROUP_DEPTH_EXCEEDED });
      expect(error.message).toContain('only 2 level(s) deep');
    });

    it('allows a move to the top level', async () => {
      const { service, groups } = setup(1);
      groups.find.mockResolvedValue(current);
      groups.update.mockResolvedValue(row({ id: 'child' }));
      await service.update('child', { expectedVersion: 3, parentId: null }, manager);
      expect(groups.update).toHaveBeenCalledWith(
        'org',
        'child',
        expect.objectContaining({ parentId: null }),
        tx,
      );
    });

    it('takes a new start date from the request and checks it against the stored end date', async () => {
      const { service, groups } = setup();
      groups.find.mockResolvedValue(current);
      groups.update.mockResolvedValue(row({ id: 'child' }));
      await service.update('child', { expectedVersion: 3, startsOn: '2026-12-15' }, manager);
      expect(groups.update).toHaveBeenCalledWith(
        'org',
        'child',
        expect.objectContaining({ startsOn: day('2026-12-15'), endsOn: current.endsOn }),
        tx,
      );
      await expect(
        service.update('child', { expectedVersion: 3, startsOn: '2027-01-01' }, manager),
      ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_FAILED });
    });

    it('answers not found when an ancestor of the new parent is missing from the tree', async () => {
      const { service, groups } = setup();
      groups.find.mockResolvedValue(current);
      groups.topology.mockResolvedValue([...topology, { id: 'orphan', parentId: 'ghost' }]);
      await expect(
        service.update('child', { expectedVersion: 3, parentId: 'orphan' }, manager),
      ).rejects.toMatchObject({ errorCode: ErrorCode.NOT_FOUND });
      expect(groups.update).not.toHaveBeenCalled();
    });

    it('answers not found when the new parent is outside the organization', async () => {
      const { service, groups } = setup();
      groups.find.mockResolvedValue(current);
      await expect(
        service.update('child', { expectedVersion: 3, parentId: 'elsewhere' }, manager),
      ).rejects.toMatchObject({ errorCode: ErrorCode.NOT_FOUND });
    });

    it('turns a unique name violation into CONFLICT_UNIQUE', async () => {
      const { service, groups } = setup();
      groups.find.mockResolvedValue(current);
      groups.update.mockRejectedValue(uniqueViolation());
      await expect(
        service.update('child', { expectedVersion: 3, name: 'Taken' }, manager),
      ).rejects.toMatchObject({ errorCode: ErrorCode.CONFLICT_UNIQUE });
    });
  });

  describe('remove', () => {
    it('answers not found without locking or deleting when the group is unknown', async () => {
      const { service, groups, emit } = setup();
      await expect(service.remove('missing', manager)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
      expect(groups.lockGroups).not.toHaveBeenCalled();
      expect(groups.remove).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it('removes a leaf and reports no ungrouped devices when none were assigned', async () => {
      const { service, groups } = setup();
      await expect(service.remove('sibling', manager)).resolves.toEqual({
        id: 'sibling',
        removedGroups: 1,
        ungroupedDevices: 0,
      });
      expect(groups.lockGroups).toHaveBeenCalledWith('org', ['sibling'], tx);
    });
  });

  describe('assign', () => {
    const group = row({ id: 'g1', name: 'North', parentId: 'root' });
    const held = (deviceId: string, id = `cd-${deviceId}`) => ({ id, deviceId });

    it('answers not found for an unknown group before touching devices', async () => {
      const { service, groups } = setup();
      groups.find.mockResolvedValue(null);
      await expect(service.assign('g1', ['d1'], manager)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
      expect(groups.lockDevices).not.toHaveBeenCalled();
    });

    it('refuses a device the organization does not hold now', async () => {
      const { service, groups, contracts } = setup();
      groups.find.mockResolvedValue(group);
      contracts.liveRowsOfOrganization.mockResolvedValue([held('d1')]);
      await expect(service.assign('g1', ['d1', 'd2'], manager)).rejects.toMatchObject({
        errorCode: ErrorCode.DEVICE_NOT_HELD,
      });
      expect(groups.openAssignment).not.toHaveBeenCalled();
    });

    it('opens an assignment for a device with none and announces the group', async () => {
      const { service, groups, contracts, emit } = setup();
      groups.find.mockResolvedValue(group);
      contracts.liveRowsOfOrganization.mockResolvedValue([held('d1')]);
      await expect(service.assign('g1', ['d1'], manager)).resolves.toEqual({
        groupId: 'g1',
        assigned: ['d1'],
        unchanged: [],
      });
      expect(groups.endAssignments).not.toHaveBeenCalled();
      expect(groups.openAssignment).toHaveBeenCalledWith(
        { groupId: 'g1', deviceId: 'd1', contractDeviceId: 'cd-d1', assignedById: 'manager' },
        expect.any(Date),
        tx,
      );
      expect(emit).toHaveBeenCalledWith(
        AUDIT_RECORD,
        expect.objectContaining({
          action: 'group.deviceAssigned',
          before: { groupId: null },
          after: { groupId: 'g1', deviceId: 'd1' },
        }),
      );
      expect(emit).toHaveBeenCalledWith('device.groupChanged', {
        organizationId: 'org',
        deviceId: 'd1',
        group: { id: 'g1', name: 'North', parentId: 'root' },
      });
    });

    it('leaves a device unchanged when it is already in this group under the same custody', async () => {
      const { service, groups, contracts, emit } = setup();
      groups.find.mockResolvedValue(group);
      contracts.liveRowsOfOrganization.mockResolvedValue([held('d1')]);
      groups.openAssignments.mockResolvedValue([
        { id: 'a1', deviceId: 'd1', groupId: 'g1', contractDeviceId: 'cd-d1' },
      ]);
      await expect(service.assign('g1', ['d1'], manager)).resolves.toEqual({
        groupId: 'g1',
        assigned: [],
        unchanged: ['d1'],
      });
      expect(groups.openAssignment).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it('moves a device from another group and records the previous group', async () => {
      const { service, groups, contracts, emit } = setup();
      groups.find.mockResolvedValue(group);
      contracts.liveRowsOfOrganization.mockResolvedValue([held('d1')]);
      groups.openAssignments.mockResolvedValue([
        { id: 'a1', deviceId: 'd1', groupId: 'other', contractDeviceId: 'cd-d1' },
      ]);
      const result = await service.assign('g1', ['d1'], manager);
      expect(result.assigned).toEqual(['d1']);
      expect(groups.endAssignments).toHaveBeenCalledWith(
        ['a1'],
        GroupExit.MOVED,
        expect.any(Date),
        tx,
      );
      expect(emit).toHaveBeenCalledWith(
        AUDIT_RECORD,
        expect.objectContaining({ before: { groupId: 'other' } }),
      );
    });

    it('reassigns a device whose custody row changed even when the group is the same', async () => {
      const { service, groups, contracts } = setup();
      groups.find.mockResolvedValue(group);
      contracts.liveRowsOfOrganization.mockResolvedValue([held('d1', 'cd-new')]);
      groups.openAssignments.mockResolvedValue([
        { id: 'a1', deviceId: 'd1', groupId: 'g1', contractDeviceId: 'cd-old' },
      ]);
      const result = await service.assign('g1', ['d1'], manager);
      expect(result).toEqual({ groupId: 'g1', assigned: ['d1'], unchanged: [] });
      expect(groups.endAssignments).toHaveBeenCalledWith(
        ['a1'],
        GroupExit.MOVED,
        expect.any(Date),
        tx,
      );
      expect(groups.openAssignment).toHaveBeenCalledWith(
        expect.objectContaining({ contractDeviceId: 'cd-new' }),
        expect.any(Date),
        tx,
      );
    });

    it('splits a mixed batch into assigned and unchanged devices in request order', async () => {
      const { service, groups, contracts } = setup();
      groups.find.mockResolvedValue(group);
      contracts.liveRowsOfOrganization.mockResolvedValue([held('d1'), held('d2'), held('d3')]);
      groups.openAssignments.mockResolvedValue([
        { id: 'a2', deviceId: 'd2', groupId: 'g1', contractDeviceId: 'cd-d2' },
      ]);
      await expect(service.assign('g1', ['d3', 'd2', 'd1'], manager)).resolves.toEqual({
        groupId: 'g1',
        assigned: ['d3', 'd1'],
        unchanged: ['d2'],
      });
    });
  });

  describe('unassign', () => {
    it('answers not found for an unknown group', async () => {
      const { service, groups } = setup();
      groups.find.mockResolvedValue(null);
      await expect(service.unassign('g1', 'd1', manager)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
      expect(groups.lockDevices).not.toHaveBeenCalled();
    });

    it('answers not found when the device has no open assignment', async () => {
      const { service, groups } = setup();
      groups.find.mockResolvedValue(row());
      await expect(service.unassign('g1', 'd1', manager)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
      expect(groups.endAssignments).not.toHaveBeenCalled();
    });

    it('answers not found when the open assignment belongs to another group', async () => {
      const { service, groups } = setup();
      groups.find.mockResolvedValue(row());
      groups.openAssignments.mockResolvedValue([{ id: 'a1', deviceId: 'd1', groupId: 'other' }]);
      await expect(service.unassign('g1', 'd1', manager)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
      expect(groups.endAssignments).not.toHaveBeenCalled();
    });

    it('ends the assignment, audits it and announces the device as ungrouped', async () => {
      const { service, groups, emit } = setup();
      groups.find.mockResolvedValue(row());
      groups.openAssignments.mockResolvedValue([{ id: 'a1', deviceId: 'd1', groupId: 'g1' }]);
      const result = await service.unassign('g1', 'd1', manager);
      expect(result).toMatchObject({ groupId: 'g1', deviceId: 'd1' });
      expect(result.endedAt).toBeInstanceOf(Date);
      expect(groups.endAssignments).toHaveBeenCalledWith(
        ['a1'],
        GroupExit.UNASSIGNED,
        result.endedAt,
        tx,
      );
      expect(emit).toHaveBeenCalledWith(
        AUDIT_RECORD,
        expect.objectContaining({
          action: 'group.deviceUnassigned',
          before: { groupId: 'g1', deviceId: 'd1' },
          after: { groupId: null, deviceId: 'd1' },
        }),
      );
      expect(emit).toHaveBeenCalledWith('device.groupChanged', {
        organizationId: 'org',
        deviceId: 'd1',
        group: null,
      });
    });
  });
});
