-- incidents 2.3, PR #114 review: the last position keeps the fix time it was taken at, so an
-- out-of-order packet whose fix is older than the stored one cannot overwrite it. A position already
-- stored was accepted against the last SOS time, so that time is its best known bound.
ALTER TABLE "incidents" ADD COLUMN "lastPositionAt" TIMESTAMPTZ(3);

UPDATE "incidents" SET "lastPositionAt" = "lastEventAt" WHERE "lastLatitude" IS NOT NULL;
