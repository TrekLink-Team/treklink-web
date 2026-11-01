-- devices task 2.7 (devices api-design 17 to 22, FR-DEV-12 to FR-DEV-15): a loss case keeps the
-- contract and organization of the custody interval CUSTODY_RESOLVER answered, because `devices` may
-- not read the rentals tables and billing charges that contract when the loss is confirmed. The Org
-- Manager's list (api-design 18) is scoped on organizationId. Additive and nullable: existing rows keep
-- null until triage sets them.

-- AlterTable
ALTER TABLE "loss_cases" ADD COLUMN     "contractId" TEXT,
ADD COLUMN     "organizationId" TEXT;

-- CreateIndex
CREATE INDEX "loss_cases_contractId_idx" ON "loss_cases"("contractId");

-- CreateIndex
CREATE INDEX "loss_cases_organizationId_state_idx" ON "loss_cases"("organizationId", "state");

-- AddForeignKey
ALTER TABLE "loss_cases" ADD CONSTRAINT "loss_cases_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "rental_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loss_cases" ADD CONSTRAINT "loss_cases_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
