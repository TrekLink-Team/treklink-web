import { PrismaService } from '../src/common/prisma/prisma.service';
import { DevicesRepository } from '../src/modules/devices/devices.repository';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// The image and the spec sheet of a hardware variant after the migrations 20261103140000_variant_media and
// 20261104200000_variant_renders (specs/devices/design.md section 10): the facts of treklink-firmware
// docs/variants.md, the detail render of each variant as imageUrl, treklink-v1 in the catalog, and both
// fields on the two reads the variant cards use. Read only; run through test:db on a migrated and seeded
// database, and nothing is written. A fresh database gets the values from prisma/seed-demo.ts or from the
// migration, an existing one from the migration.
describe('variant image and spec sheet against Postgres (devices design section 10)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const repository = new DevicesRepository(prisma);

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('seeds the verified spec facts and the detail render of v1 to v4', async () => {
    const rows = await prisma.hardwareVariant.findMany({
      where: { code: { in: ['treklink-v1', 'treklink-v2', 'treklink-v3', 'treklink-v4'] } },
      select: { code: true, imageUrl: true, specSheet: true },
      orderBy: { code: 'asc' },
    });

    expect(rows).toEqual([
      {
        code: 'treklink-v1',
        imageUrl: '/variants/treklink-v1-detail.png',
        specSheet: { mcu: 'ESP32', radio: 'SX1278', motionSensor: 'MPU6050' },
      },
      {
        code: 'treklink-v2',
        imageUrl: '/variants/treklink-v2-detail.png',
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
        imageUrl: '/variants/treklink-v3-detail.png',
        specSheet: {
          mcu: 'ESP32',
          sosControl: '3 s hold on the user button',
          localAlarm: 'LED blinks',
        },
      },
      {
        code: 'treklink-v4',
        imageUrl: '/variants/treklink-v4-detail.png',
        specSheet: {
          mcu: 'ESP32-S3',
          motionSensor: 'QMI8658',
          sosControl: '3 s hold on the user button',
          localAlarm: 'None',
        },
      },
    ]);
  });

  it('keeps treklink-v1 off MQTT with a price schedule (W17, devices task 9.3)', async () => {
    const v1 = await prisma.hardwareVariant.findUniqueOrThrow({
      where: { code: 'treklink-v1' },
      include: { priceSchedules: true },
    });

    // hasGps from treklink-firmware variants/esp32/treklink_v1_0/variant.h:10 (a GPS Neo-6M on UART1).
    expect(v1).toMatchObject({ hasGps: true, mqttCapable: false, hasMotionSensor: true, isActive: true });
    expect(v1.priceSchedules).toHaveLength(1);
    expect(v1.priceSchedules[0].monthlyPriceVnd).toBe(350000n);
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
