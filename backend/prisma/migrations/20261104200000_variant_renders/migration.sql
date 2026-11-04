-- specs/devices/design.md section 10, "Two renders per variant" and "treklink-v1 in the catalog" (W17,
-- devices task 9.3). Data only, no schema change. A forward migration because 20261103140000_variant_media
-- is applied; the demo seed writes the same values on a database it creates rows in.

-- 1. treklink-v1, inserted only when absent. Recorded facts: ESP32, SX1278, MPU6050 (treklink-firmware
-- docs/variants.md at a4aa98d, as in 20261103140000_variant_media) and MQTT compiled out
-- (-D MESHTASTIC_EXCLUDE_MQTT=1). Unverified, set only because the columns are required: "hasGps" false and
-- "firmwareBaseline" 2.7.19-treklink.1, the pattern of v2 to v4. The remaining value schedule, service
-- interval and checklist are those the seed gives v2 to v4.
INSERT INTO "hardware_variants" (
  "id", "code", "name", "hasGps", "hasMotionSensor", "mqttCapable", "firmwareBaseline",
  "remainingValueSchedule", "serviceIntervalDays", "serviceChecklist", "specSheet", "isActive", "updatedAt")
SELECT
  gen_random_uuid()::text, 'treklink-v1', 'TrekLink v1 (motion sensor, no MQTT)', false, true, false,
  '2.7.19-treklink.1',
  '[{"fromMonths": 0, "valueVnd": 2500000}, {"fromMonths": 12, "valueVnd": 1800000}, {"fromMonths": 24, "valueVnd": 1200000}]'::jsonb,
  180,
  ARRAY['Battery health', 'Antenna and connector', 'Enclosure seal', 'Button and buzzer']::text[],
  jsonb_build_object('mcu', 'ESP32', 'radio', 'SX1278', 'motionSensor', 'MPU6050'),
  true, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "hardware_variants" WHERE "code" = 'treklink-v1');

-- 2. The v1 price schedule, a demo value of 350 000 VND a month, only when v1 has none and an active Admin
-- account exists to author it (the earliest created). On a fresh database the demo seed writes it instead.
INSERT INTO "price_schedules" ("id", "hardwareVariantId", "monthlyPriceVnd", "effectiveFrom", "createdById")
SELECT gen_random_uuid()::text, v."id", 350000, CURRENT_TIMESTAMP, a."id"
FROM "hardware_variants" v
CROSS JOIN LATERAL (
  SELECT u."id"
  FROM "users" u
  JOIN "user_roles" ur ON ur."userId" = u."id"
  JOIN "roles" r ON r."id" = ur."roleId"
  WHERE r."key" = 'ADMIN' AND u."isActive" AND u."deletedAt" IS NULL
  ORDER BY u."createdAt", u."id"
  LIMIT 1
) a
WHERE v."code" = 'treklink-v1'
  AND NOT EXISTS (SELECT 1 FROM "price_schedules" p WHERE p."hardwareVariantId" = v."id");

-- 3. The detail render of each variant (frontend/public/variants/, commit 048e1e6). The icon render is derived
-- from this value by name in the frontend, so it needs no column. A row whose imageUrl an Admin already set is
-- kept.
UPDATE "hardware_variants"
SET "imageUrl" = '/variants/' || "code" || '-detail.png', "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('treklink-v1', 'treklink-v2', 'treklink-v3', 'treklink-v4') AND "imageUrl" IS NULL;
