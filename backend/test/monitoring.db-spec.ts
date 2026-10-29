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
});
