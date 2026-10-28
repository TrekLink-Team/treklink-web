import { HttpStatus, Injectable } from '@nestjs/common';
import { DeviceStatus, InspectionResult, Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import {
  DeviceIdentity,
  DeviceProjection,
  DeviceTag,
  DeviceFilter,
  DeviceListRow,
  DevicesRepository,
  ProvisionedDevice,
  UnitRow,
  VariantSummary,
} from './devices.repository';

const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Device not found.');

const wrongState = (status: DeviceStatus) =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.INVALID_STATE_TRANSITION,
    `This cannot be done while it is ${status}.`,
  );
import { RemainingValueStep, remainingValue } from './remaining-value';

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
  constructor(private readonly devices: DevicesRepository) {}

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

  // The inspection of a returned unit (task 2.4 part, rentals 4.2): it needs a reset after the unit's
  // last check-in (409 RESET_REQUIRED, BR-28). PASSED makes the unit AVAILABLE again; DAMAGED and FAILED
  // send it to MAINTENANCE. The maintenance record and the service-due rule join with task 2.8.
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
    const inspection = await this.devices.insertInspection(
      {
        deviceId,
        contractDeviceId: input.contractDeviceId,
        result: input.result,
        damageCodes: input.result === InspectionResult.DAMAGED ? input.damageCodes : [],
        note: input.note,
        inspectorId: actorId,
        createdAt: at,
      },
      tx,
    );
    const next =
      input.result === InspectionResult.PASSED ? DeviceStatus.AVAILABLE : DeviceStatus.MAINTENANCE;
    await this.devices.moveStatus([deviceId], DeviceStatus.RETURNED, next, at, tx);
    return {
      inspection,
      device: { ...unit, status: next },
    };
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
  variants(activeOnly = true): Promise<VariantSummary[]> {
    return this.devices.variants(activeOnly);
  }
}
