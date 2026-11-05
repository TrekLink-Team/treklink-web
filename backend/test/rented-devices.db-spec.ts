import { AccountType, ContractStatus, MemberRole } from '@prisma/client';
import { ReturnService } from '../src/modules/rentals/return.service';
import { at, compileRentalFlow, RentalFlow } from './db-rental-flow';

type Group = { id: string; name: string; parentId: string | null };
type Unit = {
  deviceId: string;
  contractDeviceId: string;
  contract: { id: string; planType: string; status: string };
  group: Group | null;
  holder: { name: string } | null;
  state: string;
  batteryPct: number | null;
  lastSeenAt: string | null;
};
type ConsoleEnvelope = {
  result: { items: Unit[]; totalCount: number; totalPages: number };
};
type MapEnvelope = {
  result: { devices: { id: string; group: Group | null; holder: Unit['holder'] }[] };
};

describe('rented-device console and map group filters (monitoring AC-09 and AC-10)', () => {
  let flow: RentalFlow;

  beforeAll(async () => {
    flow = await compileRentalFlow({ http: true });
  });

  afterAll(async () => {
    await flow?.close();
  });

  it('lists both contracts, expands subgroups and drops the checked-in device without filtering Staff', async () => {
    const first = await flow.rented(4);
    const { id: organizationId, manager } = first.org;
    const otherIds = await flow.availableDevices(first.variantId, 3);
    const second = await flow.requested(organizationId, manager.id, first.variantId, 3);
    await flow.approve(second.id);
    await flow.payAll(second.id);
    await flow.handOver(second.id, manager.id, otherIds);
    const [firstId, secondId, thirdId, subgroupDeviceId] = first.deviceIds;

    const createGroup = async (name: string, parentId?: string) => {
      const response = await flow.send(manager, 'post', '/api/groups', { name, parentId });
      expect(response.status).toBe(201);
      return (response.body as { result: Group }).result;
    };
    const group = await createGroup('A');
    const child = await createGroup('A1', group.id);
    const assign = (groupId: string, deviceIds: string[]) =>
      flow.send(manager, 'post', `/api/groups/${groupId}/devices`, { deviceIds });
    expect((await assign(group.id, [firstId, secondId, thirdId])).status).toBe(200);
    expect((await assign(child.id, [subgroupDeviceId])).status).toBe(200);

    await flow.prisma.contractDevice.updateMany({
      where: { contractId: first.contract.id, deviceId: firstId },
      data: { holderName: 'Ranger A' },
    });
    const beforeHandover = at('2026-11-02T02:45:00.000Z');
    await flow.prisma.device.update({
      where: { id: firstId },
      data: { lastSeenAt: beforeHandover, lastBatteryAt: beforeHandover, batteryPct: 55 },
    });

    const list = async (query = '') => {
      const response = await flow.send(manager, 'get', `/api/rented-devices${query}`);
      expect(response.status).toBe(200);
      return (response.body as ConsoleEnvelope).result;
    };
    const all = await list();
    expect(all.totalCount).toBe(7);
    expect(new Set(all.items.map(({ contract }) => contract.id))).toEqual(
      new Set([first.contract.id, second.id]),
    );
    expect(all.items.find(({ deviceId }) => deviceId === firstId)).toMatchObject({
      group: { id: group.id, name: 'A', parentId: null },
      holder: { name: 'Ranger A' },
      contract: { id: first.contract.id, planType: 'MONTHLY', status: 'ACTIVE' },
      state: 'NOT_HEARD',
      batteryPct: null,
      lastSeenAt: null,
    });
    expect((await list(`?groupId=${group.id}`)).totalCount).toBe(4);
    expect((await list(`?groupId=${child.id}`)).items.map(({ deviceId }) => deviceId)).toEqual([
      subgroupDeviceId,
    ]);
    expect((await list('?groupId=none&state=NOT_HEARD&pageSize=2')).totalPages).toBe(2);
    expect((await list(`?contractId=${second.id}`)).totalCount).toBe(3);

    const mapPath = `/api/map/snapshot?organizationId=${organizationId}&groupId=${group.id}`;
    const orgMap = await flow.send(manager, 'get', mapPath);
    expect(orgMap.status).toBe(200);
    const { devices } = (orgMap.body as MapEnvelope).result;
    expect(new Set(devices.map(({ id }) => id))).toEqual(new Set(first.deviceIds));
    expect(devices.find(({ id }) => id === firstId)).toMatchObject({
      holder: { name: 'Ranger A' },
      group: { id: group.id },
    });
    const fleetMap = await flow.send(flow.staff, 'get', mapPath);
    expect(fleetMap.status).toBe(200);
    expect((fleetMap.body as MapEnvelope).result.devices).toHaveLength(7);

    const checkedInAt = at('2026-11-03T02:00:00.000Z');
    await flow.prisma.rentalContract.update({
      where: { id: first.contract.id },
      data: { status: ContractStatus.RETURN_DUE, returnDueAt: checkedInAt },
    });
    const { assetTag } = await flow.prisma.device.findUniqueOrThrow({ where: { id: firstId } });
    await flow.get(ReturnService).checkIn(first.contract.id, [assetTag], flow.staff, checkedInAt);
    expect((await list()).totalCount).toBe(6);
    expect((await list(`?groupId=${group.id}`)).totalCount).toBe(3);
    const tree = await flow.send(manager, 'get', '/api/groups');
    expect(
      (tree.body as { result: { groups: { id: string; deviceCount: number }[] } }).result.groups[0],
    ).toMatchObject({ id: group.id, deviceCount: 2 });
  });

  it('refuses other roles and treats foreign filters as absent', async () => {
    const own = await flow.organization();
    const other = await flow.organization();
    const operatorId = await flow.user(AccountType.ORGANIZATION, 'ORG_OPERATOR');
    await flow.prisma.organizationMember.create({
      data: { organizationId: own.id, userId: operatorId, role: MemberRole.OPERATOR },
    });
    const operator = { id: operatorId, organizationId: own.id, roles: ['ORG_OPERATOR'] };
    const route = '/api/rented-devices';
    expect((await flow.send(operator, 'get', route)).status).toBe(403);
    expect((await flow.send(flow.staff, 'get', route)).status).toBe(403);
    expect((await flow.send(own.manager, 'get', `${route}?groupId=bad`)).status).toBe(400);
    const group = await flow.prisma.group.create({
      data: { organizationId: other.id, createdById: other.manager.id, name: 'Other A' },
    });
    const contract = await flow.requested(other.id, other.manager.id, await flow.variant(), 1);
    expect((await flow.send(own.manager, 'get', `${route}?groupId=${group.id}`)).status).toBe(404);
    expect((await flow.send(own.manager, 'get', `${route}?contractId=${contract.id}`)).status).toBe(
      404,
    );
  });
});
