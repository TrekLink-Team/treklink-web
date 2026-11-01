-- monitoring, 2026-11-01: Stadia serves keyless tiles to a loopback host only and answered 401 on the
-- Vercel production (D-089), so its basemap entry is marked localOnly and the client hides it on any
-- other host. Only an entry with the id stadia-terrain changes; a list an Admin edited without it is
-- left as it is. Values match scripts/specs/catalog.py.
UPDATE "business_parameters"
  SET "value" = (
        SELECT jsonb_agg(
                 CASE WHEN entry->>'id' = 'stadia-terrain' THEN entry || '{"localOnly": true}'::jsonb
                      ELSE entry END
                 ORDER BY position)
        FROM jsonb_array_elements("value") WITH ORDINALITY AS item(entry, position)
      ),
      "description" = 'Basemaps the user can switch between: id, name, tile URL, attribution, maxZoom, maxNativeZoom, optional localOnly (D-072)',
      "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "key" = 'monitoring.mapBasemaps'
    AND jsonb_typeof("value") = 'array'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements("value") AS entry
      WHERE entry->>'id' = 'stadia-terrain' AND NOT (entry ? 'localOnly')
    );
