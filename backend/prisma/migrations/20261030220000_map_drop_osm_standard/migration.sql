-- monitoring, dry run defect 11 (2026-10-30, D-031): the OpenStreetMap standard tiles print PRC district
-- names ("西沙区", "南沙区") beside the Vietnamese sovereignty overlay over the Paracel and Spratly
-- islands, so that basemap leaves the switcher. OpenTopoMap stays the default; Stadia and Esri showed no
-- such label. Values match scripts/specs/catalog.py.
UPDATE "business_parameters"
  SET "value" = (
        SELECT COALESCE(jsonb_agg(entry), '[]'::jsonb)
        FROM jsonb_array_elements("value") AS entry
        WHERE entry->>'id' <> 'openstreetmap'
      ),
      "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "key" = 'monitoring.mapBasemaps';

-- A default that pointed at the dropped entry falls back to OpenTopoMap.
UPDATE "business_parameters"
  SET "value" = '"opentopomap"'::jsonb, "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "key" = 'monitoring.mapProvider' AND "value" = '"openstreetmap"'::jsonb;
