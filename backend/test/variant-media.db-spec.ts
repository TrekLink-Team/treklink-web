import { PrismaService } from '../src/common/prisma/prisma.service';
import { DevicesRepository } from '../src/modules/devices/devices.repository';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// The image and the spec sheet of a hardware variant after the migration 20261103140000_variant_media
// (specs/devices/design.md section 10): the facts of treklink-firmware docs/variants.md, no photo, and
// both fields on the two reads the variant cards use. Read only; run through test:db on a migrated
// database, and nothing is written.
describe('variant image and spec sheet against Postgres (devices design section 10)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const repository = new DevicesRepository(prisma);

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('seeds the verified spec facts of v1 to v4 and no photo', async () => {
    const rows = await prisma.hardwareVariant.findMany({
      where: { code: { in: ['treklink-v1', 'treklink-v2', 'treklink-v3', 'treklink-v4'] } },
      select: { code: true, imageUrl: true, specSheet: true },
      orderBy: { code: 'asc' },
    });

    expect(rows).toEqual([
      {
        code: 'treklink-v1',
        imageUrl: null,
        specSheet: { mcu: 'ESP32', radio: 'SX1278', motionSensor: 'MPU6050' },
      },
      {
        code: 'treklink-v2',
        imageUrl: null,
        specSheet: {
          mcu: 'ESP32-S3',
          radio: 'SX1268',
          motionSensor: 'ICM-20948',
          sosControl: 'Dedicated SOS button',
          localAlarm: 'Buzzer and vibrator',
        },
      },
      {
        code: 'treklink-v3',
        imageUrl: null,
        specSheet: {
          mcu: 'ESP32',
          sosControl: '3 s hold on the user button',
          localAlarm: 'LED blinks',
        },
      },
      {
        code: 'treklink-v4',
        imageUrl: null,
        specSheet: {
          mcu: 'ESP32-S3',
          motionSensor: 'QMI8658',
          sosControl: '3 s hold on the user button',
          localAlarm: 'None',
        },
      },
    ]);
  });

  it('returns both fields on the catalog read and on the summary read of the plans', async () => {
    const [catalog, summary] = await Promise.all([
      repository.variantCatalog(false),
      repository.variants(false),
    ]);

    for (const row of [...catalog, ...summary]) {
      expect(row).toHaveProperty('imageUrl');
      expect(typeof row.specSheet).toBe('object');
    }
    const v2 = summary.find((row) => row.code === 'treklink-v2');
    expect(v2?.specSheet).toMatchObject({ mcu: 'ESP32-S3' });
  });
});
