import { HttpStatus, Injectable } from '@nestjs/common';
import { DeviceStatus, MaintenanceStatus, MaintenanceWorkBy, Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { ParameterService } from '../platform/parameters/parameter.service';
import {
  addDays,
  businessDay,
  DeviceView,
  parseDay,
  RecordView,
  toDeviceView,
  toRecordView,
} from './device-view';
import { DevicesRepository } from './devices.repository';
import {
  CompleteMaintenanceDto,
  DecideMaintenanceDto,
  EstimateMaintenanceDto,
  OpenMaintenanceDto,
} from './dto/maintenance.dto';
import {
  MaintenanceReason,
  MaintenanceRepository,
  RecordFilter,
  RecordRow,
} from './maintenance.repository';

const deviceNotFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Device not found.');
const recordNotFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Maintenance record not found.');
const wrongState = (status: string) =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.INVALID_STATE_TRANSITION,
    `This cannot be done while it is ${status}.`,
  );
const stale = () =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.STALE_VERSION,
    'This was changed by someone else. Reload and try again.',
  );
const maintenanceOpen = () =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.MAINTENANCE_OPEN,
    'Finish the open maintenance record first.',
  );
const required = (field: string) =>
  new DomainException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, `${field} is required.`);

const assertVendor = (workBy: MaintenanceWorkBy | undefined, vendorName: string | undefined) => {
  if (workBy === MaintenanceWorkBy.VENDOR && !vendorName?.trim()) {
    throw new DomainException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VENDOR_REQUIRED,
      'Name the vendor.',
    );
  }
};

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

// What the service-due rule reads of a unit (FR-DEV-19, design §2.2).
export interface ServiceFacts {
  serviceDueAt: Date | null;
  firmwareVersion: string;
  firmwareBaseline: string;
}

// Maintenance records and their cost approval (task 2.8, design §2.2, D-047). The weekly scan
// (`devices.serviceScan`) is not built yet; a passed inspection of a due unit and a failed intake or
// inspection open records through `openForSystem`.
@Injectable()
export class MaintenanceService {
  constructor(
    private readonly records: MaintenanceRepository,
    private readonly devices: DevicesRepository,
    private readonly parameters: ParameterService,
  ) {}

  // SCHEDULED when the unit's service falls due within `devices.maintenanceLeadDays` of `at`,
  // FIRMWARE_UPDATE when only its firmware differs from the variant's baseline, null otherwise
  // (REQ-EVT-07).
  async dueReason(
    unit: ServiceFacts,
    at: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<'SCHEDULED' | 'FIRMWARE_UPDATE' | null> {
    if (unit.serviceDueAt) {
      const leadDays = await this.parameters.get('devices.maintenanceLeadDays', tx);
      if (unit.serviceDueAt <= addDays(businessDay(at), leadDays)) return 'SCHEDULED';
    }
    return unit.firmwareVersion !== unit.firmwareBaseline ? 'FIRMWARE_UPDATE' : null;
  }

  // A record opened by a rule rather than by Staff on screen 4.3: a passed inspection of a due unit,
  // a failed inspection or a failed intake check. The caller has already moved the unit to
  // MAINTENANCE in the same transaction. `actorId` null is SYSTEM.
  openForSystem(
    input: { deviceId: string; reason: MaintenanceReason; description: string; expectedAt: Date },
    actorId: string | null,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<RecordRow> {
    return this.records.create(
      {
        deviceId: input.deviceId,
        reason: input.reason,
        status: MaintenanceStatus.OPEN,
        description: input.description,
        expectedAt: input.expectedAt,
        workBy: null,
        vendorName: null,
        estimatedCostVnd: null,
        estimatedById: null,
        openedById: actorId,
        openedAt: at,
      },
      tx,
    );
  }

  // devices api-design 11: an AVAILABLE unit goes to MAINTENANCE with a record; an estimate above
  // `devices.maintenanceApprovalThresholdVnd` leaves it PENDING_APPROVAL (FR-DEV-08, FR-DEV-20). A
  // RESERVED or RENTED unit is refused (REQ-STA-03).
  async open(
    deviceId: string,
    dto: OpenMaintenanceDto,
    actorId: string,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<{ record: RecordView; device: DeviceView }> {
    const device = await this.devices.findDetail(deviceId, tx);
    if (!device) throw deviceNotFound();
    if (await this.records.findOpen(deviceId, tx)) throw maintenanceOpen();
    if (device.status !== DeviceStatus.AVAILABLE) throw wrongState(device.status);
    if (device.version !== dto.expectedVersion) throw stale();
    assertVendor(dto.workBy, dto.vendorName);

    const aboveThreshold =
      dto.estimatedCostVnd !== undefined && dto.estimatedCostVnd > (await this.threshold(tx));
    const moved = await this.devices.moveIfCurrent(
      deviceId,
      dto.expectedVersion,
      [DeviceStatus.AVAILABLE],
      DeviceStatus.MAINTENANCE,
      at,
      tx,
    );
    if (!moved) throw stale();

    let record: RecordRow;
    try {
      record = await this.records.create(
        {
          deviceId,
          reason: dto.reason,
          status: aboveThreshold ? MaintenanceStatus.PENDING_APPROVAL : MaintenanceStatus.OPEN,
          description: dto.description.trim(),
          expectedAt: parseDay(dto.expectedAt),
          workBy: dto.workBy ?? null,
          vendorName: dto.vendorName?.trim() || null,
          estimatedCostVnd:
            dto.estimatedCostVnd !== undefined ? BigInt(dto.estimatedCostVnd) : null,
          estimatedById: dto.estimatedCostVnd !== undefined ? actorId : null,
          openedById: actorId,
          openedAt: at,
        },
        tx,
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw maintenanceOpen();
      throw error;
    }
    await this.devices.insertTransition(
      {
        deviceId,
        fromStatus: DeviceStatus.AVAILABLE,
        toStatus: DeviceStatus.MAINTENANCE,
        actorId,
        reason: 'MAINTENANCE_OPENED',
        refType: 'MAINTENANCE',
        refId: record.id,
        createdAt: at,
      },
      tx,
    );
    const after = await this.devices.findDetail(deviceId, tx);
    return { record: toRecordView(record), device: toDeviceView(after ?? device) };
  }

  // devices api-design 12: who does the work and what it is estimated to cost, on an OPEN record.
  // Above the threshold the record waits for an Admin (REQ-EVT-20). A new estimate replaces any
  // approved amount.
  async estimate(
    deviceId: string,
    recordId: string,
    dto: EstimateMaintenanceDto,
    actorId: string,
    tx: Prisma.TransactionClient,
  ): Promise<RecordView> {
    const record = await this.loadRecord(deviceId, recordId, tx);
    if (record.status !== MaintenanceStatus.OPEN) throw wrongState(record.status);
    if (record.version !== dto.expectedVersion) throw stale();
    assertVendor(dto.workBy, dto.vendorName);

    const aboveThreshold = dto.estimatedCostVnd > (await this.threshold(tx));
    await this.write(record, [MaintenanceStatus.OPEN], dto.expectedVersion, tx, {
      status: aboveThreshold ? MaintenanceStatus.PENDING_APPROVAL : MaintenanceStatus.OPEN,
      workBy: dto.workBy,
      vendorName: dto.workBy === MaintenanceWorkBy.VENDOR ? dto.vendorName!.trim() : null,
      estimatedCostVnd: BigInt(dto.estimatedCostVnd),
      estimatedById: actorId,
      approvedCostVnd: null,
      decision: null,
      decisionReason: null,
      decidedById: null,
      decidedAt: null,
    });
    return this.view(recordId, tx);
  }

  // devices api-design 13: an Admin who did not record the estimate approves an amount or rejects
  // it; either way the record returns to OPEN (REQ-EVT-21, REQ-ERR-08).
  async decide(
    deviceId: string,
    recordId: string,
    dto: DecideMaintenanceDto,
    actorId: string,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<RecordView> {
    const record = await this.loadRecord(deviceId, recordId, tx);
    if (record.status !== MaintenanceStatus.PENDING_APPROVAL) throw wrongState(record.status);
    if (record.estimatedById === actorId) {
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        ErrorCode.SEPARATION_OF_DUTY,
        'A different Admin must approve this cost.',
      );
    }
    if (record.version !== dto.expectedVersion) throw stale();
    const approved = dto.decision === 'APPROVED';
    if (approved && dto.approvedCostVnd === undefined) throw required('approvedCostVnd');
    if (!approved && !dto.reason?.trim()) throw required('reason');

    await this.write(record, [MaintenanceStatus.PENDING_APPROVAL], dto.expectedVersion, tx, {
      status: MaintenanceStatus.OPEN,
      decision: dto.decision,
      approvedCostVnd: approved ? BigInt(dto.approvedCostVnd!) : null,
      decisionReason: approved ? null : dto.reason!.trim(),
      decidedById: actorId,
      decidedAt: at,
    });
    return this.view(recordId, tx);
  }

  // devices api-design 14: completes an OPEN record or closes it UNREPAIRABLE. A cost above the
  // approved amount, or above the threshold when nothing was approved, sends it back to
  // PENDING_APPROVAL with the cost recorded (REQ-EVT-22). The unit stays MAINTENANCE until an intake
  // check passes (REQ-EVT-09); a completed SCHEDULED record moves `serviceDueAt` (REQ-EVT-18).
  async complete(
    deviceId: string,
    recordId: string,
    dto: CompleteMaintenanceDto,
    actorId: string,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<RecordView> {
    const record = await this.loadRecord(deviceId, recordId, tx);
    if (record.status !== MaintenanceStatus.OPEN) throw wrongState(record.status);
    if (record.version !== dto.expectedVersion) throw stale();

    const resolution = dto.resolution.trim();
    if (dto.status === MaintenanceStatus.UNREPAIRABLE) {
      await this.write(record, [MaintenanceStatus.OPEN], dto.expectedVersion, tx, {
        status: MaintenanceStatus.UNREPAIRABLE,
        resolution,
        actualCostVnd: dto.actualCostVnd !== undefined ? BigInt(dto.actualCostVnd) : null,
        closedById: actorId,
        closedAt: at,
      });
      return this.view(recordId, tx);
    }

    if (dto.actualCostVnd === undefined) throw required('actualCostVnd');
    const checklistResults = this.checklistResults(record, dto);
    if (record.reason === 'FIRMWARE_UPDATE' && !dto.firmwareVersion?.trim()) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.FIRMWARE_VERSION_REQUIRED,
        'Enter the firmware version now on the unit.',
      );
    }

    const firmwareVersion = dto.firmwareVersion?.trim() || null;
    const common = {
      resolution,
      actualCostVnd: BigInt(dto.actualCostVnd),
      warrantyUntil: dto.warrantyUntil ? parseDay(dto.warrantyUntil) : null,
      checklistResults: checklistResults ?? Prisma.DbNull,
      firmwareVersion,
    };
    const limit =
      record.approvedCostVnd !== null ? Number(record.approvedCostVnd) : await this.threshold(tx);
    if (dto.actualCostVnd > limit) {
      await this.write(record, [MaintenanceStatus.OPEN], dto.expectedVersion, tx, {
        ...common,
        status: MaintenanceStatus.PENDING_APPROVAL,
        estimatedById: actorId,
      });
      return this.view(recordId, tx);
    }

    await this.write(record, [MaintenanceStatus.OPEN], dto.expectedVersion, tx, {
      ...common,
      status: MaintenanceStatus.COMPLETED,
      closedById: actorId,
      closedAt: at,
    });
    const interval = record.device.hardwareVariant.serviceIntervalDays;
    await this.devices.updateService(
      deviceId,
      {
        ...(firmwareVersion ? { firmwareVersion } : {}),
        ...(record.reason === 'SCHEDULED' && interval
          ? { serviceDueAt: addDays(businessDay(at), interval) }
          : {}),
      },
      tx,
    );
    return this.view(recordId, tx);
  }

  // devices api-design 15.
  async page(filter: RecordFilter, skip: number, take: number): Promise<[RecordView[], number]> {
    const [rows, total] = await this.records.page(filter, skip, take);
    return [rows.map(toRecordView), total];
  }

  // The open record of a device for its detail (devices api-design 07), or null.
  async openRecordOf(deviceId: string): Promise<RecordView | null> {
    const row = await this.records.findOpen(deviceId);
    return row ? toRecordView(row) : null;
  }

  // The units among these with an open record, for their next step (REQ-EVT-23).
  openDeviceIds(deviceIds: readonly string[], tx?: Prisma.TransactionClient): Promise<Set<string>> {
    return this.records.openDeviceIds(deviceIds, tx);
  }

  hasOpenRecord(deviceId: string, tx?: Prisma.TransactionClient): Promise<boolean> {
    return this.records.findOpen(deviceId, tx).then((row) => row !== null);
  }

  // Every record of a device, for `trail()`.
  ofDevice(deviceId: string) {
    return this.records.ofDevice(deviceId);
  }

  // The cost above which an estimate or an actual cost waits for an Admin, read on every call so a
  // parameter change applies at once (D-015). Also shown to Staff beside the estimate (api-design 15).
  approvalThresholdVnd(tx?: Prisma.TransactionClient): Promise<number> {
    return this.parameters.get('devices.maintenanceApprovalThresholdVnd', tx);
  }

  private threshold(tx?: Prisma.TransactionClient): Promise<number> {
    return this.approvalThresholdVnd(tx);
  }

  // A SCHEDULED record needs a result for every item of the variant's checklist (REQ-ERR-09).
  private checklistResults(record: RecordRow, dto: CompleteMaintenanceDto) {
    const results = dto.checklistResults?.map((result) => ({
      item: result.item,
      passed: result.passed,
      ...(result.note?.trim() ? { note: result.note.trim() } : {}),
    }));
    if (record.reason !== 'SCHEDULED') return results;
    const answered = new Set(results?.map((result) => result.item));
    const missing = record.device.hardwareVariant.serviceChecklist.some(
      (item) => !answered.has(item),
    );
    if (missing) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.CHECKLIST_INCOMPLETE,
        'Record every checklist item.',
      );
    }
    return results;
  }

  private async loadRecord(
    deviceId: string,
    recordId: string,
    tx: Prisma.TransactionClient,
  ): Promise<RecordRow> {
    const record = await this.records.find(recordId, tx);
    if (!record || record.deviceId !== deviceId) throw recordNotFound();
    return record;
  }

  private async write(
    record: RecordRow,
    from: MaintenanceStatus[],
    version: number,
    tx: Prisma.TransactionClient,
    data: Prisma.MaintenanceRecordUncheckedUpdateManyInput,
  ): Promise<void> {
    if (!(await this.records.updateIfCurrent(record.id, version, from, data, tx))) throw stale();
  }

  private async view(recordId: string, tx: Prisma.TransactionClient): Promise<RecordView> {
    const row = await this.records.find(recordId, tx);
    if (!row) throw recordNotFound();
    return toRecordView(row);
  }
}
