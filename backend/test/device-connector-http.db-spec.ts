import { DeviceStatus } from '@prisma/client';
import { HandoverService } from '../src/modules/rentals/handover.service';
import { compileRentalFlow, RentalFlow } from './db-rental-flow';

// The device connector over HTTP against Postgres (devices design section 11, devices api-design 30 to
// 32, rentals api-design 30): recognition of a reserved unit with its contract, the dock session routes,
// the quick swap with each refusal of rentals REQ-ERR-17, and organization accounts kept out
// (REQ-UBI-07). The whole application with real guards, policies and services. Run only through
// test:db against a migrated disposable database.
describe('device connector over HTTP against Postgres (devices design section 11)', () => {
  let flow: RentalFlow;

  beforeAll(async () => {
    flow = await compileRentalFlow({ http: true });
  });

  afterAll(async () => {
    await flow?.close();
  });

  // An APPROVED contract of 5 units, its first reserved row, and a spare AVAILABLE unit of the variant.
  const approved = async () => {
    const org = await flow.organization();
    const variantId = await flow.variant();
    await flow.availableDevices(variantId, 5);
    const contract = await flow.requested(org.id, org.manager.id, variantId, 5);
    await flow.approve(contract.id);
    const rows = await flow.prisma.contractDevice.findMany({
      where: { contractId: contract.id, releasedAt: null },
      orderBy: { reservedAt: 'asc' },
    });
    const [spareId] = await flow.availableDevices(variantId, 1);
    const spare = await flow.prisma.device.findUniqueOrThrow({ where: { id: spareId } });
    return { org, variantId, contract, reservedId: rows[0].deviceId, spare };
  };

  const exchange = async (
    contractId: string,
    deviceId: string,
    body: { replacementDeviceId: string; nodeNum: number },
  ) =>
    flow.send(flow.staff, 'post', `/api/contracts/${contractId}/devices/${deviceId}/exchange`, {
      ...body,
      expectedVersion: await flow.version(contractId),
    });

  const errorCode = (response: { body: { result?: { errorCode?: string } } }) =>
    response.body.result?.errorCode;
  const resultOf = (response: { body: unknown }): unknown =>
    (response.body as { result: unknown }).result;

  it('30 (rentals): swaps a docked spare in for a reserved unit and keeps quantity and price', async () => {
    const { contract, reservedId, spare } = await approved();
    const before = await flow.prisma.rentalContract.findUniqueOrThrow({
      where: { id: contract.id },
    });

    const response = await exchange(contract.id, reservedId, {
      replacementDeviceId: spare.id,
      nodeNum: Number(spare.nodeNum),
    });

    expect(response.status).toBe(200);
    expect(resultOf(response)).toMatchObject({
      released: { deviceId: reservedId, status: 'AVAILABLE' },
      reserved: { id: spare.id, status: 'RESERVED', nodeNum: Number(spare.nodeNum) },
      contractVersion: before.version + 1,
    });
    const after = await flow.prisma.rentalContract.findUniqueOrThrow({
      where: { id: contract.id },
    });
    expect(after.quantity).toBe(before.quantity);
    expect(after.monthlyUnitPriceVnd).toBe(before.monthlyUnitPriceVnd);
    expect(after.version).toBe(before.version + 1);
    const live = await flow.prisma.contractDevice.findMany({
      where: { contractId: contract.id, releasedAt: null },
    });
    expect(live.map((row) => row.deviceId)).toContain(spare.id);
    expect(live.map((row) => row.deviceId)).not.toContain(reservedId);
    expect(live).toHaveLength(5);
    const statuses = await flow.prisma.device.findMany({
      where: { id: { in: [reservedId, spare.id] } },
      select: { id: true, status: true },
    });
    expect(Object.fromEntries(statuses.map((unit) => [unit.id, unit.status]))).toEqual({
      [reservedId]: DeviceStatus.AVAILABLE,
      [spare.id]: DeviceStatus.RESERVED,
    });
    const exchanged = await flow.prisma.deviceTransition.findFirst({
      where: { deviceId: reservedId, reason: 'EXCHANGED' },
    });
    expect(exchanged?.toStatus).toBe(DeviceStatus.AVAILABLE);
  });

  it('30 (rentals): refuses a provisioned unit, another node, another variant, a held unit and a stale version', async () => {
    const { org, contract, reservedId, spare } = await approved();
    const handover = flow.get(HandoverService);
    const { channelKeyVersion } = await flow.prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    await handover.provision(contract.id, reservedId, channelKeyVersion, flow.staff);
    const unprovisioned = (
      await flow.prisma.contractDevice.findMany({
        where: { contractId: contract.id, releasedAt: null, deviceId: { not: reservedId } },
      })
    )[0].deviceId;
    const otherVariantUnit = await flow.prisma.device.findUniqueOrThrow({
      where: { id: (await flow.availableDevices(await flow.variant(), 1))[0] },
    });

    expect(
      errorCode(
        await exchange(contract.id, reservedId, {
          replacementDeviceId: spare.id,
          nodeNum: Number(spare.nodeNum),
        }),
      ),
    ).toBe('DEVICE_PROVISIONED');
    expect(
      errorCode(
        await exchange(contract.id, unprovisioned, {
          replacementDeviceId: spare.id,
          nodeNum: Number(spare.nodeNum) + 1,
        }),
      ),
    ).toBe('NODE_MISMATCH');
    expect(
      errorCode(
        await exchange(contract.id, unprovisioned, {
          replacementDeviceId: otherVariantUnit.id,
          nodeNum: Number(otherVariantUnit.nodeNum),
        }),
      ),
    ).toBe('VARIANT_MISMATCH');
    // A unit of the variant that is already reserved (here to this same contract) is not available.
    const sameVariantHeld = await flow.prisma.contractDevice.findFirstOrThrow({
      where: {
        contractId: contract.id,
        releasedAt: null,
        deviceId: { notIn: [reservedId, unprovisioned] },
      },
    });
    const heldOnThis = await flow.prisma.device.findUniqueOrThrow({
      where: { id: sameVariantHeld.deviceId },
    });
    expect(
      errorCode(
        await exchange(contract.id, unprovisioned, {
          replacementDeviceId: heldOnThis.id,
          nodeNum: Number(heldOnThis.nodeNum),
        }),
      ),
    ).toBe('DEVICE_NOT_AVAILABLE');
    const stale = await flow.send(
      flow.staff,
      'post',
      `/api/contracts/${contract.id}/devices/${unprovisioned}/exchange`,
      { replacementDeviceId: spare.id, nodeNum: Number(spare.nodeNum), expectedVersion: 0 },
    );
    expect(errorCode(stale)).toBe('STALE_VERSION');
    await expect(
      flow.prisma.device.findUniqueOrThrow({ where: { id: spare.id } }),
    ).resolves.toMatchObject({ status: DeviceStatus.AVAILABLE });
  });

  it('30 (devices): recognizes a reserved unit with its contract and an unknown number as null', async () => {
    const { contract, reservedId } = await approved();
    const unit = await flow.prisma.device.findUniqueOrThrow({ where: { id: reservedId } });

    const response = await flow.send(
      flow.staff,
      'get',
      `/api/devices/by-node?nodeNum=${unit.nodeNum}&nodeNum=!ffffffff`,
    );

    expect(response.status).toBe(200);
    const [known, unknown] = resultOf(response) as {
      device: { assetTag: string } | null;
      contract: { code: string; status: string } | null;
      nodeId: string;
    }[];
    expect(known.device?.assetTag).toBe(unit.assetTag);
    expect(known.contract).toMatchObject({ code: contract.code, status: 'APPROVED' });
    expect(unknown).toMatchObject({ nodeId: '!ffffffff', device: null, contract: null });
  });

  it('31 and 32: Staff open and end a dock session; organization accounts get 403 on 30 to 32', async () => {
    const { org, reservedId } = await approved();
    const unit = await flow.prisma.device.findUniqueOrThrow({ where: { id: reservedId } });

    const opened = await flow.send(flow.staff, 'put', `/api/devices/${reservedId}/dock`, {
      nodeNum: Number(unit.nodeNum),
    });
    expect(opened.status).toBe(200);
    expect(resultOf(opened)).toMatchObject({ deviceId: reservedId, assetTag: unit.assetTag });
    const recognized = await flow.send(
      flow.staff,
      'get',
      `/api/devices/by-node?nodeNum=${unit.nodeNum}`,
    );
    expect((resultOf(recognized) as { docked: unknown }[])[0].docked).not.toBeNull();

    for (const [method, path, body] of [
      ['get', `/api/devices/by-node?nodeNum=${unit.nodeNum}`, undefined],
      ['put', `/api/devices/${reservedId}/dock`, { nodeNum: Number(unit.nodeNum) }],
    ] as const) {
      expect((await flow.send(org.manager, method, path, body)).status).toBe(403);
    }

    const ended = await flow.send(flow.staff, 'delete', `/api/devices/${reservedId}/dock`);
    expect(ended.status).toBe(200);
    await expect(
      flow.prisma.deviceDockSession.count({ where: { deviceId: reservedId, endedAt: null } }),
    ).resolves.toBe(0);
  });
});
