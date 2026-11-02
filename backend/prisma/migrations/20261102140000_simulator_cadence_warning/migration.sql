-- PR #242 follow-up: description only. Preserve the configured value, bounds and version.
UPDATE "business_parameters"
SET "description" = 'Field data simulator: one position and telemetry batch per simulated node per interval (FIELD_SIMULATOR_ENABLED only). Warning: short intervals can raise SUSPECTED incidents without an SOS; with cadenceCount=6 and cadenceWindowSeconds=60, intervals of 12 seconds or less can trigger detection. Recheck both cadence parameters when changing this interval'
WHERE "key" = 'gatewaySync.simulatorIntervalSeconds';
