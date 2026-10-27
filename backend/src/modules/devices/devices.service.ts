import { HttpStatus, Injectable } from '@nestjs/common';
import { DeviceStatus, Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import {
  DeviceIdentity,
  DeviceProjection,
  DeviceTag,
  DevicesRepository,
  ProvisionedDevice,
  VariantSummary,
} from './devices.repository';
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
