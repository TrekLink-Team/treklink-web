-- organizations, ruling 2026-10-30 (api-design 20, task 3.1): TrekLink Staff and Admin read any
-- organization's API keys, for example from a compliance case; creating and revoking stay with the Org
-- Manager. A forward migration, because the seed migration is already applied on the shared database.
-- Matches scripts/specs/catalog.py. ADMIN inherits every STAFF permission (FR-AUTH-10), so both get it.
INSERT INTO "permissions" ("id", "key", "action", "subject", "conditions", "fields", "accountType") VALUES
  (gen_random_uuid()::text, 'apiKey.read', 'read', 'ApiKey', NULL, ARRAY[]::text[], 'TREKLINK');

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM (VALUES
  ('ADMIN', 'apiKey.read'),
  ('STAFF', 'apiKey.read')
) AS g("role", "perm")
JOIN "roles" r ON r."key" = g."role"
JOIN "permissions" p ON p."key" = g."perm";
