import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import {
  DeviceIdentity,
  DeviceProjection,
  DevicesRepository,
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

  // Hardware variants by code, for the plan catalogue and the contract request (billing api-design 01,
  // rentals api-design 01). Read only; variant administration is task 4.1.
  variants(activeOnly = true): Promise<VariantSummary[]> {
    return this.devices.variants(activeOnly);
  }
}
