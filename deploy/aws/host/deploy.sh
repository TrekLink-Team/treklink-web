#!/usr/bin/env bash
# Runs ON the AWS host, as root, through SSM Run Command started by deploy/aws/up.sh. Never run it on a
# laptop. It installs the uploaded release into /opt/treklink/app, writes deploy/aws/.env from SSM
# Parameter Store, builds and starts compose (caddy, mosquitto, broker-hook-proxy, backend), builds the
# web app in a Node container, publishes it to the frontend bucket and invalidates CloudFront.
#
# Output stays short: step markers and results. The long build logs go to /opt/treklink/logs/<run>.log,
# and the last lines of that log are printed when a step fails. No secret is printed or logged: the
# values from SSM go only into deploy/aws/.env (mode 0600), which compose reads.
set -euo pipefail

REGION=""
STAGE=""
RUN_ID=""
COMMIT=""
ARTIFACT_BUCKET=""
RUN_PREFIX=""
FRONTEND_BUCKET=""
DISTRIBUTION_ID=""
HOST_NAME=""
CORS_ORIGINS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    --stage) STAGE="$2"; shift 2 ;;
    --run-id) RUN_ID="$2"; shift 2 ;;
    --commit) COMMIT="$2"; shift 2 ;;
    --artifact-bucket) ARTIFACT_BUCKET="$2"; shift 2 ;;
    --run-prefix) RUN_PREFIX="$2"; shift 2 ;;
    --frontend-bucket) FRONTEND_BUCKET="$2"; shift 2 ;;
    --distribution-id) DISTRIBUTION_ID="$2"; shift 2 ;;
    --host-name) HOST_NAME="$2"; shift 2 ;;
    --cors-origins) CORS_ORIGINS="$2"; shift 2 ;;
    *) echo "host deploy: unknown option $1" >&2; exit 2 ;;
  esac
done
for name in REGION STAGE RUN_ID COMMIT ARTIFACT_BUCKET RUN_PREFIX FRONTEND_BUCKET DISTRIBUTION_ID HOST_NAME CORS_ORIGINS; do
  if [ -z "${!name}" ]; then
    echo "host deploy: missing value for $name" >&2
    exit 2
  fi
done

BASE=/opt/treklink
APP="$BASE/app"
NEW="$BASE/app.new"
OLD="$BASE/app.old"
LOG="$BASE/logs/$RUN_ID.log"
COMPOSE_DIR="$APP/deploy/aws"
NODE_IMAGE="node:22-bookworm-slim"
CURRENT_STEP="start"
export AWS_DEFAULT_REGION="$REGION"

mkdir -p "$BASE/logs"
chmod 0700 "$BASE"
: > "$LOG"
chmod 0600 "$LOG"

step() {
  CURRENT_STEP="$1"
  echo "[$(date -u +%H:%M:%S)] STEP: $1"
  echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) $1" >> "$LOG"
}

on_exit() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    echo "FAILED HOST STEP: $CURRENT_STEP (exit status $status)" >&2
    echo "Last lines of $LOG:" >&2
    tail -n 60 "$LOG" >&2 || true
  fi
  rm -f "$BASE"/deploy-*.sh 2>/dev/null || true
  exit "$status"
}
trap on_exit EXIT

# Runs a command with its output in the log only.
quiet() {
  "$@" >> "$LOG" 2>&1
}

compose() {
  docker compose --project-directory "$COMPOSE_DIR" -f "$COMPOSE_DIR/compose.yml" "$@"
}

# ---------------------------------------------------------------------------------------------------
step "check the host (first boot set-up, Docker, Compose, Buildx)"
if command -v cloud-init >/dev/null 2>&1; then
  quiet cloud-init status --wait || true
fi
if [ ! -f "$BASE/.user-data-done" ]; then
  echo "The first-boot set-up did not finish. See /var/log/treklink-user-data.log on the host." >&2
  exit 1
fi
quiet systemctl start docker
quiet docker compose version
quiet docker buildx version
echo "  memory: $(free -m | awk '/^Mem:/ {print $2}') MB, swap: $(free -m | awk '/^Swap:/ {print $2}') MB, free disk: $(df -h / | awk 'NR == 2 {print $4}')"

# ---------------------------------------------------------------------------------------------------
step "install release $RUN_ID (commit $COMMIT)"
rm -rf "$NEW"
mkdir -p "$NEW"
quiet aws s3 cp "s3://$ARTIFACT_BUCKET/$RUN_PREFIX/source.tar.gz" "$BASE/source.tar.gz" --only-show-errors
tar -xzf "$BASE/source.tar.gz" -C "$NEW"
rm -f "$BASE/source.tar.gz"
echo "$COMMIT" > "$NEW/.treklink-commit"

# Files bind-mounted into running containers. compose does not notice a change of their content, so the
# services that mount a changed file are recreated explicitly below.
mounted_checksum() {
  local root="$1"
  shift
  (cd "$root" && cat "$@" 2>/dev/null | sha256sum | cut -d' ' -f1) || echo none
}
CADDY_FILES=(deploy/aws/Caddyfile)
MOSQUITTO_FILES=(deploy/aws/mosquitto/mosquitto.conf deploy/aws/mosquitto/start.sh)
PROXY_FILES=(infra/mosquitto/broker-hook-proxy.conf.template)
recreate=()
if [ -d "$APP" ]; then
  [ "$(mounted_checksum "$APP" "${CADDY_FILES[@]}")" = "$(mounted_checksum "$NEW" "${CADDY_FILES[@]}")" ] || recreate+=(caddy)
  [ "$(mounted_checksum "$APP" "${MOSQUITTO_FILES[@]}")" = "$(mounted_checksum "$NEW" "${MOSQUITTO_FILES[@]}")" ] || recreate+=(mosquitto)
  [ "$(mounted_checksum "$APP" "${PROXY_FILES[@]}")" = "$(mounted_checksum "$NEW" "${PROXY_FILES[@]}")" ] || recreate+=(broker-hook-proxy)
fi
rm -rf "$OLD"
if [ -d "$APP" ]; then mv "$APP" "$OLD"; fi
mv "$NEW" "$APP"
echo "  installed in $APP; previous release kept in $OLD"

# ---------------------------------------------------------------------------------------------------
step "write deploy/aws/.env from SSM Parameter Store /treklink/$STAGE/"
ENV_FILE="$COMPOSE_DIR/.env"
umask 077
PARAMS_JSON="$(mktemp "$BASE/params.XXXXXX")"
aws ssm get-parameters-by-path --path "/treklink/$STAGE/" --recursive --with-decryption \
  --query 'Parameters[].{Name: Name, Value: Value}' --output json > "$PARAMS_JSON"
# Single-quoted values are literal in compose's .env format: no $ expansion, no escapes. up.sh refuses
# values with a single quote or a control character.
python3 -I - "$PARAMS_JSON" "$ENV_FILE" <<'PY'
import json, sys
params = json.load(open(sys.argv[1]))
lines = []
for item in sorted(params, key=lambda p: p["Name"]):
    key = item["Name"].rsplit("/", 1)[-1]
    value = item["Value"]
    if "'" in value or any(ord(c) < 32 for c in value):
        sys.exit(f"parameter {key}: holds a single quote or a control character")
    lines.append(f"{key}='{value}'")
with open(sys.argv[2], "w") as out:
    out.write("# Written by deploy/aws/host/deploy.sh from SSM Parameter Store. Do not edit: up.sh rewrites it.\n")
    out.write("\n".join(lines) + "\n")
print(f"  {len(lines)} values from SSM")
PY
rm -f "$PARAMS_JSON"
{
  echo "# Computed by up.sh and the host"
  echo "MQTT_DOMAIN='$HOST_NAME'"
  echo "CORS_ORIGINS='$CORS_ORIGINS'"
  echo "FIELD_STATION_BROKER_URL='mqtts://$HOST_NAME:8883'"
  echo "VITE_API_BASE_URL='https://$HOST_NAME/api'"
  echo "VITE_WS_URL='https://$HOST_NAME'"
  echo "BACKEND_TAG='$(printf '%s' "$COMMIT" | cut -c1-12)'"
} >> "$ENV_FILE"
chmod 0600 "$ENV_FILE"
umask 022
for key in ACME_EMAIL DATABASE_URL MQTT_AUTH_HOOK_SECRET JWT_ACCESS_SECRET CHANNEL_KEY_MASTER; do
  grep -q "^$key=" "$ENV_FILE" || { echo "  $key is missing under /treklink/$STAGE/ (run up.sh)" >&2; exit 1; }
done
echo "  MQTT_DOMAIN $HOST_NAME, CORS_ORIGINS $CORS_ORIGINS"

# ---------------------------------------------------------------------------------------------------
step "build the backend image (the longest step on a t4g.small)"
quiet compose config --quiet
echo "  memory before the build: $(free -m | awk '/^Mem:/ {print $7 " MiB available"}'), swap $(free -m | awk '/^Swap:/ {print $3 "/" $2 " MiB used"}')"
quiet compose build backend
echo "  treklink-backend:$(printf '%s' "$COMMIT" | cut -c1-12) built"

# ---------------------------------------------------------------------------------------------------
step "start compose"
quiet compose up -d --remove-orphans
if [ "${#recreate[@]}" -gt 0 ]; then
  echo "  mounted files changed, recreating: ${recreate[*]}"
  quiet compose up -d --no-deps --force-recreate "${recreate[@]}"
fi
backend_id="$(compose ps -q backend)"
waited=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$backend_id" 2>/dev/null)" = "healthy" ]; do
  if [ "$waited" -ge 300 ]; then
    echo "  the backend is not healthy after 300 s; its last log lines:" >&2
    compose logs --no-color --tail 40 backend >&2 || true
    exit 1
  fi
  sleep 5
  waited=$((waited + 5))
done
echo "  backend healthy after ${waited}s"
compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'

# ---------------------------------------------------------------------------------------------------
step "build the web app (Node in a container)"
quiet docker pull "$NODE_IMAGE"
echo "  memory before the build: $(free -m | awk '/^Mem:/ {print $7 " MiB available"}'), swap $(free -m | awk '/^Swap:/ {print $3 "/" $2 " MiB used"}')"
# The services keep running during this build. The container limit keeps an out-of-memory kill inside
# the build instead of letting the kernel pick the backend or the broker; it may use swap up to 3 GiB.
quiet docker run --rm \
  --memory=1536m --memory-swap=3072m \
  -v "$APP:/src" \
  -v treklink-npm-cache:/root/.npm \
  -w /src \
  -e CI=true \
  -e NODE_OPTIONS=--max-old-space-size=1280 \
  -e "VITE_API_BASE_URL=$(sed -n "s/^VITE_API_BASE_URL='\(.*\)'$/\1/p" "$ENV_FILE")" \
  -e "VITE_WS_URL=$(sed -n "s/^VITE_WS_URL='\(.*\)'$/\1/p" "$ENV_FILE")" \
  -e "VITE_APP_ENV=$(sed -n "s/^VITE_APP_ENV='\(.*\)'$/\1/p" "$ENV_FILE")" \
  "$NODE_IMAGE" \
  sh -c 'npm ci -w frontend --no-audit --no-fund && npm run build -w frontend'
[ -f "$APP/frontend/dist/index.html" ] || { echo "  the build produced no frontend/dist/index.html" >&2; exit 1; }
echo "  swap in use after the build: $(free -m | awk '/^Swap:/ {print $3}') MiB"
echo "  frontend/dist: $(find "$APP/frontend/dist" -type f | wc -l) files"

# ---------------------------------------------------------------------------------------------------
step "publish the web app to s3://$FRONTEND_BUCKET and invalidate CloudFront"
DIST="$APP/frontend/dist"
# Hashed files first, cached for a year; then everything else, index.html included, revalidated on every
# request; then the old hashed files are removed.
if [ -d "$DIST/assets" ]; then
  quiet aws s3 sync "$DIST/assets" "s3://$FRONTEND_BUCKET/assets" --only-show-errors \
    --cache-control "public,max-age=31536000,immutable"
fi
quiet aws s3 sync "$DIST" "s3://$FRONTEND_BUCKET" --only-show-errors --delete --exclude "assets/*" \
  --cache-control "no-cache"
if [ -d "$DIST/assets" ]; then
  quiet aws s3 sync "$DIST/assets" "s3://$FRONTEND_BUCKET/assets" --only-show-errors --delete \
    --cache-control "public,max-age=31536000,immutable"
fi
invalidation="$(aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths '/*' \
  --query 'Invalidation.Id' --output text)"
echo "  invalidation $invalidation started (CloudFront applies it within a few minutes)"

# ---------------------------------------------------------------------------------------------------
step "health check from the host"
api_code=000
waited=0
# The first deploy waits for Caddy's certificate from Let's Encrypt.
while [ "$waited" -le 240 ]; do
  api_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$HOST_NAME/api/health" || true)"
  [ "$api_code" = "200" ] && break
  sleep 10
  waited=$((waited + 10))
done
echo "HEALTH https://$HOST_NAME/api/health -> $api_code"
if [ "$api_code" != "200" ]; then
  echo "  the API is not reachable over HTTPS; Caddy's last log lines:" >&2
  compose logs --no-color --tail 30 caddy >&2 || true
  exit 1
fi

# ---------------------------------------------------------------------------------------------------
step "clean up old images and build cache"
current_tag="$(printf '%s' "$COMMIT" | cut -c1-12)"
previous_tag=""
if [ -f "$OLD/.treklink-commit" ]; then previous_tag="$(cut -c1-12 "$OLD/.treklink-commit")"; fi
docker images treklink-backend --format '{{.Tag}}' | while read -r tag; do
  if [ "$tag" != "$current_tag" ] && [ "$tag" != "$previous_tag" ]; then
    quiet docker rmi "treklink-backend:$tag" || true
  fi
done
quiet docker image prune -f || true
quiet docker builder prune -f --filter until=168h || true
find "$BASE/logs" -name '*.log' -mtime +14 -delete 2>/dev/null || true
echo "  free disk: $(df -h / | awk 'NR == 2 {print $4}')"

echo "DONE release $RUN_ID"
