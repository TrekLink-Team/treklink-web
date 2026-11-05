import { Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { CreateVariantDto, UpdateVariantDto } from './dto/variant.dto';
import { VariantWithCount, VariantsRepository } from './variants.repository';
import { VariantsService } from './variants.service';

const ADMIN = { id: 'admin-1', roles: ['ADMIN'], organizationId: null };
const SCHEDULE = [
  { fromMonths: 0, valueVnd: 2500000 },
  { fromMonths: 12, valueVnd: 1800000 },
];

const variant = (over: Partial<VariantWithCount> = {}): VariantWithCount => ({
  id: 'v-5',
  code: 'treklink-v5',
  name: 'TrekLink v5',
  hasGps: true,
  hasMotionSensor: false,
  mqttCapable: true,
  firmwareBaseline: '2.7.19-treklink.5',
  remainingValueSchedule: SCHEDULE,
  serviceIntervalDays: 180,
  serviceChecklist: ['Battery health'],
  imageUrl: null,
  specSheet: {},
  isActive: true,
  version: 2,
  deviceCount: 0,
  ...over,
});

const createDto = (over: Partial<CreateVariantDto> = {}): CreateVariantDto => ({
  code: 'treklink-v5',
  name: 'TrekLink v5',
  hasGps: true,
  hasMotionSensor: false,
  mqttCapable: true,
  firmwareBaseline: '2.7.19-treklink.5',
  remainingValueSchedule: SCHEDULE,
  serviceIntervalDays: 180,
  serviceChecklist: ['Battery health'],
  ...over,
});

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('failed', { code, clientVersion: 'test' });

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainException) return error.errorCode;
    throw error;
  }
  return 'no error';
};

describe('VariantsService (devices task 2.1, api-design 02 to 04)', () => {
  let repo: {
    find: jest.Mock;
    findCode: jest.Mock;
    insert: jest.Mock;
    compareAndSet: jest.Mock;
    delete: jest.Mock;
  };
  let events: { transaction: jest.Mock; emitAfterCommit: jest.Mock };
  let service: VariantsService;

  beforeEach(() => {
    repo = {
      find: jest.fn().mockResolvedValue(variant()),
      findCode: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockResolvedValue(variant({ version: 0 })),
      compareAndSet: jest.fn().mockResolvedValue(true),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    events = {
      transaction: jest.fn((work: (tx: object) => unknown) => work({})),
      emitAfterCommit: jest.fn(),
    };
    service = new VariantsService(
      repo as unknown as VariantsRepository,
      events as unknown as TransactionalEvents,
    );
  });

  describe('create', () => {
    it('inserts the variant with the checked values and audits it after commit', async () => {
      await expect(
        service.create(
          createDto({
            imageUrl: '/variants/treklink-v5-detail.png',
            specSheet: { mcu: ' ESP32 ' },
          }),
          ADMIN,
        ),
      ).resolves.toMatchObject({ code: 'treklink-v5', version: 0 });
      expect(repo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'treklink-v5',
          imageUrl: '/variants/treklink-v5-detail.png',
          specSheet: { mcu: 'ESP32' },
          remainingValueSchedule: SCHEDULE,
        }),
        {},
      );
      expect(events.emitAfterCommit).toHaveBeenCalledWith(
        AUDIT_RECORD,
        expect.objectContaining({
          action: 'hardwareVariant.create',
          subjectType: 'HardwareVariant',
          subjectId: 'v-5',
          actorId: 'admin-1',
          before: null,
        }),
      );
    });

    it('refuses a code already registered, ignoring case, with 409 CONFLICT_UNIQUE', async () => {
      repo.findCode.mockResolvedValue({ id: 'v-old' });
      expect(await codeOf(service.create(createDto(), ADMIN))).toBe(ErrorCode.CONFLICT_UNIQUE);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('maps a unique violation from a racing create to CONFLICT_UNIQUE', async () => {
      repo.insert.mockRejectedValue(prismaError('P2002'));
      expect(await codeOf(service.create(createDto(), ADMIN))).toBe(ErrorCode.CONFLICT_UNIQUE);
    });

    it('checks the schedule, the service plan and the media before any write', async () => {
      expect(
        await codeOf(
          service.create(
            createDto({ remainingValueSchedule: [{ fromMonths: 3, valueVnd: 1 }] }),
            ADMIN,
          ),
        ),
      ).toBe(ErrorCode.SCHEDULE_INVALID);
      expect(await codeOf(service.create(createDto({ serviceChecklist: [] }), ADMIN))).toBe(
        ErrorCode.CHECKLIST_REQUIRED,
      );
      expect(await codeOf(service.create(createDto({ imageUrl: 'http://a/b.png' }), ADMIN))).toBe(
        ErrorCode.VARIANT_MEDIA_INVALID,
      );
      expect(events.transaction).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const patch = (over: Partial<UpdateVariantDto>): UpdateVariantDto => ({
      expectedVersion: 2,
      ...over,
    });

    it('compares and sets on the version and audits the changed fields only', async () => {
      repo.find
        .mockResolvedValueOnce(variant())
        .mockResolvedValueOnce(variant({ name: 'TrekLink v5 rev B', version: 3 }));
      await expect(
        service.update('v-5', patch({ name: 'TrekLink v5 rev B' }), ADMIN),
      ).resolves.toMatchObject({ name: 'TrekLink v5 rev B', version: 3 });
      expect(repo.compareAndSet).toHaveBeenCalledWith('v-5', 2, { name: 'TrekLink v5 rev B' }, {});
      expect(events.emitAfterCommit).toHaveBeenCalledWith(
        AUDIT_RECORD,
        expect.objectContaining({
          action: 'hardwareVariant.update',
          before: { name: 'TrekLink v5', version: 2 },
          after: { name: 'TrekLink v5 rev B', version: 3 },
        }),
      );
    });

    it('answers 404 for an unknown variant', async () => {
      repo.find.mockResolvedValue(null);
      expect(await codeOf(service.update('v-x', patch({ name: 'x' }), ADMIN))).toBe(
        ErrorCode.NOT_FOUND,
      );
    });

    it('answers 409 STALE_VERSION when the version read differs or the write loses the race (AC-22)', async () => {
      expect(
        await codeOf(service.update('v-5', patch({ expectedVersion: 1, name: 'x' }), ADMIN)),
      ).toBe(ErrorCode.STALE_VERSION);
      repo.compareAndSet.mockResolvedValue(false);
      expect(await codeOf(service.update('v-5', patch({ name: 'x' }), ADMIN))).toBe(
        ErrorCode.STALE_VERSION,
      );
      expect(events.emitAfterCommit).not.toHaveBeenCalled();
    });

    it('refuses a sensor flag change while units are registered (REQ-STA-02)', async () => {
      repo.find.mockResolvedValue(variant({ deviceCount: 4 }));
      expect(await codeOf(service.update('v-5', patch({ hasGps: false }), ADMIN))).toBe(
        ErrorCode.VARIANT_IN_USE,
      );
      // The same value is not a change, so a full form save still works.
      repo.find.mockResolvedValue(variant({ deviceCount: 4 }));
      expect(
        await codeOf(service.update('v-5', patch({ hasGps: true, isActive: false }), ADMIN)),
      ).toBe('no error');
    });

    it('lets a variant without units change its sensor flags', async () => {
      await service.update('v-5', patch({ hasMotionSensor: true }), ADMIN);
      expect(repo.compareAndSet).toHaveBeenCalledWith('v-5', 2, { hasMotionSensor: true }, {});
    });

    it('checks the service plan against the stored checklist when only the interval changes', async () => {
      repo.find.mockResolvedValue(variant({ serviceIntervalDays: null, serviceChecklist: [] }));
      expect(await codeOf(service.update('v-5', patch({ serviceIntervalDays: 90 }), ADMIN))).toBe(
        ErrorCode.CHECKLIST_REQUIRED,
      );
      repo.find.mockResolvedValue(variant());
      await service.update('v-5', patch({ serviceIntervalDays: null }), ADMIN);
      expect(repo.compareAndSet).toHaveBeenLastCalledWith(
        'v-5',
        2,
        { serviceIntervalDays: null },
        {},
      );
    });

    it('clears the image link with null and refuses an invalid one', async () => {
      await service.update('v-5', patch({ imageUrl: null }), ADMIN);
      expect(repo.compareAndSet).toHaveBeenLastCalledWith('v-5', 2, { imageUrl: null }, {});
      expect(
        await codeOf(service.update('v-5', patch({ specSheet: { colour: 'red' } }), ADMIN)),
      ).toBe(ErrorCode.VARIANT_MEDIA_INVALID);
    });
  });

  describe('remove', () => {
    it('deletes an unused variant and audits it', async () => {
      await service.remove('v-5', ADMIN);
      expect(repo.delete).toHaveBeenCalledWith('v-5', {});
      expect(events.emitAfterCommit).toHaveBeenCalledWith(
        AUDIT_RECORD,
        expect.objectContaining({ action: 'hardwareVariant.delete', after: null }),
      );
    });

    it('refuses while units are registered (REQ-STA-02)', async () => {
      repo.find.mockResolvedValue(variant({ deviceCount: 1 }));
      expect(await codeOf(service.remove('v-5', ADMIN))).toBe(ErrorCode.VARIANT_IN_USE);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('answers VARIANT_IN_USE when another row still names the variant (foreign key)', async () => {
      repo.delete.mockRejectedValue(prismaError('P2003'));
      expect(await codeOf(service.remove('v-5', ADMIN))).toBe(ErrorCode.VARIANT_IN_USE);
    });

    it('answers 404 for an unknown variant', async () => {
      repo.find.mockResolvedValue(null);
      expect(await codeOf(service.remove('v-x', ADMIN))).toBe(ErrorCode.NOT_FOUND);
    });
  });
});
