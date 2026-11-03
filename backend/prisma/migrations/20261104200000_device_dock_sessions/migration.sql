-- specs/devices/design.md section 11.8 (devices task 10.1): the dock sessions behind the Staff map pin of a unit
-- held at the counter, the parameter for how long an unrenewed session lives, and one open session per
-- device. A forward migration because the seed migration is applied to the shared database;
-- scripts/specs/catalog.py carries the same parameter.

-- CreateEnum
CREATE TYPE "DockEndReason" AS ENUM ('RELEASED', 'EXPIRED', 'REPLACED');

-- CreateTable
CREATE TABLE "device_dock_sessions" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "nodeNum" BIGINT NOT NULL,
    "openedById" TEXT NOT NULL,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewedAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3),
    "endReason" "DockEndReason",

    CONSTRAINT "device_dock_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_dock_sessions_endedAt_renewedAt_idx" ON "device_dock_sessions"("endedAt", "renewedAt");

-- AddForeignKey
ALTER TABLE "device_dock_sessions" ADD CONSTRAINT "device_dock_sessions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_dock_sessions" ADD CONSTRAINT "device_dock_sessions_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One open session per device (design section 11.8); Prisma cannot declare a partial index.
CREATE UNIQUE INDEX "device_dock_sessions_open_device_key" ON "device_dock_sessions"("deviceId") WHERE "endedAt" IS NULL;

INSERT INTO "business_parameters" ("key", "value", "valueType", "bounds", "unit", "ownerModule", "description", "version", "updatedAt") VALUES
  ('devices.dockPresenceTtlSeconds', '30'::jsonb, 'INT', '{"min": 10, "max": 300}'::jsonb, 'seconds', 'devices', 'A dock session not renewed this long ends, and the Staff map drops the unit''s counter pin', 1, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
