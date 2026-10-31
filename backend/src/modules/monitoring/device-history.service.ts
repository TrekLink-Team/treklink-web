import { Injectable } from '@nestjs/common';
import { AccountsService } from '../auth';
import { DevicesService, TrailEntry } from '../devices';
import { OrganizationsService } from '../organizations';
import { ContractsService } from '../rentals';

// One row of a device's lifecycle history (monitoring api-design 07).
export interface DeviceHistoryItem {
  at: Date;
  kind: TrailEntry['kind'] | 'CONTRACT';
  summary: string;
  actor: string;
  refType: string | null;
  refId: string | null;
}

interface Entry extends Omit<DeviceHistoryItem, 'actor'> {
  actorId: string | null;
  tie: number;
}

// Where an entry falls among entries of the same time. A reservation or a check-in comes before the
// unit's own rows of that time (it is provisioned after the reservation, reset and inspected after
// the check-in); a handover, a release or a loss comes after them; device rows keep their trail order.
const BEFORE_DEVICE_ROWS = -1;
const DEVICE_ROW = 0;
const AFTER_DEVICE_ROWS = 1;

// monitoring api-design 07 (task 3.3 part): the read-only history of a device for TrekLink staff,
// composed from `devices.trail` and `rentals.contractsOfDevice` (design §3, the read model that may
// import every module). Incidents (`incidents.incidentsOfDevice`) join with the rest of task 3.3.
// Newest first; a null actor reads SYSTEM.
@Injectable()
export class DeviceHistoryService {
  constructor(
    private readonly devices: DevicesService,
    private readonly contracts: ContractsService,
    private readonly organizations: OrganizationsService,
    private readonly accounts: AccountsService,
  ) {}

  async history(
    deviceId: string,
    skip: number,
    take: number,
  ): Promise<[DeviceHistoryItem[], number]> {
    const trail = await this.devices.trail(deviceId);
    const rows = await this.contracts.contractsOfDevice(deviceId);
    const labels = await this.organizations.labelsOf(rows.map((row) => row.organizationId));
    const contractEntries: Entry[] = rows.flatMap((row) => {
      const organization = labels.get(row.organizationId)?.code ?? row.organizationId;
      const on = `${row.contractCode} (${organization})`;
      const ref = { kind: 'CONTRACT' as const, refType: 'CONTRACT', refId: row.contractId };
      // Built in lifecycle order; the stable sort below keeps it for moves sharing one time (a seeded
      // handover reserves and hands over at once).
      const before = { ...ref, tie: BEFORE_DEVICE_ROWS };
      const after = { ...ref, tie: AFTER_DEVICE_ROWS };
      return [
        { ...before, at: row.reservedAt, summary: `Reserved for ${on}`, actorId: null },
        ...(row.releasedAt
          ? [{ ...after, at: row.releasedAt, summary: `Released from ${on}`, actorId: null }]
          : []),
        ...(row.handedOverAt
          ? [{ ...after, at: row.handedOverAt, summary: `Handed over on ${on}`, actorId: null }]
          : []),
        ...(row.checkedInAt
          ? [
              {
                ...before,
                at: row.checkedInAt,
                summary: `Checked in from ${on}`,
                actorId: row.checkedInById,
              },
            ]
          : []),
        ...(row.lostAt
          ? [{ ...after, at: row.lostAt, summary: `Lost on ${on}`, actorId: null }]
          : []),
      ];
    });
    // devices writes a CONTRACT-referenced state row for every move rentals drives; the contract
    // entries above already tell those moves with the organization, so the merged view keeps one.
    const deviceEntries = trail
      .filter((entry) => entry.refType !== 'CONTRACT')
      .map((entry) => ({ ...entry, tie: DEVICE_ROW }));
    // Oldest first with a stable sort, then reversed, so entries of one time also read newest first.
    const entries: Entry[] = [...deviceEntries, ...contractEntries]
      .sort((a, b) => a.at.getTime() - b.at.getTime() || a.tie - b.tie)
      .reverse();
    const page = entries.slice(skip, skip + take);
    const actorIds = [
      ...new Set(page.map((entry) => entry.actorId).filter((id): id is string => id !== null)),
    ];
    const cards = await this.accounts.contactCard(actorIds);
    const names = new Map(cards.map((card) => [card.id, card.fullName]));
    return [
      page.map(({ actorId, tie: _tie, ...entry }) => ({
        ...entry,
        actor: actorId ? (names.get(actorId) ?? 'Unknown account') : 'SYSTEM',
      })),
      entries.length,
    ];
  }
}
