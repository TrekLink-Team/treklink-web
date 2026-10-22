-- The account type a permission belongs to (D-057). A role may hold only permissions of its own
-- account type, so an organization role can never receive a platform permission. Filled from the
-- seeded role grants; scripts/specs/build_seed.py refuses a permission granted to no role or to roles
-- of two account types, so every row receives exactly one value.

-- AlterTable
ALTER TABLE "permissions" ADD COLUMN "accountType" "AccountType";

-- Backfill
UPDATE "permissions" p
SET "accountType" = r."accountType"
FROM "role_permissions" rp
JOIN "roles" r ON r."id" = rp."roleId"
WHERE rp."permissionId" = p."id";

-- AlterTable
ALTER TABLE "permissions" ALTER COLUMN "accountType" SET NOT NULL;
