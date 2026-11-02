import { ConfigService } from '@nestjs/config';
import { Prisma, SimulatedNode } from '@prisma/client';
import { DomainException } from '../../../common/errors';
import { DevicesService } from '../../devices';
import { OrganizationsService } from '../../organizations';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { TransactionalEvents } from '../../platform/events/emit-after-commit';
import { ParameterService } from '../../platform/parameters/parameter.service';
import { ContractsService } from '../../rentals';
import { eventIdOf } from '../ingestion.service';
import { UplinkIngress } from '../uplink-ingress';
import { startAnchor } from './field-simulation';
import { FieldSimulationService } from './field-simulation.service';
import { SimulatedNodesRepository } from './simulated-nodes.repository';
import { trailById } from './trails';

const trail = trailById('ta-nang-phan-dung')!;
const now = new Date('2026-11-06T02:00:00.400Z');
const actor = { id: 'admin-1', roles: ['ADMIN'] };
const DEVICE = {
  id: 'dev-10',
  assetTag: 'TL-0010',
  nodeNum: 0xde00000an,
  status: 'RENTED' as const,
  lastSeenAt: new Date('2026-11-06T01:59:00Z'),
};

const row = (overrides: Partial<SimulatedNode> = {}): SimulatedNode => ({
  id: 'node-1',
  deviceId: DEVICE.id,
  nodeNum: DEVICE.nodeNum,
  trailId: trail.id,
  ...startAnchor(trail, { pattern: 'WALK', speedMetresPerMinute: 60, startMetres: 0 }, now),
  sosKind: null,
  sosSince: null,
  beaconedUntil: null,
  status: 'RUNNING',
  version: 0,
  createdById: actor.id,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const domainCode = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainException) {
      return { status: error.getStatus(), code: error.errorCode };
    }
    throw error;
  }
  return null;
};

const build = () => {
  const emitted: { name: string; payload: unknown }[] = [];
  const nodes = {
    insert: jest.fn((data: Prisma.SimulatedNodeUncheckedCreateInput) =>
      Promise.resolve(row({ ...(data as Partial<SimulatedNode>) })),
    ),
    byId: jest.fn().mockResolvedValue(row()),
    runningForDevice: jest.fn().mockResolvedValue(null),
    running: jest.fn().mockResolvedValue([]),
    listed: jest.fn().mockResolvedValue([]),
    updateRunning: jest.fn(
      (_id: string, version: number, data: Partial<SimulatedNode>) =>
        Promise.resolve(row({ ...data, version: version + 1 })) as Promise<SimulatedNode | null>,
    ),
    markBeaconed: jest.fn().mockResolvedValue(undefined),
  };
  const uplinks = { ingest: jest.fn().mockResolvedValue('ingested') };
  const devices = {
    projections: jest.fn().mockResolvedValue([DEVICE]),
    page: jest.fn().mockResolvedValue([[DEVICE], 1]),
  };
  const contracts = {
    visibleDevices: jest
      .fn()
      .mockResolvedValue([
        { deviceId: DEVICE.id, organizationId: 'org-1', contractCode: 'RC-2026-0001' },
      ]),
  };
  const organizations = {
    labelsOf: jest
      .fn()
      .mockResolvedValue(
        new Map([['org-1', { id: 'org-1', code: 'ORG-0001', legalName: 'Demo' }]]),
      ),
  };
  const parameters = { get: jest.fn().mockResolvedValue(60) };
  const events = {
    transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work('tx')),
    emitAfterCommit: jest.fn((name: string, payload: unknown) => emitted.push({ name, payload })),
  };
  const service = new FieldSimulationService(
    nodes as unknown as SimulatedNodesRepository,
    uplinks as unknown as UplinkIngress,
    devices as unknown as DevicesService,
    contracts as unknown as ContractsService,
    organizations as unknown as OrganizationsService,
    parameters as unknown as ParameterService,
    events as unknown as TransactionalEvents,
    { get: () => 'treklink' } as unknown as ConfigService<ValidatedEnvironment, true>,
  );
  return { service, nodes, uplinks, devices, emitted };
};

interface SentPacket {
  id: number;
  from: number;
  timestamp: number;
  type: string;
  payload: { text?: string };
}
type IngestCall = [string, Buffer, Date, { simulated?: boolean }?];

const bodies = (ingest: jest.Mock) =>
  (ingest.mock.calls as IngestCall[]).map(([, body]) => JSON.parse(body.toString()) as SentPacket);

describe('FieldSimulationService (specs/demo/design.md §9)', () => {
  it('lists trails, patterns, devices with their holder and running node, and the nodes', async () => {
    const { service, nodes } = build();
    nodes.listed.mockResolvedValue([row()]);
    const overview = await service.overview(now);
    expect(overview.trails[0]).toMatchObject({
      id: 'ta-nang-phan-dung',
      pointCount: 63,
      source: { osmWayIds: [1164619760] },
    });
    expect(overview.patterns).toEqual(['WALK', 'STOP', 'STRAY', 'SILENT', 'LOW_BATTERY']);
    expect(overview.devices).toEqual([
      {
        id: DEVICE.id,
        assetTag: 'TL-0010',
        nodeId: '!de00000a',
        status: 'RENTED',
        organization: { id: 'org-1', code: 'ORG-0001', name: 'Demo' },
        runningNodeId: 'node-1',
      },
    ]);
    expect(overview.nodes[0]).toMatchObject({
      assetTag: 'TL-0010',
      simulated: true,
      batteryPct: 100,
      lastPacketAt: DEVICE.lastSeenAt,
    });
  });

  it('starts a node at the trail start with one audit entry', async () => {
    const { service, nodes, emitted } = build();
    const view = await service.start(
      { deviceId: DEVICE.id, trailId: trail.id, pattern: 'WALK' },
      actor,
      now,
    );
    expect(nodes.insert.mock.calls[0][0]).toMatchObject({
      deviceId: DEVICE.id,
      nodeNum: DEVICE.nodeNum,
      speedMetresPerMinute: 60,
      anchorMetres: 0,
      status: 'RUNNING',
      createdById: actor.id,
    });
    expect(view.position.lat).toBeCloseTo(trail.points[0][0], 6);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      name: 'audit.record',
      payload: { action: 'demo.simulation.start', subjectType: 'SimulatedNode' },
    });
  });

  it('refuses a device that already runs, an unknown trail, a bad speed and a disposed device', async () => {
    const { service, nodes, devices } = build();
    nodes.runningForDevice.mockResolvedValueOnce(row());
    const start = (input: Partial<Parameters<FieldSimulationService['start']>[0]>) =>
      domainCode(
        service.start(
          { deviceId: DEVICE.id, trailId: trail.id, pattern: 'WALK', ...input },
          actor,
          now,
        ),
      );
    expect(await start({})).toMatchObject({ status: 409, code: 'DEMO_NODE_RUNNING' });
    expect(await start({ trailId: 'nowhere' })).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    expect(await start({ speedMetresPerMinute: 5 })).toMatchObject({ status: 400 });
    expect(await start({ startMetres: 99_999 })).toMatchObject({ status: 400 });
    devices.projections.mockResolvedValueOnce([{ ...DEVICE, status: 'DISPOSED' }]);
    expect(await start({})).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('answers DEMO_NODE_RUNNING when a concurrent start wins the unique index', async () => {
    const { service, nodes } = build();
    nodes.insert.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }),
    );
    expect(
      await domainCode(
        service.start({ deviceId: DEVICE.id, trailId: trail.id, pattern: 'WALK' }, actor, now),
      ),
    ).toMatchObject({ status: 409, code: 'DEMO_NODE_RUNNING' });
  });

  it('re-anchors a pattern change where the node is, with compare-and-set', async () => {
    const { service, nodes, emitted } = build();
    const later = new Date(now.getTime() + 300_000);
    await service.update('node-1', { expectedVersion: 0, pattern: 'STOP' }, actor, later);
    const [, version, data] = nodes.updateRunning.mock.calls[0];
    expect(version).toBe(0);
    expect(data).toMatchObject({ pattern: 'STOP', anchorAt: later });
    expect(data.anchorMetres).toBeCloseTo(300, 3);
    expect(emitted[0].payload).toMatchObject({ action: 'demo.simulation.update' });
  });

  it('answers STALE_VERSION and INVALID_STATE_TRANSITION', async () => {
    const { service, nodes } = build();
    nodes.updateRunning.mockResolvedValueOnce(null);
    expect(
      await domainCode(service.update('node-1', { expectedVersion: 3 }, actor, now)),
    ).toMatchObject({
      status: 409,
      code: 'STALE_VERSION',
    });
    nodes.byId.mockResolvedValueOnce(row({ status: 'STOPPED' }));
    expect(await domainCode(service.stop('node-1', 0, actor, now))).toMatchObject({
      status: 409,
      code: 'INVALID_STATE_TRANSITION',
    });
    nodes.byId.mockResolvedValueOnce(null);
    expect(await domainCode(service.raise('x', 'SOS', actor, now))).toMatchObject({ status: 404 });
  });

  it('stops a node and clears its SOS', async () => {
    const { service, nodes } = build();
    nodes.byId.mockResolvedValueOnce(row({ sosKind: 'SOS', sosSince: now, beaconedUntil: now }));
    const view = await service.stop('node-1', 0, actor, now);
    expect(nodes.updateRunning.mock.calls[0][2]).toMatchObject({
      status: 'STOPPED',
      sosKind: null,
      sosSince: null,
      beaconedUntil: null,
    });
    expect(view.status).toBe('STOPPED');
  });

  it('raises a fall: the firmware text and the first beacon, simulated, at the node position', async () => {
    const { service, uplinks, nodes, emitted } = build();
    const result = await service.raise('node-1', 'FALL', actor, now);
    const since = new Date('2026-11-06T02:00:00.000Z');
    expect(nodes.updateRunning.mock.calls[0][2]).toMatchObject({
      sosKind: 'FALL',
      sosSince: since,
      beaconedUntil: since,
    });
    const [text, beacon] = bodies(uplinks.ingest);
    expect(text.payload.text).toMatch(/^SOS - FALL DETECTED - \[11\.\d{6}\], \[108\.\d{6}\]$/);
    expect(text.timestamp).toBe(since.getTime() / 1000);
    expect(beacon.type).toBe('position');
    const calls = uplinks.ingest.mock.calls as IngestCall[];
    expect(calls[0][0]).toBe('treklink/2/json/LongFast/!de00000a');
    expect(calls.every(([, , , options]) => options?.simulated === true)).toBe(true);
    expect(result.fieldEventId).toBe(eventIdOf(text.from, text.id));
    expect(emitted[0].payload).toMatchObject({
      action: 'demo.simulation.event',
      after: { kind: 'FALL' },
    });
  });

  it('cancels an SOS without sending a packet, and refuses a cancel with no SOS', async () => {
    const { service, uplinks, nodes } = build();
    nodes.byId.mockResolvedValueOnce(row({ sosKind: 'SOS', sosSince: now, beaconedUntil: now }));
    const result = await service.raise('node-1', 'SOS_CANCEL', actor, now);
    expect(result.fieldEventId).toBeNull();
    expect(uplinks.ingest).not.toHaveBeenCalled();
    expect(nodes.updateRunning.mock.calls[0][2]).toEqual({
      sosKind: null,
      sosSince: null,
      beaconedUntil: null,
    });
    expect(await domainCode(service.raise('node-1', 'SOS_CANCEL', actor, now))).toMatchObject({
      status: 409,
      code: 'INVALID_STATE_TRANSITION',
    });
  });

  it('runs every running node through ingestion and records the beacons sent', async () => {
    const { service, nodes, uplinks } = build();
    const sosSince = new Date('2026-11-06T02:00:00Z');
    nodes.running.mockResolvedValue([
      row({ id: 'walker' }),
      row({ id: 'silent', pattern: 'SILENT' }),
      row({ id: 'sos', sosKind: 'SOS', sosSince, beaconedUntil: sosSince }),
    ]);
    const sent = await service.run(new Date('2026-11-06T02:00:30Z'));
    // walker: position and telemetry; silent: nothing; sos: telemetry and the beacons 5 to 30 s.
    expect(sent).toBe(2 + 1 + 6);
    expect(uplinks.ingest).toHaveBeenCalledTimes(9);
    expect(nodes.markBeaconed).toHaveBeenCalledWith(
      'sos',
      sosSince,
      new Date('2026-11-06T02:00:30Z'),
    );
  });
});
