-- Billing task 8.3: keep existing incident and note sources and allow a fault report as a third source.
ALTER TABLE "service_credits"
  ADD COLUMN "outageSourceFaultReportId" TEXT,
  ADD CONSTRAINT "service_credits_outageSourceFaultReportId_fkey"
    FOREIGN KEY ("outageSourceFaultReportId") REFERENCES "device_fault_reports"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  DROP CONSTRAINT "service_credits_outage_source_check",
  ADD CONSTRAINT "service_credits_outage_source_check"
    CHECK ("outageSourceIncidentId" IS NOT NULL
        OR "outageSourceFaultReportId" IS NOT NULL
        OR "outageSourceNote" IS NOT NULL);

CREATE INDEX "service_credits_outageSourceFaultReportId_idx"
  ON "service_credits"("outageSourceFaultReportId");
