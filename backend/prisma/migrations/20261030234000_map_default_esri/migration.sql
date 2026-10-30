-- monitoring, dry run defect 11 (2026-10-30, D-085): OpenTopoMap, the default basemap, prints PRC district
-- names ("西沙区", "南沙区") over the Paracel and Spratly islands. The client now masks every basemap's
-- labels under the sovereignty overlay, and the default moves to Esri, whose tiles showed no foreign
-- archipelago name in the leader's check. OpenTopoMap stays in the switcher. An Admin's own choice of
-- default is kept. Values match scripts/specs/catalog.py.
UPDATE "business_parameters"
  SET "value" = '"esri-topo"'::jsonb, "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "key" = 'monitoring.mapProvider' AND "value" = '"opentopomap"'::jsonb;
