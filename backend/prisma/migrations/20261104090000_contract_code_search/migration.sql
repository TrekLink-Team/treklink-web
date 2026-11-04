-- rentals REQ-EVT-26 (api-design 02 `q`): the contract search matches a substring of the code ignoring
-- case (ILIKE), which the unique B-tree on "code" cannot serve; a trigram GIN index can.
--
-- The operator class is named with the schema pg_trgm actually lives in. A named operator class is
-- looked up through search_path, and pg_trgm may already be installed elsewhere: in another schema of
-- a hosted database (an "extensions" schema), or in "public" while a db-spec migrates a schema of its
-- own in the same database. `CREATE EXTENSION IF NOT EXISTS ... WITH SCHEMA public` does nothing in
-- either case, so the extension is created, in "public", only when it is absent.
DO $$
DECLARE
  trgm_schema text;
BEGIN
  SELECT n.nspname INTO trgm_schema
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
   WHERE e.extname = 'pg_trgm';
  IF trgm_schema IS NULL THEN
    CREATE EXTENSION pg_trgm WITH SCHEMA public;
    trgm_schema := 'public';
  END IF;
  -- CreateIndex
  EXECUTE format(
    'CREATE INDEX "rental_contracts_code_trgm" ON "rental_contracts" USING GIN ("code" %I.gin_trgm_ops)',
    trgm_schema
  );
END
$$;
