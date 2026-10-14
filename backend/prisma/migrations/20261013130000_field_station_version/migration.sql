-- The version a Field Station last reported in its health message (FR-EVT-18, D-039).

-- AlterTable
ALTER TABLE "field_stations" ADD COLUMN     "version" TEXT;
