#!/usr/bin/env bash
# Install step of both Vercel services (D-089), run from the repository root. The backend and the
# frontend build in the same checkout, and `npm ci` deletes node_modules before it installs, so two
# independent installs would wipe each other's packages mid-build. This installs both workspaces once,
# under a lock, and a second call in the same build finds the marker and does nothing. The marker holds
# the deployment id: Vercel restores node_modules from the previous deployment's build cache, marker
# included, and a bare marker made every later build skip the install and the hoist below.
set -euo pipefail
cd "$(dirname "$0")/.."

# npm keeps a few backend dependencies in backend/node_modules (today @nestjs/event-emitter and
# @nestjs/schedule). The Vercel NestJS builder makes backend/dist the function root and places each
# traced file at its path from the repository root, so a nested package ships as
# /var/task/backend/node_modules/..., which /var/task/main.js cannot resolve, and the function failed
# with "Cannot find module '@nestjs/event-emitter'". Move every package that exists only under
# backend/node_modules to the root; it must leave backend/node_modules, or the trace still resolves the
# nested copy. A package the root already has is left alone.
hoist_backend_modules() {
  [ -d backend/node_modules ] || return 0
  local entry name
  for entry in backend/node_modules/* backend/node_modules/@*/*; do
    [ -d "$entry" ] || continue
    name="${entry#backend/node_modules/}"
    case "$name" in .bin | .bin/* | @*) [ -f "$entry/package.json" ] || continue ;; esac
    if [ ! -e "node_modules/$name" ]; then
      mkdir -p "node_modules/$(dirname "$name")"
      mv "$entry" "node_modules/$name"
      echo "vercel-install: hoisted $name"
    fi
  done
}

build_id="${VERCEL_DEPLOYMENT_ID:-${VERCEL_URL:-local}}"
marker=node_modules/.tk-vercel-installed

install() {
  if [ -f "$marker" ] && [ "$(cat "$marker")" = "$build_id" ]; then
    echo "vercel-install: already installed for $build_id"
  else
    # --include=dev: with NODE_ENV=production npm skips devDependencies, and both builds need them
    # (@nestjs/cli, prisma, typescript, ts-node, vite). Harmless while NODE_ENV is development.
    npm ci --include=dev --workspace=backend --workspace=frontend
    echo "$build_id" >"$marker"
  fi
  # Idempotent, so it runs on every call: a cached tree from an older script may lack the copies.
  hoist_backend_modules
}

if command -v flock >/dev/null 2>&1; then
  exec 9>/tmp/tk-vercel-install.lock
  flock 9
fi
install
