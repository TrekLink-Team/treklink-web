-- devices, design §1 (projection) and monitoring REQ-UBI-04 (D-092 rule 2, D-040): the time of the reading that
-- set lastLatitude and lastLongitude. lastSeenAt also moves on a reading without a position, so it cannot tell
-- whether the stored position lies inside an organization's custody interval. Existing rows stay null: their fix
-- time is unknown, and an organization's map shows no position of unknown time.
ALTER TABLE "devices" ADD COLUMN "lastPositionAt" TIMESTAMPTZ(3);
