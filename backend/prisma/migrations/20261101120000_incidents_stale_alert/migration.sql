-- The device-silent alert of REQ-EVT-12 (incidents design §3, MSG40) is an outbox row written in the
-- transaction that sets the incident's stale flag, which writes no transition. A STALE row carries no
-- transition and keeps the device's last reading for its text; a TRANSITION row stays as before.
-- Existing rows become TRANSITION rows unchanged. Additive only.
-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('TRANSITION', 'STALE');

-- AlterTable
ALTER TABLE "alert_deliveries" ADD COLUMN     "kind" "AlertKind" NOT NULL DEFAULT 'TRANSITION',
ADD COLUMN     "lastSeenAt" TIMESTAMPTZ(3),
ALTER COLUMN "transitionId" DROP NOT NULL;

-- A TRANSITION row names its transition and no reading; a STALE row the reverse.
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_kind_shape" CHECK (
  ("kind" = 'TRANSITION' AND "transitionId" IS NOT NULL AND "lastSeenAt" IS NULL)
  OR ("kind" = 'STALE' AND "transitionId" IS NULL AND "lastSeenAt" IS NOT NULL)
);
