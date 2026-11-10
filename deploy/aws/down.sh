#!/usr/bin/env bash
# Removes the AWS deployment (deploy/aws/RUNBOOK.md, "One command (2026-11-10)"): stops compose on the
# host, empties both buckets, deletes the stack (instance, volume, Elastic IP, buckets, CloudFront
# distribution, budget) and, unless --keep-parameters, the SSM parameters under /treklink/<stage>/.
# Nothing billable is left. Asks for the stack name to be typed before it changes anything.
#
#   deploy/aws/down.sh [--profile treklink] [--region ap-southeast-2] [--stage staging] [--keep-parameters]
set -euo pipefail

# shellcheck source=deploy/aws/lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

KEEP_PARAMETERS=0

usage() {
  cat <<'EOF'
Usage: deploy/aws/down.sh [--profile NAME] [--region NAME] [--stage NAME] [--keep-parameters]

Stops compose, empties the buckets and deletes the stack treklink-<stage>, after you type its name.
--keep-parameters keeps the SSM parameters under /treklink/<stage>/ (they cost nothing, but they hold
the secrets). Defaults: profile treklink (or $AWS_PROFILE), region ap-southeast-2, stage staging.
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
      --keep-parameters) KEEP_PARAMETERS=1; shift ;;
      -h | --help) usage; exit 0 ;;
      *) die "unknown option: $1 (see --help)" ;;
    esac
  done
  check_common_flags
}

empty_bucket() {
  local bucket="$1"
  [ -n "$bucket" ] || return 0
  local err batch deleted=0
  err="$(mktemp)"
  if ! awsc s3api head-bucket --bucket "$bucket" >/dev/null 2>"$err"; then
    if grep -qE '\(404\)|Not Found|NoSuchBucket' "$err"; then
      rm -f "$err"
      log "  $bucket: already gone"
      return 0
    fi
    die "cannot read bucket $bucket: $(tr '\n' ' ' < "$err")"
  fi
  rm -f "$err"
  awsc s3 rm "s3://$bucket" --recursive --only-show-errors
  # The template leaves versioning off, but a bucket that had it on keeps old versions and delete markers,
  # which are billed and block the bucket delete. Remove them in batches of up to 1000.
  while :; do
    batch="$(awsc s3api list-object-versions --bucket "$bucket" --max-items 1000 \
      --query '{Objects: [Versions, DeleteMarkers][][].{Key: Key, VersionId: VersionId}}' --output json)"
    printf '%s' "$batch" | grep -q '"Key"' || break
    awsc s3api delete-objects --bucket "$bucket" --delete "$batch" --output text >/dev/null
    deleted=$((deleted + 1))
  done
  if [ "$deleted" -gt 0 ]; then
    log "  $bucket: emptied, old versions and delete markers removed"
  else
    log "  $bucket: emptied"
  fi
}

delete_parameters() {
  local names=() name
  while IFS= read -r name; do
    [ -n "$name" ] && names+=("$name")
  done < <(awsc ssm get-parameters-by-path --path "$(ssm_path)/" --recursive \
    --query 'Parameters[].Name' --output text | tr '\t' '\n')
  if [ "${#names[@]}" -eq 0 ]; then
    log "  no parameters under $(ssm_path)/"
    return 0
  fi
  local start=0
  while [ "$start" -lt "${#names[@]}" ]; do
    awsc ssm delete-parameters --names "${names[@]:$start:10}" --output text >/dev/null
    start=$((start + 10))
  done
  log "  ${#names[@]} parameters deleted under $(ssm_path)/"
}

main() {
  trap on_exit EXIT
  parse_args "$@"

  step "prerequisites"
  require_aws_cli
  require_credentials
  make_tmp_dir

  local status
  status="$(stack_status)"
  log "  stack $(stack_name): $status"
  if [ "$status" = "NONE" ] && [ "$KEEP_PARAMETERS" -eq 1 ]; then
    log "Nothing to delete."
    exit 0
  fi
  case "$status" in
    *_IN_PROGRESS) die "stack $(stack_name) is $status; wait for it to finish, then run down.sh again" ;;
  esac

  step "confirm"
  log "This deletes the TrekLink $STAGE deployment in $REGION: the host and its disk (Caddy's"
  log "certificate and the broker's queue), the Elastic IP (the sslip.io host name changes on the next"
  log "up.sh, and every node, phone and Field Station must be given the new one), both buckets, the"
  log "CloudFront distribution and the budget."
  if [ "$KEEP_PARAMETERS" -eq 0 ]; then
    log "It also deletes the SSM parameters under $(ssm_path)/ (deploy/aws/.env.aws keeps your copy)."
  fi
  log "The Neon database is not touched."
  if [ ! -t 0 ]; then
    die "the confirmation must be typed in a terminal"
  fi
  local answer=""
  printf 'Type the stack name (%s) to continue: ' "$(stack_name)"
  IFS= read -r answer || true
  [ "$answer" = "$(stack_name)" ] || die "confirmation did not match; nothing was changed"

  if [ "$status" != "NONE" ]; then
    local instance artifact frontend
    instance="$(stack_resource Host)"
    artifact="$(stack_resource ArtifactBucket)"
    frontend="$(stack_resource FrontendBucket)"

    step "stop compose on the host"
    if [ -n "$instance" ] && [ "$(instance_state "$instance")" = "running" ] \
      && wait_for_ssm_online "$instance" 30; then
      ssm_run_short "$instance" 180 \
        "cd /opt/treklink/app/deploy/aws 2>/dev/null || { echo 'no release installed'; exit 0; }" \
        "docker compose stop" \
        || warn "compose did not stop cleanly; the instance is deleted with the stack anyway"
    else
      log "  the host is not running or not reachable through SSM; skipped"
    fi

    step "empty the buckets"
    empty_bucket "$artifact"
    empty_bucket "$frontend"

    step "delete the stack (slow: CloudFront disables the distribution before deleting it)"
    awsc cloudformation delete-stack --stack-name "$(stack_name)"
    awsc cloudformation wait stack-delete-complete --stack-name "$(stack_name)" \
      || die "the stack did not delete cleanly; read its events in the CloudFormation console"
    log "  stack $(stack_name) deleted"
  fi

  if [ "$KEEP_PARAMETERS" -eq 0 ]; then
    step "delete the SSM parameters"
    delete_parameters
  fi

  step "done"
  log "Nothing of stage $STAGE is left in the account. Check the bill the following day."
  log "Rotate the secrets the host held (RUNBOOK.md, manual path §12) if it is gone for good."
}

main "$@"
