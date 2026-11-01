-- The sync audit list pages newest first by createdAt, then id (gateway-sync api-design 04,
-- SyncQueryRepository.pageAudit). A backward scan of this index serves that ORDER BY without a sort
-- (review of #235).
-- CreateIndex
CREATE INDEX "sync_audit_log_createdAt_id_idx" ON "sync_audit_log"("createdAt", "id");
