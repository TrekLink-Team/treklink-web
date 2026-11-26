import { LossCaseState } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  LOSS_CASE_SELECT,
  LOSS_CASE_SORT_FIELDS,
  LossCasesRepository,
} from './loss-cases.repository';

// devices task 2.7, design section 2.1, D-045: the Prisma calls behind the loss cases. The lifecycle
// decisions are in loss-cases.service.spec.ts; this file asserts the where clauses, the organization
// filter, the ordering, the compare-and-set on state and version, and the code sequence.

const AT = new Date('2026-11-20T03:00:00.000Z');
const lossRow = (extra: Record<string, unknown> = {}) => ({
  id: 'lc-1',
  code: 'LOSS-0007',
  state: LossCaseState.SEARCHING,
  version: 2,
  ...extra,
});

const aClient = () => ({
  $executeRaw: jest.fn().mockResolvedValue(1),
  $queryRaw: jest.fn().mockResolvedValue([{ max: 6 }]),
  lossCase: {
    findUnique: jest.fn().mockResolvedValue(lossRow()),
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    create: jest.fn().mockResolvedValue(lossRow()),
    count: jest.fn().mockResolvedValue(0),
  },
});

const sqlOf = (mock: jest.Mock, call = 0) =>
  (mock.mock.calls[call] as [TemplateStringsArray])[0].join('?').replace(/\s+/g, ' ').trim();

describe('LossCasesRepository', () => {
  let prisma: ReturnType<typeof aClient>;
  let tx: ReturnType<typeof aClient>;
  let repository: LossCasesRepository;

  beforeEach(() => {
    prisma = aClient();
    tx = aClient();
    repository = new LossCasesRepository(prisma as unknown as PrismaService);
  });

  it('selects the device asset tag with the case and sorts on four columns only', () => {
    expect(LOSS_CASE_SELECT.device).toEqual({ select: { id: true, assetTag: true } });
    expect(LOSS_CASE_SELECT.version).toBe(true);
    expect(LOSS_CASE_SORT_FIELDS).toEqual(['reportedAt', 'code', 'assetTag', 'state']);
  });

  describe('find', () => {
    it('reads one case by id, through the given client', async () => {
      await expect(repository.find('lc-1')).resolves.toEqual(lossRow());
      expect(prisma.lossCase.findUnique).toHaveBeenCalledWith({
        where: { id: 'lc-1' },
        select: LOSS_CASE_SELECT,
      });
      await repository.find('lc-1', tx as never);
      expect(tx.lossCase.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe('reads for other modules', () => {
    it('forContractDevices: the cases of the custody intervals, newest report first', async () => {
      const ids = ['cd-1', 'cd-2'] as const;
      await repository.forContractDevices(ids);
      const [args] = prisma.lossCase.findMany.mock.calls[0] as [
        { where: { contractDeviceId: { in: string[] } } },
      ];
      expect(args).toEqual({
        where: { contractDeviceId: { in: ['cd-1', 'cd-2'] } },
        orderBy: [{ reportedAt: 'desc' }, { id: 'asc' }],
        select: { id: true, contractDeviceId: true, code: true, state: true, chargeVnd: true },
      });
      expect(args.where.contractDeviceId.in).not.toBe(ids);
    });

    it('codesOfComplianceCases: code and compliance case, ordered by code', async () => {
      await repository.codesOfComplianceCases(['cc-1']);
      expect(prisma.lossCase.findMany).toHaveBeenCalledWith({
        where: { complianceCaseId: { in: ['cc-1'] } },
        orderBy: { code: 'asc' },
        select: { code: true, complianceCaseId: true },
      });
    });

    it('findManyForLink: the fields a compliance link checks, through the caller client', async () => {
      await repository.findManyForLink(['lc-1', 'lc-2'], tx as never);
      expect(tx.lossCase.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['lc-1', 'lc-2'] } },
        select: { id: true, organizationId: true, complianceCaseId: true },
      });
      expect(prisma.lossCase.findMany).not.toHaveBeenCalled();
    });
  });

  describe('linkToComplianceCase', () => {
    it('links only cases that are unlinked or already on this case, and returns the count', async () => {
      tx.lossCase.updateMany.mockResolvedValue({ count: 2 });
      await expect(
        repository.linkToComplianceCase(['lc-1', 'lc-2'], 'cc-1', tx as never),
      ).resolves.toBe(2);
      expect(tx.lossCase.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['lc-1', 'lc-2'] },
          OR: [{ complianceCaseId: null }, { complianceCaseId: 'cc-1' }],
        },
        data: { complianceCaseId: 'cc-1' },
      });
    });

    it('reports fewer rows when another writer linked one to a different case', async () => {
      tx.lossCase.updateMany.mockResolvedValue({ count: 1 });
      await expect(
        repository.linkToComplianceCase(['lc-1', 'lc-2'], 'cc-1', tx as never),
      ).resolves.toBe(1);
    });
  });

  describe('nextCode', () => {
    it('takes the advisory lock before it reads the highest code', async () => {
      await expect(repository.nextCode(tx as never)).resolves.toBe('LOSS-0007');
      expect(sqlOf(tx.$executeRaw)).toBe(
        "SELECT pg_advisory_xact_lock(hashtext('loss_cases.code'))",
      );
      expect(sqlOf(tx.$queryRaw)).toContain("FROM loss_cases WHERE code ~ '^LOSS-[0-9]+$'");
      expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.$queryRaw.mock.invocationCallOrder[0],
      );
    });

    it.each([
      ['no case yet', [{ max: null }], 'LOSS-0001'],
      ['an empty result', [], 'LOSS-0001'],
      ['a count Postgres returns as a string', [{ max: '41' }], 'LOSS-0042'],
      ['a code past four digits', [{ max: 9999 }], 'LOSS-10000'],
    ])('numbers the next case after %s', async (_label, rows, code) => {
      tx.$queryRaw.mockResolvedValue(rows);
      await expect(repository.nextCode(tx as never)).resolves.toBe(code);
    });
  });

  describe('insert', () => {
    it('creates the case through the transaction and reads it back with the full select', async () => {
      const data = { code: 'LOSS-0007', deviceId: 'd-1' } as never;
      await repository.insert(data, tx as never);
      expect(tx.lossCase.create).toHaveBeenCalledWith({ data, select: LOSS_CASE_SELECT });
    });
  });

  describe('transition', () => {
    it('moves the case only from the expected state and version, bumping the version', async () => {
      tx.lossCase.findUnique.mockResolvedValue(lossRow({ state: LossCaseState.CONFIRMED }));
      await expect(
        repository.transition(
          'lc-1',
          LossCaseState.SEARCHING,
          2,
          { state: LossCaseState.CONFIRMED, confirmedAt: AT },
          tx as never,
        ),
      ).resolves.toEqual(lossRow({ state: LossCaseState.CONFIRMED }));
      expect(tx.lossCase.updateMany).toHaveBeenCalledWith({
        where: { id: 'lc-1', state: LossCaseState.SEARCHING, version: 2 },
        data: { state: LossCaseState.CONFIRMED, confirmedAt: AT, version: { increment: 1 } },
      });
      expect(tx.lossCase.findUnique).toHaveBeenCalledWith({
        where: { id: 'lc-1' },
        select: LOSS_CASE_SELECT,
      });
      expect(prisma.lossCase.findUnique).not.toHaveBeenCalled();
    });

    it('returns null and reads nothing when another writer moved the case first', async () => {
      tx.lossCase.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        repository.transition('lc-1', LossCaseState.SEARCHING, 2, {}, tx as never),
      ).resolves.toBeNull();
      expect(tx.lossCase.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('page', () => {
    it('reads every case, newest report first, when there is no filter and no sort', async () => {
      prisma.lossCase.findMany.mockResolvedValue([lossRow()]);
      prisma.lossCase.count.mockResolvedValue(1);
      await expect(repository.page({}, 0, 20)).resolves.toEqual([[lossRow()], 1]);
      expect(prisma.lossCase.findMany).toHaveBeenCalledWith({
        where: {},
        select: LOSS_CASE_SELECT,
        orderBy: [{ reportedAt: 'desc' }, { code: 'desc' }],
        skip: 0,
        take: 20,
      });
      expect(prisma.lossCase.count).toHaveBeenCalledWith({ where: {} });
    });

    it('scopes both the rows and the count to the organization and the state', async () => {
      await repository.page({ organizationId: 'org-1', state: LossCaseState.SEARCHING }, 40, 20);
      const where = { organizationId: 'org-1', state: LossCaseState.SEARCHING };
      expect(prisma.lossCase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where, skip: 40, take: 20 }),
      );
      expect(prisma.lossCase.count).toHaveBeenCalledWith({ where });
    });

    it.each([
      ['reportedAt', { reportedAt: 'asc' }],
      ['code', { code: 'asc' }],
      ['assetTag', { device: { assetTag: 'asc' } }],
      ['state', { state: 'asc' }],
    ] as const)('sorts by %s with the id as tiebreaker', async (field, column) => {
      await repository.page({}, 0, 20, undefined, { field, order: 'asc' });
      expect(prisma.lossCase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [column, { id: 'asc' }] }),
      );
    });

    it('reads through the transaction client when one is given', async () => {
      await repository.page({}, 0, 20, tx as never, { field: 'code', order: 'desc' });
      expect(tx.lossCase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ code: 'desc' }, { id: 'desc' }] }),
      );
      expect(tx.lossCase.count).toHaveBeenCalledTimes(1);
      expect(prisma.lossCase.findMany).not.toHaveBeenCalled();
    });
  });

  describe('dueForConfirmation (devices.lossSearch, REQ-EVT-15)', () => {
    it('returns the ids of SEARCHING cases whose window has passed, oldest window first', async () => {
      prisma.lossCase.findMany.mockResolvedValue([{ id: 'lc-1' }, { id: 'lc-3' }]);
      await expect(repository.dueForConfirmation(AT)).resolves.toEqual(['lc-1', 'lc-3']);
      expect(prisma.lossCase.findMany).toHaveBeenCalledWith({
        where: { state: LossCaseState.SEARCHING, searchEndsAt: { lte: AT } },
        select: { id: true },
        orderBy: { searchEndsAt: 'asc' },
      });
    });
  });
});
