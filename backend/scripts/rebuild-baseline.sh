#!/usr/bin/env bash
# Rebuild the baseline migration from schema.prisma plus prisma/constraints.sql (D-036).
# Only valid while no shared database has applied the baseline; after that, add forward migrations.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=prisma/migrations/20261004120000_initial_schema
mkdir -p "$DIR"
export DATABASE_URL="${DATABASE_URL:-postgresql://x:y@localhost:5432/z}"
export DATABASE_DIRECT_URL="${DATABASE_DIRECT_URL:-$DATABASE_URL}"
PRISMA="${PRISMA:-../node_modules/.bin/prisma}"
"$PRISMA" format --schema prisma/schema.prisma >/dev/null
{ "$PRISMA" migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script; echo; echo; cat prisma/constraints.sql; } > "$DIR/migration.sql"
echo "wrote $DIR/migration.sql"
