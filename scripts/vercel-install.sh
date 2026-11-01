#!/usr/bin/env bash
# Install step of both Vercel services (D-089), run from the repository root. The backend and the
# frontend build in the same checkout, and `npm ci` deletes node_modules before it installs, so two
# independent installs would wipe each other's packages mid-build. This installs both workspaces once,
# under a lock, and a second call in the same checkout finds the marker and does nothing.
set -euo pipefail
cd "$(dirname "$0")/.."

# npm keeps a few backend dependencies in backend/node_modules (today @nestjs/event-emitter and
# @nestjs/schedule), but the Vercel function bundle resolves modules from the root node_modules only,
# so the function failed with "Cannot find module '@nestjs/event-emitter'". Copy every package that
# exists only under backend/node_modules to the root; a package the root already has is left alone.
hoist_backend_modules() {
  [ -d backend/node_modules ] || return 0
  local entry name
  for entry in backend/node_modules/* backend/node_modules/@*/*; do
    [ -d "$entry" ] || continue
    name="${entry#backend/node_modules/}"
    case "$name" in .bin | .bin/* | @*) [ -f "$entry/package.json" ] || continue ;; esac
    if [ ! -e "node_modules/$name" ]; then
      mkdir -p "node_modules/$(dirname "$name")"
      cp -a "$entry" "node_modules/$name"
      echo "vercel-install: hoisted $name"
    fi
  done
}

install() {
  if [ -f node_modules/.tk-vercel-installed ]; then
    echo "vercel-install: already installed in this checkout"
    return
  fi
  npm ci --workspace=backend --workspace=frontend
  hoist_backend_modules
  touch node_modules/.tk-vercel-installed
}

if command -v flock >/dev/null 2>&1; then
  exec 9>/tmp/tk-vercel-install.lock
  flock 9
fi
install
