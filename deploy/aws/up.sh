#!/usr/bin/env bash
# One command that deploys, or redeploys, the whole treklink-web system to the team AWS account
# (deploy/aws/RUNBOOK.md, "One command (2026-11-10)"). Needs bash, git and AWS CLI v2 on the laptop only.
#
#   deploy/aws/up.sh [--profile treklink] [--region ap-southeast-2] [--stage staging] [--ref HEAD]
#
# Steps: check prerequisites, deploy or update the CloudFormation stack cfn/treklink.yml, push the values
# of deploy/aws/.env.aws to SSM Parameter Store, upload the repository at --ref, then have the host
# build and start compose and publish the web app to S3 and CloudFront, through SSM Run Command.
# Idempotent: run it again to redeploy. It never prints a secret value.
set -euo pipefail

# shellcheck source=deploy/aws/lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

REF="HEAD"
ENV_FILE="$TREKLINK_AWS_DIR/.env.aws"
INSTANCE_TYPE=""
NEW_AMI=0
DRY_RUN=0
SKIP_INFRA=0

# Keys of .env.aws that up.sh reads and never sends to the host.
LOCAL_ONLY_KEYS="BUDGET_EMAIL BUDGET_LIMIT_USD"
# Keys up.sh or the host computes; refused in .env.aws so two sources never disagree.
COMPUTED_KEYS="MQTT_DOMAIN CORS_ORIGINS FIELD_STATION_BROKER_URL BACKEND_TAG VITE_API_BASE_URL VITE_WS_URL"
# Keys compose.yml fixes for the host; accepted but without effect, so up.sh warns.
FIXED_KEYS="NODE_ENV PORT_BACKEND MQTT_BROKER_URL MQTT_INGESTION_ENABLED JOBS_TICK_ON_REQUEST FIELD_SIMULATOR_ENABLED DEMO_CONTROLS_ENABLED DEMO_TEST_ACCOUNTS_ENABLED DEMO_SIMULATION_ENABLED SWAGGER_ENABLED HANDOVER_NOTE_STORE"
REQUIRED_KEYS="BUDGET_EMAIL ACME_EMAIL DATABASE_URL DATABASE_DIRECT_URL MQTT_AUTH_HOOK_SECRET MQTT_USERNAME MQTT_PASSWORD MQTT_NODE_PASSWORD JWT_ACCESS_SECRET MAIL_TRANSPORT MAIL_FROM COMPANY_LEGAL_NAME COMPANY_ADDRESS COMPANY_TAX_CODE COMPANY_HOTLINE HANDOVER_PLACE CHANNEL_KEY_MASTER VITE_APP_ENV"

usage() {
  cat <<'EOF'
Usage: deploy/aws/up.sh [options]

Deploys or redeploys the treklink-web system to AWS. Safe to run again.

Options:
  --profile NAME        AWS CLI profile (default: treklink, or $AWS_PROFILE)
  --region NAME         AWS region (default: ap-southeast-2)
  --stage NAME          environment name, stack treklink-<stage> (default: staging)
  --ref REF             git commit, branch or tag to deploy (default: HEAD)
  --env-file PATH       secrets file (default: deploy/aws/.env.aws)
  --instance-type TYPE  t4g.small, t4g.medium or t4g.large (default: keep the current one, t4g.small at
                        creation)
  --new-ami             move the host to the latest Amazon Linux 2023 AMI; this REPLACES the instance
  --skip-infra          skip the CloudFormation step and only redeploy the code and the secrets
  --dry-run             parse the options, check the local files, print the plan, call nothing on AWS
  -h, --help            show this help
EOF
}

need_value() {
  if [ $# -lt 2 ] || [ -z "$2" ]; then
    CURRENT_STEP="arguments"
    die "$1 needs a value (see --help)"
  fi
}

parse_args() {
  CURRENT_STEP="arguments"
  while [ $# -gt 0 ]; do
    case "$1" in
      --profile) need_value "$@"; PROFILE="$2"; shift 2 ;;
      --profile=*) PROFILE="${1#*=}"; shift ;;
      --region) need_value "$@"; REGION="$2"; shift 2 ;;
      --region=*) REGION="${1#*=}"; shift ;;
      --stage) need_value "$@"; STAGE="$2"; shift 2 ;;
      --stage=*) STAGE="${1#*=}"; shift ;;
      --ref) need_value "$@"; REF="$2"; shift 2 ;;
      --ref=*) REF="${1#*=}"; shift ;;
      --env-file) need_value "$@"; ENV_FILE="$2"; shift 2 ;;
      --env-file=*) ENV_FILE="${1#*=}"; shift ;;
      --instance-type) need_value "$@"; INSTANCE_TYPE="$2"; shift 2 ;;
      --instance-type=*) INSTANCE_TYPE="${1#*=}"; shift ;;
      --new-ami) NEW_AMI=1; shift ;;
      --skip-infra) SKIP_INFRA=1; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      -h | --help) usage; exit 0 ;;
      *) die "unknown option: $1 (see --help)" ;;
    esac
  done
  check_common_flags
  case "$INSTANCE_TYPE" in
    "" | t4g.small | t4g.medium | t4g.large) ;;
    *) die "--instance-type must be t4g.small, t4g.medium or t4g.large (arm64 images only)" ;;
  esac
  if [ "$NEW_AMI" -eq 1 ] && [ "$SKIP_INFRA" -eq 1 ]; then
    die "--new-ami needs the CloudFormation step; drop --skip-infra"
  fi
  [ -n "$REF" ] || die "--ref must not be empty"
}

# ---- .env.aws: read without sourcing, so a $ or a backtick in a secret is never run ----
ENV_KEYS=()
ENV_VALUES=()

in_list() {
  local item
  for item in $2; do
    if [ "$item" = "$1" ]; then return 0; fi
  done
  return 1
}

env_get() {
  local i=0
  while [ "$i" -lt "${#ENV_KEYS[@]}" ]; do
    if [ "${ENV_KEYS[$i]}" = "$1" ]; then
      printf '%s' "${ENV_VALUES[$i]}"
      return 0
    fi
    i=$((i + 1))
  done
  return 1
}

read_env_file() {
  [ -f "$ENV_FILE" ] || die "$ENV_FILE not found. Copy deploy/aws/.env.aws.example to it and fill it in."
  local line key value number=0 problems=0
  while IFS= read -r line || [ -n "$line" ]; do
    number=$((number + 1))
    line="${line%$'\r'}"
    case "$line" in
      "" | \#*) continue ;;
    esac
    case "$line" in
      *=*) ;;
      *) warn "$ENV_FILE line $number has no '=', ignored"; continue ;;
    esac
    key="${line%%=*}"
    value="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    if ! printf '%s' "$key" | grep -Eq '^[A-Z][A-Z0-9_]*$'; then
      log "  line $number: \"$key\" is not an UPPER_CASE variable name"
      problems=$((problems + 1))
      continue
    fi
    # Matching outer quotes are removed, nothing else.
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac
    case "$value" in
      *[[:cntrl:]]*)
        log "  $key: the value holds a control character (a tab or a line break)"
        problems=$((problems + 1)); continue ;;
      *\'*)
        log "  $key: the value holds a single quote, which deploy/aws/.env cannot carry"
        problems=$((problems + 1)); continue ;;
    esac
    if env_get "$key" >/dev/null; then
      log "  $key: set twice"
      problems=$((problems + 1)); continue
    fi
    if in_list "$key" "$COMPUTED_KEYS"; then
      log "  $key: computed by up.sh and the host, remove it from the file"
      problems=$((problems + 1)); continue
    fi
    if in_list "$key" "$FIXED_KEYS"; then
      warn "$key is fixed by compose.yml for the host; the value in $ENV_FILE has no effect"
    fi
    if [ -z "$value" ]; then continue; fi
    ENV_KEYS+=("$key")
    ENV_VALUES+=("$value")
  done < "$ENV_FILE"
  [ "$problems" -eq 0 ] || die "$problems problem(s) in $ENV_FILE (names above; no value is printed)"
}

check_env_values() {
  local key value problems=0
  for key in $REQUIRED_KEYS; do
    if ! env_get "$key" >/dev/null; then
      log "  $key: missing or empty"
      problems=$((problems + 1))
    fi
  done
  if value="$(env_get MQTT_AUTH_HOOK_SECRET)" && ! printf '%s' "$value" | grep -Eq '^[0-9a-fA-F]{16,}$'; then
    log "  MQTT_AUTH_HOOK_SECRET: must be at least 16 hexadecimal characters (openssl rand -hex 32)"
    problems=$((problems + 1))
  fi
  if value="$(env_get MQTT_NODE_PASSWORD)" && [ "${#value}" -lt 16 ]; then
    log "  MQTT_NODE_PASSWORD: must be at least 16 characters"
    problems=$((problems + 1))
  fi
  if value="$(env_get CHANNEL_KEY_MASTER)" && [ "${#value}" -lt 32 ]; then
    log "  CHANNEL_KEY_MASTER: must be at least 32 characters"
    problems=$((problems + 1))
  fi
  if value="$(env_get JWT_ACCESS_SECRET)" && [ "${#value}" -lt 32 ]; then
    log "  JWT_ACCESS_SECRET: must be at least 32 characters"
    problems=$((problems + 1))
  fi
  for key in DATABASE_URL DATABASE_DIRECT_URL; do
    if value="$(env_get "$key")" && ! printf '%s' "$value" | grep -Eq '^postgres(ql)?://'; then
      log "  $key: must be a postgres:// or postgresql:// URL"
      problems=$((problems + 1))
    fi
  done
  if value="$(env_get MAIL_TRANSPORT)"; then
    if [ "$value" != "smtp" ]; then
      log "  MAIL_TRANSPORT: must be smtp (NODE_ENV=production refuses console)"
      problems=$((problems + 1))
    elif ! env_get SMTP_URL >/dev/null; then
      log "  SMTP_URL: required with MAIL_TRANSPORT=smtp"
      problems=$((problems + 1))
    fi
  fi
  if value="$(env_get COMPANY_TAX_CODE)" && [ "$value" = "0000000000" ]; then
    log "  COMPANY_TAX_CODE: the placeholder is refused in production"
    problems=$((problems + 1))
  fi
  if value="$(env_get COMPANY_HOTLINE)" && [ "$value" = "1900 0000" ]; then
    log "  COMPANY_HOTLINE: the placeholder is refused in production"
    problems=$((problems + 1))
  fi
  if value="$(env_get BUDGET_EMAIL)" && ! printf '%s' "$value" | grep -Eq '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'; then
    log "  BUDGET_EMAIL: not an email address"
    problems=$((problems + 1))
  fi
  if value="$(env_get BUDGET_LIMIT_USD)" && ! printf '%s' "$value" | grep -Eq '^[1-9][0-9]*$'; then
    log "  BUDGET_LIMIT_USD: must be a whole number of USD"
    problems=$((problems + 1))
  fi
  if value="$(env_get CORS_EXTRA_ORIGINS)" && ! printf '%s' "$value" | grep -Eq '^https?://[A-Za-z0-9.:-]+(,https?://[A-Za-z0-9.:-]+)*$'; then
    log "  CORS_EXTRA_ORIGINS: must be comma-separated origins such as https://example.org, without spaces or paths"
    problems=$((problems + 1))
  fi
  [ "$problems" -eq 0 ] || die "$problems problem(s) in $ENV_FILE (names above; no value is printed)"
}

# ---- git: the ref to deploy ----
COMMIT=""

resolve_ref() {
  command -v git >/dev/null 2>&1 || die "git is not installed"
  git -C "$TREKLINK_REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || die "$TREKLINK_REPO_ROOT is not a git checkout"
  COMMIT="$(git -C "$TREKLINK_REPO_ROOT" rev-parse --verify --quiet "$REF^{commit}")" \
    || die "git ref \"$REF\" not found here (fetch it first, for example: git fetch origin staging)"
  # The deployed tree must carry the files this script drives.
  local path
  for path in deploy/aws/compose.yml deploy/aws/Caddyfile backend/Dockerfile frontend/package.json; do
    git -C "$TREKLINK_REPO_ROOT" cat-file -e "$COMMIT:$path" 2>/dev/null \
      || die "$REF ($COMMIT) has no $path"
  done
  if ! git -C "$TREKLINK_REPO_ROOT" show "$COMMIT:deploy/aws/Caddyfile" | grep -q '/socket.io/'; then
    die "$REF predates the one-command deploy: its deploy/aws/Caddyfile serves no public API. Deploy a ref that contains it."
  fi
  if [ "$REF" = "HEAD" ] && [ -n "$(git -C "$TREKLINK_REPO_ROOT" status --porcelain --untracked-files=no)" ]; then
    warn "the checkout has uncommitted changes; they are NOT deployed (git archive takes the commit only)"
  fi
}

print_plan() {
  log "Plan:"
  log "  stack           $(stack_name) in $REGION (profile $PROFILE)"
  log "  ref             $REF -> ${COMMIT:-unresolved}"
  log "  env file        $ENV_FILE (${#ENV_KEYS[@]} values; names only below)"
  log "  SSM path        $(ssm_path)/"
  log "  instance type   ${INSTANCE_TYPE:-keep current (t4g.small at creation)}"
  log "  new AMI         $([ "$NEW_AMI" -eq 1 ] && echo "yes, the instance is replaced" || echo "no")"
  log "  CloudFormation  $([ "$SKIP_INFRA" -eq 1 ] && echo "skipped" || echo "deploy or update")"
  local names="" i=0
  while [ "$i" -lt "${#ENV_KEYS[@]}" ]; do
    names="$names ${ENV_KEYS[$i]}"
    i=$((i + 1))
  done
  log "  values:$names"
}

# ---- CloudFormation ----
deploy_stack() {
  local status
  status="$(stack_status)"
  case "$status" in
    NONE | *_COMPLETE) ;;
    *_IN_PROGRESS) die "stack $(stack_name) is $status; wait for it to finish, then run up.sh again" ;;
    *) die "stack $(stack_name) is $status; see the stack events in the console, or run down.sh" ;;
  esac
  if [ "$status" = "ROLLBACK_COMPLETE" ]; then
    die "stack $(stack_name) is ROLLBACK_COMPLETE (its creation failed) and cannot be updated. Read the events, then run deploy/aws/down.sh and up.sh again."
  fi

  # Pin the AMI: an update must not replace the host because AWS published a newer image.
  local image_id=""
  if [ "$status" != "NONE" ] && [ "$NEW_AMI" -eq 0 ]; then
    local instance
    instance="$(stack_output InstanceId)"
    if [ -n "$instance" ]; then
      image_id="$(awsc ec2 describe-instances --instance-ids "$instance" \
        --query 'Reservations[0].Instances[0].ImageId' --output text)"
    fi
  fi
  if [ -z "$image_id" ]; then
    image_id="$(awsc ssm get-parameter \
      --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
      --query 'Parameter.Value' --output text)"
    [ "$status" = "NONE" ] || log "  moving the host to $image_id: the instance is replaced"
  fi
  log "  stack status $status, AMI $image_id"

  local overrides=("Stage=$STAGE" "ImageId=$image_id" "BudgetEmail=$(env_get BUDGET_EMAIL)")
  if [ -n "$INSTANCE_TYPE" ]; then overrides+=("InstanceType=$INSTANCE_TYPE"); fi
  local limit
  if limit="$(env_get BUDGET_LIMIT_USD)"; then overrides+=("BudgetLimitUsd=$limit"); fi

  if ! awsc cloudformation deploy \
    --stack-name "$(stack_name)" \
    --template-file "$TREKLINK_AWS_DIR/cfn/treklink.yml" \
    --capabilities CAPABILITY_IAM \
    --no-fail-on-empty-changeset \
    --parameter-overrides "${overrides[@]}" \
    --tags "Project=treklink" "Stage=$STAGE"; then
    log "  latest failed stack events (resource, status, reason):"
    awsc cloudformation describe-stack-events --stack-name "$(stack_name)" --max-items 50 \
      --query "StackEvents[?contains(ResourceStatus, 'FAILED')].[LogicalResourceId,ResourceStatus,ResourceStatusReason] | [0:8]" \
      --output text 2>/dev/null || true
    die "the CloudFormation deploy failed (events above)"
  fi
}

INSTANCE_ID=""
HOST_NAME=""
FRONTEND_URL=""
FRONTEND_BUCKET=""
ARTIFACT_BUCKET=""
DISTRIBUTION_ID=""

read_outputs() {
  INSTANCE_ID="$(stack_output InstanceId)"
  HOST_NAME="$(stack_output HostName)"
  FRONTEND_URL="$(stack_output FrontendUrl)"
  FRONTEND_BUCKET="$(stack_output FrontendBucketName)"
  ARTIFACT_BUCKET="$(stack_output ArtifactBucketName)"
  DISTRIBUTION_ID="$(stack_output DistributionId)"
  local name
  for name in INSTANCE_ID HOST_NAME FRONTEND_URL FRONTEND_BUCKET ARTIFACT_BUCKET DISTRIBUTION_ID; do
    [ -n "${!name}" ] || die "stack $(stack_name) has no output for $name; run up.sh without --skip-infra"
  done
  log "  host $HOST_NAME ($INSTANCE_ID), web app $FRONTEND_URL"
}

# ---- SSM Parameter Store ----
push_parameters() {
  local path current_file
  path="$(ssm_path)"
  current_file="$TMP_DIR/current-parameters"
  # Name<TAB>Value per line, held in a private temporary file and never printed. Values carry no tab or
  # line break (checked on read), so the split is exact.
  awsc ssm get-parameters-by-path --path "$path/" --recursive --with-decryption \
    --query 'Parameters[].[Name,Value]' --output text > "$current_file"

  local i=0 key value name current changed=0 unchanged=0
  while [ "$i" -lt "${#ENV_KEYS[@]}" ]; do
    key="${ENV_KEYS[$i]}"
    value="${ENV_VALUES[$i]}"
    i=$((i + 1))
    if in_list "$key" "$LOCAL_ONLY_KEYS"; then continue; fi
    name="$path/$key"
    current="$(awk -F '\t' -v n="$name" '$1 == n { sub(/^[^\t]*\t/, ""); print; exit }' "$current_file")"
    # SSM holds no empty value, so an empty match means the parameter does not exist yet.
    if [ -n "$current" ] && [ "$current" = "$value" ]; then
      unchanged=$((unchanged + 1))
      continue
    fi
    # The value goes through a private file, so it never appears in the process list.
    printf '{"Name":"%s","Value":"%s","Type":"SecureString","Overwrite":true,"Tier":"Standard"}' \
      "$(json_escape "$name")" "$(json_escape "$value")" > "$TMP_DIR/parameter.json"
    awsc ssm put-parameter --cli-input-json "file://$TMP_DIR/parameter.json" --output text >/dev/null \
      || die "could not write $name"
    rm -f "$TMP_DIR/parameter.json"
    log "  updated $key"
    changed=$((changed + 1))
  done

  # A key removed from the file is removed from SSM, so the host's .env follows the file.
  local stale=() existing
  while IFS= read -r existing; do
    [ -n "$existing" ] || continue
    key="${existing##*/}"
    if ! env_get "$key" >/dev/null || in_list "$key" "$LOCAL_ONLY_KEYS"; then
      stale+=("$existing")
    fi
  done < <(cut -f1 "$current_file")
  if [ "${#stale[@]}" -gt 0 ]; then
    local start=0
    while [ "$start" -lt "${#stale[@]}" ]; do
      awsc ssm delete-parameters --names "${stale[@]:$start:10}" --output text >/dev/null \
        || die "could not delete stale parameters"
      start=$((start + 10))
    done
    for existing in "${stale[@]}"; do log "  removed ${existing##*/}"; done
  fi
  rm -f "$current_file"
  log "  $changed updated, $unchanged unchanged, ${#stale[@]} removed under $path/"
}

# ---- Code ----
RUN_ID=""
RUN_PREFIX=""

upload_release() {
  RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(printf '%s' "$COMMIT" | cut -c1-12)"
  RUN_PREFIX="runs/$RUN_ID"
  local archive="$TMP_DIR/source.tar.gz"
  git -C "$TREKLINK_REPO_ROOT" archive --format=tar.gz -o "$archive" "$COMMIT"
  awsc s3 cp "$archive" "s3://$ARTIFACT_BUCKET/$RUN_PREFIX/source.tar.gz" --only-show-errors
  # The host script comes from this checkout, so it always matches the parameters up.sh passes.
  awsc s3 cp "$TREKLINK_AWS_DIR/host/deploy.sh" "s3://$ARTIFACT_BUCKET/$RUN_PREFIX/deploy.sh" --only-show-errors
  log "  s3://$ARTIFACT_BUCKET/$RUN_PREFIX/ ($(wc -c < "$archive" | tr -d ' ') bytes)"
}

# ---- Host ----
COMMAND_ID=""

run_on_host() {
  wait_for_ssm_online "$INSTANCE_ID" 900 \
    || die "the SSM agent of $INSTANCE_ID did not come online within 15 minutes"

  local cors="https://${FRONTEND_URL#https://}" extra
  if extra="$(env_get CORS_EXTRA_ORIGINS)"; then cors="$cors,$extra"; fi

  local script="/opt/treklink/deploy-$RUN_ID.sh"
  local params="$TMP_DIR/command.json"
  # Every value here is a stack output, the commit or the stage: no secret travels in the command.
  {
    printf '{"commands":['
    printf '"set -eu",'
    printf '"mkdir -p /opt/treklink",'
    printf '"aws s3 cp s3://%s/%s/deploy.sh %s --region %s --only-show-errors",' \
      "$ARTIFACT_BUCKET" "$RUN_PREFIX" "$script" "$REGION"
    printf '"exec bash %s --region %s --stage %s --run-id %s --commit %s --artifact-bucket %s --run-prefix %s --frontend-bucket %s --distribution-id %s --host-name %s --cors-origins %s"' \
      "$script" "$REGION" "$STAGE" "$RUN_ID" "$COMMIT" "$ARTIFACT_BUCKET" "$RUN_PREFIX" \
      "$FRONTEND_BUCKET" "$DISTRIBUTION_ID" "$HOST_NAME" "$cors"
    printf '],"executionTimeout":["3600"]}'
  } > "$params"

  COMMAND_ID="$(awsc ssm send-command \
    --instance-ids "$INSTANCE_ID" \
    --document-name AWS-RunShellScript \
    --comment "treklink up.sh $RUN_ID" \
    --timeout-seconds 600 \
    --parameters "file://$params" \
    --output-s3-bucket-name "$ARTIFACT_BUCKET" \
    --output-s3-key-prefix "$RUN_PREFIX/ssm" \
    --query 'Command.CommandId' --output text)"
  log "  SSM command $COMMAND_ID; the host builds the backend and the web app, which takes a while on a t4g.small"

  local waited=0 status="" limit=3900
  while :; do
    sleep 15
    waited=$((waited + 15))
    status="$(awsc ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
      --query 'Status' --output text 2>/dev/null || true)"
    case "$status" in
      Pending | InProgress | Delayed | "")
        if [ $((waited % 60)) -eq 0 ]; then log "  ${status:-Pending} after $((waited / 60)) min"; fi
        if [ "$waited" -ge "$limit" ]; then die "the host command did not finish within $((limit / 60)) minutes"; fi
        ;;
      *) break ;;
    esac
  done

  log ""
  log "---- host output ----"
  print_host_output
  log "---- end of host output ----"
  [ "$status" = "Success" ] || die "the host command ended $status (the failed host step is named above)"
}

# get-command-invocation keeps the first 24,000 characters; the S3 copy has everything, so the tail is
# read from there when it exists.
print_host_output() {
  local out="$TMP_DIR/host-stdout" err="$TMP_DIR/host-stderr" key
  key="$(awsc s3api list-objects-v2 --bucket "$ARTIFACT_BUCKET" --prefix "$RUN_PREFIX/ssm/" \
    --query "Contents[?ends_with(Key, 'stdout')].Key | [0]" --output text 2>/dev/null || true)"
  if [ -n "$key" ] && [ "$key" != "None" ] && awsc s3 cp "s3://$ARTIFACT_BUCKET/$key" "$out" --only-show-errors 2>/dev/null; then
    tail -n 80 "$out"
    if awsc s3 cp "s3://$ARTIFACT_BUCKET/${key%stdout}stderr" "$err" --only-show-errors 2>/dev/null && [ -s "$err" ]; then
      log "---- host errors (last 40 lines) ----"
      tail -n 40 "$err"
    fi
  else
    awsc ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
      --query 'StandardOutputContent' --output text 2>/dev/null | tail -n 80 || true
    awsc ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
      --query 'StandardErrorContent' --output text 2>/dev/null | tail -n 40 || true
  fi
}

check_health() {
  local api="https://$HOST_NAME/api/health" web="$FRONTEND_URL/" api_code web_code
  api_code="$(http_status "$api")"
  web_code="$(http_status "$web")"
  log ""
  log "TrekLink $STAGE is deployed (commit $COMMIT)."
  log "  Web app       $FRONTEND_URL"
  log "  API           https://$HOST_NAME/api"
  log "  MQTT broker   mqtts://$HOST_NAME:8883"
  log "  Health        GET $api -> $api_code"
  log "  Web app       GET $web -> $web_code"
  log "  Admin shell   aws ssm start-session --target $INSTANCE_ID --profile $PROFILE --region $REGION"
  case "$api_code" in
    200 | "not checked"*) ;;
    *) die "GET $api answered $api_code from this machine" ;;
  esac
}

main() {
  trap on_exit EXIT
  parse_args "$@"

  step "check local prerequisites"
  read_env_file
  check_env_values
  resolve_ref
  if [ "$DRY_RUN" -eq 1 ]; then
    print_plan
    log ""
    log "Dry run: nothing was called on AWS."
    exit 0
  fi
  require_aws_cli
  require_credentials
  make_tmp_dir
  print_plan

  if [ "$SKIP_INFRA" -eq 1 ]; then
    step "CloudFormation (skipped)"
  else
    step "deploy or update the CloudFormation stack"
    deploy_stack
  fi

  step "read the stack outputs"
  read_outputs

  step "push the secrets to SSM Parameter Store"
  push_parameters

  step "upload the repository at $REF"
  upload_release

  step "deploy on the host through SSM"
  run_on_host

  step "health check"
  check_health
}

main "$@"
