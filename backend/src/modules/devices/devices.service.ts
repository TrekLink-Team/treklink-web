import { HttpStatus, Injectable } from '@nestjs/common';
import { DeviceStatus, InspectionResult, Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { OrganizationsService } from '../organizations';
import { businessDay, DeviceView, RecordView, toDeviceView } from './device-view';
import {
  DeviceIdentity,
  DeviceProjection,
  DeviceTag,
  DeviceFilter,
  DeviceListRow,
  DevicesRepository,
  ProvisionedDevice,
  UnitRow,
  VariantRow,
  VariantSummary,
} from './devices.repository';
import { MaintenanceService } from './maintenance.service';

const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Device not found.');

const wrongState = (status: DeviceStatus) =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.INVALID_STATE_TRANSITION,
    `This cannot be done while it is ${status}.`,
  );

const staleVersion = () =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.STALE_VERSION,
    'This was changed by someone else. Reload and try again.',
  );
import { RemainingValueStep, remainingValue } from './remaining-value';

// The organization whose channel key is on a unit (D-021): the renter while it is out, until the reset.
export interface KeyOrganization {
  id: string;
  code: string;
  legalName: string;
}

export type FleetDevice = DeviceView & { keyOrganization: KeyOrganization | null };

// devices api-design 07.
export type DeviceDetail = FleetDevice & {
  openMaintenance: RecordView | null;
  lastIntakeCheck: { passed: boolean; createdAt: Date } | null;
  lastReset: { createdAt: Date } | null;
};

// One entry of a device's lifecycle history (monitoring api-design 07); `actorId` null is SYSTEM.
export interface TrailEntry {
  at: Date;
  kind: 'STATE' | 'INTAKE' | 'PROVISIONING' | 'RESET' | 'INSPECTION' | 'MAINTENANCE';
  summary: string;
  actorId: string | null;
  refType: string | null;
  refId: string | null;
}

const titleCase = (code: string) => code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ');

// One reading of a field event, as `gateway-sync` reports it (task 2.5). `at` is the event's occurrence
// time; a position is passed only when it is plotted, so an implausible one never moves the projection.
export interface DeviceReading {
  at: Date;
  position?: { latitude: number; longitude: number };
  batteryPct?: number;
}

// The methods other modules call (design §3). Lifecycle, reservation and the endpoints join with tasks
// 1.2 and 2.1 to 2.8.
@Injectable()
export class DevicesService {
  constructor(
    private readonly devices: DevicesRepository,
    private readonly maintenance: MaintenanceService,
    private readonly organizations: OrganizationsService,
  ) {}

  byNodeNum(nodeNum: bigint, tx?: Prisma.TransactionClient): Promise<DeviceIdentity | null> {
    return this.devices.findByNodeNum(nodeNum, tx);
  }

  // Updates lastSeenAt, battery and last position when the reading is newer than the stored last-seen
  // time; an older reading is discarded (REQ-EVT-08, FR-DEV-06). Returns the device id, or null when no
  // device has this node number.
  async projectReading(
    nodeNum: bigint,
    reading: DeviceReading,
    tx?: Prisma.TransactionClient,
  ): Promise<string | null> {
    const device = await this.devices.findByNodeNum(nodeNum, tx);
    if (!device) return null;
    await this.devices.projectIfNewer(
      device.id,
      {
        at: reading.at,
        latitude: reading.position?.latitude,
        longitude: reading.position?.longitude,
        batteryPct: reading.batteryPct,
      },
      tx,
    );
    return device.id;
  }

  // Last-seen time, battery and position of each device, for the map snapshot (monitoring 3.1).
  projections(ids: readonly string[]): Promise<DeviceProjection[]> {
    return this.devices.projections(ids);
  }

  // Remaining value of a device at a date, from its variant's schedule (FR-BILL-05, billing).
  async valueAt(deviceId: string, at: Date): Promise<number> {
    const device = await this.devices.findValuation(deviceId);
    if (!device) {
      throw new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Device not found.');
    }
    const schedule = device.hardwareVariant
      .remainingValueSchedule as unknown as RemainingValueStep[];
    return remainingValue(schedule, device.acquiredAt, at);
  }

  // Reserves `quantity` AVAILABLE units of the variant for a contract approval, inside the caller's
  // transaction (rentals task 2.2, FR-CON-03, BR-03). Fewer units than asked is 409
  // INSUFFICIENT_DEVICES with MSG11 and reserves nothing, because the caller's transaction rolls back
  // (REQ-ERR-01 of rentals). The device transition rows join with the lifecycle of task 1.2.
  async reserve(
    variant: { id: string; code: string },
    quantity: number,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<DeviceTag[]> {
    const taken = await this.devices.reserveAvailable(variant.id, quantity, at, tx);
    if (taken.length < quantity) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.INSUFFICIENT_DEVICES,
        `Only ${taken.length} ${variant.code} devices are available. Lower the quantity or choose another variant.`,
      );
    }
    return taken;
  }

  // Returns reserved units to AVAILABLE when a contract is cancelled before handover (FR-CON-04).
  release(ids: readonly string[], at: Date, tx: Prisma.TransactionClient): Promise<void> {
    return ids.length === 0 ? Promise.resolve() : this.devices.releaseReserved(ids, at, tx);
  }

  // The counter's provisioning record (rentals 2.3, D-021): only the key version is stored, never the
  // key. The caller checks the version against the organization's.
  recordProvisioning(
    provisioning: { deviceId: string; organizationId: string; keyVersion: number; actorId: string },
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<ProvisionedDevice> {
    return this.devices.recordProvisioning(provisioning, at, tx);
  }

  // Key version, organization and battery of the units, for the handover checks.
  provisioning(
    ids: readonly string[],
    tx?: Prisma.TransactionClient,
  ): Promise<ProvisionedDevice[]> {
    return ids.length === 0 ? Promise.resolve([]) : this.devices.provisioning(ids, tx);
  }

  // A reserved unit that fails the counter check goes to MAINTENANCE (E01-5). The maintenance record
  // itself joins with task 2.8.
  async failHandoverCheck(deviceId: string, at: Date, tx: Prisma.TransactionClient): Promise<void> {
    await this.devices.moveStatus(
      [deviceId],
      DeviceStatus.RESERVED,
      DeviceStatus.MAINTENANCE,
      at,
      tx,
    );
  }

  // Reserved units go out with the handover (FR-CON-05).
  async markRented(ids: readonly string[], at: Date, tx: Prisma.TransactionClient): Promise<void> {
    await this.devices.moveStatus(ids, DeviceStatus.RESERVED, DeviceStatus.RENTED, at, tx);
  }

  // Units come back at the counter (rentals 4.1, FR-DEV-01): RENTED to RETURNED; the reset and the
  // inspection decide where each goes next.
  async markReturned(
    ids: readonly string[],
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await this.devices.moveStatus(ids, DeviceStatus.RENTED, DeviceStatus.RETURNED, at, tx);
  }

  // devices api-design 10 (task 2.4 part, built by LongLP for MF-05): a RETURNED unit is reset with all
  // three steps (400 RESET_INCOMPLETE otherwise), which clears the organization key it carried (D-021).
  async reset(
    deviceId: string,
    steps: { keyRemoved: boolean; nodeDbCleared: boolean; ownerCleared: boolean },
    actorId: string,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<UnitRow> {
    const unit = await this.devices.findUnit(deviceId, tx);
    if (!unit) throw notFound();
    if (unit.status !== DeviceStatus.RETURNED) throw wrongState(unit.status);
    if (!steps.keyRemoved || !steps.nodeDbCleared || !steps.ownerCleared) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.RESET_INCOMPLETE,
        'Complete every reset step first.',
      );
    }
    return this.devices.insertReset(deviceId, steps, actorId, at, tx);
  }

  // devices api-design 16 (task 2.4, FR-DEV-09): an Admin retires a MAINTENANCE device. Design §2's
  // guard "not on a live contract row" is exactly this status check: every live-contract state is
  // RESERVED or RENTED, never MAINTENANCE, so no separate rentals lookup is needed.
  async retire(
    deviceId: string,
    dto: { reason: string; expectedVersion: number },
    actorId: string,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<FleetDevice> {
    const unit = await this.devices.findUnit(deviceId, tx);
    if (!unit) throw notFound();
    if (unit.status !== DeviceStatus.MAINTENANCE) throw wrongState(unit.status);
    if (unit.version !== dto.expectedVersion) throw staleVersion();
    const moved = await this.devices.moveIfCurrent(
      deviceId,
      dto.expectedVersion,
      [DeviceStatus.MAINTENANCE],
      DeviceStatus.RETIRED,
      at,
      tx,
      { retiredAt: at },
    );
    if (!moved) throw staleVersion();
    await this.devices.insertTransition(
      {
        deviceId,
        fromStatus: DeviceStatus.MAINTENANCE,
        toStatus: DeviceStatus.RETIRED,
        actorId,
        reason: dto.reason.trim(),
        createdAt: at,
      },
      tx,
    );
    return this.deviceViewOf(deviceId, tx);
  }

  // devices api-design 23 (task 2.7, FR-DEV-16, BR-42): an Admin records the verified wipe of a
  // RETIRED device (channel key, node database, owner name) and moves it to DISPOSED. The three wipe
  // steps mirror the counter reset (api-design 10): all three true, or 400 WIPE_INCOMPLETE.
  async dispose(
    deviceId: string,
    dto: {
      keyRemoved: boolean;
      nodeDbCleared: boolean;
      ownerCleared: boolean;
      method: string;
      expectedVersion: number;
    },
    actorId: string,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<FleetDevice> {
    const unit = await this.devices.findUnit(deviceId, tx);
    if (!unit) throw notFound();
    if (!dto.keyRemoved || !dto.nodeDbCleared || !dto.ownerCleared) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.WIPE_INCOMPLETE,
        'Complete every wipe step first.',
      );
    }
    if (unit.status !== DeviceStatus.RETIRED) throw wrongState(unit.status);
    if (unit.version !== dto.expectedVersion) throw staleVersion();
    await this.devices.insertDisposal(
      deviceId,
      {
        keyRemoved: dto.keyRemoved,
        nodeDbCleared: dto.nodeDbCleared,
        ownerCleared: dto.ownerCleared,
        method: dto.method.trim(),
      },
      actorId,
      at,
      tx,
    );
    const moved = await this.devices.moveIfCurrent(
      deviceId,
      dto.expectedVersion,
      [DeviceStatus.RETIRED],
      DeviceStatus.DISPOSED,
      at,
      tx,
    );
    if (!moved) throw staleVersion();
    await this.devices.insertTransition(
      {
        deviceId,
        fromStatus: DeviceStatus.RETIRED,
        toStatus: DeviceStatus.DISPOSED,
        actorId,
        reason: 'DISPOSED',
        createdAt: at,
      },
      tx,
    );
    return this.deviceViewOf(deviceId, tx);
  }

  // The full DEVICE shape (catalog), after a lifecycle write inside the same transaction.
  private async deviceViewOf(deviceId: string, tx: Prisma.TransactionClient): Promise<FleetDevice> {
    const row = await this.devices.findDetail(deviceId, tx);
    if (!row) throw notFound();
    const [device] = await this.withKeyOrganizations([toDeviceView(row)]);
    return device;
  }

  // The inspection of a returned unit (task 2.4 part, rentals 4.2): it needs a reset after the unit's
  // last check-in (409 RESET_REQUIRED, BR-28). PASSED makes the unit AVAILABLE again, unless its service
  // falls due within `devices.maintenanceLeadDays` or its firmware is off the baseline: then it goes to
  // MAINTENANCE with a SCHEDULED or FIRMWARE_UPDATE record (REQ-EVT-07, FR-DEV-19, BR-45). DAMAGED and
  // FAILED send it to MAINTENANCE with an INSPECTION_FAILED record.
  async recordInspection(
    deviceId: string,
    input: {
      result: InspectionResult;
      damageCodes: string[];
      note: string | null;
      contractDeviceId: string | null;
      checkedInAt: Date;
    },
    actorId: string,
    at: Date,
    tx: Prisma.TransactionClient,
  ) {
    const unit = await this.devices.findUnit(deviceId, tx);
    if (!unit) throw notFound();
    if (unit.status !== DeviceStatus.RETURNED) throw wrongState(unit.status);
    const resetAt = await this.devices.lastResetAt(deviceId, tx);
    if (!resetAt || resetAt < input.checkedInAt) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.RESET_REQUIRED,
        'Reset this device before inspecting it.',
      );
    }
    const damageCodes = input.result === InspectionResult.DAMAGED ? input.damageCodes : [];
    const inspection = await this.devices.insertInspection(
      {
        deviceId,
        contractDeviceId: input.contractDeviceId,
        result: input.result,
        damageCodes,
        note: input.note,
        inspectorId: actorId,
        createdAt: at,
      },
      tx,
    );

    const record = await this.routeInspected(
      deviceId,
      input.result,
      damageCodes,
      input.note,
      at,
      tx,
    );
    const next = record ? DeviceStatus.MAINTENANCE : DeviceStatus.AVAILABLE;
    await this.devices.moveStatus([deviceId], DeviceStatus.RETURNED, next, at, tx);
    if (record) {
      await this.maintenance.openForSystem({ deviceId, ...record }, actorId, at, tx);
    }
    await this.devices.insertTransition(
      {
        deviceId,
        fromStatus: DeviceStatus.RETURNED,
        toStatus: next,
        actorId,
        reason: `INSPECTION_${input.result}`,
        refType: 'INSPECTION',
        refId: inspection.id,
        createdAt: at,
      },
      tx,
    );
    return {
      inspection,
      device: { ...unit, status: next },
    };
  }

  // The maintenance record an inspection opens, or null when the unit returns to the fleet.
  private async routeInspected(
    deviceId: string,
    result: InspectionResult,
    damageCodes: string[],
    note: string | null,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<{
    reason: 'SCHEDULED' | 'FIRMWARE_UPDATE' | 'INSPECTION_FAILED';
    description: string;
    expectedAt: Date;
  } | null> {
    const today = businessDay(at);
    if (result !== InspectionResult.PASSED) {
      const detail = [damageCodes.join(', '), note?.trim()].filter(Boolean).join('; ');
      return {
        reason: 'INSPECTION_FAILED',
        description: `Inspection ${result.toLowerCase()}${detail ? `: ${detail}` : ''}.`,
        expectedAt: today,
      };
    }
    const detail = await this.devices.findDetail(deviceId, tx);
    if (!detail) throw notFound();
    const due = await this.maintenance.dueReason(
      {
        serviceDueAt: detail.serviceDueAt,
        firmwareVersion: detail.firmwareVersion,
        firmwareBaseline: detail.hardwareVariant.firmwareBaseline,
      },
      at,
      tx,
    );
    if (due === 'SCHEDULED') {
      const dueAt = detail.serviceDueAt!;
      return {
        reason: due,
        description: `Periodic service due ${dueAt.toISOString().slice(0, 10)}.`,
        expectedAt: dueAt > today ? dueAt : today,
      };
    }
    if (due === 'FIRMWARE_UPDATE') {
      return {
        reason: due,
        description: `Update firmware ${detail.firmwareVersion} to ${detail.hardwareVariant.firmwareBaseline}.`,
        expectedAt: today,
      };
    }
    return null;
  }

  // devices api-design 07 (task 3.1 part): one device with its open maintenance, last intake check
  // and last reset, and the organization whose key it carries.
  async detail(deviceId: string): Promise<DeviceDetail> {
    const row = await this.devices.findDetail(deviceId);
    if (!row) throw notFound();
    const [openMaintenance, lastIntakeCheck, lastReset, [device]] = await Promise.all([
      this.maintenance.openRecordOf(deviceId),
      this.devices.lastIntakeCheck(deviceId),
      this.devices.lastReset(deviceId),
      this.withKeyOrganizations([toDeviceView(row)]),
    ]);
    return {
      ...device,
      openMaintenance,
      lastIntakeCheck: lastIntakeCheck
        ? { passed: lastIntakeCheck.passed, createdAt: lastIntakeCheck.createdAt }
        : null,
      lastReset: lastReset ? { createdAt: lastReset.createdAt } : null,
    };
  }

  // devices api-design 06 with the last position and the key organization of each unit.
  async fleetPage(
    filter: DeviceFilter,
    skip: number,
    take: number,
  ): Promise<[FleetDevice[], number]> {
    const [rows, total] = await this.devices.page(filter, skip, take);
    return [await this.withKeyOrganizations(rows.map(toDeviceView)), total];
  }

  // The lifecycle rows `devices` owns for one device (design §3, task 2.5): state changes, intake
  // checks, provisioning, resets, inspections and maintenance, oldest first. Contracts and incidents
  // are added by `monitoring` (monitoring api-design 07). Throws 404 for an unknown device.
  async trail(deviceId: string): Promise<TrailEntry[]> {
    if (!(await this.devices.findUnit(deviceId))) throw notFound();
    const [rows, records] = await Promise.all([
      this.devices.lifecycle(deviceId),
      this.maintenance.ofDevice(deviceId),
    ]);
    const entries: TrailEntry[] = [
      ...rows.transitions.map((row) => ({
        at: row.createdAt,
        kind: 'STATE' as const,
        summary: `${row.fromStatus ?? 'Registered'} to ${row.toStatus} (${titleCase(row.reason)})`,
        actorId: row.actorId,
        refType: row.refType,
        refId: row.refId,
      })),
      ...rows.intakeChecks.map((row) => ({
        at: row.createdAt,
        kind: 'INTAKE' as const,
        summary: row.passed ? 'Intake check passed' : 'Intake check failed',
        actorId: row.checkedById,
        refType: 'INTAKE_CHECK',
        refId: row.id,
      })),
      ...rows.provisionings.map((row) => ({
        at: row.createdAt,
        kind: 'PROVISIONING' as const,
        summary: `Provisioned with key version ${row.keyVersion}`,
        actorId: row.provisionedById,
        refType: 'ORGANIZATION',
        refId: row.organizationId,
      })),
      ...rows.resets.map((row) => ({
        at: row.createdAt,
        kind: 'RESET' as const,
        summary: 'Reset: key removed, node database and owner cleared',
        actorId: row.resetById,
        refType: null,
        refId: null,
      })),
      ...rows.inspections.map((row) => ({
        at: row.createdAt,
        kind: 'INSPECTION' as const,
        summary:
          `Inspection ${row.result.toLowerCase()}` +
          (row.damageCodes.length ? `: ${row.damageCodes.join(', ')}` : ''),
        actorId: row.inspectorId,
        refType: 'INSPECTION',
        refId: row.id,
      })),
      ...records.flatMap((row) => [
        {
          at: row.openedAt,
          kind: 'MAINTENANCE' as const,
          summary: `Maintenance opened: ${titleCase(row.reason)}`,
          actorId: row.openedById,
          refType: 'MAINTENANCE',
          refId: row.id,
        },
        ...(row.closedAt
          ? [
              {
                at: row.closedAt,
                kind: 'MAINTENANCE' as const,
                summary: `Maintenance ${row.status.toLowerCase()}`,
                actorId: row.closedById,
                refType: 'MAINTENANCE',
                refId: row.id,
              },
            ]
          : []),
      ]),
    ];
    return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  private async withKeyOrganizations(devices: DeviceView[]): Promise<FleetDevice[]> {
    const ids = devices
      .map((device) => device.keyOrganizationId)
      .filter((id): id is string => id !== null);
    const labels = await this.organizations.labelsOf(ids);
    return devices.map((device) => {
      const label = device.keyOrganizationId ? labels.get(device.keyOrganizationId) : undefined;
      return {
        ...device,
        keyOrganization: label
          ? { id: label.id, code: label.code, legalName: label.legalName }
          : null,
      };
    });
  }

  // devices api-design 06 (task 4.1 part, built by LongLP for rentals 4.3): the fleet for Staff,
  // filtered by status, variant and asset tag. Battery, last seen and the service date come from the
  // projection; the last position joins with the live map work.
  page(filter: DeviceFilter, skip: number, take: number): Promise<[DeviceListRow[], number]> {
    return this.devices.page(filter, skip, take);
  }

  // The unit Staff chose to replace a faulty or lost one on a running contract (rentals 4.3, BR-41):
  // locked, of the contract's variant (409 VARIANT_MISMATCH) and AVAILABLE (409
  // DEVICE_NOT_AVAILABLE); it moves to RESERVED until the caller provisions and hands it over.
  async takeForReplacement(
    deviceId: string,
    variantId: string,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<DeviceTag> {
    const unit = await this.devices.lockUnit(deviceId, tx);
    if (!unit) throw notFound();
    if (unit.hardwareVariantId !== variantId) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.VARIANT_MISMATCH,
        'Choose a unit of the same variant.',
      );
    }
    if (unit.status !== DeviceStatus.AVAILABLE) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.DEVICE_NOT_AVAILABLE,
        'Choose an available unit.',
      );
    }
    await this.devices.moveStatus(
      [deviceId],
      DeviceStatus.AVAILABLE,
      DeviceStatus.RESERVED,
      at,
      tx,
    );
    return { id: unit.id, assetTag: unit.assetTag };
  }

  // Whether a missing unit has a loss case open, so it may be replaced while away (rentals 4.3).
  hasOpenLossCase(deviceId: string, tx: Prisma.TransactionClient): Promise<boolean> {
    return this.devices.hasOpenLossCase(deviceId, tx);
  }

  // AVAILABLE units per variant now; advisory for the approval queue and the request form
  // (devices api-design 24). Approval decides (FR-CON-03).
  availability(variantId?: string) {
    return this.devices.availability(variantId);
  }

  // AVAILABLE units of a variant now.
  countAvailable(variantId: string): Promise<number> {
    return this.devices.countAvailable(variantId);
  }

  // Asset tags by device id, for contract reads; in the caller's transaction when it passes one.
  async assetTags(
    ids: readonly string[],
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.devices.tags(ids, tx);
    return new Map(rows.map((row) => [row.id, row.assetTag]));
  }

  // Hardware variants by code, for the plan catalogue and the contract request (billing api-design 01,
  // rentals api-design 01). Read only; variant administration is task 4.1.
  // devices api-design 01: the full variant rows, active only unless an Admin asks for all.
  variantCatalog(activeOnly: boolean): Promise<VariantRow[]> {
    return this.devices.variantCatalog(activeOnly);
  }

  variants(activeOnly = true): Promise<VariantSummary[]> {
    return this.devices.variants(activeOnly);
  }
}
