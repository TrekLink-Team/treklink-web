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

-- BR-40, design §4.1: a suspected fraud or theft case closes only with a police report reference. The
-- service answers 409 POLICE_REFERENCE_REQUIRED first; this CHECK holds the rule for any other writer.
ALTER TABLE "compliance_cases" ADD CONSTRAINT "compliance_cases_police_reference_to_close" CHECK (
  "status" <> 'CLOSED'
  OR "type" NOT IN ('SUSPECTED_FRAUD', 'SUSPECTED_THEFT')
  OR length(btrim(coalesce("authorityReference", ''))) > 0
);
