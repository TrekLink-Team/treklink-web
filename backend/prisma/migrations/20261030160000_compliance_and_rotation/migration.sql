-- organizations, screens 3.5 and 3.6 (api-design 27 to 32, tasks 2.9 and 2.10): TrekLink Staff record a
-- channel key rotation (`organization.rotateKey`) and manage compliance cases (`complianceCase.manage`).
-- Suspending from a case keeps `organization.suspend` (Admin). A forward migration, because the seed
-- migration is already applied on the shared database; matches scripts/specs/catalog.py. ADMIN inherits
-- every STAFF permission (FR-AUTH-10), so both roles get both.
INSERT INTO "permissions" ("id", "key", "action", "subject", "conditions", "fields", "accountType") VALUES
  (gen_random_uuid()::text, 'organization.rotateKey', 'rotateKey', 'Organization', NULL, ARRAY[]::text[], 'TREKLINK'),
  (gen_random_uuid()::text, 'complianceCase.manage', 'manage', 'ComplianceCase', NULL, ARRAY[]::text[], 'TREKLINK');

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM (VALUES
  ('ADMIN', 'organization.rotateKey'),
  ('STAFF', 'organization.rotateKey'),
  ('ADMIN', 'complianceCase.manage'),
  ('STAFF', 'complianceCase.manage')
) AS g("role", "perm")
JOIN "roles" r ON r."key" = g."role"
JOIN "permissions" p ON p."key" = g."perm";

-- BR-40, design §4.1: the CHECK "compliance_cases_police_reference_to_close" already exists from
-- 20261014090000_asset_loss_and_compliance. The service answers 409 POLICE_REFERENCE_REQUIRED first and
-- stores a blank reference as NULL, so that CHECK also covers a blank one.
