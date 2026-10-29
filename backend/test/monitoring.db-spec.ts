import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { StreamRepository } from '../src/modules/monitoring/stream.repository';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// Run only through test:db against a migrated disposable database. Rows carry fresh ids per run.
describe('device release boundary against Postgres (REQ-EVT-04, AC-06)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const repository = new StreamRepository(prisma);
  const runId = randomUUID();
  const organizationId = `org-${runId}`;
  const otherOrganizationId = `org-other-${runId}`;
  const deviceId = `device-${runId}`;

  afterAll(() => prisma.$disconnect());

  it('knows no check-in for a device that was never checked in', async () => {
    await expect(repository.latestRelease(organizationId, deviceId)).resolves.toBeNull();
  });

  it('stores a check-in and reads it back', async () => {
    const checkedInAt = new Date('2026-10-20T03:00:00.000Z');
    await repository.recordRelease(organizationId, deviceId, checkedInAt);
    await expect(repository.latestRelease(organizationId, deviceId)).resolves.toEqual(checkedInAt);
  });

  it('keeps the later check-in when an earlier one is recorded afterwards', async () => {
    await repository.recordRelease(organizationId, deviceId, new Date('2026-10-19T03:00:00.000Z'));
    await expect(repository.latestRelease(organizationId, deviceId)).resolves.toEqual(
      new Date('2026-10-20T03:00:00.000Z'),
    );
  });

  it('moves forward on a later check-in of the same pair', async () => {
    const later = new Date('2026-10-25T03:00:00.000Z');
    await repository.recordRelease(organizationId, deviceId, later);
    await expect(repository.latestRelease(organizationId, deviceId)).resolves.toEqual(later);
  });

  it("does not show one organization's check-in to another", async () => {
    await expect(repository.latestRelease(otherOrganizationId, deviceId)).resolves.toBeNull();
  });

  it('survives pruning the stream, because it is not stored in it', async () => {
    const before = await repository.latestRelease(organizationId, deviceId);
    await prisma.streamEvent.deleteMany({ where: { organizationId } });
    await expect(repository.latestRelease(organizationId, deviceId)).resolves.toEqual(before);
  });

  describe('pruning the stream (task 2.4)', () => {
    const marker = `prune-test-${runId}`;
    const old = new Date('2001-01-01T00:00:00.000Z');
    const cutoff = new Date('2002-01-01T00:00:00.000Z');

    const entry = (createdAt: Date) =>
      prisma.streamEvent.create({
        data: { organizationId: null, type: marker, payload: {}, createdAt },
      });

    it('deletes entries before the cutoff in batches and keeps the newer ones', async () => {
      await entry(old);
      await entry(old);
      await entry(old);
      const kept = await entry(new Date());

      const first = await repository.pruneBefore(cutoff, 2);
      expect(first).toBe(2);
      const second = await repository.pruneBefore(cutoff, 2);
      expect(second).toBe(1);
      await expect(repository.pruneBefore(cutoff, 2)).resolves.toBe(0);

      const left = await prisma.streamEvent.findMany({ where: { type: marker } });
      expect(left.map((row) => row.seq)).toEqual([kept.seq]);
    });

    it('never touches the check-in boundary', async () => {
      const checkedInAt = new Date('2026-10-20T03:00:00.000Z');
      await repository.recordRelease(organizationId, `${deviceId}-prune`, checkedInAt);
      await entry(old);
      await repository.pruneBefore(cutoff, 5000);
      await expect(repository.latestRelease(organizationId, `${deviceId}-prune`)).resolves.toEqual(
        checkedInAt,
      );
    });
  });
});
