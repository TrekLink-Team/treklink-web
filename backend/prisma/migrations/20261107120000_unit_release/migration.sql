-- CreateEnum
CREATE TYPE "ServiceCreditKind" AS ENUM ('FAULT', 'RELEASE');

-- CreateEnum
CREATE TYPE "ReleasePhase" AS ENUM ('BEFORE_HANDOVER', 'RUNNING');

-- AlterTable
ALTER TABLE "service_credits" ADD COLUMN     "kind" "ServiceCreditKind" NOT NULL DEFAULT 'FAULT',
ADD COLUMN     "unitReleaseId" TEXT,
ALTER COLUMN "cause" DROP NOT NULL,
ALTER COLUMN "faultInspectionId" DROP NOT NULL,
ALTER COLUMN "outageFrom" DROP NOT NULL,
ALTER COLUMN "outageTo" DROP NOT NULL,
ALTER COLUMN "outageDays" DROP NOT NULL;

-- CreateTable
CREATE TABLE "unit_releases" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "contractDeviceId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "phase" "ReleasePhase" NOT NULL,
    "reason" TEXT NOT NULL,
    "releasedById" TEXT NOT NULL,
    "releasedAt" TIMESTAMPTZ(3) NOT NULL,
    "quantityBefore" INTEGER NOT NULL,
    "quantityAfter" INTEGER NOT NULL,

    CONSTRAINT "unit_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unit_releases_contractId_idx" ON "unit_releases"("contractId");

-- CreateIndex
CREATE INDEX "unit_releases_contractDeviceId_idx" ON "unit_releases"("contractDeviceId");

-- CreateIndex
CREATE INDEX "unit_releases_deviceId_idx" ON "unit_releases"("deviceId");

-- CreateIndex
CREATE INDEX "unit_releases_releasedById_idx" ON "unit_releases"("releasedById");

-- CreateIndex
CREATE UNIQUE INDEX "service_credits_unitReleaseId_key" ON "service_credits"("unitReleaseId");

-- AddForeignKey
ALTER TABLE "service_credits" ADD CONSTRAINT "service_credits_unitReleaseId_fkey" FOREIGN KEY ("unitReleaseId") REFERENCES "unit_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_releases" ADD CONSTRAINT "unit_releases_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "rental_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_releases" ADD CONSTRAINT "unit_releases_contractDeviceId_fkey" FOREIGN KEY ("contractDeviceId") REFERENCES "contract_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_releases" ADD CONSTRAINT "unit_releases_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_releases" ADD CONSTRAINT "unit_releases_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- billing design §12.1 (D-099): a RELEASE credit carries no fault fields; a FAULT credit keeps every one of
-- them and its outage source, as before (prisma/constraints.sql carries the same CHECKs for a rebuilt baseline).
ALTER TABLE "service_credits" DROP CONSTRAINT "service_credits_outage_source_check";
ALTER TABLE "service_credits"
  ADD CONSTRAINT "service_credits_outage_source_check"
    CHECK ("kind" <> 'FAULT'
        OR "outageSourceIncidentId" IS NOT NULL
        OR "outageSourceFaultReportId" IS NOT NULL
        OR "outageSourceNote" IS NOT NULL),
  ADD CONSTRAINT "service_credits_kind_fields_check"
    CHECK (("kind" = 'FAULT' AND "cause" IS NOT NULL AND "faultInspectionId" IS NOT NULL
            AND "outageFrom" IS NOT NULL AND "outageTo" IS NOT NULL AND "outageDays" IS NOT NULL)
        OR ("kind" = 'RELEASE' AND "unitReleaseId" IS NOT NULL));

-- rentals design §13.4: TrekLink Staff release a unit; organization roles have no release permission. A forward
-- migration because the seed migration is applied to the shared database; scripts/specs/catalog.py carries the
-- same row. ADMIN inherits every STAFF row (FR-AUTH-10), so the grants list both.
INSERT INTO "permissions" ("id", "key", "action", "subject", "accountType", "conditions", "fields") VALUES
  (gen_random_uuid()::text, 'contract.releaseUnit', 'releaseUnit', 'RentalContract', 'TREKLINK', NULL, ARRAY[]::text[])
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM (VALUES
  ('STAFF', 'contract.releaseUnit'),
  ('ADMIN', 'contract.releaseUnit')
) AS g("role", "perm")
JOIN "roles" r ON r."key" = g."role"
JOIN "permissions" p ON p."key" = g."perm"
ON CONFLICT DO NOTHING;
