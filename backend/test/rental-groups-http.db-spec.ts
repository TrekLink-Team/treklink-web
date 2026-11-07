import {
  AccountType,
  ContractStatus,
  GroupExit,
  MemberRole,
  OrganizationStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { LossCaseService } from '../src/modules/devices';
import { TransactionalEvents } from '../src/modules/platform/events/emit-after-commit';
import { ContractsRepository } from '../src/modules/rentals/contracts.repository';
import { ContractsService } from '../src/modules/rentals/contracts.service';
import { CustodyService } from '../src/modules/rentals/custody.service';
import { ReplacementService } from '../src/modules/rentals/replacement.service';
import { ReturnService } from '../src/modules/rentals/return.service';
import { compileRentalFlow, RentalFlow, SIGNATURE } from './db-rental-flow';

type TreeEnvelope = {
  result: { maxDepth: number; groups: { id: string; name: string; children: { id: string }[] }[] };
};

describe('group API against Postgres (rentals 9.2)', () => {
  let flow: RentalFlow;
  let org: Awaited<ReturnType<RentalFlow['organization']>>;
  let other: typeof org;

  beforeAll(async () => {
    flow = await compileRentalFlow({ http: true });
    org = await flow.organization();
    other = await flow.organization();
  });

  afterAll(async () => {
    await flow?.close();
  });

  async function create(name: string, parentId?: string, owner = org): Promise<string> {
    const response = await flow.send(owner.manager, 'post', '/api/groups', { name, parentId });
    expect(response.status).toBe(201);
    return (response.body as { result: { id: string } }).result.id;
  }

  it('reads the current depth cap, refuses a cycle and allows an edit below a lowered cap', async () => {
    const parentId = await create('  Trail  ');
    const childId = await create('Crew', parentId);
    const path = '/api/groups';
    const tooDeep = await flow.send(org.manager, 'post', path, {
      name: 'Radio',
      parentId: childId,
    });
    expect(tooDeep.status).toBe(409);
    expect(tooDeep.body).toMatchObject({ result: { errorCode: 'GROUP_DEPTH_EXCEEDED' } });

    const where = { key: 'rentals.groupMaxDepth' };
    const original = await flow.prisma.businessParameter.findUniqueOrThrow({ where });
    await flow.prisma.businessParameter.update({ where, data: { value: 2 } });
    let grandchildId: string;
    try {
      grandchildId = await create('Radio', childId);
      const cycle = await flow.send(org.manager, 'patch', `${path}/${parentId}`, {
        parentId: grandchildId,
        expectedVersion: 1,
      });
      expect(cycle.status).toBe(409);
      expect(cycle.body).toMatchObject({ result: { errorCode: 'GROUP_DEPTH_EXCEEDED' } });
    } finally {
      await flow.prisma.businessParameter.update({ where, data: { value: original.value ?? 1 } });
    }
    const edited = await flow.send(org.manager, 'patch', `${path}/${grandchildId}`, {
      name: 'Radio check',
      expectedVersion: 1,
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ result: { id: grandchildId, version: 2 } });

    const stale = await flow.send(org.manager, 'patch', `${path}/${grandchildId}`, {
      name: 'Old view',
      expectedVersion: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ result: { errorCode: 'STALE_VERSION' } });
    const tree = await flow.send(org.manager, 'get', path);
    const { maxDepth, groups } = (tree.body as TreeEnvelope).result;
    expect(maxDepth).toBe(1);
    expect(groups.find(({ id }) => id === parentId)).toMatchObject({
      name: 'Trail',
      children: [{ id: childId }],
    });
  });

  it('rejects a self-parent at cap one even when depth alone would allow it', async () => {
    const id = await create('Cycle guard');
    const response = await flow.send(org.manager, 'patch', `/api/groups/${id}`, {
      parentId: id,
      expectedVersion: 1,
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ result: { errorCode: 'GROUP_DEPTH_EXCEEDED' } });
    await expect(flow.prisma.group.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({
      parentId: null,
      version: 1,
    });
  });

  it('returns 409 CONFLICT_UNIQUE when creating or renaming to a live sibling name', async () => {
    await create('Duplicate name');
    const otherId = await create('Different name');
    const duplicate = await flow.send(org.manager, 'post', '/api/groups', {
      name: 'duplicate name',
    });
    const rename = await flow.send(org.manager, 'patch', `/api/groups/${otherId}`, {
      name: 'DUPLICATE NAME',
      expectedVersion: 1,
    });
    for (const response of [duplicate, rename]) {
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ result: { errorCode: 'CONFLICT_UNIQUE' } });
    }
  });

  it('rejects a mixed batch, serializes competing moves, and closes the assignment on check-in', async () => {
    const rental = await flow.rented(2);
    const [deviceId] = rental.deviceIds;
    const row = await flow.prisma.contractDevice.findFirstOrThrow({
      where: { contractId: rental.contract.id, deviceId },
    });
    const first = await create('North', undefined, rental.org);
    const second = await create('South', undefined, rental.org);
    const foreign = await flow.rented(1);
    const assign = (groupId: string, deviceIds: string[]) =>
      flow.send(rental.org.manager, 'post', `/api/groups/${groupId}/devices`, { deviceIds });
    const mixed = await assign(first, [deviceId, foreign.deviceIds[0]]);
    expect(mixed.status).toBe(409);
    expect(mixed.body).toMatchObject({ result: { errorCode: 'DEVICE_NOT_HELD' } });
    expect(await flow.prisma.groupAssignment.count({ where: { deviceId } })).toBe(0);

    const results = await Promise.all([assign(first, [deviceId]), assign(second, [deviceId])]);
    expect(results.map(({ status }) => status)).toEqual([200, 200]);
    const assignments = await flow.prisma.groupAssignment.findMany({ where: { deviceId } });
    expect(assignments).toHaveLength(2);
    expect(assignments.filter(({ endedReason }) => endedReason === GroupExit.MOVED)).toHaveLength(
      1,
    );
    const [open] = assignments.filter(({ endedAt }) => endedAt === null);
    const unchanged = await assign(open.groupId, [deviceId]);
    expect(unchanged.body).toMatchObject({ result: { assigned: [], unchanged: [deviceId] } });

    const unassign = await flow.send(
      rental.org.manager,
      'delete',
      `/api/groups/${open.groupId}/devices/${deviceId}`,
    );
    expect(unassign.status).toBe(200);
    await expect(
      flow.prisma.groupAssignment.findUniqueOrThrow({ where: { id: open.id } }),
    ).resolves.toMatchObject({ endedReason: GroupExit.UNASSIGNED });
    expect((await assign(first, [deviceId])).status).toBe(200);
    const fault = await flow.prisma.deviceFaultReport.create({
      data: {
        organizationId: rental.org.id,
        contractId: rental.contract.id,
        contractDeviceId: row.id,
        deviceId,
        description: 'Intermittent signal',
        reportedById: rental.org.manager.id,
      },
    });
    const visible = await flow
      .get(ContractsService)
      .visibleDevices({ organizationId: rental.org.id });
    expect(visible.find((unit) => unit.deviceId === deviceId)).toMatchObject({
      group: { id: first, name: 'North', parentId: null },
      openFaultReportId: fault.id,
    });
    const checkedInAt = new Date();
    await flow.prisma.rentalContract.update({
      where: { id: rental.contract.id },
      data: { status: ContractStatus.RETURN_DUE, returnDueAt: checkedInAt },
    });
    const tag = (await flow.prisma.device.findUniqueOrThrow({ where: { id: deviceId } })).assetTag;
    await flow.get(ReturnService).checkIn(rental.contract.id, [tag], flow.staff, checkedInAt);
    expect(await flow.prisma.groupAssignment.count({ where: { deviceId, endedAt: null } })).toBe(0);
    await expect(
      flow.prisma.deviceFaultReport.findUniqueOrThrow({ where: { id: fault.id } }),
    ).resolves.toMatchObject({ resolution: 'CHECKED_IN', resolvedAt: checkedInAt });
    const returned = await assign(first, [deviceId]);
    expect(returned.status).toBe(409);
  });

  it.each([true, false])(
    'passes the group and resolves the old fault when the replaced unit is present: %s',
    async (faultyPresent) => {
      const rental = await flow.rented(1);
      const [deviceId] = rental.deviceIds;
      const groupId = await create('Replacement group', undefined, rental.org);
      const assigned = await flow.send(
        rental.org.manager,
        'post',
        `/api/groups/${groupId}/devices`,
        {
          deviceIds: [deviceId],
        },
      );
      expect(assigned.status).toBe(200);
      const [replacementDeviceId] = await flow.availableDevices(rental.variantId, 1);
      const oldRow = await flow.prisma.contractDevice.findFirstOrThrow({
        where: { contractId: rental.contract.id, deviceId },
      });
      const fault = await flow.prisma.deviceFaultReport.create({
        data: {
          organizationId: rental.org.id,
          contractId: rental.contract.id,
          contractDeviceId: oldRow.id,
          deviceId,
          description: 'Failed radio',
          reportedById: rental.org.manager.id,
        },
      });
      const at = new Date();
      if (!faultyPresent) {
        await flow
          .get(LossCaseService)
          .report(deviceId, { description: 'Unit missing in the field' }, rental.org.manager, at);
      }
      const { contractDeviceId } = await flow.get(ReplacementService).replace(
        rental.contract.id,
        deviceId,
        {
          replacementDeviceId,
          faultyPresent,
          keyVersion: 1,
          signatureImage: SIGNATURE,
        },
        flow.staff,
        at,
      );
      const assignments = await flow.prisma.groupAssignment.findMany({ where: { groupId } });
      expect(assignments).toHaveLength(2);
      expect(assignments.find((item) => item.deviceId === deviceId)).toMatchObject({
        contractDeviceId: oldRow.id,
        endedReason: GroupExit.REPLACED,
        endedAt: at,
      });
      expect(assignments.find((item) => item.deviceId === replacementDeviceId)).toMatchObject({
        contractDeviceId,
        endedAt: null,
      });
      await expect(
        flow.prisma.deviceFaultReport.findUniqueOrThrow({ where: { id: fault.id } }),
      ).resolves.toMatchObject({ resolution: 'REPLACED', resolvedAt: at });
      await expect(
        flow.prisma.contractDevice.findUniqueOrThrow({ where: { id: oldRow.id } }),
      ).resolves.toMatchObject({ checkedInAt: faultyPresent ? at : null, lostAt: null });
      if (!faultyPresent) {
        const reassigned = await flow.send(
          rental.org.manager,
          'post',
          `/api/groups/${groupId}/devices`,
          {
            deviceIds: [deviceId],
          },
        );
        expect(reassigned.status).toBe(409);
        expect(reassigned.body).toMatchObject({ result: { errorCode: 'DEVICE_NOT_HELD' } });
      }
    },
  );

  it('offers an atomic RELEASED hook for G4 and preserves its custody-end timestamp on retry', async () => {
    const rental = await flow.rented(1);
    const [deviceId] = rental.deviceIds;
    const groupId = await create('Release hook', undefined, rental.org);
    expect(
      (
        await flow.send(rental.org.manager, 'post', `/api/groups/${groupId}/devices`, {
          deviceIds: [deviceId],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await flow.send(
          rental.org.manager,
          'post',
          `/api/contracts/${rental.contract.id}/devices/${deviceId}/fault-reports`,
          { description: 'Radio failure' },
        )
      ).status,
    ).toBe(201);
    const row = await flow.prisma.contractDevice.findFirstOrThrow({
      where: { contractId: rental.contract.id, deviceId },
    });
    const endedAt = new Date();
    const release = (at: Date, rollback = false) =>
      flow.get(TransactionalEvents).transaction(async (tx) => {
        await flow.get(ContractsRepository).lockById(rental.contract.id, tx);
        await flow
          .get(CustodyService)
          .closeCustody(
            rental.org.id,
            [row],
            { reason: 'RELEASED', actorId: flow.staff.id },
            at,
            tx,
          );
        if (rollback) throw new Error('Rollback release');
      });
    await expect(release(endedAt, true)).rejects.toThrow('Rollback release');
    await expect(
      flow.prisma.groupAssignment.count({ where: { deviceId, endedAt: null } }),
    ).resolves.toBe(1);
    await expect(
      flow.prisma.deviceFaultReport.count({
        where: { contractDeviceId: row.id, resolvedAt: null },
      }),
    ).resolves.toBe(1);
    await release(endedAt);
    await expect(
      flow.prisma.contractDevice.findUniqueOrThrow({ where: { id: row.id } }),
    ).resolves.toMatchObject({
      // A released unit is back at the counter (rentals design §13.2, D-099): its row is checked in.
      releasedAt: null,
      checkedInAt: endedAt,
      checkedInById: flow.staff.id,
      lostAt: null,
    });
    await expect(
      flow.prisma.groupAssignment.findFirstOrThrow({ where: { deviceId } }),
    ).resolves.toMatchObject({
      endedAt,
      endedReason: 'RELEASED',
    });
    await expect(
      flow.prisma.deviceFaultReport.findFirstOrThrow({ where: { contractDeviceId: row.id } }),
    ).resolves.toMatchObject({
      resolvedAt: endedAt,
      resolution: 'RELEASED',
    });
    const history = await flow.send(
      flow.staff,
      'get',
      `/api/contracts/${rental.contract.id}/fault-reports`,
    );
    expect(history.status).toBe(200);
    expect(history.body).toMatchObject({
      result: [{ contractDeviceId: row.id, deviceId, resolution: 'RELEASED' }],
    });
    await expect(release(new Date(endedAt.getTime() + 1000))).rejects.toThrow(
      'The custody interval is already closed.',
    );
    const held = await flow.get(ContractsService).visibleDevices({ organizationId: rental.org.id });
    expect(held.some((unit) => unit.deviceId === deviceId)).toBe(false);
  });

  it('returns cross-organization 404s and gives Operator only its own tree', async () => {
    const ownId = await create('Own patrol');
    const foreignId = await create('Outside patrol', undefined, other);
    const path = '/api/groups';
    const missingTargets = [
      await flow.send(org.manager, 'patch', `${path}/${foreignId}`, {
        expectedVersion: 1,
        name: 'New',
      }),
      await flow.send(org.manager, 'delete', `${path}/${foreignId}`),
      await flow.send(org.manager, 'post', path, { name: 'Out', parentId: foreignId }),
    ];
    for (const response of missingTargets) {
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ result: { errorCode: 'NOT_FOUND' } });
    }
    const userId = await flow.user(AccountType.ORGANIZATION, 'ORG_OPERATOR');
    await flow.prisma.organizationMember.create({
      data: { userId, organizationId: org.id, role: MemberRole.OPERATOR },
    });
    const operator = { id: userId, roles: ['ORG_OPERATOR'], organizationId: org.id };
    const tree = await flow.send(operator, 'get', `${path}?organizationId=${other.id}`);
    expect(tree.status).toBe(200);
    const groupIds = (tree.body as TreeEnvelope).result.groups.map(({ id }) => id);
    expect(groupIds).toContain(ownId);
    expect(groupIds).not.toContain(foreignId);
    expect((await flow.send(operator, 'post', path, { name: 'Denied' })).status).toBe(403);
    expect((await flow.send(flow.staff, 'get', path)).status).toBe(400);
    const staffTree = await flow.send(flow.staff, 'get', `${path}?organizationId=${other.id}`);
    expect(staffTree.body).toMatchObject({
      result: { groups: [expect.objectContaining({ id: foreignId })] },
    });
  });

  it('removes a subtree and ends its assignments, including for a suspended organization', async () => {
    const owner = await flow.organization();
    const rootId = await create('Remove', undefined, owner);
    const childId = await create('Child', rootId, owner);
    const variant = await flow.variant();
    const [deviceId] = await flow.availableDevices(variant, 1);
    const contract = await flow.requested(owner.id, owner.manager.id, variant, 1);
    const custody = await flow.prisma.contractDevice.create({
      data: { contractId: contract.id, deviceId, handedOverAt: new Date() },
    });
    const assignment = await flow.prisma.groupAssignment.create({
      data: {
        groupId: childId,
        deviceId,
        contractDeviceId: custody.id,
        assignedById: owner.manager.id,
      },
    });
    await flow.prisma.organization.update({
      where: { id: owner.id },
      data: { status: OrganizationStatus.SUSPENDED },
    });

    const removed = await flow.send(owner.manager, 'delete', `/api/groups/${rootId}`);
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({
      result: { id: rootId, removedGroups: 2, ungroupedDevices: 1 },
    });
    const ended = await flow.prisma.groupAssignment.findUniqueOrThrow({
      where: { id: assignment.id },
    });
    expect(ended.endedAt).toBeInstanceOf(Date);
    expect(ended.endedReason).toBe(GroupExit.GROUP_REMOVED);
    const tree = await flow.send(owner.manager, 'get', '/api/groups');
    expect(tree.body).toMatchObject({ result: { groups: [] } });
    expect((await flow.send(owner.manager, 'delete', `/api/groups/${randomUUID()}`)).status).toBe(
      404,
    );
  });
});
