# Proposed functional requirement catalogue for Report 3 (SRS final, W8)

> From the `treklink-web` cloud session, 2026-09-25, REQUEST C-004. The SRS draft names FR identifiers only through the Business Rule Matrix. This catalogue lists every FR the module specs trace to; "existing" means the identifier already appears in the draft, "new" means it is proposed here. Each row points at the EARS requirements that define it.

| FR | Status | Title | Defined in `treklink-web/specs/` |
|---|---|---|---|
| FR-ADM-01 | new | Append-only audit log and viewer | `platform` REQ-UBI-07, REQ-EVT-02 |
| FR-ADM-02 | new | Runtime business parameters with history | `platform` REQ-EVT-03 |
| FR-ADM-03 | new | Health and readiness | `platform` REQ-EVT-04 |
| FR-AUTH-01 | existing | Every mutating endpoint guarded by JWT and policy | `auth` REQ-UBI-06 |
| FR-AUTH-02 | new | Sign-in, rotating refresh, sign-out | `auth` REQ-EVT-01 to 03 |
| FR-AUTH-03 | existing | Guide sees own trips only | `auth` REQ-UBI-07 |
| FR-AUTH-04 | new | Customer registration with email OTP | `auth` REQ-EVT-04, 05 |
| FR-AUTH-05 | new | Password reset, self and Staff-triggered | `auth` REQ-EVT-07 to 09 |
| FR-AUTH-06 | new | Account provisioning and administration | `auth` REQ-EVT-06, 11 |
| FR-AUTH-07 | new | Data-driven roles and permissions | `auth` REQ-EVT-10 |
| FR-AUTH-08 | new | Authentication audit | `auth` REQ-EVT-01 to 11 |
| FR-AUTH-09 | new | Guide profile | `auth` api 09 |
| FR-DEV-01 | existing | 7-state device lifecycle | `devices` REQ-UBI-01 to 03 |
| FR-DEV-02 | new | Hardware-variant catalogue | `devices` REQ-EVT-02, REQ-ERR-05 |
| FR-DEV-03 | new | Device registration | `devices` REQ-EVT-01 |
| FR-DEV-05 | existing | Battery threshold at handover | `devices` REQ-STA-03; `rentals` REQ-EVT-15 |
| FR-DEV-06 | new | Channel PSK provisioning record | `devices` REQ-EVT-11, REQ-STA-02 |
| FR-DEV-07 | new | Maintenance records | `devices` REQ-EVT-08, 10 |
| FR-DEV-08 | new | Fleet views | `devices` api 05, 06 |
| FR-DEV-09 | existing | Loss and retirement | `devices` REQ-EVT-13; `rentals` REQ-EVT-20 |
| FR-TRIP-01 | new | Browse packages and open trips | `trips` REQ-UBI-04 |
| FR-TRIP-02 | new | Manage packages | `trips` api 03, 04 |
| FR-TRIP-03 | new | Schedule, reschedule, cancel trips | `trips` REQ-EVT-01, 06, 07 |
| FR-TRIP-04 | new | Trip lifecycle | `trips` REQ-UBI-01 |
| FR-TRIP-05 | new | Guide assignment without overlap | `trips` REQ-EVT-03, REQ-STA-02 |
| FR-TRIP-06 | new | Readiness checklist | `trips` REQ-EVT-08 |
| FR-TRIP-07 | new | Participants | `trips` api 12 |
| FR-BOOK-01 | new | Submit booking | `rentals` REQ-EVT-01, 02 |
| FR-BOOK-02 | existing | No double allocation | `rentals` REQ-UBI-01, REQ-EVT-03 |
| FR-BOOK-04 | existing | Confirm only with devices and Guides | `rentals` REQ-EVT-06 |
| FR-BOOK-07 | existing | Cancellation fee | `rentals` REQ-EVT-08; `billing` REQ-EVT-04 |
| FR-RENT-01 | new | Allocate and replace devices | `rentals` REQ-EVT-11 |
| FR-RENT-02 | new | Rental agreement PDF and signature | `rentals` REQ-EVT-12, 13 |
| FR-RENT-03 | new | Check-out | `rentals` REQ-EVT-14 |
| FR-RENT-04 | new | Handover check | `rentals` REQ-EVT-15 |
| FR-RENT-05 | new | Check-in | `rentals` REQ-EVT-18 |
| FR-RENT-06 | new | Return inspection | `rentals` REQ-EVT-19 |
| FR-EVT-01 | existing | Idempotent ingestion | `gateway-sync` REQ-UBI-05, REQ-ERR-01, 02 |
| FR-EVT-03 | existing | Priority-ordered flush | `gateway-sync` REQ-EVT-11, REQ-STA-02; firmware `onboard-queue` |
| FR-EVT-05 | existing | One episode, one Incident | `gateway-sync` REQ-EVT-05; `incidents` REQ-EVT-01 |
| FR-EVT-06 | existing | Suspected episode from cadence | `gateway-sync` REQ-EVT-06; `incidents` REQ-EVT-03 |
| FR-EVT-07 | new | Sync audit log | `gateway-sync` REQ-EVT-03 |
| FR-EVT-08 | new | Gateway health and device buffering | `gateway-sync` REQ-EVT-12 to 16 |
| FR-INC-01 | new | Acknowledge, first write wins | `incidents` REQ-EVT-07, REQ-ERR-01 |
| FR-INC-02 | existing | 5-state incident lifecycle | `incidents` REQ-UBI-01 |
| FR-INC-03 | new | Response notes | `incidents` REQ-EVT-11 |
| FR-INC-04 | existing | Append-only incident audit | `incidents` REQ-UBI-02, 03 |
| FR-INC-05 | new | Unassigned SOS triage | `incidents` REQ-EVT-04 |
| FR-INC-06 | existing | Reopen on new beacons | `incidents` REQ-EVT-06 |
| FR-INC-07 | new | Manual incident | `incidents` REQ-EVT-10 |
| FR-INC-08 | new | Incident notification | `incidents` REQ-EVT-05; `monitoring` REQ-EVT-03 |
| FR-INC-09 | new | MTTA and MTTR metrics | `incidents` api 08 |
| FR-MON-01 | new | Live feed | `monitoring` REQ-EVT-02 |
| FR-MON-02 | new | Server-side role scope | `monitoring` REQ-UBI-01, 02 |
| FR-MON-03 | existing | Stale devices shown as stale | `monitoring` REQ-STA-01 |
| FR-MON-04 | new | Gateway connectivity indicator | `monitoring` REQ-EVT-05 |
| FR-MON-05 | existing | Position plausibility | `gateway-sync` REQ-ERR-09, 11; `monitoring` REQ-ERR-02 |
| FR-MON-06 | new | Reconnect and resync | `monitoring` REQ-EVT-07 |
| FR-BILL-01 | existing | Charge calculation | `billing` REQ-EVT-05 |
| FR-BILL-02 | existing | Late fee | `billing` REQ-EVT-06 |
| FR-BILL-03 | new | Pricing rules and deposits | `billing` REQ-EVT-01 |
| FR-BILL-04 | new | Quote and escrow | `billing` REQ-EVT-02, 03 |
| FR-BILL-05 | existing | No close with balance outstanding | `billing` REQ-STA-01; `rentals` REQ-STA-05 |
| FR-BILL-06 | existing | Damage above deposit invoiced, no negative refund | `billing` REQ-EVT-07, 08 |
| FR-BILL-07 | new | Invoice view | `billing` api 07, 08 |
| FR-BILL-08 | existing | Waiver separation of duty | `billing` REQ-EVT-11, REQ-ERR-03 |
