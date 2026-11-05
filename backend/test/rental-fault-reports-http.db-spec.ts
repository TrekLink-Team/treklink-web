import { ContractStatus, DeviceStatus } from '@prisma/client';
import { ReturnService } from '../src/modules/rentals/return.service';
import { compileRentalFlow, RentalFlow } from './db-rental-flow';

describe('device fault reports against Postgres (rentals 9.4)', () => {
  let flow: RentalFlow;

  beforeAll(async () => {
    flow = await compileRentalFlow({ http: true });
  });

  afterAll(async () => {
    await flow?.close();
  });

  it('scopes the report to the live rental, deduplicates competing requests and resolves it at check-in', async () => {
    const rental = await flow.rented(1);
    const other = await flow.organization();
    const { contract, org } = rental;
    const [deviceId] = rental.deviceIds;
    const [assetTag] = rental.tags;
    const list = `/api/contracts/${contract.id}/fault-reports`;
    const path = `/api/contracts/${contract.id}/devices/${deviceId}/fault-reports`;
    const body = { description: '  Intermittent radio signal  ' };

    expect((await flow.send(other.manager, 'post', path, body)).status).toBe(404);
    expect((await flow.send(other.manager, 'get', list)).status).toBe(404);
    expect((await flow.send(flow.staff, 'post', path, body)).status).toBe(403);
    expect((await flow.send(org.manager, 'post', path, { description: '  ' })).status).toBe(400);

    const responses = await Promise.all([
      flow.send(org.manager, 'post', path, body),
      flow.send(org.manager, 'post', path, body),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    const created = responses.find(({ status }) => status === 201)!;
    const conflict = responses.find(({ status }) => status === 409)!;
    const { id } = (created.body as { result: { id: string } }).result;
    expect(created.body).toMatchObject({
      result: { contractId: contract.id, deviceId, description: 'Intermittent radio signal' },
    });
    expect(conflict.body).toMatchObject({
      result: { errorCode: 'FAULT_ALREADY_REPORTED', reportId: id },
    });
    await expect(
      flow.prisma.device.findUniqueOrThrow({ where: { id: deviceId } }),
    ).resolves.toMatchObject({
      status: DeviceStatus.RENTED,
    });

    const open = await flow.send(flow.staff, 'get', list);
    expect(open.status).toBe(200);
    expect(open.body).toMatchObject({ result: [{ id, deviceId, assetTag, resolvedAt: null }] });

    const checkedInAt = new Date();
    await flow.prisma.rentalContract.update({
      where: { id: contract.id },
      data: { status: ContractStatus.RETURN_DUE, returnDueAt: checkedInAt },
    });
    await flow.get(ReturnService).checkIn(contract.id, [assetTag], flow.staff, checkedInAt);
    const resolved = await flow.send(org.manager, 'get', list);
    expect(resolved.status).toBe(200);
    expect(resolved.body).toMatchObject({
      result: [{ id, resolvedAt: checkedInAt.toISOString(), resolution: 'CHECKED_IN' }],
    });
    const returned = await flow.send(org.manager, 'post', path, body);
    expect(returned.status).toBe(409);
    expect(returned.body).toMatchObject({ result: { errorCode: 'INVALID_STATE_TRANSITION' } });
  });
});
