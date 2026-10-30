-- billing, D-081 (leader ruling on treklink-docs#114): a damage charge stores its contract and its
-- inspector, so the decision of UC-48 checks SEPARATION_OF_DUTY and finds the closing invoice from
-- billing's own table. It also keeps the damage codes it priced, so the Admin queue (api-design 16)
-- reads them without a read from `devices`.
ALTER TABLE "damage_charges" ADD COLUMN "contractId" TEXT;
ALTER TABLE "damage_charges" ADD COLUMN "inspectorId" TEXT;
ALTER TABLE "damage_charges" ADD COLUMN "damageCodes" TEXT[];

-- Backfill from the inspection that raised each charge: its inspector, its damage codes, and the
-- contract of the contract row it was recorded against. `inspections` is append-only, so none of
-- these values can drift.
UPDATE "damage_charges" AS d
  SET "inspectorId" = i."inspectorId",
      "damageCodes" = i."damageCodes",
      "contractId" = cd."contractId"
  FROM "inspections" AS i
  LEFT JOIN "contract_devices" AS cd ON cd."id" = i."contractDeviceId"
  WHERE i."id" = d."inspectionId";

-- A charge whose inspection has no contract row cannot be backfilled; SET NOT NULL then fails and the
-- migration stops, rather than guessing a contract.
ALTER TABLE "damage_charges" ALTER COLUMN "contractId" SET NOT NULL;
ALTER TABLE "damage_charges" ALTER COLUMN "inspectorId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "damage_charges_contractId_idx" ON "damage_charges"("contractId");

-- CreateIndex
CREATE INDEX "damage_charges_inspectorId_idx" ON "damage_charges"("inspectorId");

-- AddForeignKey
ALTER TABLE "damage_charges" ADD CONSTRAINT "damage_charges_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "rental_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_charges" ADD CONSTRAINT "damage_charges_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
