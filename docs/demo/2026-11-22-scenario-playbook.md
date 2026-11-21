# Scenario playbook, main flows MF-01 to MF-05 (D-109)

Jira TK-229. Written 2026-11-20 on `dev` at `8744a0d6` for the rehearsals after the staging reseed of
Saturday 2026-11-21. Decision D-109 requires it: one scripted run per main flow, the accounts, the data
before the run, every step with its page, click and typed value, the expected screen, happy and unhappy
cases on prepared data, a fallback per step, a reset procedure and a rehearsal log. Rehearsals are logged
by LongLP (web flows MF-01a to MF-01c, MF-04, MF-05; TK-230) and KhoaDD (device flows MF-02 and MF-03;
TK-231).

Sources, in this order: `docs/demo/2026-11-01-demo-script.md` and `2026-11-01-run-book.md` (the starting
point, re-checked against `dev`); the demo seed `backend/prisma/seed-demo.ts`; the router
`frontend/src/app/router.tsx` and the page components; the backend controllers. A label or screen that was
not found in the code on `dev` is marked **(check by hand)**: the first rehearsal confirms it and corrects
this file.

Passwords, the MQTT node password, Field Station secrets and API keys are never written here. Each one is
"from the team's private channel", or is copied from the screen that shows it once.

## 1. Environment and order

| Item | Value |
|---|---|
| Environment | AWS staging: the web address is the `aws-staging` entry of `deploy/system-endpoints.json` on `main` (D-104). The API is that address plus `/api`, demo sign-in is `/demo` |
| MQTT broker | The Broker URL shown with the Field Station credential (MF-01c step 9); `deploy/aws/RUNBOOK.md` §7 |
| What the host runs | `NODE_ENV=production`, the simulator off, Demo control off (`DEMO_CONTROLS_ENABLED=false`, `deploy/aws/.env.aws.example:14-16`). So `/t/admin/demo` and its quick scenarios are absent. Every step below uses the real screens. Mail is SMTP (`MAIL_TRANSPORT=smtp`, `.env.aws.example:73`): every `treklink.dev+...@gmail.com` address lands in the team inbox `treklink.dev@gmail.com` |
| Database state | Wiped and reseeded on Sat 2026-11-21, and again before each later rehearsal (section 11). Before each flow: the fresh seed (section 2) plus what the earlier flows of the same rehearsal left (section 3) |
| Browser | One browser profile per account: a private window shares nothing with a normal one, but all private windows of one browser share one session, so two InPrivate windows sign in as the last account used (rehearsal 1). Use, for example, Edge for Staff, Edge InPrivate for one account and Chrome for another. The session is held in memory: a reload or a typed URL signs the window out (`frontend/src/entities/session/model.ts`, 2026-11-01 script §1.4). Move with the sidebar and the links |

Run order, always the same, because each flow uses what the earlier one left:

1. MF-01a onboarding (new organization ORG-0002)
2. MF-01b rental request and approval (RC-2026-0004 approved; RC-2026-0005 rejected)
3. MF-01c payment and handover (RC-2026-0004 Active, Field Station `fs-org-0001-2`). **Write down the handover time.**
4. MF-02 device data through the Field Station bridge (uses `fs-org-0001-2`)
5. MF-03 SOS to incident. **Not before the handover time of MF-01c plus 5 minutes** (rule below)
6. MF-04 live map and the organization API
7. MF-05 term end to close (RC-2026-0002)

**SOS timing rule (D-111, as stated by the leader for this task).** Send no SOS until at least 5 minutes
after the MF-01c handover. An SOS inside the 300 s attribution margin of a handover
(`gatewaySync.attributionMarginSeconds`, `backend/prisma/migrations/20261004120100_seed/migration.sql`) is
stored Unattributed and its incident stays Unrouted until the routing fix TK-245 lands after the RC. No
rehearsal sends a live SOS inside the margin (leader ruling 2026-11-20).

## 2. Accounts and seed data (fresh seed)

Accounts (`backend/prisma/seed-demo.ts:119-134`). Passwords: from the team's private channel. On staging
the `/demo` page lists the four accounts and signs in with one click when `DEMO_TEST_ACCOUNTS_ENABLED` is
on (`deploy/aws/.env.aws.example:97-101`); otherwise use `/sign-in`.

| Window | Role | Name | Email | Lands on |
|---|---|---|---|---|
| A | Org Manager, ORG-0001 | Pham Duc Huy | `treklink.dev+manager@gmail.com` | `/o` |
| B | TrekLink Staff | Le Thi Thu Ha | `treklink.dev+staff@gmail.com` | `/t/map` |
| C | Org Operator, ORG-0001 | Nguyen Thanh Tung | `treklink.dev+operator@gmail.com` | `/o/map` |
| D | Admin | Tran Quoc Bao | `treklink.dev+admin@gmail.com` | `/t/map` |
| E | Not signed in, then the new Manager of ORG-0002 | Tran Van Binh | `treklink.dev+register@gmail.com` | `/`, then `/o` |
| T | Terminal on the device laptop (KhoaDD) | | | |

Seed records used below (`seed-demo.ts`):

| Record | State after the seed | Used in |
|---|---|---|
| ORG-0001, Suong Ngan Trekking Co., Ltd., 42 Le Hong Phong, Da Lat, Lam Dong, tax code 0000000001 | Active; Manager and Operator are members; roster: Operator primary, Manager backup (`:151-155, 444`) | all |
| treklink-v3, "TrekLink v3 (GPS, SOS button)", 450,000 VND a month | 10 units Available: TL-0003 to TL-0006, TL-0011 to TL-0016 (`:186-197, 256-275`) | MF-01b, MF-01c |
| RC-2026-0001, monthly | Active, TL-0009 (node `!de000009`, holder Vo Thi Mai Anh) and TL-0010 (`!de00000a`, holder Dang Quoc Viet) Rented, handed over when the seed ran | MF-02, MF-03, MF-04 |
| RC-2026-0002, monthly | Active, TL-0017 (holder Hoang Thi Mai) and TL-0018 (holder Vu Van Nam) Rented, first invoice paid | MF-05 |
| RC-2026-0003, monthly | Defaulted, TL-0019 Rented, term balance unpaid | MF-03 unhappy (optional) |
| INC-2026-000001 | Unrouted incident on TL-0001, a unit in no custody | MF-03 unhappy |
| Field Station `fs-org-0001-1`, "Ta Nang basecamp laptop" | Active, never reported. Its secret is not known to anyone (the seed stores a hash), so MF-02 uses the station created in MF-01c | MF-01c |
| Damage rates | ANTENNA_BROKEN 300,000 VND, CASING_CRACKED 400,000 VND (`:248-251`) | MF-05 |

The holder labels of TL-0009 and TL-0010 come from treklink-web PR 530 and are in the seed from the
2026-11-21 reseed on.

## 3. What each flow leaves behind

| After | New or changed records | Next flow starts from |
|---|---|---|
| MF-01a | ORG-0002 Phan Dung Trekking Co., Ltd., Active; account `treklink.dev+register@gmail.com` with its own password | ORG-0002 can request |
| MF-01b | RC-2026-0004 (ORG-0001) Approved, five v3 units Reserved; RC-2026-0005 (ORG-0002) Rejected, its units released | 5 v3 units Available again |
| MF-01c | RC-2026-0004 Active, five units Rented, its first invoice holding fee paid, handover note signed; Field Station `fs-org-0001-2` "Bidoup ranger post" | handover time noted |
| MF-02 | Field events of TL-0009 and TL-0010; `fs-org-0001-2` Connected; one duplicate rejected | gateway keeps running |
| MF-03 | INC-2026-000002 on TL-0010 Resolved (it closes after `incidents.reopenWindowMinutes`); INC-2026-000001 reported to authority and closed | |
| MF-04 | API key "Bidoup ranger dashboard" of ORG-0001, Revoked | |
| MF-05 | RC-2026-0002 Closed; TL-0017 Available; TL-0018 in maintenance; closing invoice paid | end of the run |

Every rehearsal starts on a reseeded staging database (section 11), so the codes above hold for each run.
Without the reseed every new code moves by one (ORG-0003, RC-2026-0006 and on), the MF-01a registration is
refused (same tax code), and only 5 v3 units are left.

---

## 4. MF-01a: organization onboarding

Accounts: E (not signed in, then Tran Van Binh), B Staff, D Admin. Data before: fresh seed; no ORG-0002;
the team inbox reachable on a phone.

Prepared values: Registered company name **Phan Dung Trekking Co., Ltd.**; Tax code **0312345678**;
Registered address **18 Tran Hung Dao, Bao Loc, Lam Dong**; Company phone **0263 3821 456**; Manager full
name **Tran Van Binh**; Manager email **treklink.dev+register@gmail.com**; Manager phone **0905 123 456**
(phones match `^\+?[0-9 ]{8,15}$`, `backend/src/modules/organizations/dto/onboarding.dto.ts:18`); Master
contract number **MC-2026-0002**; new password: from the team's private channel.

### Happy run

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| 1 | E, `/` | **Register your organization** | | "Register your organization" with seven fields (`RegisterPage.tsx`) | Open `/register` from the sign-in page link |
| 2 | E, `/register` | Fill the seven fields, **Register** | the prepared values above | "Registration received..." and "Your organization code is **ORG-0002**. The Manager receives an email to set a password." | If refused as already registered, the database was not reset: section 11 |
| 3 | B, `/t/organizations` | Tab **Pending**, row **ORG-0002** | | Detail with the code, tax code, address and the "Counter verification" form | Search "0312345678" in **Search by code, name or tax code** |
| 4 | B | Counter verification: Method **In person**, tick **Business registration** and **Manager ID card**, Master contract number, tick both master contract boxes, **Record verification** | MC-2026-0002 | Toast "Saved."; the detail shows "Verified ..., in person, contract MC-2026-0002"; Staff see no Approve | Repeat the step; the button then reads **Update verification** |
| 5 | D, `/t/organizations` | Tab **Pending**, **ORG-0002**, **Approve** in the action bar at the bottom | | Toast "ORG-0002 approved. The Manager can now request devices." (`OrganizationReviewPage.tsx:460`) | If **Approve** is disabled, step 4 was not saved: redo it as Staff |
| 6 | Phone, team inbox | Open the mail "Your TrekLink invitation code" to `treklink.dev+register@gmail.com`, note the code | | "Your TrekLink invitation code is <code>. It is valid for 72 hours..." **(check by hand: SMTP delivery on AWS)** | Spam folder; if absent after 2 minutes, Admin resends the invitation from `/t/admin/accounts` **(check by hand)** |
| 7 | E, `/sign-in` | **Set password** | | `/welcome`, fields Email, Invitation code, Password, Confirm password | Open `/welcome` from the sign-in page again |
| 8 | E, `/welcome` | Fill, **Set password and sign in** | `treklink.dev+register@gmail.com`, the code, the password twice | Signed in as Tran Van Binh on `/o`, ORG-0002 overview | A wrong code shows an error under the field: retype it from the mail |

### Unhappy case: duplicate registration

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| U1 | New private window, `/register` | Fill and **Register** | same values as step 2, Manager email **treklink.dev+register2@gmail.com** | Refused: "This tax code is already registered." (409, `organization-onboarding.service.ts:97-103`); no ORG-0003 | If it is accepted, stop and record a defect; reject the extra organization as Admin with reason "Duplicate registration of ORG-0002" |

---

## 5. MF-01b: rental request and approval

Accounts: A Manager (Pham Duc Huy), E Manager of ORG-0002 (Tran Van Binh), B Staff. Data before: after
MF-01a; 10 v3 units Available.

### Happy run

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| 1 | A, `/o` | **Request a contract** | | `/o/contracts/new`, steps Plan and devices, Start date, Review and send | Sidebar **Contracts**, **Request a contract** |
| 2 | A | Plan **Monthly**; variant card **TrekLink v3 (GPS, SOS button)**; Quantity; **Next** | 5 | "10 available now" under Quantity **(check by hand: the count)**; Quote "Term fee (one month) 2,250,000 VND", "First payment, holding fee (50 %) 1,125,000 VND" | If the count is under 5, a hold is left from an earlier run: section 11 |
| 3 | A | Start date: today, **Next** | today's date | Today is the earliest date offered |  Today not offered: check the laptop clock and time zone (Asia/Ho_Chi_Minh), sign in again as A and start again at step 1; nothing is saved before step 4 |
| 4 | A | **Send request** | | "Request RC-2026-0004 sent", five devices held for 24 hours, "Deposit due before then: 1,125,000 VND" with **Open the contract** and **Pay the deposit** | If the toast shows a server error, open **Contracts**: the request may exist; do not send twice |
| 5 | B, `/t/contracts` | **Show** menu **Requested**; row RC-2026-0004, **Show details** | | Details pane with plan, devices, prices and the hold line | Search "RC-2026-0004" |
| 6 | B | Handover appointment: a time later today; **Approve** | the next full hour | Toast "RC-2026-0004 approved. 5 devices reserved." (`ContractApprovalPage.tsx:197`) and the reserved tags | A past time is refused: "The handover appointment is in the past...": pick a later time |

### Unhappy case: rejected request

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| U1 | E (Tran Van Binh), `/o` | **Request a contract**, Monthly, TrekLink v3, Quantity, **Next** | 6 | "Only 5 TrekLink v3 (GPS, SOS button) devices are available. Lower the quantity or choose another variant." and the page stays on step 1 **(check by hand: wording after the request hold)** | Go on with U2 |
| U2 | E | Quantity 5, **Next**, start today, **Next**, **Send request** | 5 | "Request RC-2026-0005 sent", the last five v3 units held | If fewer than 5 are available, MF-01b step 4 ran twice: cancel the extra request |
| U3 | B, `/t/contracts` | Row RC-2026-0005, **Show details**, **Reject**; Reason; **Reject** | The master contract of ORG-0002 is not countersigned yet | Dialog "Reject RC-2026-0005?"; after it the request is Rejected and its 5 units are Available again | An empty reason shows "Reason is required." |
| U4 | E, `/o/contracts` | Open RC-2026-0005 | | Status Rejected with the reason **(check by hand)** |  Status still Requested: sign in again as E and open **Contracts** again; or show the Rejected row as B in `/t/contracts`, **Show** menu All |

---

## 6. MF-01c: payment and handover

Accounts: B Staff, A Manager (signs on the Staff screen). Data before: RC-2026-0004 Approved with five v3
units Reserved. Run on the start date; the appointment time does not hold the handover up (the handover
checks only the start date, `backend/src/modules/rentals/handover.service.ts`).

### Happy run

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| 1 | B, `/t/contracts/<id>` | From step 6 of MF-01b, **Open the contract**, **Start handover** | | Handover mode with steps Devices, Payment, Preview note, Sign | **More actions**, **Open the counter** (`/t/counter/<contractId>`) |
| 2 | B, Devices | **Scan or type an asset tag**, **Find** | first reserved tag shown in MF-01b step 6 (for example TL-0003) | Row highlighted, "TL-0003 is on this contract." | Type the tag again without spaces |
| 3 | B | Tick **Select all units**; **Battery % for selected**; **GPS fix for selected** GPS fix; **Set readings for selected** | 90 | "Readings set on 5 units." every row 90 and GPS fix | Set the readings on each row |
| 4 | B | **Record provisioning for selected**, then **Next** | | "Recorded 5 of 5." each row "Provisioned v1" | A wrong unit: its row **Undo**, then **Undo provisioning**, record again |
| 5 | B, Payment | **Record a counter payment**; Method Cash; **Receipt number**; **Record** | Amount received 1125000; receipt CT-2026-0418 | Toast "Payment of 1,125,000 VND received." Before 09:00 local, Due now reads 0 VND and the prefill is 2,250,000: type 1125000 (2026-11-01 script MF-01 step 9) | Record the payment from `/t/billing` on the contract's first invoice |
| 6 | B, Preview note | **Next** | | The unsigned note, marked as a preview, with battery 90 % and Fix OK | **Open the preview in a new tab** |
| 7 | B with A, Sign | **Signing Manager** Pham Duc Huy; **Identity document checked**; the Manager signs; **Complete handover** | CCCD ending 1234 | Toast "Handover complete. 5 devices issued under contract RC-2026-0004."; Active. **Write down the time** | Signature lost: clear the box and sign again |
| 8 | B | Tab **Documents**, **Download handover note** | | `RC-2026-0004-handover-note.pdf`, two pages, letterhead and both signatures | Show the note from the contract later |
| 9 | A, `/o/field-stations` | **Create Field Station**, Name, **Create** | Bidoup ranger post | "Credential for Bidoup ranger post": Broker URL, Username **fs-org-0001-2**, Secret, "Copy it now; it will not be shown again." Give Broker URL, Username and Secret to KhoaDD privately | Lost secret: revoke the station and create "Bidoup ranger post 2" (username `fs-org-0001-3`) |

### Unhappy case: unit below the minimum battery

Run between steps 3 and 7.

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| U1 | B, Devices | On one row set Battery % | 35 | Accepted on the row |  Value refused ("Enter the battery as a whole number from 0 to 100."): type 35 again |
| U2 | B, Sign | **Complete handover** | | Refused: "Battery below 50 % on TL-00xx. Charge before use, or acknowledge." (`handover.service.ts:582`, `devices.handoverMinBatteryPct`) **(check by hand: where the screen shows it and the acknowledge control)** | Go back to Devices, set the row to 90, continue at step 7 |

### Unhappy case: duplicate payment webhook (optional)

Only if the SePay sandbox is set up on AWS **(check by hand)**. As A, on RC-2026-0004 use **Pay the
deposit** before step 5 instead of a counter payment, pay from the sandbox, then send the same transaction
again from the SePay sandbox. Expected: the payment page shows the payment confirmed once; the second
delivery is answered as a duplicate and records nothing (`backend/src/modules/billing/sepay.service.ts:247`).
Fallback: record the deposit at the counter (step 5).

---

## 7. MF-02: device data through the Field Station bridge

Accounts: T (KhoaDD), C Operator, B Staff. Data before: after MF-01c; credential `fs-org-0001-2`.

The device flows MF-02 and MF-03 run on the leader's physical units (leader ruling 2026-11-20). The seeded
units carry placeholder node ids (`seed-demo.ts:252-256`), which stay as the fallback.

**Before the run (after every reseed).** The leader registers the real node ids of the physical units on
staging and posts, in the team's private channel, the asset tag and contract of each unit. Write them in
the Notes of the rehearsal log. Where a step below names TL-0009 or TL-0010, use the physical unit the
leader names in its place; the expected screens then show that unit's asset tag and holder.

Gateway environment on the laptop (names only; values from MF-01c step 9): `MQTT_BROKER_URL` = the Broker
URL shown, `GATEWAY_FS_USERNAME=fs-org-0001-2`, `GATEWAY_FS_SECRET`, `GATEWAY_SERIAL_SIMULATION=false`,
`GATEWAY_SERIAL_PORT` = the USB port of the node attached to the laptop (`gateway/src/config.ts:137-144`).

**Fallback, disclosed as simulated.** If the physical units cannot report, restart the gateway in its demo
mode for the seed nodes (`gateway/src/config.ts:140-170`) and say aloud that the data is simulated:
`GATEWAY_SERIAL_SIMULATION=true`, `GATEWAY_SIM_NODES=!de000009,!de00000a`, `GATEWAY_SIM_SOS_EVERY=0` (no SOS
during MF-02; the default 12 sends one every twelfth tick), `GATEWAY_SIM_INTERVAL_MS=30000`.

### Happy run

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| 1 | T | `npm run dev:gateway` from the repository root | the variables above | Gateway lines: connected to the broker, the serial port open, packets from the physical units as they report **(check by hand: log wording)** | Wrong secret: the broker refuses; recheck the copy. Units silent or port not found: the simulated fallback above, then section 11 step 3 |
| 2 | Talk | Path: node, LoRa, laptop over USB, SQLite queue (SOS first), MQTT QoS 1, backend ingest with `eventId` dedup | | |  None, observe only |
| 3 | C, `/o/map` | **Live map** | | The physical units (fallback: TL-0009 and TL-0010) with battery and a recent last-seen time | Wait for the next report; then check step 4 |
| 4 | B, `/t/admin/sync` | Sidebar **Field data sync** | | MQTT subscriber up; Field Stations table: "Bidoup ranger post", Connected, a Last sync; Recent field events for the physical units (fallback: TL-0009 and TL-0010), Attribution "Attributed" | If the station reads "Never reported", the health report waits up to 60 s (`GATEWAY_HEALTH_INTERVAL_MS`); refresh |

### Unhappy case: duplicate packet

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| U1 | T | Publish the recorded position fixture twice with the same id: `npm --prefix backend run replay:mqtt -- position --times 2` with `MQTT_BROKER_URL`, `MQTT_USERNAME=node-!de000009`, `MQTT_PASSWORD` from the team's private channel **(check by hand: the fixture's node and the broker's per-node topic rule)** | | | If the broker refuses the login, skip U1 and say so |
| U2 | B, `/t/admin/sync` | Refresh | | **Duplicates rejected** grows by one; the audit lists "Duplicate rejected" (`SyncStatusPage.tsx:46, 254`) **(check by hand: the fixture time is old, use the audit list)** |  Count unchanged: show the newest row of the Sync audit list, **Show** menu Every outcome; if no duplicate row, say so and repeat U1 once |

---

## 8. MF-03: SOS to incident

Accounts: C Operator (primary), A Manager (backup), B Staff. Data before: after MF-02, gateway running.
**Start no earlier than the MF-01c handover time plus 5 minutes (D-111), and no earlier than 5 minutes after
the handover of the physical unit used.** TL-0010 was handed over by the seed, so its SOS is attributed to
RC-2026-0001 and routed to the Operator. The steps name TL-0010; with a physical unit, read its asset tag
and holder.

### Happy run

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| 1 | Physical unit | Press the unit's SOS control once (on a v3, hold the user button 3 s, `seed-demo.ts:203`) **(check by hand: the variant of the leader's unit)** | | The gateway log shows the SOS queued first | Disclosed as simulated: `npm --prefix backend run replay:mqtt -- sos --now --new-ids` with `MQTT_USERNAME=node-!de00000a` (TL-0010) |
| 2 | C, any page | | | Red banner "SOS: TL-0010 (Dang Quoc Viet), hh:mm. Acknowledge now." with **Acknowledge** (`AlertBanner.tsx`) | No banner in 10 s: `/o/incidents`; if the incident is Unrouted, the SOS was inside the margin: go to the unhappy case and say so |
| 3 | C, `/o/incidents` | Open the new incident (INC-2026-000002) | | Device TL-0010, state Notifying primary, last coordinates |  Not in the list: open **Incidents** again from the sidebar; still absent, sign in again as C |
| 4 | C | **Acknowledge** | | Toast "Saved."; Owner Nguyen Thanh Tung, Acknowledged; banner gone |  "Someone else changed this. Reload to see the latest.": sign in again as C, open the incident, **Acknowledge** again |
| 5 | C | **Response under way**, What is being done, **Save response** | Ranger team dispatched from the Ta Nang post | State Responding |  Save refused: retype the prepared value; a stale-version message: sign in again as C and repeat the step |
| 6 | C | **Add status**, a line, save | Team at km 6, voice contact with the hiker | The update with author and time |  Save refused: retype the prepared value; a stale-version message: sign in again as C and repeat the step |
| 7 | C | **Report outcome**, Outcome, **Resolve incident** | Hiker found, minor ankle injury, walked out | State Resolved; History lists each step |  Save refused: retype the prepared value; a stale-version message: sign in again as C and repeat the step |

### Unhappy case: SOS without attribution (Unrouted)

The rule forbids a live SOS inside the margin, so the seeded INC-2026-000001 on TL-0001 (a unit in no
custody) stands in: it is the same Unrouted path an early SOS takes until TK-245 (leader ruling
2026-11-20: no live SOS inside the margin).

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| U1 | B, `/t/incidents` | **Show** menu **Unrouted**; row TL-0001, **Show details** | | Owner "TrekLink Staff queue", state Unrouted | Search "INC-2026-000001" |
| U2 | B | **Report to authorities**; Agency; Authority reference; Reported at as prefilled; **Record report** | Lam Dong Provincial Police; LD-2026-1121 | Toast "Saved."; "Reported to authority" | A future time is refused: keep the prefilled time |
| U3 | B | Tab **Authority reports**, **Record case closed** on the row, confirm | | Toast "Saved."; the case reads closed |  A Closed at before the report time is refused: keep the prefilled time; row not shown: **Show** menu All reports |

---

## 9. MF-04: live map and the organization API

Accounts: C Operator, B Staff, A Manager, T for `curl`. Data before: after MF-03, gateway running.

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| 1 | C, `/o/map` | **Live map** | | Header with device and SOS counts; TL-0009, TL-0010, TL-0017, TL-0018, TL-0019 and the five RC-2026-0004 units ("not heard since handover") |  Units missing: show the same units on the Staff **Fleet map** (step 4); then sign in again as C |
| 2 | C | **Search asset tag, holder or contract** | TL-0010 | One row, battery, holder, last seen | Clear the search |
| 3 | C | Zoom out to 6 or 7, drag left | | "Quần đảo Hoàng Sa (Việt Nam)" and "Quần đảo Trường Sa (Việt Nam)" on their masks (D-031) | Tiles slow: wait; the masks draw without tiles |
| 4 | B, `/t/map` | **Fleet map**, organization filter ORG-0001 | | Every organization's units, then ORG-0001 only |  Filter empty: choose All organizations, then ORG-0001 again; or show the Operator's Live map of step 1 |
| 5 | A, `/o/api-keys` | **Create API key**, Name, create | Bidoup ranger dashboard | The key once with **Copy** and "Copy it now; it will not be shown again."; copy it to T privately | Lost key: revoke it, create another |
| 6 | T | `curl -s -H "X-Api-Key: <key>" <staging address>/api/telemetry/devices` | | 200, `{ result, isSuccess, statusCode, message }`, `result.devices` with ORG-0001's units (`org-api.controller.ts:96`) | Show the Live map instead and say the API answered in rehearsal |

### Unhappy case: revoked API key

API keys carry no expiry on `dev` (`ApiKeysPage.tsx` shows Active or Revoked only), so a revoked key stands in for an expired one.

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| U1 | A, `/o/api-keys` | Row "Bidoup ranger dashboard", **Revoke**, confirm | | Toast "API key revoked"; status Revoked |  Row still Active: sign in again as A and **Revoke** it again from **API keys** |
| U2 | T | The `curl` of step 6 again | same key | 401, `isSuccess` false, "Authentication required." (`backend/src/modules/auth/guards/api-key.guard.ts:40-45`) |  200 returned: check the key is the one copied in step 5 and its row reads Revoked, then repeat the call |

---

## 10. MF-05: term end to close

Accounts: A Manager, B Staff. Data before: RC-2026-0002 Active, TL-0017 and TL-0018 Rented, first invoice
paid. Its term ends a month after the seed, so on stage the term end is **End contract now** (D-097), the
real Staff and Manager action (leader ruling 2026-11-20).

### Happy run with the unhappy case (damaged return)

| Step | Page | Action | Value typed | Expected screen | Fallback |
|---|---|---|---|---|---|
| 1 | A, `/o/contracts` | RC-2026-0002, **Give notice**, confirm **Give notice** | | Toast "Notice recorded. The contract ends on <term end>..."; badge Ending | If **Pay invoice** is primary, use **More actions**, **Give notice** |
| 2 | A | **More actions**, **End contract now**; Reason; confirm | The trek season of Suong Ngan Trekking ended early | Dialog "End RC-2026-0002 now?" with Credit and After it; toast "Contract ended. Check the units in at the counter." Status Return due **(check by hand)** | Staff can run the same action from the contract home |
| 3 | B, `/t/contracts` | **Show** menu All; RC-2026-0002, **Open the contract**, **Record return** | | Counter "Counter: RC-2026-0002", tabs Check-in, Reset and inspection, Close | **More actions**, **Open the counter** |
| 4 | B, Check-in | **Scan or type an asset tag**, add, check in | TL-0017, then TL-0018 | "Check-in complete. 2 of 2 devices returned." **(check by hand: wording for two)** | Add the tags one at a time |
| 5 | B, Reset and inspection | **Record reset** on both, tick the steps | | Rows "Reset logged" |  Reset not recorded: tick every step and **Record reset** again; a sign-in again keeps a recorded reset (it is stored on the contract) |
| 6 | B | TL-0017: **Inspect**, Passed, **Record inspection** | | TL-0017 Available |  **Inspect** not offered: record the reset of step 5 first, then inspect |
| 7 | B | TL-0018: **Inspect**, **Damaged**, tick Casing cracked (CASING_CRACKED), **Record inspection** | | "Damaged, maintenance", "Damage 400,000 VND, on the closing invoice" |  Casing cracked not listed: sign in again as B, open the counter with **More actions**, **Open the counter**, inspect again |
| 8 | B, Close | Tab **Close** | | Blocker "... unpaid on the contract's invoices." with **Open the invoices**; no Close action yet |  No blocker shown: switch to another tab and back (the close check reloads on focus); if **Close contract** is offered, go to step 10 and say nothing was due |
| 9 | B | **Open the invoices**, the Closing invoice, **Record counter payment**, Method Cash, receipt, **Record** | the prefilled amount; receipt CT-2026-0419 | Toast "Payment of <amount> VND received." (amount = 400,000 VND less any end-now credit) **(check by hand)** | `/t/billing`, filter the contract |
| 9b | B | When step 8 shows no blocker and **Money** reads "TrekLink owes ... VND" (the end-now credit exceeds the damage, rehearsal 1): the Closing invoice row, **Actions**, record the refund | reference CT-2026-0419 | The invoice reads "Refunded to organization: <amount> VND" | Record it from `/t/billing` on the Closing invoice |
| 10 | B | Counter tab Close, **Close contract**, confirm | | Toast "RC-2026-0002 closed."; badge Closed | If a blocker remains, read it and resolve it; the close check reloads on focus |

---

## 11. Reset procedure

Rehearsals 2 and 3 run on staging, with a reseed between runs (leader ruling 2026-11-20).

1. **Reseed staging (leader and orchestrator).** Only when no one is rehearsing. The leader wipes the Neon
   staging database; the orchestrator then runs the reseed script `ignore/khoa/docs/seed-host-2026-11-20.sh`
   on the staging host through AWS SSM. No secret or host detail is written here.
2. **Check after the reseed.** `/demo` lists four accounts; `/t/contracts` shows RC-2026-0001 to RC-2026-0003
   only; 10 v3 units Available; TL-0010's holder reads Dang Quoc Viet.
3. **Register the physical units again** (section 7, Before the run): the reseed removes them.
4. **Device fallback for MF-02 and MF-03.** If the gateway cannot start, publish the recorded trek
   (`npm --prefix backend run replay:mqtt -- trek --now --new-ids --interval 2000`, TL-0009) with the broker
   variables of section 7, and say it is simulated.
5. After every run: stop the gateway; revoke `fs-org-0001-2`; confirm no API key is Active.

---

## 12. Rehearsal log

Result: Pass, Pass with fallback (name the step), or Fail (name the step). Notes: every screen that
differed from this file, then correct the file.

### MF-01a (LongLP, TK-230)

| Date | Who ran it | Environment | Result | Notes |
|---|---|---|---|---|
| 2026-11-21 | LongLP | AWS staging, reseed of 2026-11-21 | Pass with fallback (step 8) | Step 8: the first **Set password and sign in** answered "Internal server error" (about 17:38); the second press signed in (treklink-web#533). U1 refused as written |
| | | | | |
| | | | | |

### MF-01b (LongLP, TK-230)

| Date | Who ran it | Environment | Result | Notes |
|---|---|---|---|---|
| 2026-11-21 | LongLP | AWS staging, reseed of 2026-11-21 | Pass with deviation (step 4) | RC-2026-0004 was sent from Tran Van Binh (ORG-0002), not window A: two Edge InPrivate windows share one session. Run each account in its own browser profile |
| | | | | |
| | | | | |

### MF-01c (LongLP, TK-230)

| Date | Who ran it | Environment | Result | Notes |
|---|---|---|---|---|
| 2026-11-21 | LongLP | AWS staging, reseed of 2026-11-21 | Pass with deviation (step 7) | RC-2026-0004 belonged to ORG-0002, so the only signer offered was Tran Van Binh; handed over 18:19. Battery unhappy case not run in this run |
| | | | | |
| | | | | |

### MF-02 (KhoaDD, TK-231)

| Date | Who ran it | Environment | Result | Notes |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |

### MF-03 (KhoaDD, TK-231)

| Date | Who ran it | Environment | Result | Notes |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |

### MF-04 (LongLP, TK-230)

| Date | Who ran it | Environment | Result | Notes |
|---|---|---|---|---|
| 2026-11-21 | LongLP | AWS staging, reseed of 2026-11-21 | Pass | Step 1 lists no RC-2026-0004 units (that contract was ORG-0002 in this run). Step 6: 200 with five units, all NOT_HEARD (MF-02 not run); U2: 401 after the revoke |
| | | | | |
| | | | | |

### MF-05 (LongLP, TK-230)

| Date | Who ran it | Environment | Result | Notes |
|---|---|---|---|---|
| 2026-11-21 | LongLP | AWS staging, reseed of 2026-11-21 | Pass with fallback (step 2) | Step 2: End now answered "Internal server error" (about 18:36) yet the contract ended (closing invoice issued 18:36); pressed once. Steps 8 and 9: the end-now credit exceeded the damage, so nothing was due and TrekLink owed 470,000 VND; refund recorded on the closing invoice (CT-2026-0419). Closed 18:43 |
| | | | | |
| | | | | |

## 13. Differences from the 2026-11-01 script

- Its W43 start lines use Demo control (`/t/admin/demo`) and Quick scenarios; AWS staging runs with
  `DEMO_CONTROLS_ENABLED=false`, so those pages are absent there.
- Its MF-01a step 6 reads the invitation code from the console mail log; AWS sends SMTP mail to the team inbox.
- Its MF-02 runs the gateway against a local broker with no credential; AWS needs the Field Station
  credential and TLS. Its seeded station `fs-org-0001-1` has no usable secret on a fresh seed.
- Its MF-05 step 2 moves the term end with a terminal script; on stage the term end is End contract now (leader ruling 2026-11-20).
- Its MF-01 step 2 card count ("8 available") and step 2a ("Only 10 ...") disagree with each other; a fresh
  seed has 10 v3 units Available.
