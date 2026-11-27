import { StaleSubject } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StaleMarkRow, StaleMarksRepository } from './stale-marks.repository';

// monitoring task 2.4, design section 1: the marks behind the staleness sweep. The sweep decisions are
// in jobs/stale-sweep.job.spec.ts; this file asserts that a mark is written once, that only the writer
// learns it wrote it, and that a clear scoped to an organization leaves a replaced mark alone.

const AT = new Date('2026-11-20T03:00:00.000Z');
const SUBJECT = Object.values(StaleSubject)[0];

const mark = (extra: Partial<StaleMarkRow> = {}): StaleMarkRow => ({
  subjectType: SUBJECT,
  subjectId: 'd-1',
  organizationId: 'org-1',
  lastSeenAt: new Date('2026-11-20T02:40:00.000Z'),
  markedAt: AT,
  ...extra,
});

const aClient = () => ({
  staleMark: {
    findMany: jest.fn().mockResolvedValue([mark()]),
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
});

describe('StaleMarksRepository', () => {
  let prisma: ReturnType<typeof aClient>;
  let tx: ReturnType<typeof aClient>;
  let repository: StaleMarksRepository;

  beforeEach(() => {
    prisma = aClient();
    tx = aClient();
    repository = new StaleMarksRepository(prisma as unknown as PrismaService);
  });

  describe('list', () => {
    it.each(Object.values(StaleSubject))(
      'reads the marks of subject type %s only',
      async (type) => {
        await expect(repository.list(type)).resolves.toEqual([mark()]);
        expect(prisma.staleMark.findMany).toHaveBeenCalledWith({ where: { subjectType: type } });
      },
    );
  });

  describe('mark', () => {
    it('writes the mark once, skipping a duplicate, and reports true when this call wrote it', async () => {
      await expect(repository.mark(mark())).resolves.toBe(true);
      expect(prisma.staleMark.createMany).toHaveBeenCalledWith({
        data: [mark()],
        skipDuplicates: true,
      });
    });

    it('reports false when the subject was already marked', async () => {
      prisma.staleMark.createMany.mockResolvedValue({ count: 0 });
      await expect(repository.mark(mark())).resolves.toBe(false);
    });

    it('writes through the transaction client when one is given', async () => {
      await repository.mark(mark(), tx as never);
      expect(tx.staleMark.createMany).toHaveBeenCalledTimes(1);
      expect(prisma.staleMark.createMany).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('removes the mark of the subject whatever its organization when none is given', async () => {
      await expect(repository.clear(SUBJECT, 'd-1')).resolves.toBe(true);
      expect(prisma.staleMark.deleteMany).toHaveBeenCalledWith({
        where: { subjectType: SUBJECT, subjectId: 'd-1' },
      });
    });

    it('removes only the mark written for the given organization', async () => {
      await repository.clear(SUBJECT, 'd-1', tx as never, 'org-1');
      expect(tx.staleMark.deleteMany).toHaveBeenCalledWith({
        where: { subjectType: SUBJECT, subjectId: 'd-1', organizationId: 'org-1' },
      });
      expect(prisma.staleMark.deleteMany).not.toHaveBeenCalled();
    });

    it('treats a null organization as a filter, matching only a mark with no organization', async () => {
      await repository.clear(SUBJECT, 'd-1', tx as never, null);
      expect(tx.staleMark.deleteMany).toHaveBeenCalledWith({
        where: { subjectType: SUBJECT, subjectId: 'd-1', organizationId: null },
      });
    });

    it('reports false when there was no mark, or it was replaced in between', async () => {
      prisma.staleMark.deleteMany.mockResolvedValue({ count: 0 });
      await expect(repository.clear(SUBJECT, 'd-1', undefined, 'org-2')).resolves.toBe(false);
    });
  });
});
