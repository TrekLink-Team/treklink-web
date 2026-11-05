-- devices task 8.2, design section 9.1 (D-093 amendment item 3): where the firmware release reader looks
-- and how long it keeps the release list. Forward seed rows; the applied seed migration stays intact.
-- scripts/specs/catalog.py carries the same rows.
INSERT INTO "business_parameters" ("key", "value", "valueType", "bounds", "unit", "ownerModule", "description", "version", "updatedAt") VALUES
  ('devices.firmwareReleaseRepo', '"TrekLink-Team/treklink-firmware"'::jsonb, 'JSON', NULL, NULL, 'devices', 'GitHub repository whose releases carry the TrekLink firmware images and manifest (devices design §9.1)', 1, CURRENT_TIMESTAMP),
  ('devices.firmwareReleaseCacheSeconds', '300'::jsonb, 'INT', '{"min": 0, "max": 3600}'::jsonb, 'seconds', 'devices', 'How long the release list and manifests are kept before they are read again', 1, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
