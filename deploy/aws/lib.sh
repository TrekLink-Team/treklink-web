# shellcheck shell=bash
# Shared by up.sh, status.sh and down.sh (deploy/aws/RUNBOOK.md, "One command"). Sourced, never run.
# Written for bash 3.2 as well, the bash macOS ships: no associative arrays, no mapfile, no ${var,,}.

TREKLINK_AWS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC2034 # used by up.sh
TREKLINK_REPO_ROOT="$(cd "$TREKLINK_AWS_DIR/../.." && pwd)"

PROFILE="${AWS_PROFILE:-treklink}"
REGION="ap-southeast-2"
STAGE="staging"
CURRENT_STEP="start"
SCRIPT_NAME="$(basename "$0")"
TMP_DIR=""
FAILURE_REPORTED=0

log() { printf '%s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }

die() {
  printf '%s failed at step "%s": %s\n' "$SCRIPT_NAME" "$CURRENT_STEP" "$*" >&2
  FAILURE_REPORTED=1
  exit 1
}

step() {
  CURRENT_STEP="$1"
  printf '\n==> %s\n' "$1"
}

# The EXIT trap of every script: removes the private temporary folder and, when a command failed
# without die(), still names the step (set -e stops the script without a message of its own).
on_exit() {
  local status=$?
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
  if [ "$status" -ne 0 ] && [ "$FAILURE_REPORTED" -eq 0 ]; then
    printf '%s failed at step "%s" (exit status %s).\n' "$SCRIPT_NAME" "$CURRENT_STEP" "$status" >&2
  fi
  exit "$status"
}

make_tmp_dir() {
  TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/treklink-aws.XXXXXX")"
  chmod 0700 "$TMP_DIR"
}

# Every AWS call goes through here, so the profile and the region are never forgotten.
awsc() {
  aws --profile "$PROFILE" --region "$REGION" "$@"
}

stack_name() { printf 'treklink-%s' "$STAGE"; }
ssm_path() { printf '/treklink/%s' "$STAGE"; }

# Validates the flags every script shares; the caller has already stored them.
check_common_flags() {
  if ! printf '%s' "$STAGE" | grep -Eq '^[a-z][a-z0-9-]{1,19}$'; then
    die "--stage must be 2 to 20 characters of a-z, 0-9 and -, starting with a letter"
  fi
  if ! printf '%s' "$REGION" | grep -Eq '^[a-z]{2}(-[a-z]+)+-[0-9]$'; then
    die "--region does not look like an AWS region: $REGION"
  fi
  if [ "$REGION" != "ap-southeast-2" ]; then
    warn "region $REGION: the organisation's SCP allows EC2 in ap-southeast-2 only (verified 2026-11-10)."
  fi
  [ -n "$PROFILE" ] || die "--profile must not be empty"
}

require_aws_cli() {
  command -v aws >/dev/null 2>&1 || die "AWS CLI v2 is not installed (https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)"
  local version
  version="$(aws --version 2>&1 || true)"
  case "$version" in
    aws-cli/2.*) ;;
    *) die "AWS CLI v2 is required, found: ${version:-nothing}" ;;
  esac
}

require_credentials() {
  local account
  if ! account="$(awsc sts get-caller-identity --query Account --output text 2>/dev/null)"; then
    die "profile \"$PROFILE\" has no working credentials. Run: aws login --profile $PROFILE (or aws configure --profile $PROFILE for an access key)"
  fi
  log "AWS account $account, profile $PROFILE, region $REGION"
}

# Prints the stack status, or NONE when CloudFormation answers that the stack does not exist. Any other
# error (no access, throttling, network) stops the script: reading it as NONE could make down.sh skip
# billable resources. Callers run it as status="$(stack_status)", so set -e stops them too.
stack_status() {
  local status err
  err="$(mktemp)"
  if status="$(awsc cloudformation describe-stacks --stack-name "$(stack_name)" \
    --query 'Stacks[0].StackStatus' --output text 2>"$err")"; then
    rm -f "$err"
    printf '%s' "$status"
  elif grep -q 'does not exist' "$err"; then
    rm -f "$err"
    printf 'NONE'
  else
    printf '%s failed: cannot read stack %s: %s\n' "$SCRIPT_NAME" "$(stack_name)" "$(tr '\n' ' ' < "$err")" >&2
    rm -f "$err"
    exit 1
  fi
}

# Prints one output of the stack, or nothing.
stack_output() {
  local value
  value="$(awsc cloudformation describe-stacks --stack-name "$(stack_name)" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text 2>/dev/null || true)"
  # "none" is the template's value for an output that does not apply (no CloudFront in host mode).
  if [ "$value" = "None" ] || [ "$value" = "none" ]; then value=""; fi
  printf '%s' "$value"
}

# Prints the physical id of one resource of the stack, or nothing (works while outputs are missing).
stack_resource() {
  local value
  value="$(awsc cloudformation describe-stack-resource --stack-name "$(stack_name)" \
    --logical-resource-id "$1" --query 'StackResourceDetail.PhysicalResourceId' --output text 2>/dev/null || true)"
  if [ "$value" = "None" ]; then value=""; fi
  printf '%s' "$value"
}

instance_state() {
  local value
  value="$(awsc ec2 describe-instances --instance-ids "$1" \
    --query 'Reservations[0].Instances[0].State.Name' --output text 2>/dev/null || true)"
  printf '%s' "${value:-unknown}"
}

# Waits until the SSM agent of the instance reports Online. $1 instance id, $2 seconds.
wait_for_ssm_online() {
  local instance="$1" limit="$2" waited=0 ping
  while :; do
    ping="$(awsc ssm describe-instance-information \
      --filters "Key=InstanceIds,Values=$instance" \
      --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)"
    if [ "$ping" = "Online" ]; then return 0; fi
    if [ "$waited" -ge "$limit" ]; then return 1; fi
    if [ $((waited % 60)) -eq 0 ]; then
      log "  waiting for the SSM agent of $instance (status: ${ping:-not registered}, ${waited}s)"
    fi
    sleep 10
    waited=$((waited + 10))
  done
}

# Runs a short shell command list on the instance through SSM and prints its output.
# $1 instance id, $2 seconds to wait, then one argument per command line. Returns non-zero unless the
# command ends in Success. For short read-only commands only; up.sh has its own longer path.
ssm_run_short() {
  local instance="$1" limit="$2"
  shift 2
  local params="$TMP_DIR/ssm-short.json" first=1 line
  {
    printf '{"commands":['
    for line in "$@"; do
      if [ "$first" -eq 0 ]; then printf ','; fi
      first=0
      printf '"%s"' "$(json_escape "$line")"
    done
    printf '],"executionTimeout":["%s"]}' "$limit"
  } > "$params"
  local command_id
  command_id="$(awsc ssm send-command --instance-ids "$instance" --document-name AWS-RunShellScript \
    --comment "treklink $SCRIPT_NAME" --parameters "file://$params" \
    --query 'Command.CommandId' --output text)" || return 1
  local waited=0 status=""
  while [ "$waited" -le $((limit + 60)) ]; do
    sleep 3
    waited=$((waited + 3))
    status="$(awsc ssm get-command-invocation --command-id "$command_id" --instance-id "$instance" \
      --query 'Status' --output text 2>/dev/null || true)"
    case "$status" in
      Pending | InProgress | Delayed | "") continue ;;
      *) break ;;
    esac
  done
  awsc ssm get-command-invocation --command-id "$command_id" --instance-id "$instance" \
    --query 'StandardOutputContent' --output text 2>/dev/null || true
  [ "$status" = "Success" ]
}

# JSON string body of $1. Values reaching here never hold control characters (checked on read).
json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}

# Prints the HTTP status of a GET, or "unreachable". Needs curl, which is optional on the laptop.
http_status() {
  if ! command -v curl >/dev/null 2>&1; then
    printf 'not checked (no curl on this machine)'
    return 0
  fi
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1" 2>/dev/null || true)"
  if [ -z "$code" ] || [ "$code" = "000" ]; then code="unreachable"; fi
  printf '%s' "$code"
}
