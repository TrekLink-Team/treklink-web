-- rentals REQ-EVT-26 (api-design 02 `q`): the contract search matches a substring of the code ignoring
-- case (ILIKE), which the unique B-tree on "code" cannot serve; a trigram GIN index can.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "rental_contracts_code_trgm" ON "rental_contracts" USING GIN ("code" gin_trgm_ops);
