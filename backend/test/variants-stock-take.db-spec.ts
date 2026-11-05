import { DeviceStatus } from '@prisma/client';
import { ErrorCode } from '../src/common/errors';
import { compileRentalFlow, RentalFlow } from './db-rental-flow';

// Hardware variant administration and the stock-take over HTTP against Postgres (devices design
// section 11, tasks 2.1 and 2.6, W20A): the Admin writes with the version compare-and-set and the
// foreign key refusal, the Staff stock-take with the classification of REQ-EVT-30 and the list.
// Fixtures carry the flow's run ID and are never deleted.
describe('hardware variants and stock-take against Postgres (devices design section 11)', () => {
  let flow: RentalFlow;

  beforeAll(async () => {
    flow = await compileRentalFlow({ http: true });
  });

  afterAll(async () => {
    await flow.close();
  });

  const schedule = [
    { fromMonths: 0, valueVnd: 2500000 },
    { fromMonths: 12, valueVnd: 1800000 },
  ];

  it('creates, edits with the version read, refuses a stale edit and deletes an unused variant (AC-22)', async () => {
    const admin = await flow.admin();
    const code = `tv-${flow.next()}`.toLowerCase();
    const created = await flow.send(admin, 'post', '/api/hardware-variants', {
      code,
      name: 'Test variant',
      hasGps: true,
      hasMotionSensor: false,
      mqttCapable: true,
      firmwareBaseline: '2.7.19-treklink.9',
      remainingValueSchedule: schedule,
      serviceIntervalDays: 180,
      serviceChecklist: ['Battery health'],
      imageUrl: '/variants/treklink-v3-detail.png',
      specSheet: { mcu: 'ESP32' },
    });
    expect(created.status).toBe(201);
    const body = created.body as { result: { id: string; version: number; deviceCount: number } };
    expect(body.result).toMatchObject({ version: 0, deviceCount: 0 });
    const id = body.result.id;

    const again = await flow.send(admin, 'post', '/api/hardware-variants', {
      code,
      name: 'Twin',
      hasGps: true,
      hasMotionSensor: false,
      mqttCapable: true,
      firmwareBaseline: 'x',
      remainingValueSchedule: schedule,
    });
    expect(again.status).toBe(409);
    expect((again.body as { result: { errorCode: string } }).result.errorCode).toBe(
      ErrorCode.CONFLICT_UNIQUE,
    );

    const edited = await flow.send(admin, 'patch', `/api/hardware-variants/${id}`, {
      name: 'Test variant rev B',
      expectedVersion: 0,
    });
    expect(edited.status).toBe(200);
    expect((edited.body as { result: { version: number; name: string } }).result).toMatchObject({
      version: 1,
      name: 'Test variant rev B',
    });

    const stale = await flow.send(admin, 'patch', `/api/hardware-variants/${id}`, {
      isActive: false,
      expectedVersion: 0,
    });
    expect(stale.status).toBe(409);
    expect((stale.body as { result: { errorCode: string } }).result.errorCode).toBe(
      ErrorCode.STALE_VERSION,
    );

    // The audit entries are written by the after-commit listener; give it a moment.
    const auditOf = () =>
      flow.prisma.auditLog.findMany({
        where: { subjectType: 'HardwareVariant', subjectId: id },
        select: { action: true },
      });
    let audit = await auditOf();
    for (let attempt = 0; attempt < 20 && audit.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      audit = await auditOf();
    }
    expect(audit.map((row) => row.action).sort()).toEqual([
      'hardwareVariant.create',
      'hardwareVariant.update',
    ]);

    const removed = await flow.send(admin, 'delete', `/api/hardware-variants/${id}`);
    expect(removed.status).toBe(200);
    expect(await flow.prisma.hardwareVariant.findUnique({ where: { id } })).toBeNull();
  });

  it('refuses a sensor flag change and a delete while units are registered, and forbids Staff', async () => {
    const admin = await flow.admin();
    const variantId = await flow.variant(schedule);
    await flow.availableDevices(variantId, 1);

    const flag = await flow.send(admin, 'patch', `/api/hardware-variants/${variantId}`, {
      hasGps: false,
      expectedVersion: 0,
    });
    expect(flag.status).toBe(409);
    expect((flag.body as { result: { errorCode: string } }).result.errorCode).toBe(
      ErrorCode.VARIANT_IN_USE,
    );

    const removed = await flow.send(admin, 'delete', `/api/hardware-variants/${variantId}`);
    expect(removed.status).toBe(409);

    const staff = await flow.send(flow.staff, 'patch', `/api/hardware-variants/${variantId}`, {
      isActive: false,
      expectedVersion: 0,
    });
    expect(staff.status).toBe(403);
  });

  it('classifies a count, stores it and lists it first with its counts (AC-04, AC-23)', async () => {
    const variantId = await flow.variant(schedule);
    const [shelfId, missingId, rentedId] = await flow.availableDevices(variantId, 3);
    const tags = await flow.prisma.device.findMany({
      where: { id: { in: [shelfId, missingId, rentedId] } },
      select: { id: true, assetTag: true },
    });
    const tagOf = (id: string) => tags.find((row) => row.id === id)!.assetTag;
    // A rented unit last heard 30 hours ago, beyond the seeded 24 hour window (AC-04).
    await flow.prisma.device.update({
      where: { id: rentedId },
      data: { status: DeviceStatus.RENTED, lastSeenAt: new Date(Date.now() - 30 * 3600 * 1000) },
    });
    const unknown = `ZZ-${flow.next()}`.toUpperCase();

    const run = await flow.send(flow.staff, 'post', '/api/stock-takes', {
      scannedTags: [` ${tagOf(shelfId).toLowerCase()} `, unknown],
    });
    expect(run.status).toBe(201);
    const result = (
      run.body as {
        result: {
          id: string;
          unconfirmed: { id: string; assetTag: string; status: string }[];
          unknownTags: string[];
          scannedCount: number;
        };
      }
    ).result;
    expect(result.scannedCount).toBe(2);
    expect(result.unknownTags).toEqual([unknown]);
    const unconfirmedIds = result.unconfirmed.map((row) => row.id);
    expect(unconfirmedIds).toEqual(expect.arrayContaining([missingId, rentedId]));
    expect(unconfirmedIds).not.toContain(shelfId);
    expect(result.unconfirmed.find((row) => row.id === rentedId)?.status).toBe('RENTED');

    const list = await flow.send(flow.staff, 'get', '/api/stock-takes?pageSize=5');
    expect(list.status).toBe(200);
    const first = (list.body as { result: { items: Record<string, unknown>[] } }).result.items[0];
    expect(first).toMatchObject({
      id: result.id,
      scannedCount: 2,
      unknownCount: 1,
      unconfirmedCount: result.unconfirmed.length,
    });
    expect(typeof first.takenBy).toBe('string');

    const empty = await flow.send(flow.staff, 'post', '/api/stock-takes', { scannedTags: [] });
    expect(empty.status).toBe(400);
  });
});
