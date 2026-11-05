-- specs/devices/design.md section 11 (W20A): the optimistic lock of the Admin variant edit (devices
-- api-design 03, REQ-ERR-19). Existing rows start at version 0.
ALTER TABLE "hardware_variants" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
