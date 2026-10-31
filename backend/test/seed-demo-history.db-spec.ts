import './db-app-env';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { seedDemo } from '../prisma/seed-demo';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { DeviceHistoryService } from '../src/modules/monitoring/device-history.service';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}
if (/\.neon\.tech/i.test(databaseUrl)) {
  throw new Error('seed-demo-history.db-spec seeds the database; never run it against Neon.');
}

// The device history page of a unit the demo seed hands over (monitoring api-design 07) reads its
// lifecycle in order: registered, intake check, intake passed, reserved, provisioned, handed over.
// The seed used to leave the device rows at the database's transaction time, after the contract's
// own reservation and handover times, so the page listed the registration above the handover.
//
// The seed takes fixed codes (RC-2026-0001 to 0003, ORG-0001) that the rentals flows of other suites
// also allocate, so it runs in a schema of its own on the same disposable database: migrated here,
// seeded, read through the real services and dropped at the end.
describe('demo seed device history order', () => {
  const schema = `seed_demo_history_${randomUUID().slice(0, 8)}`;
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schema);
  const prisma = new PrismaService({ datasourceUrl: url.toString() });
  let history: DeviceHistoryService;
  let close: () => Promise<void>;
  const now = new Date();

  beforeAll(async () => {
    execFileSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
      {
        cwd: join(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: url.toString(), DATABASE_DIRECT_URL: url.toString() },
        stdio: 'pipe',
      },
    );
    // Compiled, not started: no scheduler job runs beside the seed (as compileRentalFlow does).
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    close = () => moduleRef.close();
    history = moduleRef.get(DeviceHistoryService, { strict: false });
    const password = 'Seed-demo-history-1';
    await seedDemo(
      prisma,
      { admin: password, staff: password, manager: password, operator: password },
      { now, bcryptCost: 4 },
    );
  }, 120_000);
  afterAll(async () => {
    await close?.();
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  const oldestFirst = async (assetTag: string) => {
    const device = await prisma.device.findUniqueOrThrow({ where: { assetTag } });
    const [items, total] = await history.history(device.id, 0, 100);
    expect(items).toHaveLength(total);
    // Newest first: no row is newer than the one above it.
    for (let i = 1; i < items.length; i += 1) {
      expect(items[i].at.getTime()).toBeLessThanOrEqual(items[i - 1].at.getTime());
    }
    return items.reverse().map((item) => item.summary);
  };

  it.each([
    ['TL-0009', 'RC-2026-0001'],
    ['TL-0017', 'RC-2026-0002'],
    ['TL-0019', 'RC-2026-0003'],
  ])('reads %s of %s in lifecycle order', async (assetTag, contractCode) => {
    expect(await oldestFirst(assetTag)).toEqual([
      'Registered to IN_INTAKE (Registered)',
      'Intake check passed',
      'IN_INTAKE to AVAILABLE (Intake passed)',
      `Reserved for ${contractCode} (ORG-0001)`,
      'Provisioned with key version 1',
      `Handed over on ${contractCode} (ORG-0001)`,
    ]);
  });

  it('writes the device rows at the contract dates the seed gives the unit', async () => {
    const device = await prisma.device.findUniqueOrThrow({ where: { assetTag: 'TL-0019' } });
    const row = await prisma.contractDevice.findFirstOrThrow({ where: { deviceId: device.id } });
    const moves = await prisma.deviceTransition.findMany({
      where: { deviceId: device.id, refType: 'CONTRACT' },
      orderBy: { createdAt: 'asc' },
    });
    expect(moves.map((move) => [move.toStatus, move.createdAt.getTime()])).toEqual([
      ['RESERVED', row.reservedAt.getTime()],
      ['RENTED', row.handedOverAt?.getTime()],
    ]);
    const registration = await prisma.deviceTransition.findFirstOrThrow({
      where: { deviceId: device.id, reason: 'REGISTERED' },
    });
    expect(registration.createdAt.getTime()).toBe(device.acquiredAt.getTime());
  });
});
