import { AccountType, GroupExit, MemberRole, OrganizationStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { compileRentalFlow, RentalFlow } from './db-rental-flow';

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
