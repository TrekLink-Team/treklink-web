#!/bin/sh
# Start script of the field host's broker (specs/platform/design.md §2.5). Caddy obtains and renews the
# certificate of MQTT_DOMAIN; this script copies it from Caddy's data volume (mounted read-only at
# /caddy-data) into /mosquitto/tls, readable by the broker's user, starts the broker, and every
# CERT_CHECK_SECONDS compares Caddy's files with the copy. When they differ it copies them again and sends
# the broker SIGHUP, which makes Mosquitto 2.0.18 load the new certificate for new connections.
set -eu

: "${MQTT_DOMAIN:?set MQTT_DOMAIN to the host name of the certificate}"
CHECK="${CERT_CHECK_SECONDS:-3600}"
SOURCE_ROOT=/caddy-data/caddy/certificates
TLS_DIR=/mosquitto/tls
CONF=/mosquitto/config/mosquitto.conf

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) start.sh: $*"; }

# The issuer folder Caddy keeps the certificate in: acme-v02.api.letsencrypt.org-directory in production,
# local for Caddy's internal CA in the rehearsal.
source_dir() {
  for dir in "$SOURCE_ROOT"/*/"$MQTT_DOMAIN"; do
    if [ -f "$dir/$MQTT_DOMAIN.crt" ] && [ -f "$dir/$MQTT_DOMAIN.key" ]; then
      echo "$dir"
      return 0
    fi
  done
  return 1
}

same_as_copy() {
  [ -f "$TLS_DIR/server.crt" ] && [ -f "$TLS_DIR/server.key" ] \
    && cmp -s "$1/$MQTT_DOMAIN.crt" "$TLS_DIR/server.crt" \
    && cmp -s "$1/$MQTT_DOMAIN.key" "$TLS_DIR/server.key"
}

install_copy() {
  mkdir -p "$TLS_DIR"
  cp "$1/$MQTT_DOMAIN.crt" "$TLS_DIR/server.crt.new"
  cp "$1/$MQTT_DOMAIN.key" "$TLS_DIR/server.key.new"
  chown mosquitto:mosquitto "$TLS_DIR/server.crt.new" "$TLS_DIR/server.key.new"
  chmod 0644 "$TLS_DIR/server.crt.new"
  chmod 0600 "$TLS_DIR/server.key.new"
  mv "$TLS_DIR/server.crt.new" "$TLS_DIR/server.crt"
  mv "$TLS_DIR/server.key.new" "$TLS_DIR/server.key"
}

# The named volume is created owned by root and the image has no /mosquitto/data of its own, so the broker,
# which runs as its user, could not write its persistence file there (found in the rehearsal, 2026-11-07).
mkdir -p /mosquitto/data
chown mosquitto:mosquitto /mosquitto/data

waited=0
until dir=$(source_dir); do
  if [ $((waited % 60)) -eq 0 ]; then
    log "waiting for Caddy's certificate of $MQTT_DOMAIN under $SOURCE_ROOT"
  fi
  sleep 5
  waited=$((waited + 5))
done
install_copy "$dir"
log "certificate copied from $dir"

/usr/sbin/mosquitto -c "$CONF" &
pid=$!
stopping=0
sleeper=
# docker compose stop: pass SIGTERM on, so the broker writes its persistence file and exits cleanly.
stop() {
  stopping=1
  kill -TERM "$pid" 2>/dev/null || true
  [ -n "$sleeper" ] && kill "$sleeper" 2>/dev/null || true
}
trap stop TERM INT

while [ "$stopping" -eq 0 ] && kill -0 "$pid" 2>/dev/null; do
  sleep "$CHECK" &
  sleeper=$!
  wait "$sleeper" || true
  sleeper=
  [ "$stopping" -eq 0 ] || break
  if dir=$(source_dir) && ! same_as_copy "$dir"; then
    install_copy "$dir"
    kill -HUP "$pid" 2>/dev/null || true
    log "certificate changed: copied from $dir and reloaded the broker"
  fi
done

status=0
wait "$pid" || status=$?
log "broker exited with status $status"
exit "$status"
