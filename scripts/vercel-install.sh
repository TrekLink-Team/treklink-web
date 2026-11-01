#!/usr/bin/env bash
# Install step of both Vercel services (D-089), run from the repository root. The backend and the
# frontend build in the same checkout, and `npm ci` deletes node_modules before it installs, so two
# independent installs would wipe each other's packages mid-build. This installs both workspaces once,
# under a lock, and a second call in the same checkout finds the marker and does nothing.
set -euo pipefail
cd "$(dirname "$0")/.."

install() {
  if [ -f node_modules/.tk-vercel-installed ]; then
    echo "vercel-install: already installed in this checkout"
    return
  fi
  npm ci --workspace=backend --workspace=frontend
  touch node_modules/.tk-vercel-installed
}

if command -v flock >/dev/null 2>&1; then
  exec 9>/tmp/tk-vercel-install.lock
  flock 9
fi
install
