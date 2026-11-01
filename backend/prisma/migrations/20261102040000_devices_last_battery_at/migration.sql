-- devices, design §1 (projection) and monitoring REQ-UBI-04 (D-040): the time of the reading that set
-- batteryPct. A reading without a battery value still moves lastSeenAt, so lastSeenAt cannot tell whether
-- the stored battery lies inside an organization's custody interval. Existing rows stay null: their battery
-- time is unknown, and an organization sees no battery of unknown time.
ALTER TABLE "devices" ADD COLUMN "lastBatteryAt" TIMESTAMPTZ(3);
