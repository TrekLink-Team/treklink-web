import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { CreateVariantDto, UpdateVariantDto } from './dto/variant.dto';
import { checkImageUrl, checkSchedule, checkServicePlan, checkSpecSheet } from './variant-rules';
import { VariantWithCount, VariantsRepository } from './variants.repository';

const SENSOR_FLAGS = ['hasGps', 'hasMotionSensor', 'mqttCapable'] as const;

const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Hardware variant not found.');

const stale = () =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.STALE_VERSION,
    'This was changed by someone else. Reload and try again.',
  );

const inUse = (message: string) =>
  new DomainException(HttpStatus.CONFLICT, ErrorCode.VARIANT_IN_USE, message);

const isPrismaError = (error: unknown, code: string) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;

// The fields an audit entry compares; deviceCount and version are not edits.
const AUDITED = [
  'name',
  'hasGps',
  'hasMotionSensor',
  'mqttCapable',
  'firmwareBaseline',
  'remainingValueSchedule',
  'serviceIntervalDays',
  'serviceChecklist',
  'imageUrl',
  'specSheet',
  'isActive',
] as const;

const snapshot = (variant: VariantWithCount, keys: readonly (typeof AUDITED)[number][]) =>
  Object.fromEntries(keys.map((key) => [key, variant[key]]));

// Hardware variants with their service plans (devices task 2.1, api-design 02 to 04, design section 11).
// TrekLink Admin only (`hardwareVariant.manage`). Every write is audited after commit.
@Injectable()
export class VariantsService {
  constructor(
    private readonly variants: VariantsRepository,
    private readonly events: TransactionalEvents,
  ) {}

  async create(dto: CreateVariantDto, caller: Caller): Promise<VariantWithCount> {
    const remainingValueSchedule = checkSchedule(dto.remainingValueSchedule);
    const serviceIntervalDays = dto.serviceIntervalDays ?? null;
    const serviceChecklist = dto.serviceChecklist ?? [];
    checkServicePlan(serviceIntervalDays, serviceChecklist);
    const imageUrl = checkImageUrl(dto.imageUrl);
    const specSheet = checkSpecSheet(dto.specSheet);
    const taken = () =>
      new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT_UNIQUE,
        `${dto.code} is already registered.`,
      );

    try {
      return await this.events.transaction(async (tx) => {
        if (await this.variants.findCode(dto.code, tx)) throw taken();
        const variant = await this.variants.insert(
          {
            code: dto.code,
            name: dto.name,
            hasGps: dto.hasGps,
            hasMotionSensor: dto.hasMotionSensor,
            mqttCapable: dto.mqttCapable,
            firmwareBaseline: dto.firmwareBaseline,
            remainingValueSchedule: remainingValueSchedule as unknown as Prisma.InputJsonValue,
            serviceIntervalDays,
            serviceChecklist,
            imageUrl,
            specSheet,
          },
          tx,
        );
        this.audit(caller, 'hardwareVariant.create', variant.id, null, {
          code: variant.code,
          ...snapshot(variant, AUDITED),
        });
        return variant;
      });
    } catch (error) {
      // Two creates of one code racing: the unique index decides.
      if (isPrismaError(error, 'P2002')) throw taken();
      throw error;
    }
  }

  async update(id: string, dto: UpdateVariantDto, caller: Caller): Promise<VariantWithCount> {
    return this.events.transaction(async (tx) => {
      const current = await this.variants.find(id, tx);
      if (!current) throw notFound();
      if (current.version !== dto.expectedVersion) throw stale();

      const flagChanged = SENSOR_FLAGS.some(
        (flag) => dto[flag] !== undefined && dto[flag] !== current[flag],
      );
      if (flagChanged && current.deviceCount > 0) {
        throw inUse('Sensor flags cannot change once devices are registered.');
      }

      const data: Prisma.HardwareVariantUncheckedUpdateManyInput = {};
      if (dto.name !== undefined) data.name = dto.name;
      for (const flag of SENSOR_FLAGS) if (dto[flag] !== undefined) data[flag] = dto[flag];
      if (dto.firmwareBaseline !== undefined) data.firmwareBaseline = dto.firmwareBaseline;
      if (dto.isActive !== undefined) data.isActive = dto.isActive;
      if (dto.remainingValueSchedule !== undefined) {
        data.remainingValueSchedule = checkSchedule(
          dto.remainingValueSchedule,
        ) as unknown as Prisma.InputJsonValue;
      }
      const intervalDays =
        dto.serviceIntervalDays !== undefined
          ? dto.serviceIntervalDays
          : current.serviceIntervalDays;
      const checklist = dto.serviceChecklist ?? current.serviceChecklist;
      checkServicePlan(intervalDays, checklist);
      if (dto.serviceIntervalDays !== undefined) data.serviceIntervalDays = dto.serviceIntervalDays;
      if (dto.serviceChecklist !== undefined) data.serviceChecklist = dto.serviceChecklist;
      if (dto.imageUrl !== undefined) data.imageUrl = checkImageUrl(dto.imageUrl);
      if (dto.specSheet !== undefined) data.specSheet = checkSpecSheet(dto.specSheet);

      if (!(await this.variants.compareAndSet(id, dto.expectedVersion, data, tx))) throw stale();
      const updated = await this.variants.find(id, tx);
      if (!updated) throw notFound();

      const changed = AUDITED.filter((key) => key in data);
      this.audit(
        caller,
        'hardwareVariant.update',
        id,
        { ...snapshot(current, changed), version: current.version },
        { ...snapshot(updated, changed), version: updated.version },
      );
      return updated;
    });
  }

  async remove(id: string, caller: Caller): Promise<void> {
    let code = '';
    try {
      await this.events.transaction(async (tx) => {
        const current = await this.variants.find(id, tx);
        if (!current) throw notFound();
        code = current.code;
        if (current.deviceCount > 0) {
          throw inUse(`${current.code} has registered devices. Deactivate it instead.`);
        }
        await this.variants.delete(id, tx);
        this.audit(caller, 'hardwareVariant.delete', id, snapshot(current, AUDITED), null);
      });
    } catch (error) {
      // A contract, price schedule or damage rate still names the variant (design section 11): the
      // foreign key refuses the delete, so devices never reads those modules' tables.
      if (isPrismaError(error, 'P2003')) {
        throw inUse(`${code} has registered devices or prices. Deactivate it instead.`);
      }
      throw error;
    }
  }

  private audit(
    caller: Caller,
    action: string,
    subjectId: string,
    before: unknown,
    after: unknown,
  ): void {
    this.events.emitAfterCommit(AUDIT_RECORD, {
      actorId: caller.id,
      actorRoles: [...caller.roles],
      organizationId: null,
      action,
      subjectType: 'HardwareVariant',
      subjectId,
      before,
      after,
    } satisfies AuditRecordEvent);
  }
}
