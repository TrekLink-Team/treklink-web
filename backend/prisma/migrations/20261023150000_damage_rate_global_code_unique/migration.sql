-- billing, FR-BILL-04: a damage code is unique within its variant scope (api-design 06, 409
-- CONFLICT_UNIQUE). The Prisma unique on ("code", "hardwareVariantId") cannot enforce this for a rate that
-- applies to every variant, because Postgres treats NULLs as distinct; this partial index covers that case.

-- ─── Constraints Prisma cannot express (mirrors prisma/constraints.sql) ─────────────────────
CREATE UNIQUE INDEX "damage_rates_one_global_code"
  ON "damage_rates" ("code")
  WHERE "hardwareVariantId" IS NULL;
