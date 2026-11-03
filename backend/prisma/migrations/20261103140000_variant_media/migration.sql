-- specs/devices/design.md section 10 (UI conventions E-2, gap G1): the image and the spec sheet of a
-- hardware variant, shown wherever a unit is chosen, handed over or viewed. The read path only: the
-- edit path comes with devices task 2.1. A forward migration because the seed migration is applied.
ALTER TABLE "hardware_variants" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "hardware_variants" ADD COLUMN "specSheet" JSONB NOT NULL DEFAULT '{}';

-- Verified facts only, from treklink-firmware docs/variants.md at dev a4aa98d. Radio, GNSS, display,
-- battery and enclosure of v3 and v4 stay empty until the leader records them, and no photo is
-- seeded: imageUrl stays null until the leader supplies photos of the units.
UPDATE "hardware_variants" SET "specSheet" = jsonb_build_object(
  'mcu', 'ESP32', 'radio', 'SX1278', 'motionSensor', 'MPU6050')
WHERE "code" = 'treklink-v1';

UPDATE "hardware_variants" SET "specSheet" = jsonb_build_object(
  'mcu', 'ESP32-S3', 'radio', 'SX1268', 'motionSensor', 'ICM-20948',
  'sosControl', 'Dedicated SOS button', 'localAlarm', 'Buzzer and vibrator')
WHERE "code" = 'treklink-v2';

UPDATE "hardware_variants" SET "specSheet" = jsonb_build_object(
  'mcu', 'ESP32', 'sosControl', '3 s hold on the user button', 'localAlarm', 'LED blinks')
WHERE "code" = 'treklink-v3';

UPDATE "hardware_variants" SET "specSheet" = jsonb_build_object(
  'mcu', 'ESP32-S3', 'motionSensor', 'QMI8658',
  'sosControl', '3 s hold on the user button', 'localAlarm', 'None')
WHERE "code" = 'treklink-v4';
