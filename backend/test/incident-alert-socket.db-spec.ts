import './db-app-env';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { io, Socket } from 'socket.io-client';
import { AccountType, Incident } from '@prisma/client';
import { Caller } from '../src/common/decorators/access.decorator';
import { INCIDENT_ALERT, IncidentAlertEvent } from '../src/modules/incidents';
import { AlertDispatcherJob } from '../src/modules/incidents/alerts/alert-dispatcher.job';
import { IncidentLifecycle } from '../src/modules/incidents/incident-lifecycle';
import { IncidentsRepository } from '../src/modules/incidents/incidents.repository';
import { RoutingService } from '../src/modules/incidents/routing.service';
import { LiveIoAdapter } from '../src/modules/monitoring/live-io.adapter';
import { TransactionalEvents } from '../src/modules/platform/events/emit-after-commit';
import { compileRentalFlow, RentalFlow } from './db-rental-flow';

interface Entry {
  seq: number;
  type: string;
  cursor?: number;
  payload: Record<string, unknown>;
}
interface Client {
  socket: Socket;
  entries: { entry: Entry; at: number }[];
}

// Real JWT/account authentication, PostgreSQL commit, the production 2-second cron, and loopback
// Socket.IO clients. No fake clock and no direct dispatch call in the latency measurement.
describe('TK-143 committed incident alerts over authenticated sockets', () => {
  let flow: RentalFlow;
  let app: INestApplication;
  let url: string;
  let orgA: Awaited<ReturnType<RentalFlow['organization']>>;
  let orgB: typeof orgA;
  let admin: Caller;
  let peer: Caller;
  let plain: Caller;
  let variantId: string;
  const clients: Client[] = [];

  const until = async (predicate: () => boolean | Promise<boolean>, timeout = 5000) => {
    const end = performance.now() + timeout;
    while (!(await predicate())) {
      if (performance.now() >= end) throw new Error('Socket verification timed out');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const tokenOf = (caller: Caller) => flow.get(JwtService).signAsync({ sub: caller.id, pv: 0 });
  const connect = async (auth: Record<string, unknown>): Promise<Client> => {
    const socket = io(url, {
      auth,
      transports: ['websocket'],
      reconnection: false,
      autoConnect: false,
    });
    const client: Client = { socket, entries: [] };
    clients.push(client);
    socket.on('stream', (entry: Entry) => client.entries.push({ entry, at: performance.now() }));
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
  const as = async (caller: Caller, extra: Record<string, unknown> = {}) =>
    connect({ token: await tokenOf(caller), ...extra });
  const alerts = (client: Client, id: string) =>
    client.entries.filter(
      ({ entry }) => entry.type === INCIDENT_ALERT && entry.payload.incidentId === id,
    );
  const create = async (routed: boolean): Promise<{ incident: Incident; committedAt: number }> => {
    const [deviceId] = await flow.availableDevices(variantId, 1);
    const incident = await flow.get(TransactionalEvents).transaction(async (tx) => {
      const at = new Date();
      const { incident: inserted } = await flow.get(IncidentsRepository).insert(
        {
          deviceId,
          source: 'DEVICE_SOS',
          confidence: 'CONFIRMED',
          firstEventAt: at,
          lastEventAt: at,
          organizationId: routed ? orgA.id : null,
        },
        at,
        tx,
      );
      const route = await flow
        .get(RoutingService)
        .route({ organizationId: routed ? orgA.id : null, contractId: null }, at, tx);
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
    // Timestamp at the successful transaction acknowledgement, before yielding to socket callbacks.
    return { incident, committedAt: performance.now() };
  };

  beforeAll(async () => {
    flow = await compileRentalFlow();
    orgA = await flow.organization();
    orgB = await flow.organization();
    admin = await flow.admin();
    peer = {
      id: await flow.user(AccountType.ORGANIZATION, 'ORG_OPERATOR'),
      roles: ['ORG_OPERATOR'],
      organizationId: orgA.id,
    };
    await flow.prisma.organizationMember.create({
      data: { userId: peer.id, organizationId: orgA.id, role: 'OPERATOR' },
    });
    plain = { id: await flow.user(AccountType.TREKLINK), roles: [], organizationId: null };
    variantId = await flow.variant();
    // Bring the disposable database to a quiet baseline; other suites leave their own due rows.
    const dispatcher = flow.get(AlertDispatcherJob);
    for (let batch = 0; batch < 100; batch++) {
      if ((await dispatcher.deliverAlerts()) === 0) break;
      if (batch === 99) throw new Error('Test database alert backlog did not drain');
    }
    app = flow.moduleRef.createNestApplication();
    app.useLogger(false);
    app.useWebSocketAdapter(new LiveIoAdapter(app, ['http://localhost']));
    await app.listen(0, '127.0.0.1');
    expect(flow.get(SchedulerRegistry).getCronJob('incidents.deliverAlerts').cronTime.source).toBe(
      '*/2 * * * * *',
    );
    url = `http://127.0.0.1:${((app.getHttpServer() as Server).address() as AddressInfo).port}/live`;
  });
  afterEach(() => {
    clients.splice(0).forEach(({ socket }) => socket.close());
  });
  afterAll(async () => {
    if (app) await app.close();
    else if (flow) await flow.close();
  });

  it('delivers a committed burst to Staff/Admin and the routed organization recipient within 2 seconds', async () => {
    const [staff, administrator, manager, sameOrg, otherOrg, noRole] = await Promise.all([
      as(flow.staff),
      as(admin),
      as(orgA.manager),
      as(peer),
      as(orgB.manager, { rooms: [`user:${flow.staff.id}`, `org:${orgA.id}`, 'fleet'] }),
      as(plain),
    ]);
    otherOrg.socket.emit('join', `user:${flow.staff.id}`);
    const burst = await Promise.all([create(false), create(false), create(true)]);
    const latency: number[] = [];
    for (const { incident, committedAt } of burst) {
      const recipients = incident.organizationId ? [manager] : [staff, administrator];
      await until(() => recipients.every((client) => alerts(client, incident.id).length > 0));
      for (const client of recipients) {
        const [received] = alerts(client, incident.id);
        const elapsed = received.at - committedAt;
        latency.push(elapsed);
        expect(elapsed).toBeGreaterThanOrEqual(0);
        expect(elapsed).toBeLessThanOrEqual(2000);
        expect(received.entry.seq).toBe(0);
        expect(received.entry.payload.code).toBe(incident.code);
      }
    }
    // Keep a complete dispatch period for negative assertions, including clients that forged rooms.
    await new Promise((resolve) => setTimeout(resolve, 2100));
    for (const { incident } of burst) {
      for (const client of [sameOrg, otherOrg, noRole])
        expect(alerts(client, incident.id)).toHaveLength(0);
      expect(
        otherOrg.entries.filter(({ entry }) => entry.payload.incidentId === incident.id),
      ).toHaveLength(0);
      expect(
        noRole.entries.filter(({ entry }) => entry.payload.incidentId === incident.id),
      ).toHaveLength(0);
      if (!incident.organizationId)
        expect(
          manager.entries.filter(({ entry }) => entry.payload.incidentId === incident.id),
        ).toHaveLength(0);
      else {
        expect(alerts(staff, incident.id)).toHaveLength(0);
        expect(alerts(administrator, incident.id)).toHaveLength(0);
      }
    }
    console.info(
      `TK-143 loopback commit-to-alert milliseconds: ${latency.map((ms) => ms.toFixed(1)).join(', ')}`,
    );
  });

  it('rejects absent and forged credentials before incident information can be received', async () => {
    await expect(connect({})).rejects.toMatchObject({ data: { errorCode: 'UNAUTHENTICATED' } });
    await expect(connect({ token: 'forged', rooms: ['fleet'] })).rejects.toMatchObject({
      data: { errorCode: 'UNAUTHENTICATED' },
    });
    const { incident } = await create(false);
    await until(
      async () =>
        (await flow.prisma.alertDelivery.count({
          where: { incidentId: incident.id, channel: 'WEBSOCKET', status: 'PENDING' },
        })) === 0,
    );
    for (const client of clients) expect(client.entries).toHaveLength(0);
  });

  it('reconnects with scoped replay, does not replay personal alerts, and permits at-least-once duplicates', async () => {
    const initial = await as(orgA.manager);
    const first = await create(true);
    await until(() => alerts(initial, first.incident.id).length === 1);
    const cursor = Math.max(0, ...initial.entries.map(({ entry }) => entry.seq));
    initial.socket.disconnect();
    const missed = await create(true);
    await until(
      async () =>
        (await flow.prisma.alertDelivery.count({
          where: { incidentId: missed.incident.id, channel: 'WEBSOCKET', status: 'PENDING' },
        })) === 0,
    );
    const reconnected = await as(orgA.manager, { after: cursor });
    await until(() => reconnected.entries.some(({ entry }) => entry.type === 'replay.done'));
    expect(alerts(reconnected, missed.incident.id)).toHaveLength(0);
    expect(
      reconnected.entries.some(
        ({ entry }) =>
          entry.type === 'incident.changed' && entry.payload.incidentId === missed.incident.id,
      ),
    ).toBe(true);
    const live = await create(true);
    await until(() => alerts(reconnected, live.incident.id).length === 1);
    const [received] = alerts(reconnected, live.incident.id);
    expect(received.at - live.committedAt).toBeLessThanOrEqual(2000);
    const duplicate: IncidentAlertEvent = {
      recipientId: orgA.manager.id,
      alert: received.entry.payload as unknown as IncidentAlertEvent['alert'],
    };
    flow.get(EventEmitter2).emit(INCIDENT_ALERT, duplicate);
    flow.get(EventEmitter2).emit(INCIDENT_ALERT, duplicate);
    await until(() => alerts(reconnected, live.incident.id).length === 3);
    expect(alerts(reconnected, live.incident.id).map(({ entry }) => entry.seq)).toEqual([0, 0, 0]);
    const recovered = await flow.prisma.incident.findUniqueOrThrow({
      where: { id: missed.incident.id },
    });
    expect(recovered.state).toBe('NOTIFY_MANAGER');
  });

  it('never dispatches an uncommitted or rolled-back alert', async () => {
    const recipient = await as(flow.staff);
    const [deviceId] = await flow.availableDevices(variantId, 1);
    let incidentId = '';
    await expect(
      flow.get(TransactionalEvents).transaction(async (tx) => {
        const at = new Date();
        const { incident } = await flow.get(IncidentsRepository).insert(
          {
            deviceId,
            source: 'DEVICE_SOS',
            confidence: 'CONFIRMED',
            firstEventAt: at,
            lastEventAt: at,
          },
          at,
          tx,
        );
        incidentId = incident.id;
        const route = await flow
          .get(RoutingService)
          .route({ organizationId: null, contractId: null }, at, tx);
        await flow
          .get(IncidentLifecycle)
          .apply(
            incident.id,
            'DETECTED',
            'UNROUTED',
            { kind: 'SYSTEM' },
            { code: 'ROUTED', at, recipients: route.recipients },
            tx,
          );
        // The real dispatcher uses another connection and cannot see this transaction's outbox.
        await flow.get(AlertDispatcherJob).deliverAlerts();
        expect(alerts(recipient, incidentId)).toHaveLength(0);
        throw new Error('rollback probe');
      }),
    ).rejects.toThrow('rollback probe');
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect(await flow.prisma.incident.findUnique({ where: { id: incidentId } })).toBeNull();
    expect(alerts(recipient, incidentId)).toHaveLength(0);
  });
});
