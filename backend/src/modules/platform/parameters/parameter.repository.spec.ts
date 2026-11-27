import { PrismaService } from '../../../common/prisma/prisma.service';
import { HISTORY_SELECT, PARAMETER_SELECT, ParameterRepository } from './parameter.repository';

// platform design section 6, api-design 02 to 04: the Prisma calls behind the business parameters.
// The registry checks and the update flow are in parameter.service.spec.ts and
// parameter-reads.service.spec.ts, which mock this class; this file asserts the reads, the row lock
// and the writes of an update.

const KEY = 'incident.ack-timeout-seconds';
const paramRow = (extra: Record<string, unknown> = {}) => ({
  key: KEY,
  value: 120,
  version: 2,
  ...extra,
});

const aClient = () => ({
  $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  businessParameter: {
    findUnique: jest.fn().mockResolvedValue(paramRow()),
    update: jest.fn().mockResolvedValue(paramRow({ value: 90, version: 3 })),
    findMany: jest.fn().mockResolvedValue([paramRow()]),
    count: jest.fn().mockResolvedValue(12),
  },
  businessParameterHistory: {
    create: jest.fn().mockResolvedValue({ id: 'h-1' }),
    findMany: jest.fn().mockResolvedValue([{ newValue: 90 }]),
    count: jest.fn().mockResolvedValue(3),
  },
});

describe('ParameterRepository', () => {
  let prisma: ReturnType<typeof aClient>;
  let tx: ReturnType<typeof aClient>;
  let repository: ParameterRepository;

  beforeEach(() => {
    prisma = aClient();
    tx = aClient();
    repository = new ParameterRepository(prisma as unknown as PrismaService);
  });

  it('exposes the public shape of a parameter and of a history entry, and nothing more', () => {
    expect(Object.keys(PARAMETER_SELECT)).toEqual([
      'key',
      'value',
      'valueType',
      'bounds',
      'unit',
      'ownerModule',
      'description',
      'version',
      'updatedAt',
    ]);
    expect(PARAMETER_SELECT).not.toHaveProperty('updatedById');
    expect(Object.keys(HISTORY_SELECT)).toEqual([
      'previousValue',
      'newValue',
      'changedById',
      'reason',
      'changedAt',
    ]);
  });

  describe('findByKey', () => {
    it('reads one parameter by key with the public select', async () => {
      await expect(repository.findByKey(KEY)).resolves.toEqual(paramRow());
      expect(prisma.businessParameter.findUnique).toHaveBeenCalledWith({
        where: { key: KEY },
        select: PARAMETER_SELECT,
      });
    });

    it('returns null for an unknown key', async () => {
      prisma.businessParameter.findUnique.mockResolvedValue(null);
      await expect(repository.findByKey('no.such-key')).resolves.toBeNull();
    });
  });

  describe('lockAndFind (design section 6)', () => {
    it('locks the parameter row, then reads it through the same transaction', async () => {
      await expect(repository.lockAndFind(KEY, tx as never)).resolves.toEqual(paramRow());
      const [strings, key] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, string];
      expect(strings.join('?')).toBe(
        'SELECT 1 FROM "business_parameters" WHERE "key" = ? FOR UPDATE',
      );
      expect(key).toBe(KEY);
      expect(tx.businessParameter.findUnique).toHaveBeenCalledWith({
        where: { key: KEY },
        select: PARAMETER_SELECT,
      });
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.businessParameter.findUnique.mock.invocationCallOrder[0],
      );
      expect(prisma.businessParameter.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('updateValue', () => {
    it('writes the value, the version the service computed and the editor, through the transaction', async () => {
      await expect(repository.updateValue(KEY, 90, 3, 'admin-1', tx as never)).resolves.toEqual(
        paramRow({ value: 90, version: 3 }),
      );
      expect(tx.businessParameter.update).toHaveBeenCalledWith({
        where: { key: KEY },
        data: { value: 90, version: 3, updatedById: 'admin-1' },
        select: PARAMETER_SELECT,
      });
    });
  });

  describe('appendHistory', () => {
    it('appends one history entry through the transaction and returns nothing', async () => {
      const entry = {
        key: KEY,
        previousValue: 120,
        newValue: 90,
        changedById: 'admin-1',
        reason: null,
      };
      await expect(repository.appendHistory(entry, tx as never)).resolves.toBeUndefined();
      expect(tx.businessParameterHistory.create).toHaveBeenCalledWith({ data: entry });
      expect(prisma.businessParameterHistory.create).not.toHaveBeenCalled();
    });
  });

  describe('page (api-design 02)', () => {
    it('orders by owning module then key, and counts with the same filter', async () => {
      const where = { ownerModule: 'incidents' };
      await expect(repository.page(where, 20, 10)).resolves.toEqual([[paramRow()], 12]);
      expect(prisma.businessParameter.findMany).toHaveBeenCalledWith({
        where,
        select: PARAMETER_SELECT,
        orderBy: [{ ownerModule: 'asc' }, { key: 'asc' }],
        skip: 20,
        take: 10,
      });
      expect(prisma.businessParameter.count).toHaveBeenCalledWith({ where });
    });
  });

  describe('historyPage (api-design 04)', () => {
    it('reads one key newest first, the id breaking a tie, and counts that key only', async () => {
      await expect(repository.historyPage(KEY, 0, 5)).resolves.toEqual([[{ newValue: 90 }], 3]);
      expect(prisma.businessParameterHistory.findMany).toHaveBeenCalledWith({
        where: { key: KEY },
        select: HISTORY_SELECT,
        orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 5,
      });
      expect(prisma.businessParameterHistory.count).toHaveBeenCalledWith({ where: { key: KEY } });
    });
  });
});
