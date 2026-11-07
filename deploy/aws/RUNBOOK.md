# Runbook: the AWS field host (D-098)

What it is: one always-on host running the MQTT broker and one backend instance for the field flow. The
Vercel staging keeps serving the web app and the API, and both write the same Neon database
(`treklink_prod` on the branch `vercel-prod`). Design: `specs/platform/design.md` §2.5. Tasks:
`specs/platform/tasks.md` Phase 7. Target: deployed for testing by Sunday 2026-11-15.

Files in this folder:

| File | Purpose |
|---|---|
| `compose.yml` | The four services: `caddy`, `mosquitto`, `broker-hook-proxy`, `backend` |
| `Caddyfile` | Let's Encrypt certificate for `MQTT_DOMAIN`; HTTPS for `/api/health` only |
| `mosquitto/mosquitto.conf` | Broker: TLS on 8883 (public), plain 1883 on the compose network only, go-auth hooks |
| `mosquitto/start.sh` | Copies Caddy's certificate for the broker and reloads the broker when Caddy renews it |
| `.env.example` | Every variable the host needs. Copy it to `.env` on the host and never commit that file |
| `compose.rehearsal.yml`, `Caddyfile.rehearsal` | The same stack on a laptop, with a local Postgres and Caddy's internal CA |

Prices change. Check every amount below on the AWS pricing pages before you rely on it.

---

## 1. Decide the host name

Let's Encrypt needs a DNS name that resolves to the host's static IP. The name goes in `MQTT_DOMAIN` and
becomes the broker address of every node, phone and Field Station.

1. **Recommended**: a subdomain of a domain the team controls, for example `mqtt.<domain>`, as an `A`
   record to the static IP.
2. `<a>-<b>-<c>-<d>.sslip.io`, the static IP with dashes. It needs no DNS setup, but Let's Encrypt rate
   limits are shared with every other user of sslip.io, so issuance can fail on a busy week.
3. No public certificate. Not supported by these files. Nodes would still connect, because the firmware
   does not verify the certificate (`setInsecure()`), but the Field Station's MQTT client does verify it and
   would refuse.

## 2. AWS console (the leader)

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

## 3. DNS

Create the `A` record `MQTT_DOMAIN` with the static IP as its value, then check it from your laptop:

```bash
dig +short mqtt.<domain>
```

Wait until it prints the static IP before step 6. Otherwise Caddy's first attempts fail, and Let's
Encrypt counts the failures against its rate limit.

## 4. Prepare the host

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

## 5. Code and environment

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
- Copy `DATABASE_URL`, `DATABASE_DIRECT_URL`, the mail values, the `COMPANY_*` values, `HANDOVER_PLACE`,
  `CHANNEL_KEY_MASTER` and `VITE_APP_ENV` from the Vercel project's Production environment.
- The container never runs `prisma migrate` or a seed. Migrations stay with the Vercel production build
  (`backend/scripts/vercel-build.sh`).

## 6. Start

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

## 7. Check it

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

## 8. Point the field clients at it

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

Set `GATEWAY_FS_USERNAME` and `GATEWAY_FS_SECRET` to the Username and Secret of its credential. Its
uplinks pass under the interim rule of gateway-sync design §4 while the leader's ruling of 2026-11-07 is
pending. In the Vercel project, set `FIELD_STATION_BROKER_URL` to the same `mqtts://` URL and redeploy,
so new credentials show the right address.

## 9. Logs

```bash
docker compose logs -f --tail=100 backend
```

Swap `backend` for `mosquitto` or `caddy` to follow another service. A refused client shows in the
backend log as `Broker credential refused: username "..." (<reason>)` or `Broker topic denied: ...`;
passwords are never logged. Each service keeps 5 files of 10 MB.

## 10. Update the backend

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

## 11. Roll back

```bash
docker compose stop
```

The Vercel staging keeps working with its field simulator. The Field Station keeps its SQLite queue and
retries, and nodes keep their onboard queue. To go back further, check out the previous commit and
repeat step 10. Nothing here migrated the database, so there is no schema to roll back.

## 12. Tear down

```bash
docker compose down -v
```

`-v` deletes the certificate, the broker's persistence and Caddy's state. Then, in the console:

- Lightsail: delete the instance, then delete the static IP and any snapshot.
- EC2: terminate the instance, release the Elastic IP, and delete leftover volumes, snapshots and AMIs.

Remove the DNS record and check the bill the following day.

## 13. After go-live (do not do these before the host is live)

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
| Allowed: node JSON topic (RC 0), node `2/e` topic (RC 16, no subscriber), station health (RC 0), station Field Station style position on the node topic (RC 0, interim rule), backend subscribe `treklink/#` (granted QoS 1) | 5 of 5 |
| Refused at CONNECT (CONNACK 135): anonymous, wrong node password, wrong station secret, unknown username | 4 of 4 |
| Refused publish (PUBACK 135): node on another node's topic, station on another station's topic, station on `2/e`, backend publish | 4 of 4 |
| Refused subscribe (SUBACK 135): node, station | 2 of 2 |
| Rows: the node telemetry and the station's position reached `field_events` (`TL-0010` telemetry, `TL-0009` position, `ingress` `MQTT_NODE`, `ACCEPTED_UNATTRIBUTED` because the seed's handover is minutes old, `NEAR_HANDOVER`); the station health report set `lastSyncAt` and `queueDepth {0,0,1,3}` | 3 events, 1 station row |
| A new certificate in Caddy's folder, as a renewal writes it: copied and reloaded by `start.sh` within one `CERT_CHECK_SECONDS` (60 s), new connections got it; the same after Caddy reissued its own | yes, twice |
| `docker compose stop mosquitto`: clean exit in 1 s, persistence saved (before the fix in `start.sh`, the root-owned volume made the save fail) | yes |
| Backend stopped: new CONNECT dropped after the 5 s hook timeout; a connected QoS 1 client publishing 65 s into the outage was disconnected, resent after the backend returned, and the event was stored once | yes |
