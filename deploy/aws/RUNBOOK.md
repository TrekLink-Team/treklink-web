# Runbook: the AWS host (D-098)

What it is: one always-on host running the MQTT broker and one backend instance, both written for the field
flow of D-098 (`specs/platform/design.md` §2.5, `specs/platform/tasks.md` Phase 7). The one-command deploy
of 2026-11-10 is built so that the same host also serves the whole API and the web app is published to S3
behind CloudFront, so the system can run on AWS alone. It has not been deployed yet (see "What has not been
tested" below). Neon stays the database (`treklink_prod` on the branch `vercel-prod`), shared with the
Vercel staging, which stays the fallback until AWS passes the W10 checks (leader ruling, 2026-11-10).

There are two ways to deploy it:

- **One command** (the next section): `up.sh`, `status.sh` and `down.sh` from a laptop with bash, git and
  AWS CLI v2. Recommended.
- **The manual path** (sections 1 to 13 further down): the console steps written before 2026-11-10. Kept for
  reference and for debugging a host by hand.

Files in this folder:

| File | Purpose |
|---|---|
| `up.sh` | One command: deploys or redeploys the stack, the secrets, the backend and the web app |
| `status.sh` | Stack status, instance state, compose services on the host, health URLs |
| `down.sh` | Stops compose, empties the buckets, deletes the stack and the SSM parameters |
| `lib.sh` | Shared by the three scripts; never run on its own |
| `host/deploy.sh` | Run on the host by `up.sh` through SSM Run Command; never run on a laptop |
| `cfn/treklink.yml` | The CloudFormation stack: EC2 host, security group, Elastic IP, buckets, CloudFront, budget |
| `.env.aws.example` | Every value `up.sh` needs. Copy it to `.env.aws` on your laptop; git-ignored |
| `compose.yml` | The four services: `caddy`, `mosquitto`, `broker-hook-proxy`, `backend` |
| `Caddyfile` | Let's Encrypt certificate for `MQTT_DOMAIN`; HTTPS for `/api/*` and `/socket.io/*`, 404 for the broker hooks and every other path |
| `mosquitto/mosquitto.conf` | Broker: TLS on 8883 (public), plain 1883 on the compose network only, go-auth hooks |
| `mosquitto/start.sh` | Copies Caddy's certificate for the broker and reloads the broker when Caddy renews it |
| `.env.example` | Manual path: every variable the host needs. Copy it to `.env` on the host and never commit that file |
| `compose.rehearsal.yml`, `Caddyfile.rehearsal` | The same stack on a laptop, with a local Postgres and Caddy's internal CA |

Prices change. Check every amount in this runbook on the AWS pricing pages before you rely on it.

---

## One command (2026-11-10)

### What it builds

All in `ap-southeast-2` (Sydney), the only region where the organisation's SCP allows EC2 (verified
2026-11-10). Stack `treklink-<stage>`, stage `staging` by default:

| Piece | Detail |
|---|---|
| EC2 host | `t4g.small` (2 GB, arm64), latest Amazon Linux 2023 arm64 AMI at creation, 20 GiB encrypted gp3 root volume deleted with the instance, 2 GB swap, in the default VPC |
| Access | No SSH and no key pair. Admin shell through SSM Session Manager. No IAM user and no console password (the organisation denies `iam:CreateLoginProfile`) |
| Security group | Inbound TCP 80, 443 and 8883 from anywhere, nothing else |
| Elastic IP | Gives the host name: the IP with dashes on sslip.io, for example `3-104-1-2.sslip.io`. It is `MQTT_DOMAIN`, the API host and the broker address |
| Host services | `compose.yml`: Caddy (Let's Encrypt certificate, HTTPS API and socket), Mosquitto (MQTT over TLS on 8883, same certificate), broker-hook-proxy, backend |
| Web app | Built on the host in a Node container. `FRONTEND_HOSTING=host` (the default): served by Caddy on the same sslip.io host from `/opt/treklink/www/current` (client routes answered with `index.html`, the two newest builds kept). `FRONTEND_HOSTING=cloudfront`: published to a private S3 bucket and served by CloudFront (Origin Access Control, HTTPS, price class 200) |
| Secrets | SSM Parameter Store SecureString under `/treklink/<stage>/`, written from your `deploy/aws/.env.aws`; the host writes `deploy/aws/.env` from them on every deploy |
| Artifacts | A private S3 bucket for the source archives and the SSM command output, emptied after 14 days |
| Budget | Monthly AWS Budgets cost budget of 40 USD for the whole account, email alert at 80 % actual to `BUDGET_EMAIL` |

**CloudFront needs a verified account.** On 2026-11-10 the first `up.sh` failed at the distribution with
"Your account must be verified before you can add new CloudFront resources" (request ID
379b5ee3-cc54-47ef-90f7-b53b4e155ff5), and the stack rolled back. Until AWS Support verifies the account
(a case under Account and billing), the host serves the web app. After the verification, set
`FRONTEND_HOSTING=cloudfront` in `.env.aws` and run `up.sh`: the stack adds the bucket and the
distribution, and the web app moves to the CloudFront domain.

With the host serving the web app, the browser calls the API on the same origin. With CloudFront, it
calls the API across origins, from the CloudFront domain to the sslip.io host. The host sets
`CORS_ORIGINS` to the CloudFront origin (plus `CORS_EXTRA_ORIGINS`), and the web app is built with
`VITE_API_BASE_URL=https://<host name>/api` and `VITE_WS_URL=https://<host name>`. Tokens travel in the
request body and the `Authorization` header, not in cookies, so the two origins need nothing more.

### Prerequisites

1. **AWS CLI v2** (`aws --version` prints `aws-cli/2.`), bash (macOS's bash 3.2 works) and git, run from a
   checkout of this repository. No Docker, Node or Terraform is needed on the laptop. `curl` is optional:
   with it, `up.sh` and `status.sh` also check the URLs from the laptop.
2. **A profile named `treklink`** in the team account, either way:
   - `aws login --profile treklink`, the browser sign-in of a recent AWS CLI v2 (the minimum CLI version
     is unverified; update the CLI if the command is unknown), or `aws configure sso --profile treklink`
     where the account offers IAM Identity Center;
   - an access key profile: `aws configure --profile treklink`, with the key of an existing identity the
     leader gives you. Do not create IAM users for this.

   Check it with `aws sts get-caller-identity --profile treklink`. Another profile name works with
   `--profile <name>`.
3. **The Neon role** `treklink_field` and its pooled connection string: manual path §5 creates it once.
4. **A ref that contains these files.** `up.sh` refuses a commit whose `deploy/aws/Caddyfile` predates the
   public API. Its schema must also already be migrated on `treklink_prod` by the Vercel production build,
   because the host never runs `prisma migrate` (manual path §5).

### The env file

```bash
cp deploy/aws/.env.aws.example deploy/aws/.env.aws && chmod 600 deploy/aws/.env.aws
```

Fill in every uncommented key. Generate each secret with `openssl rand -hex 32`. Copy the mail values, the
`COMPANY_*` values, `HANDOVER_PLACE` and `CHANNEL_KEY_MASTER` from the Vercel project's Production
environment. `up.sh` checks the file before it calls AWS, names each problem without printing a value,
and refuses the keys it computes itself (`MQTT_DOMAIN`, `CORS_ORIGINS`, `FIELD_STATION_BROKER_URL`,
`BACKEND_TAG`, `VITE_API_BASE_URL`, `VITE_WS_URL`). The file is git-ignored by `deploy/aws/.gitignore`.
Never commit it, paste it in chat or send it in Zalo.

### Up

```bash
deploy/aws/up.sh
```

Options: `--profile`, `--region`, `--stage`, `--ref` (default `HEAD`, the commit you have checked out;
uncommitted changes are not deployed), `--instance-type`, `--skip-infra` (code and secrets only),
`--new-ami` (moves the host to the latest AMI by replacing the instance) and `--dry-run` (checks the
options, the env file and the ref, prints the plan, calls nothing on AWS). `deploy/aws/up.sh --help`
lists them.

What it does, each step named in its output and in its error message when it fails:

1. Checks the AWS CLI, the credentials, the env file and the ref.
2. `aws cloudformation deploy` of `cfn/treklink.yml`: creates the stack, or updates it. The AMI is pinned
   to the one the host runs, so an update never replaces the instance unless you pass `--new-ami`.
3. Reads the stack outputs.
4. Writes each value of `.env.aws` to SSM as a SecureString, only when it changed, and deletes the
   parameters whose key you removed from the file. Values go through a private temporary file, never on
   a command line.
5. `git archive` of the ref and the host script into the artifact bucket.
6. SSM Run Command on the host: installs the release in `/opt/treklink/app`, writes `deploy/aws/.env`
   (mode 0600), builds the backend image, starts compose, waits for the backend to be healthy, builds the
   web app, syncs it to the frontend bucket, invalidates CloudFront and checks
   `https://<host name>/api/health` from the host. The build logs stay on the host in
   `/opt/treklink/logs/`; the last lines are printed when a host step fails.
7. Prints the URLs and the health results.

The first run creates everything, including Caddy's first certificate from Let's Encrypt. sslip.io names
share Let's Encrypt's rate limits with every other sslip.io user, so issuance can fail on a busy week
(manual path §1). The certificate lives on the host's disk and survives redeploys; `down.sh` deletes it.

Run `up.sh` again to redeploy. A redeploy rebuilds the backend image and the web app, restarts the backend
(the restart window of manual path §10 applies), and restarts Caddy, Mosquitto or the proxy only when their
mounted files changed.

### Status

```bash
deploy/aws/status.sh
```

Prints the stack status, the instance state, the deployed commit, `docker compose ps` on the host and the
two health URLs. Read-only.

For a shell on the host: `aws ssm start-session --target <InstanceId> --profile treklink --region
ap-southeast-2` (needs the Session Manager plugin for the AWS CLI on the laptop), then
`sudo -i` and `cd /opt/treklink/app/deploy/aws`. Logs: manual path §9.

### Down

```bash
deploy/aws/down.sh
```

Asks you to type the stack name, then stops compose, empties both buckets, deletes the stack (instance,
volume, Elastic IP, buckets, CloudFront distribution, budget) and deletes the SSM parameters under
`/treklink/<stage>/` (`--keep-parameters` keeps them). Nothing billable is left. The Neon database is not
touched. The next `up.sh` gets a new Elastic IP, so the host name changes and every node, phone and Field
Station needs the new broker address. Rotate the secrets as in manual path §12 if the host is gone for good.

### Cost notes

Check every price on the AWS pricing pages before relying on it; prices differ by region and change.
On 2026-11-10 the leader saw on-demand `t4g.small` at 0.0212 USD per hour in Sydney, which is about
15.5 USD for a 730-hour month before any free-plan credit. What else bills while the stack exists:

- the public IPv4 address of the Elastic IP, billed by the hour;
- the 20 GiB gp3 root volume, billed per GB-month;
- CloudFront requests and data transfer out, and S3 storage and requests (small for this web app);
- data transfer out of the host, and to Neon in Singapore.

Standard SSM parameters and the budget are expected to cost nothing (check the pricing pages). A stopped
instance still pays for its volume and its Elastic IP: `down.sh` is the way to stop paying. The stack's
budget alerts at 80 % of 40 USD; the manual budgets of manual path §2 may exist next to it.

### Rollback to Vercel

The Vercel project is not touched by any of this and keeps serving the staging, so a rollback needs no
deploy:

1. Send testers back to the Vercel staging URL. The landing page already lists it: `deploy/system-endpoints.json`
   on `main` is changed only after AWS passes the W10 checks.
2. Stop the AWS backend so that only Vercel writes Neon: `down.sh`, or for a pause
   `aws ssm start-session` then `cd /opt/treklink/app/deploy/aws && docker compose stop`.
3. Field clients pointed at the sslip.io broker fall back to their queues as in manual path §11.

To roll the AWS host back to an earlier commit instead: `deploy/aws/up.sh --ref <commit>`. Nothing on the
host migrates the database, so there is no schema to roll back.

### What has not been tested (2026-11-10)

The scripts and the template were checked with shellcheck, cfn-lint, a dry run and a run against a mock
AWS CLI, without AWS credentials. The first complete run was on 2026-11-13 (recorded below); it was also the first test of: the stack creation in the team account under its SCPs (IAM role creation, Budgets,
CloudFront), the first-boot set-up on Amazon Linux 2023 (Compose v2.32.4 and Buildx v0.19.3 from GitHub),
the backend and web app builds on a `t4g.small` (the host prints the available memory before each build
and the swap in use after the web app build; record them), the certificate for the sslip.io name, and the web app
calling the API across origins. Record the result here.

**First runs in the team account, 2026-11-10.** Three `up.sh` runs, all stopped at the stack creation and
rolled back; each empty stack was deleted, and no instance, Elastic IP, bucket, budget or parameter was left.

1. 14:08: `FrontendDistribution` failed with "Your account must be verified before you can add new CloudFront
   resources" (request ID 379b5ee3-cc54-47ef-90f7-b53b4e155ff5). The web app moved to the host
   (`FRONTEND_HOSTING=host`).
2. 14:44 and 15:00: `Host` failed with EC2 "This account is currently blocked and not recognized as a valid
   account". An `ec2 run-instances --dry-run` at 15:00 answered "Request would have succeeded", so a dry run does
   not show this block. The AWS settings page shows "Actions are currently unavailable. To protect your account,
   some actions have been disabled."

What worked: credentials and the `ap-southeast-2` region, the change set, the IAM role and instance profile
(the inline SSM agent policy was accepted), the artifact bucket and its policy, the security group, and the
budget. Support case 179429676400684 (Account Activation, Account Verification) was opened on 2026-11-10 at
14:46. Run `up.sh` again after AWS answers; until then the Vercel staging stays the system.

**First complete run, new team account, 2026-11-13.** The suspended account was replaced by account
566332862593 (region `ap-southeast-2`, IAM user `Admin` with AdministratorAccess for `up.sh`; member IAM users
are view-only). `up.sh --profile treklink-admin` at 06:02 (UTC+7) on commit 7118d6a8 (this branch rebased on
`dev` 510daa90) created the stack from AMI ami-071733a41b3cc3de4 with `FRONTEND_HOSTING=host`, and the host
answered in about ten minutes:

- backend image build: 1337 MiB available before, about two minutes; web app build: 1041 MiB available before,
  10 MiB swap in use after; 14 GB disk free after the clean-up.
- Let's Encrypt issued the sslip.io certificate on the first try; `GET /api/health` returned 200 with
  `database: up` and `mqtt: up`, the web app returned 200, and port 8883 accepted a TCP connection.
- `up.sh` still exited 1 at its final health check because the operator laptop's resolver (Tailscale DNS,
  100.100.100.100) answers `0.0.0.0` for `*.sslip.io`; a public resolver returns the Elastic IP. A network
  that filters sslip.io cannot reach the host by name: a team domain avoids it (section 1, option 1).
- Before the run, the one migration on `dev` that Neon `treklink_prod` lacked
  (`20261107140000_demo_quick_controls`, two new tables) was applied by the database owner, because the
  host never migrates.

---

# The manual path (written before 2026-11-10)

The sections below are the console steps of D-098. The one-command deploy above replaces them. Note that
section 2 names Singapore, `ap-southeast-1`, where the organisation's SCP now denies EC2 (verified
2026-11-10): use `ap-southeast-2` if you follow it. The Caddyfile now serves the whole API, not only
`/api/health` as section 7 describes.

## 1. Decide the host name (manual path)

Let's Encrypt needs a DNS name that resolves to the host's static IP. The name goes in `MQTT_DOMAIN` and
becomes the broker address of every node, phone and Field Station.

1. **Recommended**: a subdomain of a domain the team controls, for example `mqtt.<domain>`, as an `A`
   record to the static IP.
2. `<a>-<b>-<c>-<d>.sslip.io`, the static IP with dashes. It needs no DNS setup, but Let's Encrypt rate
   limits are shared with every other user of sslip.io, so issuance can fail on a busy week.
3. No public certificate. Not supported by these files. Nodes would still connect, because the firmware
   does not verify the certificate (`setInsecure()`), but the Field Station's MQTT client does verify it and
   would refuse.

## 2. AWS console (the leader) (manual path)

Pick one of the two options. Both run in Singapore, `ap-southeast-1`, next to Neon and the Vercel
function.

### Option A: Lightsail (fewer moving parts)

1. Lightsail, Create instance: region Singapore, platform Linux/Unix, blueprint OS Only, Ubuntu 24.04 LTS,
   the 2 GB RAM plan. Name it `treklink-field`.
2. Networking, Create static IP, attach it to `treklink-field`. Write the IP down.
3. Instance, Networking, IPv4 firewall: keep SSH 22 and restrict it to your own IP (or use the browser
   SSH only), keep HTTP 80, add HTTPS 443 and a custom TCP rule for 8883. No other port, and not 1883.
   If IPv6 networking is on, apply the same rules to the IPv6 firewall, or turn IPv6 off.

### Option B: EC2

1. EC2, Launch instance: Ubuntu Server 24.04 LTS, architecture 64-bit (Arm), type `t4g.small`, a new key
   pair, 20 GB gp3 root volume with "Delete on termination" on, in the default VPC with a public subnet.
2. Security group `treklink-field`: inbound TCP 22 from your IP only, TCP 80, 443 and 8883 from
   `0.0.0.0/0`. Nothing else.
3. Elastic IPs, Allocate, then Associate it with the instance.
4. Do not create a NAT gateway, a load balancer, or a second VPC. None is needed.

### Budget alarms (both options)

Billing and Cost Management, Budgets, Create budget, Cost budget, monthly:

1. `treklink-10`: amount US$10, alerts at 80 % actual and 100 % forecasted, to the leader's email.
2. `treklink-50`: amount US$50, alert at 100 % actual, to the leader's email and one other member.

### What costs money without doing anything useful

- A public IPv4 address: AWS bills each public IPv4 address by the hour, attached or not. On EC2 this
  includes the Elastic IP. Lightsail plans include one public IPv4 address while the instance exists. Check
  the current price on the AWS pricing page.
- An Elastic IP or Lightsail static IP left after its instance is deleted.
- A NAT gateway or a load balancer: billed by the hour even when idle. This host needs neither.
- Snapshots, AMIs and EBS volumes that outlive the instance.
- A stopped EC2 instance still pays for its EBS volume and its Elastic IP.
- Data transfer out above the plan's allowance. MQTT field traffic is small, but a loop that republishes
  is not.

## 3. DNS (manual path)

Create the `A` record `MQTT_DOMAIN` with the static IP as its value, then check it from your laptop:

```bash
dig +short mqtt.<domain>
```

Wait until it prints the static IP before step 6. Otherwise Caddy's first attempts fail, and Let's
Encrypt counts the failures against its rate limit.

## 4. Prepare the host (manual path)

SSH in (`ssh ubuntu@<static IP>`), then:

```bash
sudo apt-get update && sudo apt-get -y upgrade
```

Install Docker Engine and the Compose plugin from Docker's own apt repository, following
https://docs.docker.com/engine/install/ubuntu/ (section "Install using the apt repository"). Then let
the `ubuntu` user run Docker and log in again:

```bash
sudo usermod -aG docker ubuntu
```

The backend image is built on the host, and the build needs more than 2 GB of memory at its peak. Add a
2 GB swap file once:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Docker publishes ports past `ufw`, so the Lightsail firewall or the security group is the firewall. Do
not rely on `ufw` for 80, 443 and 8883.

## 5. Code and environment (manual path)

The backend image must come from the commit the Vercel staging runs, after that build has migrated
`treklink_prod`, so that the Prisma client matches the schema. The repository is private. Either clone it
with a read-only fine-grained token or a deploy key:

```bash
git clone --branch staging https://github.com/TrekLink-Team/treklink-web.git && cd treklink-web
```

or copy an archive from your laptop:

```bash
git archive --format=tar.gz -o treklink-web.tar.gz origin/staging && scp treklink-web.tar.gz ubuntu@<static IP>:
```

Fill in the environment:

```bash
cd treklink-web/deploy/aws && cp .env.example .env && chmod 600 .env && nano .env
```

- Generate each secret with `openssl rand -hex 32`. That covers `MQTT_AUTH_HOOK_SECRET`, `MQTT_PASSWORD`,
  `MQTT_NODE_PASSWORD` and `JWT_ACCESS_SECRET`.
- Give the host its own Neon role, one that can read and write rows but cannot change the schema. Run this in the
  Neon SQL editor on `treklink_prod` (branch `vercel-prod`) as the owner role, with your own password in
  place of the placeholder. Create the role with SQL, not on the console's Roles page: roles created there
  join `neon_superuser` (unverified; check Neon's "Manage roles" page). `<owner>` is the role the Vercel
  build migrates with, so tables that later migrations create get the same grants.

  ```sql
  CREATE ROLE treklink_field LOGIN PASSWORD '<long random password>';
  GRANT CONNECT ON DATABASE treklink_prod TO treklink_field;
  GRANT USAGE ON SCHEMA public TO treklink_field;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO treklink_field;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO treklink_field;
  ALTER DEFAULT PRIVILEGES FOR ROLE <owner> IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO treklink_field;
  ALTER DEFAULT PRIVILEGES FOR ROLE <owner> IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO treklink_field;
  ```

  Build the pooled connection string for `treklink_field` (Connect, Pooled connection) and put it in both
  `DATABASE_URL` and `DATABASE_DIRECT_URL`.
- Copy the mail values, the `COMPANY_*` values, `HANDOVER_PLACE`, `CHANNEL_KEY_MASTER` and `VITE_APP_ENV`
  from the Vercel project's Production environment.
- The container never runs `prisma migrate` or a seed. Migrations stay with the Vercel production build
  (`backend/scripts/vercel-build.sh`).

## 6. Start (manual path)

```bash
docker compose build backend
```

```bash
docker compose up -d
```

```bash
docker compose ps
```

Expected within about two minutes:

- `caddy` logs `certificate obtained successfully` for `MQTT_DOMAIN`. Check with
  `docker compose logs caddy | grep -i certificate`.
- `mosquitto` logs `start.sh: certificate copied` and then `mosquitto version 2.0.18 running`. Until Caddy
  has the certificate it logs `waiting for Caddy's certificate`.
- `backend` is `healthy` and logs
  `Connected to mqtt://mosquitto:1883; subscribing to treklink/2/json/+/+, treklink/fs/+/health`.

## 7. Check it (manual path)

From your laptop:

```bash
curl -s https://mqtt.<domain>/api/health
```

The answer has `"database":"up"` and `"mqtt":"up"`. Any other path on 443 answers 404, the broker hooks
included.

```bash
openssl s_client -connect mqtt.<domain>:8883 -servername mqtt.<domain> </dev/null | grep "Verify return code"
```

The answer is `Verify return code: 0 (ok)`.

A test publish as a fleet node. It needs `mosquitto-clients` on the laptop, and `!de000009` (TL-0009 of the
demo seed) stands in for a real node id:

```bash
mosquitto_pub -h mqtt.<domain> -p 8883 --capath /etc/ssl/certs -V 5 -q 1 -d -u 'node-!de000009' -P '<MQTT_NODE_PASSWORD>' -t 'treklink/2/json/LongFast/!de000009' -m '{"id":1,"timestamp":0,"to":4294967295,"from":3724541961,"channel":0,"type":"telemetry","sender":"!de000009","payload":{"battery_level":80}}'
```

`PUBACK (Mid: 1, RC:0)` means accepted. The event then appears in the Field data sync audit on the Vercel
staging, signed in as `admin@treklink.local`. On macOS use `--cafile` with the system bundle instead of
`--capath`.

## 8. Point the field clients at it (manual path)

**Wi-Fi node (Stage A, B).** At the docking page (devices design §8.8), set:

- broker address: `MQTT_DOMAIN` (port 8883 follows from TLS),
- user name: `node-<nodeId>`, the node's id in the `!xxxxxxxx` form,
- password: `MQTT_NODE_PASSWORD`,
- TLS: on.

Root `treklink`, JSON on and encryption off are fixed by the page.

**Phone (Meshtastic app, MQTT client proxy).** Use this for a node without Wi-Fi. The node's MQTT module
config is the same as for a Wi-Fi node, plus "Proxy to client enabled". In the app, open the node's MQTT
settings and set: enabled, address `MQTT_DOMAIN`, the same user name and password, TLS on, JSON on,
encryption off, root topic `treklink`, proxy to client on. The node hands each message to the app over
Bluetooth, and the app publishes it with those settings (`treklink-firmware` `src/mqtt/MQTT.cpp:473-512`).
The menu labels differ between app versions (unverified). The phone must stay connected to the node and
online. Known limit: a JSON message longer than 434 bytes is cut on the way to the phone
(`mesh.pb.h:876`) and is audited `MALFORMED_ENVELOPE`. Check the audit after the first walk.

**Field Station.** In the station's `.env`:

```bash
MQTT_BROKER_URL="mqtts://mqtt.<domain>:8883"
```

Set `GATEWAY_FS_USERNAME` and `GATEWAY_FS_SECRET` to the Username and Secret of its credential, and
`GATEWAY_MQTT_STATION_TOPIC=true`. Its uplinks go on its data topic and pass only for nodes its
organization holds, with `MQTT_STATION_UPLINK_ENABLED=true` on the host (gateway-sync design §4). The
station's own USB node must be one of its organization's rented units. In the Vercel project, set `FIELD_STATION_BROKER_URL` to the same `mqtts://` URL and redeploy,
so new credentials show the right address.

## 9. Logs (manual path)

```bash
docker compose logs -f --tail=100 backend
```

Swap `backend` for `mosquitto` or `caddy` to follow another service. A refused client shows in the
backend log as `Broker credential refused: username "..." (<reason>)` or `Broker topic denied: ...`;
passwords are never logged. Each service keeps 5 files of 10 MB.

## 10. Update the backend (manual path)

When the Vercel staging moves to a new commit and its build has succeeded:

```bash
git fetch origin staging && git checkout origin/staging
```

```bash
docker compose build backend && docker compose up -d backend
```

**Restart window.** While the backend is down, the broker cannot ask its hooks. A new connection is
dropped after the 5 s hook timeout. A connected client whose 60 s ACL cache entry has expired has its
connection closed at its next publish, because a hook error is not a denial. In the rehearsal, a QoS 1
client then resent the message after the backend returned, and the message was stored once. The Field
Station keeps unacknowledged rows in SQLite and sends them again. A node publishing directly uses the
firmware's MQTT client, and a message it had written to the closed connection is not known to be resent
(unverified; the firmware's onboard queue covers only the time it knows it is offline). Keep the restart
short, and update when no field test is running.

## 11. Roll back (manual path)

```bash
docker compose stop
```

The Vercel staging keeps working with its field simulator. The Field Station keeps its SQLite queue and
retries, and nodes keep their onboard queue. To go back further, check out the previous commit and
repeat step 10. Nothing here migrated the database, so there is no schema to roll back.

## 12. Tear down (manual path)

```bash
docker compose down -v
```

`-v` deletes the certificate, the broker's persistence and Caddy's state. Then, in the console:

- Lightsail: delete the instance, then delete the static IP and any snapshot.
- EC2: terminate the instance, release the Elastic IP, and delete leftover volumes, snapshots and AMIs.

Remove the DNS record and check the bill the following day.

Rotate every secret the host held, because its disk and its `.env` may outlive the instance in a snapshot
or a backup:

- the Neon password of `treklink_field`: `ALTER ROLE treklink_field PASSWORD '<new>'`, or `DROP ROLE` it
  (after `REASSIGN OWNED BY treklink_field TO <owner>; DROP OWNED BY treklink_field;`) if the host is gone
  for good;
- `MQTT_NODE_PASSWORD`: a new value on the next broker, and re-dock every node that carried the old one
  (devices design §8.8);
- `MQTT_AUTH_HOOK_SECRET` and `MQTT_PASSWORD`: new values on the next host;
- each Field Station credential that pointed at this host: revoke it and issue a new one in the portal if
  its secret was ever copied onto the host.

## 13. After go-live (do not do these before the host is live) (manual path)

1. `deploy/system-endpoints.json` on `main`, in a pull request: the landing page sends visitors to the
   Vercel staging, and this host serves no page, so it is not a candidate `url`. Its health URL,
   `https://MQTT_DOMAIN/api/health`, is the one to probe if the leader wants the field flow's state
   checked before the landing page opens the staging.
2. The D-094 rule 1 amendment in the decision register (`treklink-docs`): record that real field data
   reaches the Vercel staging through this host (D-098). The register text is not readable from this
   repository, so the wording is the leader's.

---

## Rehearsal (a laptop or a sandbox)

The same stack, with a local Postgres in place of Neon and Caddy's internal CA in place of Let's
Encrypt. Add `127.0.0.1 mqtt.rehearsal.test` to `/etc/hosts`, and write a throwaway `deploy/aws/.env`
with `MQTT_DOMAIN=mqtt.rehearsal.test` and test secrets. Then:

```bash
docker compose -f compose.yml -f compose.rehearsal.yml up -d postgres
```

```bash
DATABASE_URL=postgresql://postgres:rehearsal@127.0.0.1:55432/treklink_rehearsal DATABASE_DIRECT_URL=postgresql://postgres:rehearsal@127.0.0.1:55432/treklink_rehearsal npx --prefix backend prisma migrate deploy
```

Run the demo seed the same way (`npm --prefix backend run seed:demo`, with the `SEED_*` passwords set).
Then start everything:

```bash
docker compose -f compose.yml -f compose.rehearsal.yml up -d
```

The CA to trust is `/data/caddy/pki/authorities/local/root.crt` in the `caddy` container
(`docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt .`).

### Results of the rehearsal of 2026-11-07 (sandbox, amd64)

Recorded before 2026-11-10. Since then Caddy also serves `/api/*` and `/socket.io/*` on 443, so
`/api/auth/login` no longer answers 404 there; `/api/internal/*` still does. The new routes have not been
rehearsed.

The backend image was built from `backend/Dockerfile` with two sandbox-only differences: `NODE_IMAGE=node:22-bookworm`
in place of the slim image, and no apt step, because the sandbox's proxy refuses `deb.debian.org`. The full image already
has the packages the apt step installs. The proxy's CA was also added for npm and Prisma. The slim image with apt was not
built in the sandbox.

| Check | Result |
|---|---|
| Stack up, `backend` healthy, subscriber connected through go-auth as `treklink-backend` | yes |
| `GET https://mqtt.rehearsal.test/api/health` | 200, `database` up, `mqtt` up |
| `/api/internal/mqtt/acl` and `/api/auth/login` on 443 | 404 both |
| 80 | 308 to HTTPS |
| 8883 against the Caddy CA / against another CA | verify 0 / verify failed |
| 1883 from outside the compose network | connection refused |
| Allowed: node JSON topic (RC 0), node `2/e` topic (RC 16, no subscriber), station health (RC 0), backend subscribe `treklink/#` (granted QoS 1) | 4 of 4 |
| Refused at CONNECT (CONNACK 135): anonymous, wrong node password, wrong station secret, unknown username | 4 of 4 |
| Refused publish (PUBACK 135): node on another node's topic, station on another station's topic, station on `2/e`, backend publish | 4 of 4 |
| Refused subscribe (SUBACK 135): node, station | 2 of 2 |
| Rows: the node telemetry reached `field_events` (`ingress` `MQTT_NODE`, `ACCEPTED_UNATTRIBUTED` because the seed's handover is minutes old, `NEAR_HANDOVER`); the station health report set `lastSyncAt` and `queueDepth {0,0,1,3}` | events and 1 station row |
| A new certificate in Caddy's folder, as a renewal writes it: copied and reloaded by `start.sh` within one `CERT_CHECK_SECONDS` (60 s), new connections got it; the same after Caddy reissued its own | yes, twice |
| `docker compose stop mosquitto`: clean exit in 1 s, persistence saved (before the fix in `start.sh`, the root-owned volume made the save fail) | yes |
| Backend stopped: new CONNECT dropped after the 5 s hook timeout; a connected QoS 1 client publishing 65 s into the outage was disconnected, resent after the backend returned, and the event was stored once | yes |

#### Station uplinks after the review of treklink-web#431 (same day, second run)

Image rebuilt after the review: no Prisma CLI in the runtime stage (`node_modules/prisma`, `.bin/prisma` and
`@prisma/engines` absent), code owned by root (`touch dist/x` as `node`: permission denied), the query engine
present, `healthy` against the migrated and seeded Postgres. The demo seed has no second organization, so the
rehearsal database got `ORG-0002` and its contract `RC-2026-0003` (`TL-0019`, `!de000013`). Every publish is
`fs-org-0001-1` (ORG-0001, which holds `TL-0009`, `TL-0010`, `TL-0017`, `TL-0018`).

| Case | `MQTT_STATION_UPLINK_ENABLED` | Result |
|---|---|---|
| Data topic for its own node `!de000009` | false | PUBACK 135, subscriber not subscribed to `treklink/fs/+/2/json/+/+` |
| Node topic `treklink/2/json/LongFast/!de000009` | false | PUBACK 135 |
| Health report | false | PUBACK 0 |
| Data topic for its own node `!de000009`, a `TL-0009` position | true | PUBACK 0; one `field_events` row, `ingress FIELD_STATION`, `uplinkKey` and `fieldStationId` = `fs-org-0001-1`, `timeSource STATION_CORRECTED` |
| Data topic for the unrented `!de000001` (`TL-0001`) | true | PUBACK 135 |
| Data topic for ORG-0002's rented `!de000013` (`TL-0019`) | true | PUBACK 135 |
| Node topic | true | PUBACK 135 |
| Another station's data topic | true | PUBACK 135 |
| A forged `SOS - FALL DETECTED` from `TL-0019` inside its own node's data topic | true | PUBACK 0 at the broker; audited `NOT_RENTED_TO_STATION_ORG`, no `field_events` row, no incident |
| TLS 1.1 client on 8883 (`tls_version tlsv1.2`) | either | refused with a protocol version alert; TLS 1.2 verifies |

