-- The field simulation of the demo panel (D-093 amendment, D-094; specs/demo/design.md §9). Forward only:
-- the simulated nodes of gateway-sync, the simulated mark on field events and incidents, and the
-- permission demo.simulate for the TrekLink Admin. scripts/specs/catalog.py carries the same permission row.

-- CreateEnum
CREATE TYPE "SimulationPattern" AS ENUM ('WALK', 'STOP', 'STRAY', 'SILENT', 'LOW_BATTERY');

-- CreateEnum
CREATE TYPE "SimulatedNodeStatus" AS ENUM ('RUNNING', 'STOPPED');

-- CreateEnum
CREATE TYPE "SimulatedSosKind" AS ENUM ('SOS', 'FALL');

-- AlterTable
ALTER TABLE "field_events" ADD COLUMN     "simulated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "simulated" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "simulated_nodes" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "nodeNum" BIGINT NOT NULL,
    "trailId" TEXT NOT NULL,
    "pattern" "SimulationPattern" NOT NULL,
    "speedMetresPerMinute" INTEGER NOT NULL DEFAULT 60,
    "anchorAt" TIMESTAMPTZ(3) NOT NULL,
    "anchorMetres" DOUBLE PRECISION NOT NULL,
    "anchorLat" DOUBLE PRECISION NOT NULL,
    "anchorLon" DOUBLE PRECISION NOT NULL,
    "anchorBattery" DOUBLE PRECISION NOT NULL,
    "direction" INTEGER NOT NULL,
    "strayBearing" DOUBLE PRECISION,
    "sosKind" "SimulatedSosKind",
    "sosSince" TIMESTAMPTZ(3),
    "beaconedUntil" TIMESTAMPTZ(3),
    "status" "SimulatedNodeStatus" NOT NULL DEFAULT 'RUNNING',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "simulated_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "simulated_nodes_deviceId_idx" ON "simulated_nodes"("deviceId");

-- CreateIndex
CREATE INDEX "simulated_nodes_status_updatedAt_idx" ON "simulated_nodes"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "simulated_nodes_createdById_idx" ON "simulated_nodes"("createdById");

-- AddForeignKey
ALTER TABLE "simulated_nodes" ADD CONSTRAINT "simulated_nodes_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulated_nodes" ADD CONSTRAINT "simulated_nodes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One RUNNING simulated node per device (design §9, 409 DEMO_NODE_RUNNING); stopped rows stay.
CREATE UNIQUE INDEX "simulated_nodes_one_running_per_device" ON "simulated_nodes"("deviceId")
  WHERE "status" = 'RUNNING';

ALTER TABLE "simulated_nodes" ADD CONSTRAINT "simulated_nodes_direction_check" CHECK ("direction" IN (1, -1));
ALTER TABLE "simulated_nodes" ADD CONSTRAINT "simulated_nodes_speed_check"
  CHECK ("speedMetresPerMinute" BETWEEN 10 AND 300);

-- demo.simulate for the Admin: every simulation route (REQ-SIM-07).
INSERT INTO "permissions" ("id", "key", "action", "subject", "accountType", "conditions", "fields") VALUES
  (gen_random_uuid()::text, 'demo.simulate', 'simulate', 'Demo', 'TREKLINK', NULL, ARRAY[]::text[])
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE r."key" = 'ADMIN' AND p."key" = 'demo.simulate'
ON CONFLICT DO NOTHING;
