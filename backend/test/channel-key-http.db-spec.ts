import { hkdfSync } from 'node:crypto';
import { compileRentalFlow, RentalFlow } from './db-rental-flow';

// The docking backend over HTTP against Postgres (rentals api-design 09 and 21, devices design section
// 8.5 and 8.6, D-082): the permission row of the new forward migration, the derived channel key for a
// reserved unit whose nodeNum matches, the 409 NODE_MISMATCH that returns no key and records nothing,
// and the audit rows that never hold a key. The whole application with real guards, policies and
// services (test/db-rental-flow.ts). Run only through test:db against a migrated disposable database.
describe('device docking over HTTP against Postgres (D-082)', () => {
  let flow: RentalFlow;

  beforeAll(async () => {
    flow = await compileRentalFlow({ http: true });
  });

  afterAll(async () => {
    await flow?.close();
  });

  // An APPROVED contract of 5 units with one reserved unit and the node number of its record.
  const approved = async () => {
    const org = await flow.organization();
    const variantId = await flow.variant();
    await flow.availableDevices(variantId, 5);
    const contract = await flow.requested(org.id, org.manager.id, variantId, 5);
    await flow.approve(contract.id);
    const [row, second] = await flow.prisma.contractDevice.findMany({
      where: { contractId: contract.id, releasedAt: null },
    });
    const device = await flow.prisma.device.findUniqueOrThrow({ where: { id: row.deviceId } });
    return {
      org,
      contract,
      deviceId: device.id,
      nodeNum: Number(device.nodeNum),
      secondDeviceId: second.deviceId,
    };
  };

  const channelKey = (contractId: string, deviceId: string, nodeNum: number) =>
    flow.send(flow.staff, 'post', `/api/contracts/${contractId}/devices/${deviceId}/channel-key`, {
      nodeNum,
    });

  // The key as the design derives it, computed here without the service under test.
  const expectedKey = (organizationId: string, version: number) =>
    Buffer.from(
      hkdfSync(
        'sha256',
        process.env.CHANNEL_KEY_MASTER as string,
        organizationId,
        `treklink-channel-key/v${version}`,
        32,
      ),
    ).toString('hex');

  // The audit sink writes after the response; wait for the row instead of racing it.
  const auditRows = async (action: string, subjectId: string) => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const rows = await flow.prisma.auditLog.findMany({ where: { action, subjectId } });
      if (rows.length > 0) return rows;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return [];
  };

  it('seeds contract.issueChannelKey for TrekLink Staff and Admin only', async () => {
    const grants = await flow.prisma.$queryRaw<{ key: string }[]>`
      SELECT r."key" FROM "role_permissions" rp
      JOIN "roles" r ON r."id" = rp."roleId"
      JOIN "permissions" p ON p."id" = rp."permissionId"
      WHERE p."key" = 'contract.issueChannelKey'
      ORDER BY r."key"`;
    expect(grants.map((grant) => grant.key)).toEqual(['ADMIN', 'STAFF']);
  });

  it('21: issues the derived key for a reserved unit, never cached, and audits without the key', async () => {
    const { org, contract, deviceId, nodeNum } = await approved();
    const { channelKeyVersion } = await flow.prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    const keyHex = expectedKey(org.id, channelKeyVersion);

    const response = await channelKey(contract.id, deviceId, nodeNum);

    expect({ status: response.status, body: response.body as unknown }).toMatchObject({
      status: 200,
      body: {
        isSuccess: true,
        message: 'Channel key issued',
        result: { keyHex, keyVersion: channelKeyVersion },
      },
    });
    expect(response.headers['cache-control']).toBe('no-store');
    const [audit] = await auditRows('contract.channelKeyIssued', contract.id);
    expect(audit).toMatchObject({
      organizationId: org.id,
      subjectType: 'RentalContract',
      after: { deviceId, keyVersion: channelKeyVersion },
    });
    expect(JSON.stringify(audit)).not.toContain(keyHex);
  });

  it('21: 409 NODE_MISMATCH for another unit, with no key in the answer and no audit row', async () => {
    const { org, contract, deviceId, nodeNum } = await approved();
    const { channelKeyVersion } = await flow.prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });

    const response = await channelKey(contract.id, deviceId, nodeNum + 1);

    expect({ status: response.status, body: response.body as unknown }).toMatchObject({
      status: 409,
      body: { isSuccess: false, statusCode: 409, result: { errorCode: 'NODE_MISMATCH' } },
    });
    expect(JSON.stringify(response.body)).not.toContain(expectedKey(org.id, channelKeyVersion));
    expect(JSON.stringify(response.body)).not.toContain('keyHex');
    expect(
      await flow.prisma.auditLog.count({
        where: { action: 'contract.channelKeyIssued', subjectId: contract.id },
      }),
    ).toBe(0);
  });

  it('21: an Org Manager is refused, the key is for TrekLink Staff', async () => {
    const { org, contract, deviceId, nodeNum } = await approved();

    const response = await flow.send(
      org.manager,
      'post',
      `/api/contracts/${contract.id}/devices/${deviceId}/channel-key`,
      { nodeNum },
    );

    expect(response.status).toBe(403);
    expect(JSON.stringify(response.body)).not.toContain('keyHex');
  });

  it('09: records a matching nodeNum, refuses a different one, and audits the fallback as manual', async () => {
    const { contract, deviceId, nodeNum, secondDeviceId } = await approved();
    const provision = (unitId: string, body: object) =>
      flow.send(
        flow.staff,
        'post',
        `/api/contracts/${contract.id}/devices/${unitId}/provisioning`,
        body,
      );

    const refused = await provision(deviceId, { keyVersion: 1, nodeNum: nodeNum + 1 });
    expect({ status: refused.status, body: refused.body as unknown }).toMatchObject({
      status: 409,
      body: { result: { errorCode: 'NODE_MISMATCH' } },
    });
    expect(
      (await flow.prisma.device.findUniqueOrThrow({ where: { id: deviceId } })).keyVersion,
    ).toBeNull();

    const docked = await provision(deviceId, { keyVersion: 1, nodeNum });
    expect(docked.status).toBe(200);
    expect(
      (await flow.prisma.device.findUniqueOrThrow({ where: { id: deviceId } })).keyVersion,
    ).toBe(1);
    expect(
      await flow.prisma.auditLog.count({
        where: { action: 'contract.provisioningRecordedManually', subjectId: contract.id },
      }),
    ).toBe(0);

    const manual = await provision(secondDeviceId, { keyVersion: 1 });
    expect(manual.status).toBe(200);
    const [audit] = await auditRows('contract.provisioningRecordedManually', contract.id);
    expect(audit).toMatchObject({
      after: { deviceId: secondDeviceId, keyVersion: 1, manual: true },
    });
  });

  it('03: the contract detail carries the nodeNum of each unit, read only', async () => {
    const { contract, deviceId, nodeNum } = await approved();

    const response = await flow.send(flow.staff, 'get', `/api/contracts/${contract.id}`);

    expect(response.status).toBe(200);
    const devices = (
      response.body as { result: { devices: { deviceId: string; nodeNum: number }[] } }
    ).result.devices;
    expect(devices.find((device) => device.deviceId === deviceId)?.nodeNum).toBe(nodeNum);
  });
});
