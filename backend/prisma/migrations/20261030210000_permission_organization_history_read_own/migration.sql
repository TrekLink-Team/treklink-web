-- organizations api-design 11 (review of treklink-web#135): an Org Manager reads its own organization's
-- status history, suspension reasons included; an Org Operator does not. The service checked the role
-- name; it now checks this permission, so an Admin can grant or withdraw it like any other. A forward
-- migration because the seed migration is applied to the shared database; scripts/specs/catalog.py
-- carries the same row.
INSERT INTO "permissions" ("id", "key", "action", "subject", "accountType", "conditions", "fields")
VALUES (
  gen_random_uuid()::text,
  'organization.history.read.own',
  'readHistory',
  'Organization',
  'ORGANIZATION',
  '{"id": "${user.organizationId}"}'::jsonb,
  ARRAY[]::text[]
)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE r."key" = 'ORG_MANAGER' AND p."key" = 'organization.history.read.own'
ON CONFLICT DO NOTHING;
