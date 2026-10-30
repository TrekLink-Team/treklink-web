-- devices api-design 13 (task 2.8, FR-DEV-20, BR-44): a TrekLink Admin approves or rejects a
-- maintenance cost. A forward migration because the seed migration is applied to the shared database;
-- scripts/specs/catalog.py carries the same row.
INSERT INTO "permissions" ("id", "key", "action", "subject", "accountType", "conditions", "fields")
VALUES (gen_random_uuid()::text, 'maintenance.decide', 'decide', 'MaintenanceRecord', 'TREKLINK', NULL, ARRAY[]::text[])
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE r."key" = 'ADMIN' AND p."key" = 'maintenance.decide'
ON CONFLICT DO NOTHING;
