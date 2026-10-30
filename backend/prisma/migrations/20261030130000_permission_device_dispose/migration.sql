-- devices api-design 23 (task 2.4/2.7, FR-DEV-16, BR-42): a TrekLink Admin records the verified wipe
-- of a RETIRED device and moves it to DISPOSED. A forward migration because the seed migration is
-- applied to the shared database; scripts/specs/catalog.py carries the same row.
INSERT INTO "permissions" ("id", "key", "action", "subject", "accountType", "conditions", "fields")
VALUES (gen_random_uuid()::text, 'device.dispose', 'dispose', 'Device', 'TREKLINK', NULL, ARRAY[]::text[])
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE r."key" = 'ADMIN' AND p."key" = 'device.dispose'
ON CONFLICT DO NOTHING;
