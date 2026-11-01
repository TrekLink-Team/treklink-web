-- rentals, D-092 rule 1 (supervisor feedback of 2026-11-01): a request holds its devices at once,
-- until the deposit is paid or the hold expires. A contract requested before this migration keeps a
-- null holdExpiresAt and holds nothing; its approval reserves as before (rentals design §2.1).
ALTER TABLE "rental_contracts" ADD COLUMN "holdExpiresAt" TIMESTAMPTZ(3);

-- The hold length. Values match scripts/specs/catalog.py; a row an Admin already holds is left as it is.
INSERT INTO "business_parameters" ("key", "value", "valueType", "bounds", "unit", "ownerModule", "description", "version", "updatedAt") VALUES
  ('rentals.requestHoldHours', '24'::jsonb, 'INT', '{"min": 1, "max": 168}'::jsonb, 'hours', 'rentals', 'A request holds its devices this long; an unpaid hold then expires and the request is cancelled', 1, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
