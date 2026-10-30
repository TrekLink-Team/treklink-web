-- A status update is corrected by a new row that names it (dry run defect 15). The append-only
-- trigger on "incident_status_updates" fires only on UPDATE and DELETE, so inserting a correction
-- passes it, and adding a nullable column writes no row. Additive only.
ALTER TABLE "incident_status_updates" ADD COLUMN "correctsId" TEXT;

-- One correction per update at most.
CREATE UNIQUE INDEX "incident_status_updates_correctsId_key" ON "incident_status_updates"("correctsId");

ALTER TABLE "incident_status_updates" ADD CONSTRAINT "incident_status_updates_correctsId_fkey" FOREIGN KEY ("correctsId") REFERENCES "incident_status_updates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
