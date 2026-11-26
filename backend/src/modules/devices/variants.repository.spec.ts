import { PrismaService } from '../../common/prisma/prisma.service';
import { VARIANT_SELECT } from './devices.repository';
import { VariantsRepository, VariantWrite } from './variants.repository';

// devices task 2.1, design section 11: the Prisma calls behind the Admin hardware variant catalog.
// The catalog rules are in devices.variants.spec.ts; this file asserts the device count flattening,
// the case-insensitive code lookup and the compare-and-set on version (REQ-ERR-19).

const WITH_COUNT = { ...VARIANT_SELECT, _count: { select: { devices: true } } };

const stored = (devices: number, extra: Record<string, unknown> = {}) => ({
  id: 'v-1',
  code: 'T-BEAM-S3',
  name: 'T-Beam Supreme',
  version: 3,
  _count: { devices },
  ...extra,
});

const aClient = () => ({
  hardwareVariant: {
    findUnique: jest.fn().mockResolvedValue(stored(4)),
    findFirst: jest.fn().mockResolvedValue({ id: 'v-1' }),
    create: jest.fn().mockResolvedValue(stored(0)),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    delete: jest.fn().mockResolvedValue({ id: 'v-1' }),
  },
});

describe('VariantsRepository', () => {
  let prisma: ReturnType<typeof aClient>;
  let tx: ReturnType<typeof aClient>;
  let repository: VariantsRepository;

  beforeEach(() => {
    prisma = aClient();
    tx = aClient();
    repository = new VariantsRepository(prisma as unknown as PrismaService);
  });

  describe('find', () => {
    it('reads the variant with its device count, flattened into deviceCount', async () => {
      await expect(repository.find('v-1')).resolves.toEqual({
        id: 'v-1',
        code: 'T-BEAM-S3',
        name: 'T-Beam Supreme',
        version: 3,
        deviceCount: 4,
      });
      expect(prisma.hardwareVariant.findUnique).toHaveBeenCalledWith({
        where: { id: 'v-1' },
        select: WITH_COUNT,
      });
    });

    it('drops the raw _count from the result', async () => {
      const variant = await repository.find('v-1');
      expect(variant).not.toHaveProperty('_count');
    });

    it('returns null for an unknown variant', async () => {
      prisma.hardwareVariant.findUnique.mockResolvedValue(null);
      await expect(repository.find('v-9')).resolves.toBeNull();
    });

    it('reads through the transaction client when one is given', async () => {
      await repository.find('v-1', tx as never);
      expect(tx.hardwareVariant.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.hardwareVariant.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('findCode', () => {
    it('matches the code without regard to case and reads the id only', async () => {
      await expect(repository.findCode('t-beam-s3')).resolves.toEqual({ id: 'v-1' });
      expect(prisma.hardwareVariant.findFirst).toHaveBeenCalledWith({
        where: { code: { equals: 't-beam-s3', mode: 'insensitive' } },
        select: { id: true },
      });
    });

    it('returns null when no variant has the code', async () => {
      prisma.hardwareVariant.findFirst.mockResolvedValue(null);
      await expect(repository.findCode('NOPE')).resolves.toBeNull();
    });
  });

  describe('insert', () => {
    it('creates through the transaction and returns the new variant with a zero device count', async () => {
      const data = { code: 'T-BEAM-S3', name: 'T-Beam Supreme' } as VariantWrite;
      await expect(repository.insert(data, tx as never)).resolves.toMatchObject({
        id: 'v-1',
        deviceCount: 0,
      });
      expect(tx.hardwareVariant.create).toHaveBeenCalledWith({ data, select: WITH_COUNT });
      expect(prisma.hardwareVariant.create).not.toHaveBeenCalled();
    });
  });

  describe('compareAndSet (REQ-ERR-19)', () => {
    it('writes only while the version is the expected one, and bumps it', async () => {
      await expect(
        repository.compareAndSet('v-1', 3, { name: 'T-Beam Supreme v2' }, tx as never),
      ).resolves.toBe(true);
      expect(tx.hardwareVariant.updateMany).toHaveBeenCalledWith({
        where: { id: 'v-1', version: 3 },
        data: { name: 'T-Beam Supreme v2', version: { increment: 1 } },
      });
    });

    it('reports false when another edit won', async () => {
      tx.hardwareVariant.updateMany.mockResolvedValue({ count: 0 });
      await expect(repository.compareAndSet('v-1', 3, {}, tx as never)).resolves.toBe(false);
    });
  });

  describe('delete', () => {
    it('deletes the variant by id through the transaction and returns nothing', async () => {
      await expect(repository.delete('v-1', tx as never)).resolves.toBeUndefined();
      expect(tx.hardwareVariant.delete).toHaveBeenCalledWith({ where: { id: 'v-1' } });
      expect(prisma.hardwareVariant.delete).not.toHaveBeenCalled();
    });
  });
});
