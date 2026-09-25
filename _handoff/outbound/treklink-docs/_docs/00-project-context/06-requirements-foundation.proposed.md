# Proposed edits: `_docs/00-project-context/06-requirements-foundation.md`

> From the `treklink-web` cloud session, 2026-09-25, REQUEST C-004. Written against the `web-pack.zip` snapshot (`treklink-docs@089374b`), which predates PR #27; apply by hand against current `dev`. Nothing here is applied yet.

## 1. Use case catalogue §3.3: add UC-27 to UC-42

The module specs trace to these; without them several stories have no use case. Verb-object names, each a function, per §3 of the file.

| UC | Name | Actor | Main Flow | Priority | Relationship | Spec |
|---|---|---|---|---|---|---|
| UC-27 | Register Account | Customer (visitor) | MF-01 | High | | `auth` |
| UC-28 | Reset Password | all human actors; Staff-triggered | none | Medium | | `auth` |
| UC-29 | Manage Hardware Variants | Admin | MF-01 | Low | | `devices` |
| UC-30 | Register Device | Staff | MF-01 | High | | `devices` |
| UC-31 | Provision Device | Staff | MF-01 | High | `include`d by UC-08 while the PSK check is on (D-021) | `devices` |
| UC-32 | Record Maintenance | Staff | MF-05 | Medium | | `devices` |
| UC-33 | Retire Device | Staff, Admin | MF-05 | Medium | `extend`s UC-32 when unrepairable; covers loss (E05-3) | `devices`, `rentals` |
| UC-34 | Manage Trek Packages | Staff | MF-01 | High | | `trips` |
| UC-35 | Schedule Trip | Staff; Guide requests | MF-01 | High | | `trips` |
| UC-36 | Complete Readiness Checklist | Guide | MF-01 | Medium | | `trips` |
| UC-37 | Cancel Booking | Customer, Staff | MF-01 | High | | `rentals`, `billing` |
| UC-38 | Confirm Device Handover | Guide | MF-01 | High | `include`d by UC-08 | `rentals` |
| UC-39 | Raise Manual Incident | Staff | MF-03 | Medium | | `incidents` |
| UC-40 | Manage Pricing Rules | Admin | MF-01, MF-05 | High | | `billing` |
| UC-41 | Approve Fee Waiver | Staff (not the inspector) | MF-05 | Medium | `extend`s UC-11 when a waiver is requested | `billing` |
| UC-42 | Dismiss Suspected Episode | Staff | MF-03 | Medium | `extend`s UC-16 when confidence is `SUSPECTED` (US-088) | `incidents` |

## 2. Context diagram §1, Figure 1

Two changes, mirrored in `treklink-web/specs/platform/design.md` Figure 1:

- Draw the **MQTT broker** as its own external system between the Gateway Bridge (and the node's own uplink, Stage A) and the platform. It is operated infrastructure, and Stage A reaches it without any bridge.
- Replace **Notification channel** with **Email service**. Email OTP (Q31, Q35) is the only outbound channel the answers require; incident alerts use the platform's WebSocket.

## 3. Business Rule Matrix §5: BR-04 wording

BR-04 reads "A device below the configured minimum battery may not be checked out". Q52 says telemetry never blocks assignment and manual verification is final. Proposed wording: "A device whose **manually verified** battery at the Guide's handover check is below the configured minimum is rejected at handover and sent to maintenance; telemetry battery never blocks allocation or check-out." Implementation: `rentals` handover check, `devices.minHandoverBatteryPct`.

## 4. Business Rule Matrix §5: BR-22 wording

BR-22 reads "retired with a loss record" after the grace period, implying automatic retirement. `rentals` REQ-STA-02 proposes: after the grace period items become `LOSS_SUSPECTED` and Staff are alerted; retirement needs a Staff confirmation. Update BR-22 to match whichever the leader decides in C-003.

## 5. Honest status §7

Replace the "Specs" row: "All nine modules plus a cross-cutting `platform` spec have requirements, design, tasks and api-design drafted on `treklink-web` branch `feat/module-specs-and-backend-foundation`, awaiting approval." Keep Implementation at 0 % until code lands.
