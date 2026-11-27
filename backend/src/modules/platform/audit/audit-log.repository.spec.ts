import { PrismaService } from '../../../common/prisma/prisma.service';
import { AUDIT_LOG_SELECT, AuditLogRepository } from './audit-log.repository';

// platform task 3.1: the reads of the append-only audit log. The query building and the paging are in
// audit-log.service.spec.ts, which mocks this class; this file asserts the Prisma calls.

const AT = new Date('2026-11-20T03:00:00.000Z');

describe('AuditLogRepository', () => {
  let prisma: { auditLog: { findMany: jest.Mock; count: jest.Mock; findFirst: jest.Mock } };
  let repository: AuditLogRepository;

  beforeEach(() => {
    prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([{ id: 'a-1' }]),
        count: jest.fn().mockResolvedValue(41),
        findFirst: jest.fn().mockResolvedValue({ createdAt: AT }),
      },
    };
    repository = new AuditLogRepository(prisma as unknown as PrismaService);
  });

  it('selects the eleven columns of an audit entry, before and after included', () => {
    expect(Object.keys(AUDIT_LOG_SELECT)).toHaveLength(11);
    expect(AUDIT_LOG_SELECT).toMatchObject({ before: true, after: true, requestId: true });
  });

  describe('page', () => {
    it('reads one page newest first, the id breaking a tie, and counts with the same filter', async () => {
      const where = { organizationId: 'org-1', action: 'device.status.changed' };
      await expect(repository.page(where, 20, 10)).resolves.toEqual([[{ id: 'a-1' }], 41]);
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where,
        select: AUDIT_LOG_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 20,
        take: 10,
      });
      expect(prisma.auditLog.count).toHaveBeenCalledWith({ where });
    });

    it('passes an empty filter through unchanged to both reads', async () => {
      await repository.page({}, 0, 50);
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
      expect(prisma.auditLog.count).toHaveBeenCalledWith({ where: {} });
    });

    it('lets a failed read reach the caller', async () => {
      const error = new Error('connection reset');
      prisma.auditLog.count.mockRejectedValue(error);
      await expect(repository.page({}, 0, 50)).rejects.toBe(error);
    });
  });

  describe('latestOf (D-110)', () => {
    it('returns the time of the newest entry of the action', async () => {
      await expect(repository.latestOf('demo.reseed')).resolves.toBe(AT);
      expect(prisma.auditLog.findFirst).toHaveBeenCalledWith({
        where: { action: 'demo.reseed' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
    });

    it('returns null when the action was never logged', async () => {
      prisma.auditLog.findFirst.mockResolvedValue(null);
      await expect(repository.latestOf('demo.reseed')).resolves.toBeNull();
    });
  });
});
