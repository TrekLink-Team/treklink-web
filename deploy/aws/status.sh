#!/usr/bin/env bash
# State of the AWS deployment (deploy/aws/RUNBOOK.md, "One command (2026-11-10)"): stack status, instance
# state, `docker compose ps` on the host through SSM, and the health URLs. Read-only.
#
#   deploy/aws/status.sh [--profile treklink] [--region ap-southeast-2] [--stage staging]
set -euo pipefail

# shellcheck source=deploy/aws/lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

usage() {
  cat <<'EOF'
Usage: deploy/aws/status.sh [--profile NAME] [--region NAME] [--stage NAME]

Prints the stack status, the instance state, the compose services on the host and the health URLs.
Defaults: profile treklink (or $AWS_PROFILE), region ap-southeast-2, stage staging.
EOF
}

parse_args() {
  CURRENT_STEP="arguments"
  while [ $# -gt 0 ]; do
    case "$1" in
      --profile | --region | --stage)
        if [ $# -lt 2 ] || [ -z "$2" ]; then die "$1 needs a value (see --help)"; fi
        case "$1" in
          --profile) PROFILE="$2" ;;
          --region) REGION="$2" ;;
          --stage) STAGE="$2" ;;
        esac
        shift 2 ;;
      --profile=*) PROFILE="${1#*=}"; shift ;;
      --region=*) REGION="${1#*=}"; shift ;;
      --stage=*) STAGE="${1#*=}"; shift ;;
      -h | --help) usage; exit 0 ;;
      *) die "unknown option: $1 (see --help)" ;;
    esac
  done
  check_common_flags
}

main() {
  trap on_exit EXIT
  parse_args "$@"

  step "prerequisites"
  require_aws_cli
  require_credentials
  make_tmp_dir

  step "stack $(stack_name)"
  local status
  status="$(stack_status)"
  log "  status: $status"
  if [ "$status" = "NONE" ]; then
    log "  Nothing is deployed for stage $STAGE. Run deploy/aws/up.sh."
    exit 0
  fi
  local instance host frontend
  instance="$(stack_output InstanceId)"
  host="$(stack_output HostName)"
  frontend="$(stack_output FrontendUrl)"
  log "  host name:  ${host:-none}"
  log "  web app:    ${frontend:-none}"
  log "  elastic IP: $(stack_output ElasticIp)"

  step "instance"
  if [ -z "$instance" ]; then
    log "  the stack has no instance output"
  else
    local state
    state="$(instance_state "$instance")"
    log "  $instance: $state"
    if [ "$state" = "running" ]; then
      step "compose on the host"
      if wait_for_ssm_online "$instance" 30; then
        ssm_run_short "$instance" 60 \
          "cd /opt/treklink/app/deploy/aws 2>/dev/null || { echo 'no release installed yet'; exit 0; }" \
          "echo \"release: \$(cat /opt/treklink/app/.treklink-commit 2>/dev/null || echo unknown)\"" \
          "docker compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'" \
          "echo \"free disk: \$(df -h / | awk 'NR == 2 {print \$4}'), memory available: \$(free -m | awk '/^Mem:/ {print \$7}') MB\"" \
          || warn "the SSM command did not succeed"
      else
        warn "the SSM agent of $instance is not online"
      fi
    fi
  fi

  step "health"
  if [ -n "$host" ]; then
    log "  GET https://$host/api/health -> $(http_status "https://$host/api/health")"
  fi
  if [ -n "$frontend" ]; then
    log "  GET $frontend/ -> $(http_status "$frontend/")"
  fi
}

main "$@"
