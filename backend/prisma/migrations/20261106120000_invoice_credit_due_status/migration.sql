-- Credit due to organization (billing design section 11, D-097 amended, leader ruling 2026-11-06).
-- Only the enum values: PostgreSQL cannot use a new enum value inside the transaction that adds it, so the
-- backfill and the refund columns follow in 20261106120100_invoice_refund.
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'CREDIT_DUE';
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';
