import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException, ErrorCode } from '../../common/errors';
import { DevicesService } from '../devices';
import { IncidentsQueryService } from '../incidents';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ContractsService } from '../rentals';
import { custodyView, type UnitState } from './custody-view';
import { ReplayService } from './replay.service';
import { StreamRepository } from './stream.repository';
import { WireEntry } from './stream.service';

// One device of api-design 04. `state`, `position`, `batteryPct`, `lastSeenAt` and `stale` follow the
// map snapshot's custody rule for an organization (`custodyView`, REQ-UBI-04, D-040): nothing from
// before the handover, and `position.at` is the time of the reading that carried the position.
export interface OrgApiDevice {
  id: string;
  assetTag: string;
  hardwareVariant: string;
  holder: { name: string } | null;
  position: { lat: number; lon: number; at: string } | null;
  batteryPct: number | null;
  lastSeenAt: string | null;
  stale: boolean;
  state: UnitState;
  openIncident: { id: string; code: string; state: string } | null;
  contractCode: string;
}

export interface OrgApiDevices {
  cursor: number;
  devices: OrgApiDevice[];
}

// One page of api-design 05.
export interface StreamPage {
  entries: WireEntry[];
  nextCursor: number;
  hasMore: boolean;
}

// The organization API read model (task 3.2, api-design 04 and 05, UC-39). Every read takes the
// organization of the verified key, never one from the request (FR-AUTH-11, BR-20).
@Injectable()
export class OrgApiService {
  constructor(
    private readonly contracts: ContractsService,
    private readonly devices: DevicesService,
    private readonly incidents: IncidentsQueryService,
    private readonly replays: ReplayService,
    private readonly stream: StreamRepository,
    private readonly parameters: ParameterService,
  ) {}

  // The devices the organization holds now with their last state, and the cursor to stream from. The
  // cursor is read first, so an entry written while the devices are read is streamed, not lost. Every
  // reading is clipped to the organization's custody interval as on its live map (D-040, D-092 rule 2).
  async devicesOf(organizationId: string, now: Date = new Date()): Promise<OrgApiDevices> {
    const cursor = await this.stream.maxSeq();
    const visible = await this.contracts.visibleDevices({ organizationId });
    const ids = visible.map((device) => device.deviceId);
    const [projections, open, staleSeconds] = await Promise.all([
      this.devices.projections(ids),
      this.incidents.openByDevices(ids),
      this.parameters.get('monitoring.deviceStaleSeconds'),
    ]);
    const custody = new Map(visible.map((device) => [device.deviceId, device]));
    const staleBefore = now.getTime() - staleSeconds * 1000;
    return {
      cursor,
      devices: projections.map((device) => {
        const held = custody.get(device.id)!;
        const view = custodyView(device, held.handedOverAt, staleBefore, true);
        // Only an incident routed to this organization is shown, never another holder's.
        const incident = open.get(device.id);
        return {
          id: device.id,
          assetTag: device.assetTag,
          hardwareVariant: device.variantCode,
          holder: held.holder,
          position: view.position,
          batteryPct: view.batteryPct,
          lastSeenAt: view.lastSeenAt,
          stale: view.stale,
          state: view.state,
          openIncident:
            incident && incident.organizationId === organizationId
              ? { id: incident.id, code: incident.code, state: incident.state }
              : null,
          contractCode: held.contractCode,
        };
      }),
    };
  }

  // The organization's entries after the cursor, oldest first. A cursor whose entries have left the
  // retention window answers 410 CURSOR_EXPIRED and the client re-reads api-design 04 (E04-3).
  async streamOf(organizationId: string, after: number, limit: number): Promise<StreamPage> {
    if (await this.replays.isExpired(after)) {
      throw new DomainException(
        HttpStatus.GONE,
        ErrorCode.CURSOR_EXPIRED,
        'The cursor is too old. Read the devices again and stream from the new cursor.',
      );
    }
    const batch = await this.replays.batchAfter(organizationId, after, limit + 1);
    const entries = batch.slice(0, limit);
    return {
      entries,
      nextCursor: entries.length > 0 ? entries[entries.length - 1].seq : after,
      hasMore: batch.length > limit,
    };
  }
}
