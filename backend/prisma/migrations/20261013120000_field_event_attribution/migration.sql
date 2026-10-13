-- Occurrence time and custody-interval attribution of field events (D-040, FR-EVT-15 to FR-EVT-17).
-- field_events has no rows yet: the seed inserts none and no ingestion code exists, so the NOT NULL
-- columns need no default.

-- CreateEnum
CREATE TYPE "TimeSource" AS ENUM ('STATION_CORRECTED', 'DEVICE_RTC', 'SERVER_RECEIPT');

-- CreateEnum
CREATE TYPE "AttributionState" AS ENUM ('ATTRIBUTED', 'UNATTRIBUTED');

-- AlterEnum
ALTER TYPE "SyncOutcome" ADD VALUE 'ACCEPTED_UNATTRIBUTED';

-- AlterTable
ALTER TABLE "field_events" ADD COLUMN     "attribution" "AttributionState" NOT NULL,
ADD COLUMN     "capturedAt" TIMESTAMPTZ(3),
ADD COLUMN     "contractDeviceId" TEXT,
ADD COLUMN     "occurredAt" TIMESTAMPTZ(3) NOT NULL,
ADD COLUMN     "timeSource" "TimeSource" NOT NULL;

-- CreateIndex
CREATE INDEX "field_events_contractDeviceId_idx" ON "field_events"("contractDeviceId");

-- CreateIndex
CREATE INDEX "field_events_attribution_seq_idx" ON "field_events"("attribution", "seq");

-- AddForeignKey
ALTER TABLE "field_events" ADD CONSTRAINT "field_events_contractDeviceId_fkey" FOREIGN KEY ("contractDeviceId") REFERENCES "contract_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
