import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DeviceStatus, Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { addDays, businessDay, DeviceView, parseDay, toDeviceView } from './device-view';
import { DevicesRepository } from './devices.repository';
import { notCheckedIn } from './devices.service';
import { IntakeCheckDto } from './dto/intake-check.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { MaintenanceService } from './maintenance.service';
import { fromNodeId, isNodeNum, toNodeId } from './node-id';
import { CUSTODY_RESOLVER, CustodyResolver } from './ports/custody-resolver.port';

const INTAKE_FROM: readonly DeviceStatus[] = [DeviceStatus.IN_INTAKE, DeviceStatus.MAINTENANCE];

const invalid = (message: string) =>
  new DomainException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, message);

// The radio identity of a registration: an unsigned 32-bit number, or a node id such as `!a4b1c2d3`.
const nodeNumOf = (value: number | string): bigint => {
  try {
    const nodeNum =
      typeof value === 'number'
        ? Number.isSafeInteger(value)
          ? BigInt(value)
          : -1n
        : /^\d+$/.test(value.trim())
          ? BigInt(value.trim())
          : fromNodeId(value.trim());
    if (isNodeNum(nodeNum)) return nodeNum;
  } catch {
    // falls through to the validation error
  }
  throw invalid('nodeNum must be an unsigned 32-bit number or a node id such as !a4b1c2d3.');
};

// devices api-design 09 (task 2.2, intake part): the GPS, radio, battery and, for a motion-sensor
// variant, motion results. A pass moves an IN_INTAKE unit, or a MAINTENANCE unit whose record is
// closed, to AVAILABLE and sets the first `serviceDueAt`; a failure keeps or moves it to MAINTENANCE
// with an INTAKE_FAILED record (REQ-EVT-02, REQ-EVT-18). Registration (api-design 05) creates the unit
// IN_INTAKE; the node number is typed by Staff until Web Serial docking (D-080) reads it.
@Injectable()
export class IntakeService {
  constructor(
    private readonly devices: DevicesRepository,
    private readonly maintenance: MaintenanceService,
    @Inject(CUSTODY_RESOLVER) private readonly custody: CustodyResolver,
  ) {}

  // devices api-design 05 (task 2.2, FR-DEV-02, BR-10): the asset tag and node number are unique across
  // every device ever registered (409 CONFLICT_UNIQUE, MSG10); the variant must be active and the
  // acquisition date not in the future. One registration transition is written.
  async register(
    dto: RegisterDeviceDto,
    actorId: string,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<DeviceView> {
    const assetTag = dto.assetTag.trim();
    if (!assetTag) throw invalid('assetTag is required.');
    const nodeNum = nodeNumOf(dto.nodeNum);
    const acquiredAt = parseDay(dto.acquiredAt);
    if (Number.isNaN(acquiredAt.getTime()) || acquiredAt > businessDay(at)) {
      throw invalid('acquiredAt cannot be in the future.');
    }
    const variant = await this.devices.findVariant(dto.hardwareVariantId, tx);
    if (!variant?.isActive) throw invalid('hardwareVariantId is not an active hardware variant.');

    const taken = await this.devices.findRegistered(assetTag, nodeNum, tx);
    if (taken) {
      const name = taken.nodeNum === nodeNum ? toNodeId(nodeNum) : assetTag;
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT_UNIQUE,
        `${name} is already registered.`,
      );
    }
    const row = await this.devices.insertDevice(
      {
        assetTag,
        nodeNum,
        hardwareVariantId: variant.id,
        firmwareVersion: dto.firmwareVersion.trim(),
        acquiredAt,
        registeredById: actorId,
        statusChangedAt: at,
      },
      tx,
    );
    await this.devices.insertTransition(
      {
        deviceId: row.id,
        fromStatus: null,
        toStatus: DeviceStatus.IN_INTAKE,
        actorId,
        reason: 'REGISTERED',
        createdAt: at,
      },
      tx,
    );
    return toDeviceView(row);
  }

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
        'Finish the open maintenance record first.',
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
    // A pass makes the unit AVAILABLE: refused while its contract row is open (design §2.1).
    if (passed && (await this.custody.custodyAt(deviceId, at, tx))) throw notCheckedIn();

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
