-- The refund of a credit due, made outside TrekLink (billing design section 11.1, D-097 amended).
ALTER TABLE "invoices" ADD COLUMN "refundedVnd" BIGINT;
ALTER TABLE "invoices" ADD COLUMN "refundedAt" TIMESTAMPTZ(3);
ALTER TABLE "invoices" ADD COLUMN "refundedById" TEXT;
ALTER TABLE "invoices" ADD COLUMN "refundNote" VARCHAR(500);

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_refundedById_fkey"
  FOREIGN KEY ("refundedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The four refund columns are set together, and a refund is a positive amount.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_refund_complete" CHECK (
  ("refundedVnd" IS NULL AND "refundedAt" IS NULL AND "refundedById" IS NULL AND "refundNote" IS NULL)
  OR ("refundedVnd" > 0 AND "refundedAt" IS NOT NULL AND "refundedById" IS NOT NULL AND "refundNote" IS NOT NULL)
);

-- A closing invoice whose total is below zero read PAID; it is a credit due to the organization.
UPDATE "invoices" SET "status" = 'CREDIT_DUE' WHERE "totalVnd" < 0 AND "status" = 'PAID';

-- invoice.refund (scripts/specs/catalog.py): TrekLink Staff, and Admin, who inherits every Staff row
-- (FR-AUTH-10), so the grants list both.
INSERT INTO "permissions" ("id", "key", "action", "subject", "accountType", "conditions", "fields") VALUES
  (gen_random_uuid()::text, 'invoice.refund', 'refund', 'Invoice', 'TREKLINK', NULL, ARRAY[]::text[])
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM (VALUES
  ('STAFF', 'invoice.refund'),
  ('ADMIN', 'invoice.refund')
) AS g("role", "perm")
JOIN "roles" r ON r."key" = g."role"
JOIN "permissions" p ON p."key" = g."perm"
ON CONFLICT DO NOTHING;
