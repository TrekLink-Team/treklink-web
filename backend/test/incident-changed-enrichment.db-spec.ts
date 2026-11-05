import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import type { Socket } from 'socket.io-client';
import { Caller } from '../src/common/decorators/access.decorator';
import { IncidentsService } from '../src/modules/incidents/incidents.service';
import { IncidentLifecycle } from '../src/modules/incidents/incident-lifecycle';
import { IncidentsRepository } from '../src/modules/incidents/incidents.repository';
import { RoutingService } from '../src/modules/incidents/routing.service';
import { LiveIoAdapter } from '../src/modules/monitoring/live-io.adapter';
import { TransactionalEvents } from '../src/modules/platform/events/emit-after-commit';
import { compileRentalFlow, RentalFlow } from './db-rental-flow';
import { openLiveSocket } from './live-socket-client';

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

// Monitoring task 2.1: the `incident.changed` entry of the live stream carries the code, the owner's
// name, the last position and the stale mark of the committed incident (ws-live-contract), read through
// `IncidentsQueryService.liveFieldsOf` by the real `StreamListener`, and reaches the routed
// organization and the fleet only. Real PostgreSQL commit and authenticated loopback sockets. Fixtures
// are fresh organizations and a fresh device; nothing existing is deleted.
describe('incident.changed carries the fields of the committed incident (monitoring 2.1)', () => {
  let flow: RentalFlow;
  let app: INestApplication;
  let url: string;
  const clients: Client[] = [];

  const until = async (predicate: () => boolean, timeout = 5000) => {
    const end = performance.now() + timeout;
    while (!predicate()) {
      if (performance.now() >= end) throw new Error('Socket verification timed out');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const quiet = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));
  const as = async (caller: Caller): Promise<Client> => {
    const token = await flow.get(JwtService).signAsync({ sub: caller.id, pv: 0 });
    // The shared helper waits 10 s for the handshake; the entries are collected from the first one on.
    const entries: Entry[] = [];
    const socket = await openLiveSocket(url, { token }, (opened) => {
      opened.on('stream', (entry: Entry) => entries.push(entry));
    });
    const client: Client = { socket, entries };
    clients.push(client);
    return client;
  };
  const changesOf = (client: Client, incidentId: string) =>
    client.entries.filter(
      (entry) => entry.type === 'incident.changed' && entry.payload.incidentId === incidentId,
    );

  beforeAll(async () => {
    flow = await compileRentalFlow();
    app = flow.moduleRef.createNestApplication();
    app.useLogger(false);
    app.useWebSocketAdapter(new LiveIoAdapter(app, ['http://localhost']));
    await app.listen(0, '127.0.0.1');
    url = `http://127.0.0.1:${((app.getHttpServer() as Server).address() as AddressInfo).port}/live`;
  }, 120_000);
  afterEach(() => {
    clients.splice(0).forEach(({ socket }) => socket.close());
  });
  afterAll(async () => {
    if (app) await app.close();
    else if (flow) await flow.close();
  });

  it('puts the code, the owner name, the last position and the stale mark on the entry of the routed organization and the fleet', async () => {
    const orgA = await flow.organization();
    const orgB = await flow.organization();
    const variantId = await flow.variant();
    const [deviceId] = await flow.availableDevices(variantId, 1);
    const [manager, outsider, staff] = await Promise.all([
      as(orgA.manager),
      as(orgB.manager),
      as(flow.staff),
    ]);
    const fullName = (
      await flow.prisma.user.findUniqueOrThrow({
        where: { id: orgA.manager.id },
        select: { fullName: true },
      })
    ).fullName;
    const at = new Date();

    const incident = await flow.get(TransactionalEvents).transaction(async (tx) => {
      const { incident: inserted } = await flow.get(IncidentsRepository).insert(
        {
          deviceId,
          source: 'DEVICE_SOS',
          confidence: 'CONFIRMED',
          firstEventAt: at,
          lastEventAt: at,
          organizationId: orgA.id,
          lastLatitude: 11.561,
          lastLongitude: 108.552,
        },
        at,
        tx,
      );
      const route = await flow
        .get(RoutingService)
        .route({ organizationId: orgA.id, contractId: null }, at, tx);
      return flow
        .get(IncidentLifecycle)
        .apply(
          inserted.id,
          'DETECTED',
          route.to,
          { kind: 'SYSTEM' },
          { code: 'ROUTED', at, recipients: route.recipients },
          tx,
        );
    });

    await until(() => changesOf(manager, incident.id).length > 0);
    await until(() => changesOf(staff, incident.id).length > 0);
    for (const client of [manager, staff]) {
      const [entry] = changesOf(client, incident.id);
      expect(entry.deviceId).toBe(deviceId);
      expect(entry.payload).toMatchObject({
        incidentId: incident.id,
        code: incident.code,
        ownerId: null,
        ownerName: null,
        lastPosition: { lat: 11.561, lon: 108.552 },
        stale: false,
      });
    }

    // The Manager acknowledges: the next entry names the owner.
    await flow
      .get(IncidentsService)
      .acknowledge(incident.id, { expectedVersion: incident.version }, orgA.manager);

    const acknowledged = (client: Client) =>
      changesOf(client, incident.id).find((entry) => entry.payload.state === 'ACKNOWLEDGED');
    await until(() => acknowledged(manager) !== undefined);
    await until(() => acknowledged(staff) !== undefined);
    await quiet();
    for (const client of [manager, staff]) {
      expect(acknowledged(client)?.payload).toMatchObject({
        code: incident.code,
        ownerId: orgA.manager.id,
        ownerName: fullName,
        lastPosition: { lat: 11.561, lon: 108.552 },
        stale: false,
      });
    }
    expect(changesOf(outsider, incident.id)).toEqual([]);
  });
});
