-- billing task 3.2, the VietQR render check (2026-11-02): SePay's QR service answers an error page,
-- not an image, for an account holding anything but letters and digits, so the seeded "SANDBOX-0001"
-- never rendered. The receiving account becomes "0123456789", the example of SePay's Test mode guide,
-- to be set to the Test mode bank account. An Admin's own value is kept. Values match
-- scripts/specs/catalog.py.
UPDATE "business_parameters"
  SET "value" = '"0123456789"'::jsonb, "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "key" = 'billing.sepayBankAccount' AND "value" = '"SANDBOX-0001"'::jsonb;
