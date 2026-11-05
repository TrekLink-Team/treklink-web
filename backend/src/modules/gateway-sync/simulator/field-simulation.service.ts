import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeviceStatus, Prisma, SimulatedNode, SimulatedNodeStatus } from '@prisma/client';
import { DomainException, ErrorCode } from '../../../common/errors';
import { DevicesService } from '../../devices';
import { OrganizationsService } from '../../organizations';
import { AUDIT_RECORD, AuditRecordEvent } from '../../platform/audit/audit-record.event';
import { simulationDatabaseAllowed } from '../../platform/config/database-url';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { TransactionalEvents } from '../../platform/events/emit-after-commit';
import { ParameterService } from '../../platform/parameters/parameter.service';
import { ContractsService } from '../../rentals';
import { eventIdOf } from '../ingestion.service';
import { UplinkIngress } from '../uplink-ingress';
import {
  DEFAULT_SPEED_METRES_PER_MINUTE,
  MAX_SPEED_METRES_PER_MINUTE,
  MIN_SPEED_METRES_PER_MINUTE,
  SIMULATION_PATTERNS,
  SimulatedNodeState,
  SimulationAnchor,
  SimulationPatternName,
  SosKindName,
  nodeIdOf,
  planRun,
  positionPacket,
  reanchor,
  sosPacket,
  startAnchor,
  stateAt,
  trailLengthMetres,
} from './field-simulation';
import { SIMULATION_STYLES, SimulationStyleName, styleFor } from './field-styles';
import { SimulatedPacket } from './simulated-batch';
import { SimulatedNodesRepository } from './simulated-nodes.repository';
import { TRAILS, Trail, trailById } from './trails';

export type SimulationEventKind = SosKindName | 'SOS_CANCEL';

export interface SimulationActor {
  id: string;
  roles: string[];
}

export interface StartNodeInput {
  deviceId: string;
  trailId: string;
  pattern: SimulationPatternName;
  // Design §9.1: without one, the style of the device's asset tag.
  style?: SimulationStyleName;
  speedMetresPerMinute?: number;
  startMetres?: number;
}

export interface UpdateNodeInput {
  expectedVersion: number;
  pattern?: SimulationPatternName;
  style?: SimulationStyleName;
  trailId?: string;
  speedMetresPerMinute?: number;
}

export interface OrganizationRef {
  id: string;
  code: string;
  name: string;
}

// One simulated node as demo api-design 06 to 10 return it.
export interface SimulatedNodeView {
  id: string;
  deviceId: string;
  assetTag: string | null;
  nodeId: string;
  organization: OrganizationRef | null;
  trailId: string;
  pattern: SimulationPatternName;
  // Null for a node started before the styles, which keeps the steady walk at its speed.
  style: SimulationStyleName | null;
  speedMetresPerMinute: number;
  status: SimulatedNodeStatus;
  sosKind: SosKindName | null;
  sosSince: Date | null;
  position: { lat: number; lon: number };
  batteryPct: number;
  lastPacketAt: Date | null;
  simulated: true;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TrailView {
  id: string;
  name: string;
  region: string;
  lengthMetres: number;
  pointCount: number;
  source: Trail['source'];
}

export interface SimulatableDeviceView {
  id: string;
  assetTag: string;
  nodeId: string;
  status: DeviceStatus;
  organization: OrganizationRef | null;
  runningNodeId: string | null;
}

export interface SimulationOverview {
  trails: TrailView[];
  patterns: readonly SimulationPatternName[];
  styles: readonly SimulationStyleName[];
  devices: SimulatableDeviceView[];
  nodes: SimulatedNodeView[];
}

// The devices the panel offers: every one not DISPOSED (each has a nodeNum, a required column).
const SIMULATABLE_STATUSES = Object.values(DeviceStatus).filter(
  (status) => status !== DeviceStatus.DISPOSED,
);
const DEVICE_LIST_LIMIT = 500;

const notFound = (what: string) =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, `${what} not found.`);
const invalid = (message: string) =>
  new DomainException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, message);
const stopped = () =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.INVALID_STATE_TRANSITION,
    'This cannot be done while it is STOPPED.',
  );
const stale = () =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.STALE_VERSION,
    'This was changed by someone else. Reload and try again.',
  );

const anchorOf = (node: SimulatedNode): SimulationAnchor => ({
  pattern: node.pattern,
  speedMetresPerMinute: node.speedMetresPerMinute,
  anchorAt: node.anchorAt,
  anchorMetres: node.anchorMetres,
  anchorLat: node.anchorLat,
  anchorLon: node.anchorLon,
  anchorBattery: node.anchorBattery,
  direction: node.direction,
  strayBearing: node.strayBearing,
  style: node.style,
  styleSeed: node.styleSeed,
});

const anchorColumns = (anchor: SimulationAnchor) => ({
  pattern: anchor.pattern,
  speedMetresPerMinute: anchor.speedMetresPerMinute,
  anchorAt: anchor.anchorAt,
  anchorMetres: anchor.anchorMetres,
  anchorLat: anchor.anchorLat,
  anchorLon: anchor.anchorLon,
  anchorBattery: anchor.anchorBattery,
  direction: anchor.direction,
  strayBearing: anchor.strayBearing,
  style: anchor.style,
  styleSeed: anchor.styleSeed,
});

const wholeSecond = (at: Date) => new Date(Math.floor(at.getTime() / 1000) * 1000);

// The field simulation of the demo panel (specs/demo/design.md §9, D-093 amendment, D-094). The demo
// module's routes call it; the field data simulator job calls `run`. Every packet goes through
// UplinkIngress with `{ simulated: true }`, the path a broker message takes, so positions, staleness,
// incidents and alerts behave as for a real node. It never deletes a row.
@Injectable()
export class FieldSimulationService {
  private readonly logger = new Logger(FieldSimulationService.name);
  private readonly root: string;
  // The refusal of `run` is logged once per process, not every 10 s.
  private refusalLogged = false;

  constructor(
    private readonly nodes: SimulatedNodesRepository,
    private readonly uplinks: UplinkIngress,
    private readonly devices: DevicesService,
    private readonly contracts: ContractsService,
    private readonly organizations: OrganizationsService,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {
    this.root = config.get('MQTT_ROOT', { infer: true });
  }

  // demo api-design 06 (REQ-SIM-08).
  async overview(now: Date = new Date()): Promise<SimulationOverview> {
    const [[rows], nodes, holders] = await Promise.all([
      this.devices.page({ statuses: SIMULATABLE_STATUSES }, 0, DEVICE_LIST_LIMIT),
      this.nodes.listed(),
      this.holders(),
    ]);
    const views = await this.views(nodes, now, holders);
    const running = new Map(
      nodes.filter((n) => n.status === SimulatedNodeStatus.RUNNING).map((n) => [n.deviceId, n.id]),
    );
    const devices = [...rows]
      .sort((a, b) => a.assetTag.localeCompare(b.assetTag))
      .map((row) => ({
        id: row.id,
        assetTag: row.assetTag,
        nodeId: nodeIdOf(row.nodeNum),
        status: row.status,
        organization: holders.get(row.id) ?? null,
        runningNodeId: running.get(row.id) ?? null,
      }));
    return {
      trails: TRAILS.map((trail) => ({
        id: trail.id,
        name: trail.name,
        region: trail.region,
        lengthMetres: Math.round(trailLengthMetres(trail)),
        pointCount: trail.points.length,
        source: trail.source,
      })),
      patterns: SIMULATION_PATTERNS,
      styles: SIMULATION_STYLES,
      devices,
      nodes: views,
    };
  }

  // demo api-design 07 (REQ-SIM-03).
  async start(
    input: StartNodeInput,
    actor: SimulationActor,
    now: Date = new Date(),
  ): Promise<SimulatedNodeView> {
    const trail = this.trail(input.trailId);
    const speed = this.speed(input.speedMetresPerMinute ?? DEFAULT_SPEED_METRES_PER_MINUTE);
    const startMetres = input.startMetres ?? 0;
    if (startMetres < 0 || startMetres > trailLengthMetres(trail))
      throw invalid('The start is past the end of the trail.');
    const [device] = await this.devices.projections([input.deviceId]);
    if (!device || device.status === DeviceStatus.DISPOSED) throw notFound('Device');
    const running = () =>
      new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.DEMO_NODE_RUNNING,
        `${device.assetTag} already runs as a simulated node. Stop it first.`,
      );
    if (await this.nodes.runningForDevice(device.id)) throw running();
    // The seed always comes from the asset tag, so a run repeats; the style may be chosen (§9.1).
    const assigned = styleFor(device.assetTag);
    const anchor = startAnchor(
      trail,
      {
        pattern: input.pattern,
        speedMetresPerMinute: speed,
        startMetres,
        style: input.style ?? assigned.style,
        styleSeed: assigned.seed,
      },
      now,
    );
    let node: SimulatedNode;
    try {
      node = await this.events.transaction(async (tx) => {
        const created = await this.nodes.insert(
          {
            deviceId: device.id,
            nodeNum: device.nodeNum,
            trailId: trail.id,
            ...anchorColumns(anchor),
            status: SimulatedNodeStatus.RUNNING,
            createdById: actor.id,
          },
          tx,
        );
        this.audit(actor, 'demo.simulation.start', created, null, {
          assetTag: device.assetTag,
          trailId: trail.id,
          pattern: created.pattern,
          style: created.style,
          speedMetresPerMinute: speed,
          startMetres,
        });
        return created;
      });
    } catch (error) {
      // The partial unique index: another start of the same device committed first.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw running();
      throw error;
    }
    return this.view(node, now);
  }

  // demo api-design 08 (REQ-SIM-04): a new anchor where the node is now.
  async update(
    id: string,
    input: UpdateNodeInput,
    actor: SimulationActor,
    now: Date = new Date(),
  ): Promise<SimulatedNodeView> {
    const node = await this.running(id);
    const trail = this.trail(node.trailId);
    const nextTrail = input.trailId === undefined ? undefined : this.trail(input.trailId);
    const speed =
      input.speedMetresPerMinute === undefined ? undefined : this.speed(input.speedMetresPerMinute);
    const anchor = reanchor(trail, anchorOf(node), now, {
      pattern: input.pattern,
      speedMetresPerMinute: speed,
      trail: nextTrail,
      style: input.style,
    });
    const updated = await this.events.transaction(async (tx) => {
      const row = await this.nodes.updateRunning(
        id,
        input.expectedVersion,
        { ...anchorColumns(anchor), trailId: (nextTrail ?? trail).id },
        tx,
      );
      if (!row) throw stale();
      this.audit(
        actor,
        'demo.simulation.update',
        row,
        {
          pattern: node.pattern,
          style: node.style,
          trailId: node.trailId,
          speedMetresPerMinute: node.speedMetresPerMinute,
        },
        {
          pattern: row.pattern,
          style: row.style,
          trailId: row.trailId,
          speedMetresPerMinute: row.speedMetresPerMinute,
        },
      );
      return row;
    });
    return this.view(updated, now);
  }

  // demo api-design 09: the node sends nothing more; an active SOS ends without a packet.
  async stop(
    id: string,
    expectedVersion: number,
    actor: SimulationActor,
    now: Date = new Date(),
  ): Promise<SimulatedNodeView> {
    const node = await this.running(id);
    const anchor = reanchor(this.trail(node.trailId), anchorOf(node), now, {});
    const updated = await this.events.transaction(async (tx) => {
      const row = await this.nodes.updateRunning(
        id,
        expectedVersion,
        {
          ...anchorColumns(anchor),
          status: SimulatedNodeStatus.STOPPED,
          sosKind: null,
          sosSince: null,
          beaconedUntil: null,
        },
        tx,
      );
      if (!row) throw stale();
      this.audit(
        actor,
        'demo.simulation.stop',
        row,
        { status: node.status },
        { status: row.status },
      );
      return row;
    });
    return this.view(updated, now);
  }

  // demo api-design 10 (REQ-SIM-05): SOS or FALL ingests the firmware's text and the first beacon at
  // once; SOS_CANCEL stops the beacons and sends nothing.
  async raise(
    id: string,
    kind: SimulationEventKind,
    actor: SimulationActor,
    now: Date = new Date(),
  ): Promise<{ node: SimulatedNodeView; fieldEventId: string | null }> {
    const node = await this.running(id);
    const trail = this.trail(node.trailId);
    if (kind === 'SOS_CANCEL') {
      if (node.sosKind === null)
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATE_TRANSITION,
          'No SOS is active on this node.',
        );
      const cancelled = await this.events.transaction(async (tx) => {
        const row = await this.nodes.updateRunning(
          id,
          node.version,
          { sosKind: null, sosSince: null, beaconedUntil: null },
          tx,
        );
        if (!row) throw stale();
        this.audit(actor, 'demo.simulation.event', row, { sosKind: node.sosKind }, { kind });
        return row;
      });
      return { node: await this.view(cancelled, now), fieldEventId: null };
    }
    const since = wholeSecond(now);
    const anchor = reanchor(trail, anchorOf(node), since, {});
    const raised = await this.events.transaction(async (tx) => {
      const row = await this.nodes.updateRunning(
        id,
        node.version,
        { ...anchorColumns(anchor), sosKind: kind, sosSince: since, beaconedUntil: since },
        tx,
      );
      if (!row) throw stale();
      this.audit(actor, 'demo.simulation.event', row, { sosKind: node.sosKind }, { kind });
      return row;
    });
    // After the commit: ingestion runs its own transaction. The SOS text carries no fix of its own, so
    // the first beacon (offset 0) goes with it.
    const sender = nodeIdOf(raised.nodeNum);
    const seconds = since.getTime() / 1000;
    const at = stateAt(trail, anchorOf(raised), since);
    const text = sosPacket(sender, seconds, kind, at);
    await this.ingest(text, now);
    await this.ingest(positionPacket(sender, seconds, at, 'beacon'), now);
    return { node: await this.view(raised, now), fieldEventId: eventIdOf(text.from, text.id) };
  }

  // One run of the field data simulator while DEMO_SIMULATION_ENABLED is true (REQ-SIM-01, REQ-SIM-03):
  // the packets of every running node for the interval that holds `now`, and the beacons due. Returns
  // the number of packets handed to ingestion. The database check of the routes runs here too (design
  // §9, REQ-SIM-02): on a database that is neither loopback nor the staging, the run sends nothing.
  async run(now: Date = new Date()): Promise<number> {
    if (!simulationDatabaseAllowed(this.config)) {
      if (!this.refusalLogged) {
        this.logger.warn(
          'The field simulation runs only on a local database or the Vercel staging; no packet is sent.',
        );
        this.refusalLogged = true;
      }
      return 0;
    }
    const interval = Number(await this.parameters.get('gatewaySync.simulatorIntervalSeconds'));
    let sent = 0;
    for (const node of await this.nodes.running()) {
      const trail = trailById(node.trailId);
      if (!trail) {
        this.logger.warn(`Simulated node ${node.id} names an unknown trail ${node.trailId}`);
        continue;
      }
      const state: SimulatedNodeState = {
        ...anchorOf(node),
        nodeNum: node.nodeNum,
        sosKind: node.sosKind,
        sosSince: node.sosSince,
        beaconedUntil: node.beaconedUntil,
      };
      const plan = planRun(trail, state, now, interval);
      for (const packet of plan.packets) {
        await this.ingest(packet, now);
        sent += 1;
      }
      if (node.sosSince && plan.beaconedUntil && plan.beaconedUntil !== node.beaconedUntil)
        await this.nodes.markBeaconed(node.id, node.sosSince, plan.beaconedUntil);
    }
    return sent;
  }

  private async ingest(packet: SimulatedPacket, now: Date): Promise<void> {
    const topic = `${this.root}/2/json/LongFast/${packet.sender}`;
    const outcome = await this.uplinks.ingest(topic, Buffer.from(JSON.stringify(packet)), now, {
      simulated: true,
    });
    if (outcome !== 'ingested')
      this.logger.warn(`Simulated ${packet.type} for ${packet.sender} was ${outcome}`);
  }

  private async running(id: string): Promise<SimulatedNode> {
    const node = await this.nodes.byId(id);
    if (!node) throw notFound('Simulated node');
    if (node.status !== SimulatedNodeStatus.RUNNING) throw stopped();
    return node;
  }

  private trail(id: string): Trail {
    const trail = trailById(id);
    if (!trail) throw invalid('Unknown trail.');
    return trail;
  }

  private speed(value: number): number {
    if (
      !Number.isInteger(value) ||
      value < MIN_SPEED_METRES_PER_MINUTE ||
      value > MAX_SPEED_METRES_PER_MINUTE
    )
      throw invalid(
        `The speed must be ${MIN_SPEED_METRES_PER_MINUTE} to ${MAX_SPEED_METRES_PER_MINUTE} metres a minute.`,
      );
    return value;
  }

  // The organization holding each device now, by device id.
  private async holders(): Promise<Map<string, OrganizationRef>> {
    const custody = await this.contracts.visibleDevices({ organizationId: null });
    const labels = await this.organizations.labelsOf(custody.map((row) => row.organizationId));
    const holders = new Map<string, OrganizationRef>();
    for (const row of custody) {
      const label = labels.get(row.organizationId);
      if (label)
        holders.set(row.deviceId, { id: label.id, code: label.code, name: label.legalName });
    }
    return holders;
  }

  private async view(node: SimulatedNode, now: Date): Promise<SimulatedNodeView> {
    const [view] = await this.views([node], now, await this.holders());
    return view;
  }

  private async views(
    nodes: SimulatedNode[],
    now: Date,
    holders: Map<string, OrganizationRef>,
  ): Promise<SimulatedNodeView[]> {
    if (nodes.length === 0) return [];
    const projections = new Map(
      (await this.devices.projections([...new Set(nodes.map((n) => n.deviceId))])).map((p) => [
        p.id,
        p,
      ]),
    );
    return nodes.map((node) => {
      const trail = trailById(node.trailId);
      // A stopped node stays where it was at the stop.
      const at = node.status === SimulatedNodeStatus.STOPPED ? node.anchorAt : now;
      const state = trail
        ? stateAt(trail, anchorOf(node), at)
        : { lat: node.anchorLat, lon: node.anchorLon, battery: node.anchorBattery };
      const device = projections.get(node.deviceId);
      return {
        id: node.id,
        deviceId: node.deviceId,
        assetTag: device?.assetTag ?? null,
        nodeId: nodeIdOf(node.nodeNum),
        organization: holders.get(node.deviceId) ?? null,
        trailId: node.trailId,
        pattern: node.pattern,
        style: node.style,
        speedMetresPerMinute: node.speedMetresPerMinute,
        status: node.status,
        sosKind: node.sosKind,
        sosSince: node.sosSince,
        position: { lat: state.lat, lon: state.lon },
        batteryPct: Math.round(state.battery),
        lastPacketAt: device?.lastSeenAt ?? null,
        simulated: true,
        version: node.version,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
      };
    });
  }

  // One audit entry per simulation command (REQ-SIM-07), emitted after the commit.
  private audit(
    actor: SimulationActor,
    action: string,
    node: SimulatedNode,
    before: unknown,
    after: unknown,
  ): void {
    this.events.emitAfterCommit(AUDIT_RECORD, {
      actorId: actor.id,
      actorRoles: actor.roles,
      organizationId: null,
      action,
      subjectType: 'SimulatedNode',
      subjectId: node.id,
      before: before === null ? undefined : { deviceId: node.deviceId, ...(before as object) },
      after: { deviceId: node.deviceId, ...(after as object) },
    } satisfies AuditRecordEvent);
  }
}
