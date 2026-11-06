-- specs/devices/design.md section 12.14 (devices task 10.14, leader UAT 2026-11-06): the device hub's actions on a
-- docked unit, one row per action, STARTED before the unit is written and SUCCEEDED or FAILED when it ends
-- (devices api-design 33 and 34). A forward migration; no permission or parameter is added (`device.operate`
-- already covers the writes).

-- CreateEnum
CREATE TYPE "HubActionKind" AS ENUM ('REBOOT', 'FACTORY_RESET', 'RESTORE_DEFAULTS', 'UPLINK', 'FIRMWARE_UPDATE');

-- CreateEnum
CREATE TYPE "HubActionOutcome" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "device_hub_actions" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "action" "HubActionKind" NOT NULL,
    "outcome" "HubActionOutcome" NOT NULL DEFAULT 'STARTED',
    "nodeNum" BIGINT NOT NULL,
    "deviceStatus" "DeviceStatus" NOT NULL,
    "contractId" TEXT,
    "contractCode" TEXT,
    "firmwareFrom" TEXT,
    "firmwareTo" TEXT,
    "fullImage" BOOLEAN NOT NULL DEFAULT false,
    "failure" TEXT,
    "actorId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "device_hub_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_hub_actions_deviceId_startedAt_idx" ON "device_hub_actions"("deviceId", "startedAt");

-- CreateIndex
CREATE INDEX "device_hub_actions_actorId_idx" ON "device_hub_actions"("actorId");

-- AddForeignKey
ALTER TABLE "device_hub_actions" ADD CONSTRAINT "device_hub_actions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_hub_actions" ADD CONSTRAINT "device_hub_actions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
