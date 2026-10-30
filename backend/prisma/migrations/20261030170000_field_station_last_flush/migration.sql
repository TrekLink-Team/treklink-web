-- Field Station health: the station's last successful flush, reported in its health message on
-- treklink/fs/<username>/health (gateway-sync mqtt-ingress-contract.md, Field Station health). Nullable:
-- a station that never flushed, or never reported, has none.
ALTER TABLE "field_stations" ADD COLUMN "lastFlushAt" TIMESTAMPTZ(3);
