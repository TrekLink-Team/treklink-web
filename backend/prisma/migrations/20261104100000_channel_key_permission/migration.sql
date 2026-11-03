-- specs/devices/design.md section 8.5 and 8.6 (D-082 decision 1): the Staff-only endpoint that issues the
-- derived channel key for a docked unit (rentals api-design 21) has its own permission, separate from
-- contract.operate, so the key-issuing trail has its own row. A forward migration because the seed
-- migration is applied to the shared database; scripts/specs/catalog.py carries the same row. ADMIN
-- inherits every STAFF row (FR-AUTH-10), so the grants list both.
INSERT INTO "permissions" ("id", "key", "action", "subject", "accountType", "conditions", "fields") VALUES
  (gen_random_uuid()::text, 'contract.issueChannelKey', 'issueChannelKey', 'RentalContract', 'TREKLINK', NULL, ARRAY[]::text[])
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM (VALUES
  ('STAFF', 'contract.issueChannelKey'),
  ('ADMIN', 'contract.issueChannelKey')
) AS g("role", "perm")
JOIN "roles" r ON r."key" = g."role"
JOIN "permissions" p ON p."key" = g."perm"
ON CONFLICT DO NOTHING;
