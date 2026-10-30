-- The device history (monitoring api-design 03) reads one device's events by occurrence time, a
-- range on "occurredAt"; the existing device indexes are on "receivedAt". Additive only.
CREATE INDEX "field_events_deviceId_occurredAt_idx" ON "field_events"("deviceId", "occurredAt");
