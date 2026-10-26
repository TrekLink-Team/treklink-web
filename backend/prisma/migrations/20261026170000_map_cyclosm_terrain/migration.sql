-- monitoring, D-071: the live map moves to the CyclOSM style (OpenStreetMap data with contours and
-- hillshading, hosted by OpenStreetMap France) so the field map shows terrain. The values match
-- scripts/specs/catalog.py. The seed migration is already applied to the shared database (D-036), so
-- the change is a forward update; an Admin can still change the three values through the parameters API.
UPDATE "business_parameters" SET "value" = '"cyclosm"'::jsonb, "description" = 'Map provider identifier (D-031, D-071)', "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "key" = 'monitoring.mapProvider';
UPDATE "business_parameters" SET "value" = '"https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png"'::jsonb, "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "key" = 'monitoring.mapTileUrl';
UPDATE "business_parameters" SET "value" = '"© OpenStreetMap contributors, style CyclOSM, tiles by OpenStreetMap France"'::jsonb, "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "key" = 'monitoring.mapAttribution';
