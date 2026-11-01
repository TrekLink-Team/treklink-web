import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DeviceStatus, InspectionResult, LossCaseState, Prisma } from '@prisma/client';
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
  TransitionContext,
  UnitRow,
  VariantRow,
  VariantSummary,
} from './devices.repository';
import { MaintenanceService } from './maintenance.service';
import { NextStep, nextStepOf } from './next-step';
import { CUSTODY_RESOLVER, CustodyResolver } from './ports/custody-resolver.port';

const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Device not found.');

const wrongState = (status: DeviceStatus) =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.INVALID_STATE_TRANSITION,
    `This cannot be done while it is ${status}.`,
  );

// A unit whose contract row is still open, such as one recovered from a loss case before its renter's
// check-in (design §2.1, leader ruling 2026-11-01): the counter checks it in first. The state code fits.
export const notCheckedIn = () =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.INVALID_STATE_TRANSITION,
    'Check this device in on its contract first.',
  );

const staleVersion = () =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.STALE_VERSION,
    'This was changed by someone else. Reload and try again.',
  );
import { RemainingValueStep, remainingValue } from './remaining-value';
import { toNodeId } from './node-id';

// One unit as the handover note prints it (rentals design §4.1): its radio identity, the key version
// on it, and the remaining value a confirmed loss would charge at `at` (FR-BILL-05), null when the
// variant's schedule has no row for the unit's age, so the note never blocks a handover.
export interface HandoverUnit {
  id: string;
  assetTag: string;
  nodeId: string;
  keyVersion: number | null;
  firmwareVersion: string;
  variantCode: string;
  remainingValueVnd: number | null;
}

const valueOrNull = (schedule: unknown, acquiredAt: Date, at: Date): number | null => {
  if (!Array.isArray(schedule)) return null;
  try {
    return remainingValue(schedule as RemainingValueStep[], acquiredAt, at);
  } catch {
    return null;
  }
};

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
  nextStep: NextStep | null;
};

// A unit's state now and its next step back to AVAILABLE (REQ-EVT-23), for rentals.
export interface ReturnState {
  status: DeviceStatus;
  nextStep: NextStep | null;
  // The contract of the unit's last move into RETURNED when it was a check-in, so a contract shows the
  // next step only on the row of the unit's latest return.
  lastReturnContractId: string | null;
}

// State rows oldest first, rows of one time in the order of their moves: a row whose `fromStatus`
// is the `toStatus` of another row of that time follows it. A seeded handover reserves and hands over
// in one instant, and the id order of such rows says nothing about which move came first.
export function inMoveOrder<
  T extends { fromStatus: DeviceStatus | null; toStatus: DeviceStatus; createdAt: Date },
>(rows: readonly T[]): T[] {
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const ordered: T[] = [];
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (
      end < sorted.length &&
      sorted[end].createdAt.getTime() === sorted[start].createdAt.getTime()
    ) {
      end += 1;
    }
    const pending = sorted.slice(start, end);
    while (pending.length > 0) {
      // The first row no other pending row leads into; on a cycle, the first row.
      const next = pending.findIndex(
        (row) => !pending.some((other) => other !== row && other.toStatus === row.fromStatus),
      );
      ordered.push(...pending.splice(Math.max(next, 0), 1));
    }
    start = end;
  }
  return ordered;
}

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

// What the return counter shows of one returned contract row (devices api-design 10, rentals 16).
export interface ReturnCheck {
  resetAt: Date | null;
  inspection: { result: InspectionResult; at: Date } | null;
}

// The contract a move driven by rentals belongs to (design §2): its transition row carries refType
// CONTRACT, the contract id and, as the note, the contract code the device history shows; the actor
// is the Staff account, or null for SYSTEM. `reason` overrides the method's own, such as REPLACED for
// the faulty unit a replacement checks in.
export interface ContractMove {
  contractId: string;
  contractCode: string;
  actorId: string | null;
  reason?: string;
}

const contractRow = (move: ContractMove, reason: string): TransitionContext => ({
  actorId: move.actorId,
  reason: move.reason ?? reason,
  note: move.contractCode,
  refType: 'CONTRACT',
  refId: move.contractId,
});

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
    @Inject(CUSTODY_RESOLVER) private readonly custody: CustodyResolver,
  ) {}

  // One device by its asset tag with its version, or null (demo module, D-088).
  byAssetTag(assetTag: string) {
    return this.devices.findByAssetTag(assetTag);
  }

  // For the demo module only (D-088): no business flow calls it; it moves dates outside the normal rules.
  // Makes a unit due for service on `serviceDueAt` (demo module's asset-maintenance scenario, D-088), so a
  // passed inspection or the fleet list shows it due within devices.maintenanceLeadDays (REQ-EVT-07).
  scheduleService(deviceId: string, serviceDueAt: Date): Promise<void> {
    return this.devices.setServiceDue(deviceId, serviceDueAt);
  }

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
  // (REQ-ERR-01 of rentals). Each unit taken gets an AVAILABLE to RESERVED transition row naming the
  // contract (design §2). When the caller names the units, one that is not an AVAILABLE unit of the
  // variant (another status, another variant, unknown, or held by a concurrent approval) is 409
  // DEVICE_NOT_AVAILABLE naming it.
  async reserve(
    variant: { id: string; code: string },
    quantity: number,
    at: Date,
    tx: Prisma.TransactionClient,
    move: ContractMove,
    deviceIds?: readonly string[],
  ): Promise<DeviceTag[]> {
    const taken = await this.devices.reserveAvailable(variant.id, quantity, at, tx, deviceIds);
    if (deviceIds && taken.length < quantity) {
      const takenIds = new Set(taken.map((device) => device.id));
      const refused = deviceIds.filter((id) => !takenIds.has(id));
      const tags = await this.assetTags(refused, tx);
      const names = refused.map((id) => tags.get(id) ?? id).join(', ');
      const what =
        refused.length === 1
          ? `is not an available ${variant.code} device`
          : `are not available ${variant.code} devices`;
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.DEVICE_NOT_AVAILABLE,
        `${names} ${what}. Choose available units of the variant.`,
      );
    }
    if (taken.length < quantity) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.INSUFFICIENT_DEVICES,
        `Only ${taken.length} ${variant.code} devices are available. Lower the quantity or choose another variant.`,
      );
    }
    await this.devices.insertTransitions(
      taken.map((device) => device.id),
      DeviceStatus.AVAILABLE,
      DeviceStatus.RESERVED,
      at,
      tx,
      contractRow(move, 'RESERVED'),
    );
    return taken;
  }

  // Returns reserved units to AVAILABLE when a contract is cancelled before handover (FR-CON-04),
  // with a RESERVED to AVAILABLE transition row each.
  async release(
    ids: readonly string[],
    at: Date,
    tx: Prisma.TransactionClient,
    move: ContractMove,
  ): Promise<void> {
    await this.devices.moveWithTransitions(
      ids,
      DeviceStatus.RESERVED,
      DeviceStatus.AVAILABLE,
      at,
      tx,
      contractRow(move, 'RELEASED'),
    );
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

  // A provisioning recorded on the wrong unit, undone at the counter before the handover (rentals
  // api-design 19). Rentals has checked the contract, the row and the unit's state.
  clearProvisioning(deviceId: string, tx: Prisma.TransactionClient): Promise<ProvisionedDevice> {
    return this.devices.clearProvisioning(deviceId, tx);
  }

  // Key version, organization and battery of the units, for the handover checks.
  provisioning(
    ids: readonly string[],
    tx?: Prisma.TransactionClient,
  ): Promise<ProvisionedDevice[]> {
    return ids.length === 0 ? Promise.resolve([]) : this.devices.provisioning(ids, tx);
  }

  // A reserved unit that fails the counter check goes to MAINTENANCE (E01-5) with a
  // HANDOVER_CHECK_FAILED record holding the swap reason, so it appears on the maintenance screen and
  // returns to the fleet through the record and an intake check like any other repaired unit.
  async failHandoverCheck(
    deviceId: string,
    reason: string,
    actorId: string,
    at: Date,
    tx: Prisma.TransactionClient,
    move: Omit<ContractMove, 'actorId'>,
  ): Promise<void> {
    await this.devices.moveWithTransitions(
      [deviceId],
      DeviceStatus.RESERVED,
      DeviceStatus.MAINTENANCE,
      at,
      tx,
      contractRow({ ...move, actorId }, 'HANDOVER_CHECK_FAILED'),
    );
    await this.maintenance.openForSystem(
      {
        deviceId,
        reason: 'HANDOVER_CHECK_FAILED',
        description: `Handover check failed: ${reason}`,
        expectedAt: businessDay(at),
      },
      actorId,
      at,
      tx,
    );
  }

  // Reserved units go out with the handover or a replacement (FR-CON-05).
  async markRented(
    ids: readonly string[],
    at: Date,
    tx: Prisma.TransactionClient,
    move: ContractMove,
  ): Promise<void> {
    await this.devices.moveWithTransitions(
      ids,
      DeviceStatus.RESERVED,
      DeviceStatus.RENTED,
      at,
      tx,
      contractRow(move, 'HANDED_OVER'),
    );
  }

  // Units come back at the counter (rentals 4.1, FR-DEV-01): RENTED to RETURNED; the reset and the
  // inspection decide where each goes next.
  async markReturned(
    ids: readonly string[],
    at: Date,
    tx: Prisma.TransactionClient,
    move: ContractMove,
  ): Promise<void> {
    await this.devices.moveWithTransitions(
      ids,
      DeviceStatus.RENTED,
      DeviceStatus.RETURNED,
      at,
      tx,
      contractRow(move, 'CHECKED_IN'),
    );
  }

  // devices api-design 10 (task 2.4 part, built by LongLP for MF-05): a RETURNED unit is reset with all
  // three steps (400 RESET_INCOMPLETE otherwise), which clears the organization key it carried (D-021).
  // One reset per return: a unit already reset since it became RETURNED is 409 ALREADY_RESET. A unit
  // whose contract row is still open is refused until it is checked in (design §2.1).
  async reset(
    deviceId: string,
    steps: { keyRemoved: boolean; nodeDbCleared: boolean; ownerCleared: boolean },
    actorId: string,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<UnitRow> {
    // Lock the device row first: two counters (or a double click) must not both pass the
    // ALREADY_RESET check below and insert two resets for one return.
    const unit = await this.devices.lockUnit(deviceId, tx);
    if (!unit) throw notFound();
    if (unit.status !== DeviceStatus.RETURNED) throw wrongState(unit.status);
    if (await this.custody.custodyAt(deviceId, at, tx)) throw notCheckedIn();
    if (!steps.keyRemoved || !steps.nodeDbCleared || !steps.ownerCleared) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.RESET_INCOMPLETE,
        'Complete every reset step first.',
      );
    }
    const resetAt = await this.devices.lastResetAt(deviceId, tx);
    if (resetAt && resetAt >= unit.statusChangedAt) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.ALREADY_RESET,
        'This device is already reset for this return.',
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
    // An OPEN or PENDING_APPROVAL record is closed first (UNREPAIRABLE when the unit cannot be
    // repaired), so no record stays open on a RETIRED device (leader ruling, 2026-10-30).
    if (await this.maintenance.hasOpenRecord(deviceId, tx)) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.MAINTENANCE_OPEN,
        'Finish the open maintenance record first.',
      );
    }
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
        reason: 'RETIRED',
        note: dto.reason.trim(),
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

  // devices api-design 08 (FR-DEV-01): Staff correct the firmware version after a reflash. The state
  // and identity never change here. Returns the version before the edit for the audit record.
  async updateFirmware(
    deviceId: string,
    dto: { firmwareVersion: string; expectedVersion: number },
    tx: Prisma.TransactionClient,
  ): Promise<{ before: string; device: FleetDevice }> {
    const row = await this.devices.findDetail(deviceId, tx);
    if (!row) throw notFound();
    // A DISPOSED unit was wiped and left the fleet: its record is final (review of treklink-web#284). A
    // RETIRED unit may still be reflashed before its disposal.
    if (row.status === DeviceStatus.DISPOSED) throw wrongState(row.status);
    if (row.version !== dto.expectedVersion) throw staleVersion();
    const firmwareVersion = dto.firmwareVersion.trim();
    const written = await this.devices.setFirmwareIfCurrent(
      deviceId,
      dto.expectedVersion,
      firmwareVersion,
      tx,
    );
    if (!written) throw staleVersion();
    return { before: row.firmwareVersion, device: await this.deviceViewOf(deviceId, tx) };
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
    // Inspection is the step that makes the unit AVAILABLE: refused while its contract row is open.
    if (await this.custody.custodyAt(deviceId, at, tx)) throw notCheckedIn();
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
    const [openMaintenance, lastIntakeCheck, lastReset, [device], states] = await Promise.all([
      this.maintenance.openRecordOf(deviceId),
      this.devices.lastIntakeCheck(deviceId),
      this.devices.lastReset(deviceId),
      this.withKeyOrganizations([toDeviceView(row)]),
      this.nextSteps([deviceId]),
    ]);
    return {
      ...device,
      openMaintenance,
      lastIntakeCheck: lastIntakeCheck
        ? { passed: lastIntakeCheck.passed, createdAt: lastIntakeCheck.createdAt }
        : null,
      lastReset: lastReset ? { createdAt: lastReset.createdAt } : null,
      nextStep: states.get(deviceId)?.nextStep ?? null,
    };
  }

  // devices REQ-EVT-23 (D-092 rule 4): each unit's state now and its next step back to AVAILABLE, for
  // the device page and for the checked-in rows of a contract (rentals api-design 03). A reset counts
  // when it is at or after the unit became RETURNED; the reset and inspection name the contract of the
  // unit's last move into RETURNED when that move was a check-in (refType CONTRACT).
  async nextSteps(
    deviceIds: readonly string[],
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, ReturnState>> {
    const ids = [...new Set(deviceIds)];
    if (ids.length === 0) return new Map();
    const [{ units, resets, returns }, open] = await Promise.all([
      this.devices.returnStates(ids, tx),
      this.maintenance.openDeviceIds(ids, tx),
    ]);
    return new Map(
      units.map((unit) => {
        const reset = resets.find((entry) => entry.deviceId === unit.id);
        const lastReturn = returns.find((entry) => entry.deviceId === unit.id);
        const returnContractId =
          lastReturn?.refType === 'CONTRACT' ? (lastReturn.refId ?? null) : null;
        return [
          unit.id,
          {
            status: unit.status,
            lastReturnContractId: returnContractId,
            nextStep: nextStepOf({
              status: unit.status,
              resetSinceReturn: Boolean(reset && reset.createdAt >= unit.statusChangedAt),
              openMaintenance: open.has(unit.id),
              returnContractId,
            }),
          },
        ];
      }),
    );
  }

  // The open loss case of each unit by device id, for the rentals close check (api-design 20).
  async openLossCases(
    deviceIds: readonly string[],
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, { id: string; code: string; state: LossCaseState }>> {
    const rows = await this.devices.openLossCases(deviceIds, tx);
    const byDevice = new Map<string, { id: string; code: string; state: LossCaseState }>();
    for (const row of rows) {
      if (!byDevice.has(row.deviceId)) {
        byDevice.set(row.deviceId, { id: row.id, code: row.code, state: row.state });
      }
    }
    return byDevice;
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
      ...inMoveOrder(rows.transitions).map((row) => ({
        at: row.createdAt,
        kind: 'STATE' as const,
        summary:
          `${row.fromStatus ?? 'Registered'} to ${row.toStatus} (${titleCase(row.reason)})` +
          (row.note ? `: ${row.note}` : ''),
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
    // Stable: rows of one time keep the order above, state rows first and in the order of their moves.
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
    move: ContractMove,
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
    await this.devices.moveWithTransitions(
      [deviceId],
      DeviceStatus.AVAILABLE,
      DeviceStatus.RESERVED,
      at,
      tx,
      contractRow(move, 'RESERVED'),
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

  // The reset and inspection of each returned contract row, for the return counter (rentals api-design
  // 03 devices[]): the first reset at or after the row's check-in and before the unit's next return, and
  // the last inspection recorded against the row. Rows not checked in are left out.
  async returnChecks(
    rows: readonly { contractDeviceId: string; deviceId: string; checkedInAt: Date | null }[],
  ): Promise<Map<string, ReturnCheck>> {
    const back = rows.filter(
      (row): row is typeof row & { checkedInAt: Date } => row.checkedInAt !== null,
    );
    if (back.length === 0) return new Map();
    const deviceIds = [...new Set(back.map((row) => row.deviceId))];
    const [resets, returns, inspections] = await Promise.all([
      this.devices.resetsOf(deviceIds),
      this.devices.returnsOf(deviceIds),
      this.devices.inspectionsOfContractDevices(back.map((row) => row.contractDeviceId)),
    ]);
    return new Map(
      back.map((row) => {
        // A reset after the unit came back on a later contract belongs to that return, not this one.
        const nextReturn = returns.find(
          (entry) => entry.deviceId === row.deviceId && entry.createdAt > row.checkedInAt,
        );
        const reset = resets.find(
          (entry) =>
            entry.deviceId === row.deviceId &&
            entry.createdAt >= row.checkedInAt &&
            (!nextReturn || entry.createdAt < nextReturn.createdAt),
        );
        const inspection = inspections
          .filter((entry) => entry.contractDeviceId === row.contractDeviceId)
          .at(-1);
        return [
          row.contractDeviceId,
          {
            resetAt: reset?.createdAt ?? null,
            inspection: inspection ? { result: inspection.result, at: inspection.createdAt } : null,
          },
        ];
      }),
    );
  }

  // The units of a handover note by device id (rentals design §4.1), in the caller's transaction when
  // it passes one; an unknown id is absent.
  async handoverUnits(
    ids: readonly string[],
    at: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, HandoverUnit>> {
    if (ids.length === 0) return new Map();
    const rows = await this.devices.handoverUnits(ids, tx);
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          assetTag: row.assetTag,
          nodeId: toNodeId(row.nodeNum),
          keyVersion: row.keyVersion,
          firmwareVersion: row.firmwareVersion,
          variantCode: row.hardwareVariant.code,
          remainingValueVnd: valueOrNull(
            row.hardwareVariant.remainingValueSchedule,
            row.acquiredAt,
            at,
          ),
        },
      ]),
    );
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
  async variantCatalog(activeOnly: boolean): Promise<(VariantRow & { deviceCount: number })[]> {
    const rows = await this.devices.variantCatalog(activeOnly);
    return rows.map(({ _count, ...variant }) => ({ ...variant, deviceCount: _count.devices }));
  }

  variants(activeOnly = true, tx?: Prisma.TransactionClient): Promise<VariantSummary[]> {
    return this.devices.variants(activeOnly, tx);
  }
}
