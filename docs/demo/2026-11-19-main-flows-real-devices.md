# Demo script, the five main flows with real devices on the AWS staging

Written 2026-11-19 by LongLP for TK-222, from the real-device runs of 18 and 19 November 2026 on the AWS staging
(D-104). Each step names who signs in, the page, the click and the value typed, then what the screen must show.
It records those runs and the device steps learned in them; rehearsals follow the scenario playbook of D-109,
`2026-11-22-scenario-playbook.md`, and are logged there. Account names below are those of the seed before the
reseed of 2026-11-21.

## 1. Setup

| Item | Value |
|---|---|
| Staging | the `aws-staging` entry of `deploy/system-endpoints.json` on `main` |
| Sign-in | `/demo`, one click per account: TrekLink Staff, Org Manager, Org Operator. This describes 18 and 19 November; the quick sign-in needs `DEMO_TEST_ACCOUNTS_ENABLED` (`deploy/aws/.env.aws.example:102-106`), and on the staging now the accounts of the scenario playbook apply |
| Organization | ORG-0001, TrekLink Demo Tours Co., Ltd. |
| Receiver (station unit) | Treklink a278, `!0aa3a278`, TrekLink v2, on the laptop over USB. It must be one of the organization's rented units: the gateway publishes every packet under the receiver's node, and the broker refuses the whole topic otherwise (treklink-web#547) |
| Remote unit (carried) | Treklink a294, `!0aa3a294`, TrekLink v2, on battery |
| Firmware | v2.7.26-treklink.4, flashed with tk-flasher **Install** (erases the unit) |
| Field Station | LaptopLong, station `fs-org-0001-12`, page http://localhost:4321 |
| Roster | ORG-0001 shift on now: primary Demo Operator, backup Demo Manager |

The minimum order is 5 units of one variant. Two v2 units are real; three v2 rows (TL-0001, TL-0002,
TEST-TEMP-V2-01) are seeded records whose readings are typed by hand. Say so when presenting.

Before a run:

1. Both real units read back channel 0 `positionPrecision 32`, `fixedPosition false`, `gpsMode ENABLED`
   (`py -3 -m meshtastic --port <COM> --info`). Close every program that holds the serial port first.
2. The v2 board loses power while its USB port is opened or it restarts: hold POWER through every dock, flash
   and gateway start (treklink-firmware#36).
3. The five v2 rows are Available on Staff **Devices**. A unit that came back Failed goes through
   **Maintenance**, then **Record intake check**, before it can be rented again.

## 2. MF-01, request to handover

| # | Account | Page and action | Value | Expected |
|---|---|---|---|---|
| 1 | Org Manager | **Contracts**, **Request a contract** | | Step 1, Plan and devices |
| 2 | Org Manager | Plan, variant, Quantity, **Next** | Monthly, TrekLink v2, `5` | Quote shows the first payment; "5 available now" or more |
| 3 | Org Manager | Start date, **Next**, **Send request** | today | "Request RC-2026-00xx sent", units held until tomorrow, deposit due |
| 4 | Staff | **Contracts**, the request, details pane | | Prices, hold expiry, appointment field |
| 5 | Staff | Handover appointment, **Approve** | a time later today | Toast "RC-2026-00xx approved. 5 devices reserved." |
| 6 | Staff | Contract, **Start handover**, step **1. Devices** | | Five rows, "Not provisioned yet" |
| 7 | Staff | Row of a real unit, **Dock and provision**, pick its port; hold POWER | a294 on its COM port | Row reads "Provisioned v2" |
| 8 | Staff | Same for the other real unit | a278 | "Provisioned v2" |
| 9 | Staff | Each seeded row, **Enter manually** | key version `2` | "Provisioned v2" |
| 10 | Staff | **Select all units**, Battery % for selected, GPS, **Set readings for selected**, **Next** | `90`, GPS fix | Next is enabled |
| 11 | Staff | **2. Payment**, **Record a counter payment** | Cash, the amount due, reference `TEST-RC00xx-PAY01` | "The first payment is recorded." |
| 12 | Staff | **Next** to **3. Preview note** | | The unsigned PDF lists the organization and the five units |
| 13 | Staff | **Next** to **4. Sign**: Signing Manager, Identity, signature, **Complete handover** | Demo Manager, `Test ID card, last digits 0000` | Contract Active, toast "Handover complete. 5 devices issued" |
| 14 | Staff | **Documents**, **Download handover note** | | The signed PDF downloads |

Unhappy cases: a quantity above the units available is refused with MSG11 under Quantity; an appointment in the
past is refused under the field ("The handover appointment is in the past").

Fallback: when **Dock and provision** gets no answer over USB, write the unit by hand. Run the same channel and
owner through the Meshtastic CLI (`--seturl` from a provisioned unit, `--set-owner` with the asset tag), then use
**Enter manually** on its row. The audit marks it MANUAL.

## 3. MF-02, field data through the Field Station

| # | Who | Action | Expected |
|---|---|---|---|
| 1 | Laptop | Plug the receiver in; in PowerShell set `GATEWAY_SERIAL_PORT` to its port, `GATEWAY_SERIAL_BAUD` `115200`, then `npm.cmd --prefix <treklink-web>\gateway run start:dev`; hold POWER on the receiver | The log reaches "Connected to MQTT broker" |
| 2 | Laptop | Open http://localhost:4321 | Uplink Connected, Serial port "COMx, reading" |
| 3 | Field | Send `OK` from the remote unit | Recent events: `!0aa3a294 TEXT OK` |
| 4 | Staff | **Field data sync**, the event, **Show details** | CHAT of Treklink a294, Ingress Field Station, Attribution Attributed |
| 5 | Laptop | Queue | "Nothing, all sent" |

Store-and-forward (run after the online flows): switch the laptop's Internet off, send `OFFLINE-001` and
`OFFLINE-002` from the remote unit, see the queue grow while the serial port keeps reading, switch the Internet
back on, and see the queue drain to 0 and both events reach Field data sync as Attributed. Passed on 18 November
(14:22 to 14:24).

Run on 19 November, 13:34 to 13:35: the TEXT and the SOS from a294 were listed under `!0aa3a294`, and a278 only
with its own telemetry (treklink-web#518 fixed by treklink-web#520).

## 4. MF-03, SOS to incident closed

| # | Account | Action | Expected |
|---|---|---|---|
| 1 | Field | Press SOS on the remote unit | Field Station banner "SOS heard !0aa3a294" |
| 2 | Staff | **Incidents**, **Refresh** | New incident, source SOS button, device Treklink a294 |
| 3 | Org Operator (on shift) | **Incidents**, the incident, **Acknowledge** with a note | State Acknowledged |
| 4 | Org Operator | **Responding** with a note, then a status update | State Responding |
| 5 | Field | Cancel the SOS on the unit | |
| 6 | Org Operator | **Resolve** with the outcome | State Resolved, reopen window starts |
| 7 | Staff | After the reopen window, **Refresh detail** | Closed, history "Reopen window ended" |

Known defect, 19 November: an SOS 5 minutes after the 13:30 handover was Unattributed, so INC-2026-000015 went
Unrouted and alerted only TrekLink accounts (treklink-web#527); an SOS at 13:44 was Attributed. Until it is fixed,
leave time between the handover and the SOS step, and check a test `OK` in **Field data sync** is Attributed
before pressing SOS in front of the audience.

## 5. MF-04, live map

| # | Account | Action | Expected |
|---|---|---|---|
| 1 | Org Operator | **Live map** | a294 and a278 listed with last seen; seeded rows "never reported" |
| 2 | Field | Take the remote unit outdoors until it has a GPS fix | Field Station card shows a position for `!0aa3a294` |
| 3 | Field | Point A: stand 2 minutes, press **Send position** | The marker moves to A on the live map |
| 4 | Field | Point B, more than 200 m away: stand 2 minutes, **Send position** | The marker moves to B |
| 5 | Field | Press SOS at B | SOS marker at B, linked to the incident |
| 6 | Field | Leave the unit silent past the stale threshold | The unit turns stale with its last seen time |

On 18 November the position stayed fixed while moving (treklink-firmware#38): fix shipped in v2.7.26-treklink.4, walk
retest of 19 November blocked (no GPS fix), not yet verified. Latest evidence: on 25 November a294's first position
reached the live map at 16:07 (§8, run of 25 November); movement between two points is still to be shown. Runs are in §8.

## 6. MF-05, end, return and close

| # | Account | Action | Value | Expected |
|---|---|---|---|---|
| 1 | Staff | Contract, **More actions**, **End contract now** | reason `MF-05 demo return` | Preview of the unused-days credit; press confirm once |
| 2 | Staff | | | The dialog closes; status Return due with **Record return** (treklink-web#521 fixed by treklink-web#522) |
| 3 | Staff | **Record return**, Check-in, scan or type each asset tag | the five tags | Check-in shows 0 left |
| 4 | Staff | Reset tab, **Record reset** per unit after doing the three steps on the real units | | "Reset logged", Next: Inspect |
| 5 | Staff | **Inspect** per unit: Passed for good units | | Passed units go Available |
| 6 | Staff | Close tab: blockers listed, or **Close contract** | | Contract Closed |

Record reset only logs that the channel key, the node database and the owner were cleared on the unit; it sends no
command. On the real units clear them first (Restore TrekLink defaults keeps the node database).

An incident of the contract's units blocks the close until it is Closed (`OPEN_INCIDENTS`, MSG29). A Resolved or
False alarm incident turns Closed only when its reopen window ends, one hour on the staging (18 November: Resolved
14:35:57, window end 15:35:57). Close every incident at least one hour before the MF-05 step, and press no SOS in
that hour: an SOS inside the window reopens the incident.

Money at the close, from RC-2026-0016 on 19 November: End now credited 1,933,334 VND, the two approved damage
charges (400,000 and 300,000 VND) were set against it, and the closing invoice INV-2026-000023 showed
-1,233,334 VND, leaving 233,334 VND owed to the organization after the unpaid 1,000,000 VND of term 1. The refund is
paid outside TrekLink and recorded on the closing invoice, which then reads "Refunded to organization".

## 7. Reset after a run

1. Close the contract (MF-05) and every incident it raised.
2. Return each real unit to Available: Maintenance completed, then **Record intake check**.
3. The seeded rows return to Available through their inspection.
4. Stop the Field Station with Ctrl+C in its PowerShell window; answer `N` to "Terminate batch job" while a test
   is running.

## 8. Runs

| Date | Flow | Who | Result | Notes |
|---|---|---|---|---|
| 2026-11-18 | MF-01 | LongLP | Passed | RC-2026-0015, two real units docked |
| 2026-11-18 | MF-02 | LongLP, HoangTK | Passed | Online and store-and-forward |
| 2026-11-18 | MF-03 | HoangTK | Passed to Resolved | INC-2026-000014 |
| 2026-11-18 | MF-04 | LongLP | Failed | Position did not move (treklink-firmware#38) |
| 2026-11-18 | MF-05 | LongLP | Closed | End now dialog error (treklink-web#521) |
| 2026-11-19 | MF-01 | LongLP | Passed | RC-2026-0016, a278 by CLI script, a294 by Dock and provision |
| 2026-11-19 | MF-02 | LongLP | Passed | #518 recheck |
| 2026-11-19 | MF-03 | LongLP | Failed | Unrouted SOS after handover (treklink-web#527) |
| 2026-11-19 | MF-04 | LongLP | Blocked | a294 got no GPS fix, no POSITION reached the station (treklink-firmware#38) |
| 2026-11-19 | MF-05 | LongLP | Returned, close waits | Damage and refund recorded; close waits for INC-2026-000015 to leave its reopen window |
| 2026-11-25 | MF-01 | LongLP | Passed | Outdoor run, RC-2026-0006 (ORG-0001, five v2: a274, a278, a294, TL-0001, TL-0002), handed over 15:07 |
| 2026-11-25 | MF-02 | LongLP | Passed | Station `fs-org-0001-3` on a274: 35 events 15:50 to 16:11, all Attributed. The first receiver, a264, was not rented and every packet was refused (treklink-web#547) |
| 2026-11-25 | MF-04 | LongLP | Partly | Positions of a274 (15:52) and a294 (16:07) on the live map; movement between two points not shown; a278 got no GPS lock |
| 2026-11-25 | MF-03 | LongLP | Not passed | No SOS incident was created during the run |
