-- The demo control panel (D-088, specs/demo/design.md §6). A forward migration because the seed migration
-- is applied to the shared database; scripts/specs/catalog.py carries the same permission rows.

-- An auth event for a demo role switch: a token pair issued without a password.
ALTER TYPE "AuthEventType" ADD VALUE IF NOT EXISTS 'DEMO_SWITCH';

-- demo.stage for the Admin; the role switch for every role, one key per account type (D-057).
INSERT INTO "permissions" ("id", "key", "action", "subject", "accountType", "conditions", "fields") VALUES
  (gen_random_uuid()::text, 'demo.stage', 'stage', 'Demo', 'TREKLINK', NULL, ARRAY[]::text[]),
  (gen_random_uuid()::text, 'demo.switchRole', 'switchRole', 'Demo', 'TREKLINK', NULL, ARRAY[]::text[]),
  (gen_random_uuid()::text, 'demo.switchRole.org', 'switchRole', 'Demo', 'ORGANIZATION', NULL, ARRAY[]::text[])
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE (r."key" = 'ADMIN' AND p."key" IN ('demo.stage', 'demo.switchRole'))
   OR (r."key" = 'STAFF' AND p."key" = 'demo.switchRole')
   OR (r."key" IN ('ORG_MANAGER', 'ORG_OPERATOR') AND p."key" = 'demo.switchRole.org')
ON CONFLICT DO NOTHING;
