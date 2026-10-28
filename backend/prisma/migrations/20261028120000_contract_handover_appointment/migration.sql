-- rentals, leader ruling on #87 point 1: the handover appointment chosen at approval gets its own
-- column. Until now it lived only in the APPROVED transition reason.
ALTER TABLE "rental_contracts" ADD COLUMN "handoverAppointmentAt" TIMESTAMPTZ(3);

-- Backfill from the reason every approval wrote so far, "Handover appointment <ISO instant>".
UPDATE "rental_contracts" AS c
  SET "handoverAppointmentAt" = (substring(t."reason" from '^Handover appointment (.+)$'))::timestamptz
  FROM "contract_transitions" AS t
  WHERE t."contractId" = c."id"
    AND t."toStatus" = 'APPROVED'
    AND t."reason" LIKE 'Handover appointment %';
