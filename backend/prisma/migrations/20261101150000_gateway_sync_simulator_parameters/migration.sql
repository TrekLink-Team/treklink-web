-- gateway-sync, design §2 (field data simulator) (D-090 rule 2): the field data simulator's two parameters. Values match
-- scripts/specs/catalog.py; a row an Admin already holds is left as it is.
INSERT INTO "business_parameters" ("key", "value", "valueType", "bounds", "unit", "ownerModule", "description", "version", "updatedAt") VALUES
  ('gatewaySync.simulatorIntervalSeconds', '60'::jsonb, 'DURATION_SECONDS', '{"min": 10, "max": 3600}'::jsonb, 'seconds', 'gateway-sync', 'Field data simulator: one position and telemetry batch per simulated node per interval (FIELD_SIMULATOR_ENABLED only)', 1, CURRENT_TIMESTAMP),
  ('gatewaySync.simulatorSosIntervalMinutes', '0'::jsonb, 'INT', '{"min": 0, "max": 1440}'::jsonb, 'minutes', 'gateway-sync', 'Field data simulator: the first node sends an SOS once per this many minutes; 0 never', 1, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
