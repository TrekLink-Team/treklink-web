-- monitoring, requirements REQ-UBI-04 (D-092 rule 2): the TrekLink counter location where the live map pins a
-- unit not heard since its handover. Values match scripts/specs/catalog.py; a row an Admin already holds is
-- left as it is.
INSERT INTO "business_parameters" ("key", "value", "valueType", "bounds", "unit", "ownerModule", "description", "version", "updatedAt") VALUES
  ('monitoring.counterLocation', '{"name": "TrekLink counter", "lat": 11.56, "lon": 108.54}'::jsonb, 'JSON', NULL, 'degrees', 'monitoring', 'Where the map pins a unit not heard since its handover: the TrekLink counter that handed it over; seeded at the default viewport centre until an Admin sets the counter''s position (D-092 rule 2)', 1, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
