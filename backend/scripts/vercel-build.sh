#!/usr/bin/env bash
# Backend build on Vercel (D-089). Generates the Prisma client and compiles the app on every build.
# Only a production build migrates and seeds, and only when the database is `treklink_prod` on the
# Neon branch the leader created for it: the shared `dev` database of D-062 is never migrated or
# seeded from here, and a preview build never touches a database.
set -euo pipefail

npx prisma generate

if [ "${VERCEL_ENV:-}" = "production" ]; then
  for url in "${DATABASE_URL:-}" "${DATABASE_DIRECT_URL:-}"; do
    database="${url##*/}"
    database="${database%%\?*}"
    if [ "$database" != "treklink_prod" ]; then
      echo "vercel-build: refusing to migrate or seed: the database is '${database}', not treklink_prod" >&2
      exit 1
    fi
  done
  npx prisma migrate deploy
  npm run seed:demo
fi

npm run build
