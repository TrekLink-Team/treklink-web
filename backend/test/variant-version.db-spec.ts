import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { VariantsRepository } from '../src/modules/devices/variants.repository';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// The optimistic lock of the Admin variant edit (devices api-design 03, REQ-ERR-19, design section 11):
// VariantsRepository.compareAndSet updates only while `version` still matches. Two edits that both read
// version 0 race here in two transactions; with `version` left out of the WHERE clause both would win
// and the second would overwrite the first, so this spec fails (review of treklink-web#382). It writes
// one throwaway variant on a migrated database and deletes it afterwards.
describe('hardware variant compare-and-set against Postgres (REQ-ERR-19)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const repository = new VariantsRepository(prisma);
  const code = `test-cas-${randomUUID().slice(0, 8)}`;
  let id: string;

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    const row = await prisma.hardwareVariant.create({
      data: {
        code,
        name: 'Compare and set',
        hasGps: true,
        hasMotionSensor: false,
        mqttCapable: true,
        firmwareBaseline: '2.7.19-treklink.3',
        remainingValueSchedule: [{ fromMonths: 0, valueVnd: 2500000 }],
      },
    });
    id = row.id;
  });

  afterEach(async () => {
    await prisma.hardwareVariant.deleteMany({ where: { code } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('lets one of two concurrent edits of version 0 win and refuses the other', async () => {
    // The first edit holds its row lock until the second has sent its update, so the second waits on
    // the lock and then re-reads the row it would change, now at version 1.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let firstWritten!: () => void;
    const written = new Promise<void>((resolve) => (firstWritten = resolve));

    const first = prisma.$transaction(
      async (tx) => {
        const won = await repository.compareAndSet(id, 0, { name: 'First edit' }, tx);
        firstWritten();
        await held;
        return won;
      },
      { timeout: 15_000 },
    );
    await written;
    const second = prisma.$transaction(
      (tx) => repository.compareAndSet(id, 0, { name: 'Second edit' }, tx),
      { timeout: 15_000 },
    );
    // Long enough for the second update to reach Postgres and block on the lock.
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();

    expect(await Promise.all([first, second])).toEqual([true, false]);
    const row = await prisma.hardwareVariant.findUniqueOrThrow({ where: { id } });
    expect(row.name).toBe('First edit');
    expect(row.version).toBe(1);
  });

  it('refuses an edit of a version already moved on and leaves the row as it was', async () => {
    expect(
      await prisma.$transaction((tx) => repository.compareAndSet(id, 0, { name: 'Edit' }, tx)),
    ).toBe(true);
    expect(
      await prisma.$transaction((tx) => repository.compareAndSet(id, 0, { name: 'Late' }, tx)),
    ).toBe(false);
    const row = await prisma.hardwareVariant.findUniqueOrThrow({ where: { id } });
    expect([row.name, row.version]).toEqual(['Edit', 1]);
  });
});
