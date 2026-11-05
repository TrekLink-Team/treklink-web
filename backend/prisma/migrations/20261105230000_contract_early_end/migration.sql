-- D-097 (leader ruling 2026-11-05, treklink-docs#173): End now, with the current term billed pro rata
-- (rentals design §12, billing design §10). Forward only; the applied seed migration stays intact.

-- AlterEnum
ALTER TYPE "InvoiceLineType" ADD VALUE 'EARLY_END_CREDIT';

-- billing design §10.2: an EARLY_END_CREDIT line is negative like an ADJUSTMENT or SERVICE_CREDIT line
-- (prisma/constraints.sql carries the same CHECKs for a rebuilt baseline). Compared as text: the enum value
-- added above is not usable as an enum literal in the transaction that adds it.
ALTER TABLE "invoice_lines"
  DROP CONSTRAINT "invoice_lines_amount_sign",
  DROP CONSTRAINT "invoice_lines_paid_bounds";
ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_amount_sign" CHECK ("type"::text IN ('ADJUSTMENT', 'SERVICE_CREDIT', 'EARLY_END_CREDIT') OR "amountVnd" >= 0),
  ADD CONSTRAINT "invoice_lines_paid_bounds" CHECK ("paidVnd" >= 0 AND ("type"::text IN ('ADJUSTMENT', 'SERVICE_CREDIT', 'EARLY_END_CREDIT') OR "paidVnd" <= "amountVnd"));

-- rentals design §12.2: Staff end any running contract, an Org Manager its own organization's.
-- scripts/specs/catalog.py carries the same rows. ADMIN inherits every STAFF row (FR-AUTH-10), so the
-- grants list both.
INSERT INTO "permissions" ("id", "key", "action", "subject", "accountType", "conditions", "fields") VALUES
  (gen_random_uuid()::text, 'contract.end', 'end', 'RentalContract', 'TREKLINK', NULL, ARRAY[]::text[]),
  (gen_random_uuid()::text, 'contract.end.own', 'end', 'RentalContract', 'ORGANIZATION', '{"organizationId": "${user.organizationId}"}'::jsonb, ARRAY[]::text[])
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM (VALUES
  ('STAFF', 'contract.end'),
  ('ADMIN', 'contract.end'),
  ('ORG_MANAGER', 'contract.end.own')
) AS g("role", "perm")
JOIN "roles" r ON r."key" = g."role"
JOIN "permissions" p ON p."key" = g."perm"
ON CONFLICT DO NOTHING;
