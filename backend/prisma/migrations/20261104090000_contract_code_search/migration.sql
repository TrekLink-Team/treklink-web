-- rentals REQ-EVT-26 (api-design 02 `q`): the contract search matches a substring of the code ignoring
-- case (ILIKE), which the unique B-tree on "code" cannot serve; a trigram GIN index can.
-- The extension lives in "public" and the operator class is qualified, because a named operator class
-- is looked up through search_path: a suite that migrates its own schema in the same database (the
-- demo and seed-history db-specs) finds the extension already installed and would not see it there.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- CreateIndex
CREATE INDEX "rental_contracts_code_trgm" ON "rental_contracts" USING GIN ("code" public.gin_trgm_ops);
