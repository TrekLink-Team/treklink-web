import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ContractStatus, IngressPath, PlanType, Prisma } from '@prisma/client';
import { io, Socket } from 'socket.io-client';
import * as request from 'supertest';
import { configureApp } from '../src/app.setup';
import { Caller } from '../src/common/decorators/access.decorator';
import { FieldStationJsonAdapter } from '../src/modules/gateway-sync/adapters/field-station-json.adapter';
import { CanonicalEnvelope } from '../src/modules/gateway-sync/canonical-envelope';
import { IngestionService } from '../src/modules/gateway-sync/ingestion.service';
import { fixture } from '../src/modules/gateway-sync/testing/fixtures';
import { LiveIoAdapter } from '../src/modules/monitoring/live-io.adapter';
import { ValidatedEnvironment } from '../src/modules/platform/config/environment-variables';
import { ApiKeysService } from '../src/modules/organizations/api-keys.service';
import { DEVICE_CHECKED_IN, DEVICE_HANDED_OVER } from '../src/modules/rentals';
import { compileRentalFlow, RentalFlow } from './db-rental-flow';

const HOUR = 3_600_000;
const SKEW = 3 * HOUR; // the station clock runs 3 h fast (gateway-sync design section 8)

interface Entry {
  seq: number;
  type: string;
  deviceId: string | null;
  payload: Record<string, unknown>;
}
interface Client {
  socket: Socket;
  entries: Entry[];
}
interface Org {
  id: string;
  manager: Caller;
  key: string;
  member: Client;
  api: Client;
}

// Monitoring task 4.2, AC-01 and AC-06 with two organizations and the real parts end to end: the
// ingestion of gateway-sync attributes an event to the custody interval of its occurrence time, the
// `StreamListener` publishes it to that organization only, and loopback Socket.IO clients, the
// organization API and the history read what each organization is allowed to see. Custody is written
// as rows, as `station-attribution.db-spec.ts` does, and the handover and check-in events are emitted on
// the application's own event bus. Each case has its own device; fixtures carry a fresh run id and
// nothing existing is deleted. Background jobs run as in `incident-alert-socket.db-spec.ts`, so a
// `device.stale` entry of a device can appear; the cases look at position entries only.
describe('monitoring with two organizations (task 4.2, AC-01 and AC-06)', () => {
  let flow: RentalFlow;
  let app: NestExpressApplication;
  let url: string;
  let a: Org;
  let b: Org;
  let variantId: string;
  let ingestion: IngestionService;
  let adapter: FieldStationJsonAdapter;
  let stationUsername: string;
  const runId = randomUUID();
  const short = runId.slice(0, 8);
  let serial = 0;
  let packetId = Number.parseInt(randomUUID().slice(0, 7), 16);
  const clients: Client[] = [];

  const until = async (predicate: () => boolean, timeout = 5000) => {
    const end = performance.now() + timeout;
    while (!predicate()) {
      if (performance.now() >= end) throw new Error('Socket verification timed out');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const quiet = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));
  const connect = async (auth: Record<string, unknown>): Promise<Client> => {
    const socket = io(url, {
      auth,
      transports: ['websocket'],
      reconnection: false,
      autoConnect: false,
    });
    const client: Client = { socket, entries: [] };
    clients.push(client);
    socket.on('stream', (entry: Entry) => client.entries.push(entry));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Handshake timed out')), 3000);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.connect();
    });
    return client;
  };
  const token = (caller: Caller) =>
    flow.get(JwtService).signAsync({ sub: caller.id, roles: [], pv: 0 });
  const withToken = async (caller: Caller, path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${await token(caller)}`);
  const withKey = (key: string, path: string) =>
    request(app.getHttpServer()).get(path).set('X-Api-Key', key);

  const organization = async (): Promise<Org> => {
    const base = await flow.organization();
    const { key } = await flow.get(ApiKeysService).create(base.id, 'two-orgs', base.manager);
    return {
      id: base.id,
      manager: base.manager,
      key,
      member: await connect({ token: await token(base.manager) }),
      api: await connect({ apiKey: key }),
    };
  };

  // A device with the custody of A, then of B, and the events the rentals module emits for them.
  const scenario = async (now: Date) => {
    const nodeNum = BigInt(`0x${randomUUID().slice(0, 8)}`);
    const { id: deviceId } = await flow.prisma.device.create({
      data: {
        assetTag: `TW-${short}-${++serial}`,
        nodeNum,
        hardwareVariantId: variantId,
        firmwareVersion: 'test-only',
        acquiredAt: new Date(now.getTime() - 400 * HOUR),
        registeredById: flow.staff.id,
        status: 'RENTED',
      },
    });
    const interval = async (org: Org, handedOverAt: Date, checkedInAt: Date | null) => {
      const contract = await flow.prisma.rentalContract.create({
        data: {
          code: `RC-TW-${short}-${++serial}`,
          organizationId: org.id,
          planType: PlanType.MONTHLY,
          hardwareVariantId: variantId,
          quantity: 1,
          requestedStartDate: new Date('2026-09-01T00:00:00Z'),
          monthlyUnitPriceVnd: 250_000n,
          holdingFeeRatio: new Prisma.Decimal('0.5'),
          requestedById: org.manager.id,
          status: ContractStatus.ACTIVE,
        },
      });
      await flow.prisma.contractDevice.create({
        data: { contractId: contract.id, deviceId, handedOverAt, checkedInAt },
      });
      return contract.id;
    };
    const handedA = new Date(now.getTime() - 30 * HOUR);
    const releasedA = new Date(now.getTime() - 6 * HOUR);
    const handedB = new Date(now.getTime() - 5 * HOUR);
    const contractA = await interval(a, handedA, releasedA);
    const contractB = await interval(b, handedB, null);
    const bus = flow.get(EventEmitter2);
    await bus.emitAsync(DEVICE_HANDED_OVER, {
      deviceId,
      contractId: contractA,
      organizationId: a.id,
      at: handedA,
    });
    await bus.emitAsync(DEVICE_CHECKED_IN, {
      deviceId,
      contractId: contractA,
      organizationId: a.id,
      at: releasedA,
    });
    await bus.emitAsync(DEVICE_HANDED_OVER, {
      deviceId,
      contractId: contractB,
      organizationId: b.id,
      at: handedB,
    });
    return { deviceId, nodeNum: Number(nodeNum) };
  };

  // The position of the unit as its own uplink sends it (Stage A, rx_time 0): occurrence is the receipt.
  const nodePosition = (nodeNum: number, receivedAt: Date): CanonicalEnvelope => {
    const message = {
      id: ++packetId,
      from: nodeNum,
      timestamp: 0,
      type: 'position' as const,
      sender: `!${nodeNum.toString(16).padStart(8, '0')}`,
      payload: { latitude_i: 115544000, longitude_i: 1085381000, altitude: 1320 },
    };
    return {
      ingress: IngressPath.MQTT_NODE,
      uplinkKey: message.sender,
      receivedAt,
      packet: message,
      message,
    };
  };
  // A position A's Field Station queued, as the E02-7 fixture is, captured at `capturedAt`.
  const stationPosition = (nodeNum: number, capturedAt: Date, receivedAt: Date) => {
    const [{ body }] = fixture('station-sos-e02-7');
    const message = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
    Object.assign(message, {
      id: ++packetId,
      from: nodeNum,
      type: 'position',
      payload: { latitude_i: 115544000, longitude_i: 1085381000, altitude: 1320 },
      fs_captured_at: capturedAt.getTime() + SKEW,
      fs_sent_at: receivedAt.getTime() + SKEW,
    });
    const topic = `treklink/fs/${stationUsername}/2/json/LongFast/!de0000a1`;
    const result = adapter.adapt(topic, Buffer.from(JSON.stringify(message)), receivedAt);
    if (result.kind !== 'envelope')
      throw new Error(`station message did not adapt: ${result.kind}`);
    return result.envelope;
  };

  const positionsOf = (client: Client, deviceId: string) =>
    client.entries.filter(
      (entry) => entry.type === 'device.position' && entry.deviceId === deviceId,
    );
  const apiEntries = async (org: Org, cursor: number, deviceId: string) => {
    const response = await withKey(org.key, `/api/telemetry/stream?after=${cursor}&limit=500`);
    expect(response.status).toBe(200);
    const entries = (response.body as { result: { entries: Entry[] } }).result.entries;
    return entries.filter((entry) => entry.deviceId === deviceId);
  };
  const cursorOf = async (org: Org) => {
    const response = await withKey(org.key, '/api/telemetry/devices');
    expect(response.status).toBe(200);
    return (response.body as { result: { cursor: number } }).result.cursor;
  };
  const historyAts = async (org: Org, deviceId: string, now: Date) => {
    const from = new Date(now.getTime() - 48 * HOUR).toISOString();
    const to = new Date(now.getTime() + HOUR).toISOString();
    const response = await withToken(
      org.manager,
      `/api/telemetry/devices/${deviceId}/history?from=${from}&to=${to}`,
    );
    return {
      status: response.status,
      ats: ((response.body as { result: { points?: { at: string }[] } }).result.points ?? []).map(
        (point) => new Date(point.at).getTime(),
      ),
    };
  };

  beforeAll(async () => {
    flow = await compileRentalFlow();
    app = flow.moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    app.useWebSocketAdapter(new LiveIoAdapter(app, ['http://localhost']));
    await app.listen(0, '127.0.0.1');
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/live`;
    ingestion = flow.get(IngestionService);
    adapter = new FieldStationJsonAdapter({
      get: () => 'treklink',
    } as unknown as ConfigService<ValidatedEnvironment, true>);
    variantId = await flow.variant();
    a = await organization();
    b = await organization();
    stationUsername = `fs-tw-${short}-a`;
    await flow.prisma.fieldStation.create({
      data: {
        organizationId: a.id,
        name: 'Two-organization station A',
        mqttUsername: stationUsername,
        secretHash: 'not-a-real-hash',
        createdById: a.manager.id,
        queueDepth: [],
      },
    });
  }, 120_000);
  afterAll(async () => {
    clients.splice(0).forEach(({ socket }) => socket.close());
    if (app) await app.close();
    else if (flow) await flow.close();
  });

  it('AC-01: B receives its unit position and A never does, on the socket, the API and the history', async () => {
    const now = new Date();
    const unit = await scenario(now);
    const [cursorA, cursorB] = [await cursorOf(a), await cursorOf(b)];

    await expect(ingestion.ingest(nodePosition(unit.nodeNum, now))).resolves.toBe('ACCEPTED');

    await until(() => positionsOf(b.member, unit.deviceId).length > 0);
    await until(() => positionsOf(b.api, unit.deviceId).length > 0);
    await quiet();
    expect(positionsOf(a.member, unit.deviceId)).toEqual([]);
    expect(positionsOf(a.api, unit.deviceId)).toEqual([]);
    expect(await apiEntries(a, cursorA, unit.deviceId)).toEqual([]);
    expect(
      (await apiEntries(b, cursorB, unit.deviceId)).filter((e) => e.type === 'device.position'),
    ).toHaveLength(1);
    const own = await historyAts(b, unit.deviceId, now);
    expect(own.status).toBe(200);
    expect(own.ats).toContain(now.getTime());
    const foreign = await historyAts(a, unit.deviceId, now);
    expect(foreign.status).toBe(200);
    expect(foreign.ats).not.toContain(now.getTime());
  });

  it('AC-06: a position of A synchronized after the unit went to B reaches A flagged late and never B', async () => {
    const now = new Date();
    const unit = await scenario(now);
    const capturedAt = new Date(now.getTime() - 20 * HOUR);
    const [cursorA, cursorB] = [await cursorOf(a), await cursorOf(b)];

    await expect(ingestion.ingest(stationPosition(unit.nodeNum, capturedAt, now))).resolves.toBe(
      'ACCEPTED',
    );

    await until(() => positionsOf(a.member, unit.deviceId).length > 0);
    await until(() => positionsOf(a.api, unit.deviceId).length > 0);
    await quiet();
    for (const client of [a.member, a.api]) {
      const [entry] = positionsOf(client, unit.deviceId);
      expect(entry.payload).toMatchObject({ late: true, at: capturedAt.toISOString() });
    }
    expect(positionsOf(b.member, unit.deviceId)).toEqual([]);
    expect(positionsOf(b.api, unit.deviceId)).toEqual([]);
    const late = (await apiEntries(a, cursorA, unit.deviceId)).filter(
      (entry) => entry.type === 'device.position',
    );
    expect(late).toHaveLength(1);
    expect(late[0].payload).toMatchObject({ late: true });
    expect(await apiEntries(b, cursorB, unit.deviceId)).toEqual([]);
    const own = await historyAts(a, unit.deviceId, now);
    expect(own.status).toBe(200);
    expect(own.ats).toContain(capturedAt.getTime());
    const foreign = await historyAts(b, unit.deviceId, now);
    expect(foreign.status).toBe(200);
    expect(foreign.ats).not.toContain(capturedAt.getTime());
  });
});
