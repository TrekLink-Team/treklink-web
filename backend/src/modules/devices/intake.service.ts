import { HttpStatus, Injectable } from '@nestjs/common';
import { DeviceStatus, Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { addDays, businessDay, DeviceView, toDeviceView } from './device-view';
import { DevicesRepository } from './devices.repository';
import { IntakeCheckDto } from './dto/intake-check.dto';
import { MaintenanceService } from './maintenance.service';

const INTAKE_FROM: readonly DeviceStatus[] = [DeviceStatus.IN_INTAKE, DeviceStatus.MAINTENANCE];

// devices api-design 09 (task 2.2, intake part): the GPS, radio, battery and, for a motion-sensor
// variant, motion results. A pass moves an IN_INTAKE unit, or a MAINTENANCE unit whose record is
// closed, to AVAILABLE and sets the first `serviceDueAt`; a failure keeps or moves it to MAINTENANCE
// with an INTAKE_FAILED record (REQ-EVT-02, REQ-EVT-18). Registration joins with the rest of 2.2.
@Injectable()
export class IntakeService {
  constructor(
    private readonly devices: DevicesRepository,
    private readonly maintenance: MaintenanceService,
  ) {}

  async record(
    deviceId: string,
    dto: IntakeCheckDto,
    actorId: string,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<{ check: { id: string; passed: boolean; createdAt: Date }; device: DeviceView }> {
    const device = await this.devices.findDetail(deviceId, tx);
    if (!device) {
      throw new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Device not found.');
    }
    if (!INTAKE_FROM.includes(device.status)) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE_TRANSITION,
        `This cannot be done while it is ${device.status}.`,
      );
    }
    if (await this.maintenance.hasOpenRecord(deviceId, tx)) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.MAINTENANCE_OPEN,
        'Close the maintenance record first.',
      );
    }
    if (device.version !== dto.expectedVersion) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.STALE_VERSION,
        'This was changed by someone else. Reload and try again.',
      );
    }
    const hasMotion = device.hardwareVariant.hasMotionSensor;
    if (hasMotion && dto.motionOk === undefined) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.MOTION_RESULT_REQUIRED,
        'Record the motion sensor result.',
      );
    }
    const motionOk = hasMotion ? (dto.motionOk ?? null) : null;
    const passed = dto.gpsFixOk && dto.radioOk && dto.batteryOk && motionOk !== false;

    const check = await this.devices.insertIntakeCheck(
      {
        deviceId,
        gpsFixOk: dto.gpsFixOk,
        radioOk: dto.radioOk,
        batteryOk: dto.batteryOk,
        motionOk,
        passed,
        note: dto.note?.trim() || null,
        checkedById: actorId,
        createdAt: at,
      },
      tx,
    );

    const interval = device.hardwareVariant.serviceIntervalDays;
    const firstService =
      passed && device.serviceDueAt === null && interval
        ? { serviceDueAt: addDays(businessDay(at), interval) }
        : {};
    const next = passed ? DeviceStatus.AVAILABLE : DeviceStatus.MAINTENANCE;
    const moved = await this.devices.moveIfCurrent(
      deviceId,
      dto.expectedVersion,
      INTAKE_FROM,
      next,
      at,
      tx,
      firstService,
    );
    if (!moved) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.STALE_VERSION,
        'This was changed by someone else. Reload and try again.',
      );
    }
    if (device.status !== next) {
      await this.devices.insertTransition(
        {
          deviceId,
          fromStatus: device.status,
          toStatus: next,
          actorId,
          reason: passed ? 'INTAKE_PASSED' : 'INTAKE_FAILED',
          refType: 'INTAKE_CHECK',
          refId: check.id,
          createdAt: at,
        },
        tx,
      );
    }
    if (!passed) {
      const failed = [
        !dto.gpsFixOk && 'GPS fix',
        !dto.radioOk && 'radio',
        !dto.batteryOk && 'battery',
        motionOk === false && 'motion sensor',
      ].filter(Boolean);
      await this.maintenance.openForSystem(
        {
          deviceId,
          reason: 'INTAKE_FAILED',
          description: `Intake check failed: ${failed.join(', ')}.`,
          expectedAt: businessDay(at),
        },
        actorId,
        at,
        tx,
      );
    }
    const after = await this.devices.findDetail(deviceId, tx);
    return { check, device: toDeviceView(after ?? device) };
  }
}
