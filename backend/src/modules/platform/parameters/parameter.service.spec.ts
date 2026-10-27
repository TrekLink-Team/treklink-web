import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../../common/errors';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ValidatedEnvironment } from '../config/environment-variables';
import { TransactionalEvents } from '../events/emit-after-commit';
import { assertValueFits, ParameterService } from './parameter.service';
import { ParameterRepository, ParameterRow } from './parameter.repository';

const row = (overrides: Partial<ParameterRow> = {}): ParameterRow => ({
  key: 'incidents.primaryAckTimeoutSeconds',
  value: 120,
  valueType: 'DURATION_SECONDS',
  bounds: { min: 30, max: 900 },
  unit: 'seconds',
  ownerModule: 'incidents',
  description: 'How long the primary on-duty member has to acknowledge',
  version: 3,
  updatedAt: new Date('2026-10-20T03:15:00.000Z'),
  ...overrides,
});

const actor = { id: 'admin-1', roles: ['TREKLINK_ADMIN'] };
const KEY = 'incidents.primaryAckTimeoutSeconds';

describe('ParameterService', () => {
  let stored: ParameterRow;
  let repository: {
    findByKey: jest.Mock;
    lockAndFind: jest.Mock;
    updateValue: jest.Mock;
    appendHistory: jest.Mock;
  };
  let emitter: EventEmitter2;
  let emitted: jest.SpyInstance;
  let service: ParameterService;
  const tx = {} as Prisma.TransactionClient;

  beforeEach(() => {
    stored = row();
    repository = {
      findByKey: jest.fn(() => Promise.resolve({ ...stored })),
      lockAndFind: jest.fn(() => Promise.resolve({ ...stored })),
      updateValue: jest.fn((key: string, value: unknown, version: number) => {
        stored = { ...stored, value: value as Prisma.JsonValue, version };
        return Promise.resolve({ ...stored });
      }),
      appendHistory: jest.fn(() => Promise.resolve()),
    };
    const prisma = {
      $transaction: jest.fn((work: (client: Prisma.TransactionClient) => Promise<unknown>) =>
        work(tx),
      ),
    } as unknown as PrismaService;
    emitter = new EventEmitter2();
    emitted = jest.spyOn(emitter, 'emit');
    const config = { get: () => 30 } as unknown as ConfigService<ValidatedEnvironment, true>;
    service = new ParameterService(
      repository as unknown as ParameterRepository,
      new TransactionalEvents(prisma, emitter),
      config,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('get', () => {
    it('serves a second read from the cache within the TTL', async () => {
      await expect(service.get(KEY)).resolves.toBe(120);
      await expect(service.get(KEY)).resolves.toBe(120);

      expect(repository.findByKey).toHaveBeenCalledTimes(1);
    });

    it('reads again once the TTL has passed', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      await service.get(KEY);
      now.mockReturnValue(1_000_000 + 30_001);
      stored = row({ value: 60 });

      await expect(service.get(KEY)).resolves.toBe(60);
      expect(repository.findByKey).toHaveBeenCalledTimes(2);
    });

    it('reuses the first value read inside a transaction (REQ-STA-02)', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      await expect(service.get(KEY, tx)).resolves.toBe(120);
      now.mockReturnValue(1_000_000 + 60_000);
      stored = row({ value: 60 });

      await expect(service.get(KEY, tx)).resolves.toBe(120);
      await expect(service.get(KEY)).resolves.toBe(60);
    });

    it('reads a cache miss through the transaction it was given', async () => {
      await expect(service.get(KEY, tx)).resolves.toBe(120);
      expect(repository.findByKey).toHaveBeenCalledWith(KEY, tx);
    });

    it('fails loudly for a registry key that has no seeded row', async () => {
      repository.findByKey.mockResolvedValueOnce(null);

      await expect(service.get(KEY)).rejects.toThrow(`Business parameter ${KEY} is not seeded`);
    });
  });

  describe('update (REQ-EVT-03)', () => {
    it('stores the value, appends history, invalidates the cache and emits after commit', async () => {
      await service.get(KEY);

      const updated = await service.update(
        KEY,
        { value: 60, expectedVersion: 3, reason: 'Faster escalation for the drill' },
        actor,
      );

      expect(updated).toMatchObject({ key: KEY, value: 60, version: 4 });
      expect(repository.updateValue).toHaveBeenCalledWith(KEY, 60, 4, 'admin-1', tx);
      expect(repository.appendHistory).toHaveBeenCalledWith(
        {
          key: KEY,
          previousValue: 120,
          newValue: 60,
          changedById: 'admin-1',
          reason: 'Faster escalation for the drill',
        },
        tx,
      );
      expect(emitted).toHaveBeenCalledWith('parameter.changed', { key: KEY, version: 4 });
      expect(emitted).toHaveBeenCalledWith(
        'audit.record',
        expect.objectContaining({
          actorId: 'admin-1',
          organizationId: null,
          action: 'parameter.update',
          subjectType: 'BusinessParameter',
          subjectId: KEY,
          before: { value: 120, version: 3 },
          after: { value: 60, version: 4, reason: 'Faster escalation for the drill' },
        }),
      );
      await expect(service.get(KEY)).resolves.toBe(60);
    });

    const rejects = async (change: Parameters<ParameterService['update']>[1]) => {
      const error = await service.update(KEY, change, actor).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DomainException);
      return error as DomainException;
    };

    it('rejects a value outside the bounds and leaves the stored value (REQ-ERR-05)', async () => {
      const error = await rejects({ value: 5, expectedVersion: 3 });

      expect(error.errorCode).toBe(ErrorCode.PARAMETER_OUT_OF_RANGE);
      expect(error.message).toBe('value must be between 30 and 900.');
      expect(repository.updateValue).not.toHaveBeenCalled();
      expect(repository.appendHistory).not.toHaveBeenCalled();
      expect(emitted).not.toHaveBeenCalled();
    });

    it('rejects a stale version with 409 STALE_VERSION', async () => {
      const error = await rejects({ value: 60, expectedVersion: 2 });

      expect(error.httpStatus).toBe(409);
      expect(error.errorCode).toBe(ErrorCode.STALE_VERSION);
      expect(repository.updateValue).not.toHaveBeenCalled();
      expect(emitted).not.toHaveBeenCalled();
    });

    it('answers an unknown key with 404 NOT_FOUND', async () => {
      repository.lockAndFind.mockResolvedValueOnce(null);

      const error = await rejects({ value: 60, expectedVersion: 3 });

      expect(error.errorCode).toBe(ErrorCode.NOT_FOUND);
      expect(error.message).toBe('Parameter not found.');
    });
  });
});

describe('assertValueFits', () => {
  const fits =
    (valueType: ParameterRow['valueType'], value: unknown, bounds: unknown = null) =>
    () =>
      assertValueFits({ valueType, bounds: bounds as Prisma.JsonValue }, value);

  it.each([
    ['INT', 8, { min: 8, max: 64 }],
    ['DECIMAL', 1.5, { min: 1, max: 5 }],
    ['PERCENT', 0, { min: 0, max: 100 }],
    ['DURATION_SECONDS', 900, { min: 30, max: 900 }],
    ['BOOL', false, null],
    ['JSON', [3, 4, 7], null],
    ['JSON', 'openstreetmap', null],
  ] as const)('accepts a %s value %p', (type, value, bounds) => {
    expect(fits(type, value, bounds)).not.toThrow();
  });

  it.each([
    ['INT', 7.5, null, 'value must be a whole number.'],
    ['DURATION_SECONDS', '60', null, 'value must be a number.'],
    ['DECIMAL', Number.NaN, null, 'value must be a number.'],
    ['INT', 65, { min: 8, max: 64 }, 'value must be between 8 and 64.'],
    ['INT', 0, { min: 1 }, 'value must be at least 1.'],
    ['BOOL', 'true', null, 'value must be true or false.'],
    ['JSON', null, null, 'value must be a JSON value.'],
  ] as const)('rejects a %s value %p', (type, value, bounds, message) => {
    expect(fits(type, value, bounds)).toThrow(message);
  });
});
