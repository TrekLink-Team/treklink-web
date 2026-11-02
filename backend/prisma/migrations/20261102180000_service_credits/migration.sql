-- billing task 8.1, design §9 (D-092 rule 5, leader rulings of 2026-11-02 on treklink-web#288): service
-- credits for a unit that failed through no fault of the organization. The decided amount lands as
-- negative SERVICE_CREDIT lines, possibly on more than one invoice, so the line names its credit.
-- CreateEnum
CREATE TYPE "ServiceCreditCause" AS ENUM ('BATTERY_FAULT', 'RADIO_FAULT', 'GPS_FAULT', 'BOARD_FAULT', 'FIRMWARE_FAULT');

-- CreateEnum
CREATE TYPE "ServiceCreditStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'APPLIED', 'REFUND_DUE', 'REFUNDED');

-- AlterEnum
ALTER TYPE "InvoiceLineType" ADD VALUE 'SERVICE_CREDIT';

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN     "serviceCreditId" TEXT;

-- CreateTable
CREATE TABLE "service_credits" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractDeviceId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "cause" "ServiceCreditCause" NOT NULL,
    "faultInspectionId" TEXT NOT NULL,
    "outageFrom" TIMESTAMPTZ(3) NOT NULL,
    "outageSourceIncidentId" TEXT,
    "outageSourceNote" TEXT,
    "outageTo" TIMESTAMPTZ(3) NOT NULL,
    "outageDays" INTEGER NOT NULL,
    "computedVnd" BIGINT NOT NULL,
    "decidedVnd" BIGINT,
    "appliedVnd" BIGINT NOT NULL DEFAULT 0,
    "status" "ServiceCreditStatus" NOT NULL,
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decisionReason" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "refundReference" TEXT,
    "refundedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_credits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_credits_refundReference_key" ON "service_credits"("refundReference");

-- CreateIndex
CREATE INDEX "service_credits_contractId_idx" ON "service_credits"("contractId");

-- CreateIndex
CREATE INDEX "service_credits_organizationId_idx" ON "service_credits"("organizationId");

-- CreateIndex
CREATE INDEX "service_credits_contractDeviceId_idx" ON "service_credits"("contractDeviceId");

-- CreateIndex
CREATE INDEX "service_credits_deviceId_idx" ON "service_credits"("deviceId");

-- CreateIndex
CREATE INDEX "service_credits_faultInspectionId_idx" ON "service_credits"("faultInspectionId");

-- CreateIndex
CREATE INDEX "service_credits_outageSourceIncidentId_idx" ON "service_credits"("outageSourceIncidentId");

-- CreateIndex
CREATE INDEX "service_credits_requestedById_idx" ON "service_credits"("requestedById");

-- CreateIndex
CREATE INDEX "service_credits_decidedById_idx" ON "service_credits"("decidedById");

-- CreateIndex
CREATE INDEX "service_credits_status_idx" ON "service_credits"("status");

-- CreateIndex
CREATE INDEX "invoice_lines_serviceCreditId_idx" ON "invoice_lines"("serviceCreditId");

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_serviceCreditId_fkey" FOREIGN KEY ("serviceCreditId") REFERENCES "service_credits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_credits" ADD CONSTRAINT "service_credits_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "rental_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_credits" ADD CONSTRAINT "service_credits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_credits" ADD CONSTRAINT "service_credits_contractDeviceId_fkey" FOREIGN KEY ("contractDeviceId") REFERENCES "contract_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_credits" ADD CONSTRAINT "service_credits_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_credits" ADD CONSTRAINT "service_credits_faultInspectionId_fkey" FOREIGN KEY ("faultInspectionId") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_credits" ADD CONSTRAINT "service_credits_outageSourceIncidentId_fkey" FOREIGN KEY ("outageSourceIncidentId") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_credits" ADD CONSTRAINT "service_credits_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_credits" ADD CONSTRAINT "service_credits_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One source of the outage start is required (leader ruling 2026-11-02, design §9.1).
ALTER TABLE "service_credits" ADD CONSTRAINT "service_credits_outage_source_check"
  CHECK ("outageSourceIncidentId" IS NOT NULL OR "outageSourceNote" IS NOT NULL);

-- design §9.3: a SERVICE_CREDIT line is negative like an ADJUSTMENT line (prisma/constraints.sql carries the
-- same CHECKs for a rebuilt baseline). Compared as text: the enum value added above is not usable as an enum
-- literal in the transaction that adds it.
ALTER TABLE "invoice_lines"
  DROP CONSTRAINT "invoice_lines_amount_sign",
  DROP CONSTRAINT "invoice_lines_paid_bounds";
ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_amount_sign" CHECK ("type"::text IN ('ADJUSTMENT', 'SERVICE_CREDIT') OR "amountVnd" >= 0),
  ADD CONSTRAINT "invoice_lines_paid_bounds" CHECK ("paidVnd" >= 0 AND ("type"::text IN ('ADJUSTMENT', 'SERVICE_CREDIT') OR "paidVnd" <= "amountVnd"));

-- design §9.4: Staff request and record refunds, an Admin decides (never the requester, checked per
-- credit), Staff and Admin read every credit, an Org Manager reads its own organization's. A forward
-- migration because the seed migration is applied to the shared database; scripts/specs/catalog.py
-- carries the same rows. ADMIN inherits every STAFF row (FR-AUTH-10), so the grants list both.
INSERT INTO "permissions" ("id", "key", "action", "subject", "accountType", "conditions", "fields") VALUES
  (gen_random_uuid()::text, 'serviceCredit.read', 'read', 'ServiceCredit', 'TREKLINK', NULL, ARRAY[]::text[]),
  (gen_random_uuid()::text, 'serviceCredit.read.own', 'read', 'ServiceCredit', 'ORGANIZATION', '{"organizationId": "${user.organizationId}"}'::jsonb, ARRAY[]::text[]),
  (gen_random_uuid()::text, 'serviceCredit.request', 'request', 'ServiceCredit', 'TREKLINK', NULL, ARRAY[]::text[]),
  (gen_random_uuid()::text, 'serviceCredit.decide', 'decide', 'ServiceCredit', 'TREKLINK', NULL, ARRAY[]::text[]),
  (gen_random_uuid()::text, 'serviceCredit.refund', 'refund', 'ServiceCredit', 'TREKLINK', NULL, ARRAY[]::text[])
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM (VALUES
  ('STAFF', 'serviceCredit.read'),
  ('ADMIN', 'serviceCredit.read'),
  ('STAFF', 'serviceCredit.request'),
  ('ADMIN', 'serviceCredit.request'),
  ('STAFF', 'serviceCredit.refund'),
  ('ADMIN', 'serviceCredit.refund'),
  ('ADMIN', 'serviceCredit.decide'),
  ('ORG_MANAGER', 'serviceCredit.read.own')
) AS g("role", "perm")
JOIN "roles" r ON r."key" = g."role"
JOIN "permissions" p ON p."key" = g."perm"
ON CONFLICT DO NOTHING;
