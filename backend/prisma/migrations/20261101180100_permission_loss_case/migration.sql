-- devices api-design 17 to 22 and 27 (task 2.7, UC-49, UC-60): the loss-case permissions. Staff
-- report any device in service and triage, recover and confirm (`lossCase.operate`); an Admin settles
-- (`lossCase.decide`, BR-39 is checked per case); the Org Manager reports a device the organization
-- rents and reads its own cases. A forward migration because the seed migration is applied to the
-- shared database; scripts/specs/catalog.py carries the same rows. ADMIN inherits every STAFF row and
-- ORG_MANAGER every ORG_OPERATOR row (FR-AUTH-10), so the grants list both where they apply.
INSERT INTO "permissions" ("id", "key", "action", "subject", "accountType", "conditions", "fields") VALUES
  (gen_random_uuid()::text, 'lossCase.read', 'read', 'LossCase', 'TREKLINK', NULL, ARRAY[]::text[]),
  (gen_random_uuid()::text, 'lossCase.read.own', 'read', 'LossCase', 'ORGANIZATION', '{"organizationId": "${user.organizationId}"}'::jsonb, ARRAY[]::text[]),
  (gen_random_uuid()::text, 'lossCase.report', 'report', 'LossCase', 'TREKLINK', NULL, ARRAY[]::text[]),
  (gen_random_uuid()::text, 'lossCase.report.own', 'report', 'LossCase', 'ORGANIZATION', '{"organizationId": "${user.organizationId}"}'::jsonb, ARRAY[]::text[]),
  (gen_random_uuid()::text, 'lossCase.operate', 'operate', 'LossCase', 'TREKLINK', NULL, ARRAY[]::text[]),
  (gen_random_uuid()::text, 'lossCase.decide', 'decide', 'LossCase', 'TREKLINK', NULL, ARRAY[]::text[])
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM (VALUES
  ('STAFF', 'lossCase.read'),
  ('ADMIN', 'lossCase.read'),
  ('STAFF', 'lossCase.report'),
  ('ADMIN', 'lossCase.report'),
  ('STAFF', 'lossCase.operate'),
  ('ADMIN', 'lossCase.operate'),
  ('ADMIN', 'lossCase.decide'),
  ('ORG_MANAGER', 'lossCase.read.own'),
  ('ORG_MANAGER', 'lossCase.report.own')
) AS g("role", "perm")
JOIN "roles" r ON r."key" = g."role"
JOIN "permissions" p ON p."key" = g."perm"
ON CONFLICT DO NOTHING;
