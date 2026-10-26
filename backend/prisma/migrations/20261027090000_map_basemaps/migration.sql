-- monitoring, D-072 (supersedes D-071): the live map offers several keyless basemaps the user switches
-- between, OpenTopoMap by default. CyclOSM is dropped: over Vietnam it serves no tile above zoom 13.
-- `monitoring.mapProvider` now names the default entry of `monitoring.mapBasemaps`, which replaces
-- `monitoring.mapTileUrl` and `monitoring.mapAttribution`. Values match scripts/specs/catalog.py.
UPDATE "business_parameters"
  SET "value" = '"opentopomap"'::jsonb,
      "description" = 'Default basemap, an id in monitoring.mapBasemaps (D-031, D-072)',
      "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "key" = 'monitoring.mapProvider';

INSERT INTO "business_parameters" ("key", "value", "valueType", "bounds", "unit", "ownerModule", "description", "version", "updatedAt") VALUES
  ('monitoring.mapBasemaps', '[{"id": "opentopomap", "name": "Topographic (OpenTopoMap)", "tileUrl": "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", "attribution": "Map data © OpenStreetMap contributors, SRTM; style © OpenTopoMap (CC-BY-SA)", "maxZoom": 18, "maxNativeZoom": 17}, {"id": "stadia-terrain", "name": "Terrain (Stadia)", "tileUrl": "https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png", "attribution": "© Stadia Maps © Stamen Design © OpenMapTiles © OpenStreetMap contributors", "maxZoom": 18, "maxNativeZoom": 18}, {"id": "esri-topo", "name": "Topographic (Esri)", "tileUrl": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", "attribution": "Tiles © Esri and the GIS user community", "maxZoom": 18, "maxNativeZoom": 16}, {"id": "openstreetmap", "name": "OpenStreetMap", "tileUrl": "https://tile.openstreetmap.org/{z}/{x}/{y}.png", "attribution": "© OpenStreetMap contributors", "maxZoom": 19, "maxNativeZoom": 19}]'::jsonb, 'JSON', NULL, NULL, 'monitoring', 'Basemaps the user can switch between: id, name, tile URL, attribution, maxZoom, maxNativeZoom (D-072)', 1, CURRENT_TIMESTAMP);

-- No history row references the two retired keys (checked on Neon dev and locally, 2026-10-27).
DELETE FROM "business_parameters" WHERE "key" IN ('monitoring.mapTileUrl', 'monitoring.mapAttribution');
