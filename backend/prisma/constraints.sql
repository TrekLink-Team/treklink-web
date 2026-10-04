-- ─── Constraints Prisma cannot express (specs/platform/design.md §3.4) ──────────────────────
-- Column names are the Prisma field names (camelCase); only table names are mapped.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- organizations, FR-ORG-05: shift windows of one organization never overlap.
ALTER TABLE "roster_shifts"
  ADD CONSTRAINT "roster_shifts_end_after_start" CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT "roster_shifts_no_overlap"
  EXCLUDE USING gist ("organizationId" WITH =, tstzrange("startsAt", "endsAt", '[)') WITH &&);

-- organizations, FR-ORG-05: the primary and the backup are different members.
ALTER TABLE "roster_shifts"
  ADD CONSTRAINT "roster_shifts_distinct_members"
  CHECK ("primaryMemberId" IS NULL OR "backupMemberId" IS NULL OR "primaryMemberId" <> "backupMemberId");

-- rentals, BR-03: a device has at most one live commitment to a contract.
CREATE UNIQUE INDEX "contract_devices_one_live_per_device"
  ON "contract_devices" ("deviceId")
  WHERE "releasedAt" IS NULL AND "checkedInAt" IS NULL AND "lostAt" IS NULL;

-- rentals: quantities, plan lengths and term ranges.
ALTER TABLE "rental_contracts"
  ADD CONSTRAINT "rental_contracts_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "rental_contracts_day_plan_length"
  CHECK (("planType" = 'DAY' AND "dayPlanDays" > 0 AND "dayPremium" >= 1)
      OR ("planType" = 'MONTHLY' AND "dayPlanDays" IS NULL)),
  ADD CONSTRAINT "rental_contracts_holding_ratio" CHECK ("holdingFeeRatio" > 0 AND "holdingFeeRatio" <= 1);
ALTER TABLE "contract_terms"
  ADD CONSTRAINT "contract_terms_end_after_start" CHECK ("endsAt" > "startsAt");

-- billing: amounts are never negative except an ADJUSTMENT line; a line is never overpaid.
ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_amount_sign" CHECK ("type" = 'ADJUSTMENT' OR "amountVnd" >= 0),
  ADD CONSTRAINT "invoice_lines_paid_bounds" CHECK ("paidVnd" >= 0 AND ("type" = 'ADJUSTMENT' OR "paidVnd" <= "amountVnd"));
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amountVnd" > 0);

-- incidents, BR-17: an authority report is about exactly one incident or one contract.
ALTER TABLE "authority_reports"
  ADD CONSTRAINT "authority_reports_one_subject"
  CHECK (("incidentId" IS NULL) <> ("contractId" IS NULL));

-- incidents, FR-INC-01: at most one open incident per device.
CREATE UNIQUE INDEX "incidents_one_open_per_device"
  ON "incidents" ("deviceId")
  WHERE "state" <> 'CLOSED';

-- Append-only tables (REQ-UBI-07, NFR-SEC-05, BR-18): the database rejects UPDATE and DELETE.
CREATE OR REPLACE FUNCTION raise_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on append-only table % is not allowed', TG_OP, TG_TABLE_NAME;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'audit_log', 'business_parameter_history', 'auth_events', 'organization_transitions',
    'device_transitions', 'intake_checks', 'device_provisionings', 'device_resets', 'inspections',
    'contract_transitions', 'price_schedules', 'incident_transitions', 'incident_status_updates',
    'sync_audit_log'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION raise_append_only()',
                   t || '_append_only', t);
  END LOOP;
END $$;

-- field_events is append-only with one exception: an UPDATE that only sets "incidentId" from NULL
-- to a value, which links an accepted event to the episode it opened or joined.
CREATE OR REPLACE FUNCTION field_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."incidentId" IS NULL AND NEW."incidentId" IS NOT NULL
     AND (to_jsonb(NEW) - 'incidentId') = (to_jsonb(OLD) - 'incidentId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% on append-only table % is not allowed', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "field_events_append_only" BEFORE UPDATE OR DELETE ON "field_events"
  FOR EACH ROW EXECUTE FUNCTION field_events_append_only();
