import { Inject, Injectable, Optional } from '@nestjs/common';
import { ACCOUNT_DIRECTORY, AccountDirectory } from '../../platform/ports/account-directory.port';
import { ParameterService } from '../../platform/parameters/parameter.service';
import { toDeviceView } from '../device-view';
import { DevicesRepository } from '../devices.repository';
import { FleetDevice, DevicesService } from '../devices.service';
import { MaintenanceService } from '../maintenance.service';
import { toNodeId } from '../node-id';
import { DEVICE_CONTRACTS, DeviceContracts } from '../ports/device-contracts.port';
import { DockSessionRepository, DockSessionRow } from './dock-session.repository';

// The live contract of a recognized unit (devices api-design 30 `contract`).
export interface ConnectorContract {
  id: string;
  code: string;
  status: string;
  organization: { id: string; code: string | null };
  // The organization's key version the unit carries, or null when it carries none of this organization.
  provisionedKeyVersion: number | null;
}

// An open dock session as the connector and the Staff map read it.
export interface DockedView {
  since: Date;
  byName: string | null;
}

// One answer row of devices api-design 30, in the order the caller asked.
export interface RecognizedUnit {
  nodeNum: number;
  nodeId: string;
  device:
    | (FleetDevice & {
        firmwareBaseline: string;
        openMaintenance: { id: string; reason: string; status: string } | null;
      })
    | null;
  contract: ConnectorContract | null;
  docked: DockedView | null;
}

// An open session for the Staff live map (monitoring api-design 02, design section 12.8).
export interface DockedUnit {
  deviceId: string;
  since: Date;
  byName: string | null;
}

// A docked unit with its live contract, if any, for the Staff map entries of monitoring api-design 02.
export interface DockedUnitWithContract extends DockedUnit {
  contract: { code: string; organizationId: string } | null;
}

const SECOND_MS = 1000;

// The device connector's reads (devices design section 12.5 and 12.8, tasks 10.2 and 10.3): recognition of
// the units plugged into a Staff computer and the open dock sessions the Staff map pins at the counter.
@Injectable()
export class DeviceConnectorService {
  constructor(
    private readonly devices: DevicesRepository,
    private readonly fleet: DevicesService,
    private readonly maintenance: MaintenanceService,
    private readonly sessions: DockSessionRepository,
    private readonly parameters: ParameterService,
    @Inject(DEVICE_CONTRACTS) private readonly contracts: DeviceContracts,
    @Optional() @Inject(ACCOUNT_DIRECTORY) private readonly directory?: AccountDirectory,
  ) {}

  // devices api-design 30: one row per requested node number, in request order; `device` is null for a
  // number never registered. Retired and disposed units are recognized too, so the connector names them.
  async recognize(nodeNums: readonly bigint[], at: Date = new Date()): Promise<RecognizedUnit[]> {
    const rows = await this.devices.byNodeNums(nodeNums);
    const ids = rows.map((row) => row.id);
    const [views, live, docked, records] = await Promise.all([
      this.fleet.fleetViews(rows.map(toDeviceView)),
      ids.length > 0 ? this.contracts.liveContractsOf(ids) : Promise.resolve([]),
      this.docked(ids, at),
      Promise.all(ids.map((id) => this.maintenance.openRecordOf(id))),
    ]);
    const viewById = new Map(views.map((view) => [view.id, view]));
    const rowByNode = new Map(rows.map((row) => [row.nodeNum, row]));
    const contractByDevice = new Map(live.map((contract) => [contract.deviceId, contract]));
    const recordByDevice = new Map(ids.map((id, index) => [id, records[index]]));
    const dockedByDevice = new Map(docked.map((unit) => [unit.deviceId, unit]));
    return nodeNums.map((nodeNum) => {
      const row = rowByNode.get(nodeNum);
      const view = row ? viewById.get(row.id) : undefined;
      if (!row || !view) {
        return {
          nodeNum: Number(nodeNum),
          nodeId: toNodeId(nodeNum),
          device: null,
          contract: null,
          docked: null,
        };
      }
      const record = recordByDevice.get(row.id) ?? null;
      const contract = contractByDevice.get(row.id);
      const session = dockedByDevice.get(row.id);
      return {
        nodeNum: Number(nodeNum),
        nodeId: toNodeId(nodeNum),
        device: {
          ...view,
          firmwareBaseline: row.hardwareVariant.firmwareBaseline,
          openMaintenance: record
            ? { id: record.id, reason: record.reason, status: record.status }
            : null,
        },
        contract: contract
          ? {
              id: contract.contractId,
              code: contract.code,
              status: contract.status,
              organization: { id: contract.organizationId, code: contract.organizationCode },
              provisionedKeyVersion:
                row.keyOrganizationId === contract.organizationId ? row.keyVersion : null,
            }
          : null,
        docked: session ? { since: session.since, byName: session.byName } : null,
      };
    });
  }

  // The open, unexpired dock sessions of these devices, or of every device (monitoring api-design 02).
  async docked(deviceIds?: readonly string[], at: Date = new Date()): Promise<DockedUnit[]> {
    if (deviceIds && deviceIds.length === 0) return [];
    const ttl = await this.parameters.get('devices.dockPresenceTtlSeconds');
    const sessions = await this.sessions.open(new Date(at.getTime() - ttl * SECOND_MS), deviceIds);
    const names = await this.namesOf(sessions);
    return sessions.map((session) => ({
      deviceId: session.deviceId,
      since: session.openedAt,
      byName: names.get(session.openedById) ?? null,
    }));
  }

  // Every open, unexpired dock session with the unit's live contract (monitoring api-design 02 for
  // TrekLink callers, REQ-STA-05).
  async dockedWithContracts(at: Date = new Date()): Promise<DockedUnitWithContract[]> {
    const docked = await this.docked(undefined, at);
    if (docked.length === 0) return [];
    const live = await this.contracts.liveContractsOf(docked.map((unit) => unit.deviceId));
    const byDevice = new Map(live.map((contract) => [contract.deviceId, contract]));
    return docked.map((unit) => {
      const contract = byDevice.get(unit.deviceId);
      return {
        ...unit,
        contract: contract
          ? { code: contract.code, organizationId: contract.organizationId }
          : null,
      };
    });
  }

  private async namesOf(sessions: readonly DockSessionRow[]): Promise<Map<string, string>> {
    if (!this.directory || sessions.length === 0) return new Map();
    return this.directory.namesOf([...new Set(sessions.map((session) => session.openedById))]);
  }
}
