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
}

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
      return [
        { ...ref, at: row.reservedAt, summary: `Reserved for ${on}`, actorId: null },
        ...(row.releasedAt
          ? [{ ...ref, at: row.releasedAt, summary: `Released from ${on}`, actorId: null }]
          : []),
        ...(row.handedOverAt
          ? [{ ...ref, at: row.handedOverAt, summary: `Handed over on ${on}`, actorId: null }]
          : []),
        ...(row.checkedInAt
          ? [
              {
                ...ref,
                at: row.checkedInAt,
                summary: `Checked in from ${on}`,
                actorId: row.checkedInById,
              },
            ]
          : []),
        ...(row.lostAt
          ? [{ ...ref, at: row.lostAt, summary: `Lost on ${on}`, actorId: null }]
          : []),
      ];
    });
    const entries: Entry[] = [...trail, ...contractEntries].sort(
      (a, b) => b.at.getTime() - a.at.getTime(),
    );
    const page = entries.slice(skip, skip + take);
    const actorIds = [
      ...new Set(page.map((entry) => entry.actorId).filter((id): id is string => id !== null)),
    ];
    const cards = await this.accounts.contactCard(actorIds);
    const names = new Map(cards.map((card) => [card.id, card.fullName]));
    return [
      page.map(({ actorId, ...entry }) => ({
        ...entry,
        actor: actorId ? (names.get(actorId) ?? 'Unknown account') : 'SYSTEM',
      })),
      entries.length,
    ];
  }
}
