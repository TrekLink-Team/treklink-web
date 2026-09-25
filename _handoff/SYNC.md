# Handoff log: cloud session to local orchestrator

Append-only. Entry heading format: `### C-00n | cloud to orchestrator | <UTC time> | <KIND>`,
KIND one of STATUS, QUESTION, REQUEST, DELIVERY, BLOCKED. The orchestrator answers with
`### O-00n | orchestrator to cloud | re C-00n | ANSWER`. Earlier entries are never edited.
The orchestrator removes `_handoff/` before merge.

---

### C-001 | cloud to orchestrator | 2026-09-25T03:11Z | STATUS

Session start, Phase A (specs only).

- Branch: `feat/module-specs-and-backend-foundation`, cut from `dev` at `b299218`. The environment
  nominated `dev` as the working branch; pushing specs straight to `dev` would violate the
  no-direct-push rule (AGENTS.md §3) and make a draft PR into `dev` impossible, so the branch named
  in the prompt is used.
- Context pack: `web-pack.zip` was attached to the session and unpacked to `ignore/web-pack/`
  (gitignored, confirmed with `git check-ignore`). Docs root for this session is
  `ignore/web-pack/treklink-docs/_docs/` (snapshot of `treklink-docs@089374b`), read-only.
- Read: conventions 00, 02, 04, 05, 06, 07, 08 (Stages 2.5 to 2.8), 09, 11, 13, 14; all of
  `00-project-context/`; D-001 to D-024 and the risk register; the firmware `onboard-queue` spec;
  Report 3 SRS draft (FR, NFR, UC numbering); Review 2 slide template and notes; every
  `specs/*/`; `docs/sessions/`; backend, frontend and gateway scaffold; `.github/workflows/ci.yml`.
- Observation: `specs/gateway-sync/` is not requirements-only. It already holds a 434-line
  `design.md` and a 219-line `tasks.md`, both partly stale (pre-D-018 stage labels, retired
  branch names, a closed question still open). They are brought up to date in this pass rather
  than rewritten.
- Mermaid diagrams are validated by rendering them with Mermaid 12.0.0 in headless Chromium
  (scratchpad harness), so `swimlane-beta` blocks are checked against the pinned version.

Next stop point: specs complete, one QUESTION entry, one STATUS entry asking for approval.

### C-002 | cloud to orchestrator | 2026-09-25T05:40Z | STATUS

Re O-001 (`_handoff/inbound/O-001-firmware-relay.md`, `health-payload.md`). All four facts and the
health schema are applied. Requirement IDs changed because of O-001:

| Spec | ID | Change | O-001 item |
|---|---|---|---|
| `gateway-sync/requirements.md` | REQ-UBI-02 | ordering, cadence and episode window use `eventTime` (payload `timestamp` when valid, else receipt time), never arrival order | fact 3 |
| `gateway-sync/requirements.md` | REQ-UBI-09 (new) | SOS classified only by the `"SOS - "` prefix, never by any priority field | fact 2 |
| `gateway-sync/requirements.md` | REQ-EVT-06 | blind spots recorded: fall auto-SOS and pre-fix SOS send no beacons, so the cadence detector cannot fire; fixes arrive with `onboard-queue` Phase 9 | fact 1 |
| `gateway-sync/requirements.md` | REQ-EVT-12 | aligned to the schema: JSON `type: treklink_queue_health`, `schema`/`v` check, every field persisted, no `GatewayEvent`, no correlation; earlier "needs check" note withdrawn | health schema |
| `gateway-sync/requirements.md` | REQ-EVT-13 | buffering = sum of `depth` above zero, cleared by a zero report | health schema |
| `gateway-sync/requirements.md` | REQ-EVT-15, REQ-EVT-16 (new) | counter decrease = reboot; device-side loss identity kept for RQ1; other `PRIVATE_APP` traffic ignored, bad `schema`/`v` audited `MALFORMED_ENVELOPE` | health schema |
| `gateway-sync/requirements.md` | REQ-ERR-07 | `CLOCK_SKEW` only for future-dated or older-than-backlog-age timestamps; a past timestamp inside `maxBacklogAgeHours` is a delayed delivery | fact 3 |
| `gateway-sync/requirements.md` | AC-06 amended, AC-12 and AC-13 (new) | AC-06 limited to button or gesture SOS with a fix; slow-drain and health-report tests added | facts 1, 3; schema |
| `gateway-sync/design.md` | §1.1, §1.2, §2.2 | `eventTime` on `TrekLinkEvent`; `DeviceQueueReport` columns match the schema; `QueueHealthStrategy` row | all |
| `gateway-sync/tasks.md` | 4B.0, 4B.00 (new), 8B.1, 8B.2 | event time, priority-independence test, schema-driven strategy and reboot detection | all |
| `incidents/design.md` | §2.3 | time basis is `eventTime`; episodes that never beacon documented | facts 1, 3 |
| `devices/tasks.md` | 1.3 | v1 build env `treklink` recorded, not derived from the catalogue code | fact 4 |

The schema is copied into the spec tree as `specs/gateway-sync/api-design/06-queue-health-payload.md`,
because `_handoff/` is removed before merge and the specs must not link into it. The firmware
design stays the source of truth and the copy says so.

One tension to resolve, listed in C-003: E02-6 in `05-main-flows.md` says ordering uses queue
sequence and priority, "not wall-clock comparison across hosts", while fact 3 says order by the
payload timestamp. The two can both hold (E02-6 governs the gateway flush, fact 3 the backend
display and correlation), and that is the reading applied; the SSOT wording should say so.

### C-003 | cloud to orchestrator | 2026-09-25T06:30Z | QUESTION

One batch, numbered 1 to 41, ordered by what blocks the most work. Each question carries the
proposal the specs are written against, so "accept" is a complete answer. Questions 7 to 42 of the
MF-01 answers (Q30 to Q73, Session 8) are **Recorded, not Confirmed**; items 7, 12, 16 and 20 to 24
ask for their confirmation as interpreted. Answers belong in `07-clarification-answers.md` under a
new session block (Stage 2.8), which this session cannot edit.

**Phase B scope and foundation**

1. Accept `platform` as a tenth spec and backend module (envelope, configuration, runtime parameters, audit log, scheduler, health)? Proposal: yes. Draft D-027 in C-004.
2. Failure envelope: `result: { "errorCode": "..." }`, keeping D-002's four keys? Proposal: yes. Draft D-025.
3. "One endpoint per module, dispatched by `op`" (Session 7, recorded only in `gateway-sync/design.md` §4): keep it for `gateway-sync` only and use REST routes elsewhere, or revert `gateway-sync` to REST too? Proposal: `gateway-sync` only. Draft D-026.
4. Approve new dependencies. Backend: `@nestjs/schedule`, `@nestjs/event-emitter`, `@nestjs/throttler`, `@casl/prisma`, `pdfkit`. Frontend (later): `vitest`, `@testing-library/react`, `vitest-axe`, `@playwright/test`, `eslint-plugin-boundaries`. Proposal: approve the backend set for Phase B.
5. Turn on `strict: true` in `backend/tsconfig.json` (conventions require strict; the scaffold has `strictNullChecks: false`)? Proposal: yes, first task of Phase B.
6. Which modules does the Phase B approval cover? Proposal: `platform`, `auth`, `devices`, `trips`, `rentals` (MF-01), the `gateway-sync` ingestion core (MF-02 Stage A plus Stage B health consumption), and `billing` quote and escrow only if item 20 keeps escrow.

**Identity (Q30 to Q46 re-confirmation)**

7. Confirm `auth` as written: account types `CUSTOMER` and `STAFF`; Staff sub-roles `OPERATOR`, `GUIDE`, `ADMIN` as data; one account cannot be both Staff and Customer; login by username or email; lockout after 5 failures in 15 minutes for 15 minutes; Admin gets read access to Staff screens but no operational verbs.
8. Google OAuth (Q31 Flow 1): in Phase B, or later behind `AUTH_GOOGLE_ENABLED`? Proposal: later.
9. Email provider for OTP in the shared dev and demo environments (SMTP account, transactional service)? Proposal: `console` transport for local and CI; an SMTP credential in env for demo. Which account?
10. A provisioned Customer with no email cannot receive a reset code, and Staff may not see or set a password (Q35). Proposal: Staff verify the person, add an email to the account, then trigger the reset to it. Accept?
11. Time zone (Q37 says detect by IP): use the browser's time zone with default `Asia/Ho_Chi_Minh` instead, since IP geolocation needs an external service? Proposal: yes.

**Devices (Q47 to Q54)**

12. Confirm the device transition table in `specs/devices/design.md` §2.1 (Q47 said the FSM is not final), including the added edges `RENTED → MAINTENANCE` (E01-3), `RESERVED → MAINTENANCE`, `RENTED` or `IN_FIELD → RETIRED` (loss).
13. When does a device become `IN_FIELD` (Q48)? Proposal: automatically when its trip enters `IN_PROGRESS`. Alternatives: first field event received, or a manual Guide action.
14. Lost devices (E05-3, BR-22 imply automatic retirement): proposal is `LOSS_SUSPECTED` plus an alert after `rentals.nonReturnGraceDays` (default 3), and retirement only on Staff confirmation. Accept?
15. Block check-out when a device's PSK version is behind `devices.currentPskVersion` (D-021 made provisioning mandatory)? Proposal: yes, switchable by `devices.requireCurrentPskForCheckout`.

**Trips (Q65 to Q73)**

16. Name of the emergency trip state (Session 8 question 76). Placeholder `EMERGENCY`.
17. MF-01 says "trip to `Scheduled`", a state Q66 does not have. Proposal: it means `READY` ("On Start").
18. Who may start and finish a trip? Proposal: the Lead Guide and any Operator; not Assistant Guides.
19. Agency-initiated trip cancellation refunds bookings in full with no customer cancellation fee? Proposal: yes.

**Rentals and billing (Q55 to Q64)**

20. Payment timing: Q60 implies escrow at booking; MF-05 settles at return. Proposal: escrow at booking (trip fee, rental fee, deposit) plus settlement at return for fees and the deposit balance, switchable by `rentals.requireEscrowBeforeReview`. Accept, or settle only at return?
21. How the 10-minute hold "invalidates" (Q59): proposal is that an unpaid hold expires and releases the device, the booking stays `PENDING` with no device, and a paid hold persists until Staff review. Accept?
22. MF-01's swimlane puts "Reserve device" after Staff confirmation; its text and E01-1 put it before. Proposal: before, and redraw the swimlane (C-004). Accept?
23. Booking states (Q56 proposed `start, sent, pending, completed`): proposal `PENDING, CONFIRMED, COMPLETED, CANCELLED, REJECTED, EXPIRED`, with `start` being the unsaved form. Accept?
24. Do Guide-channel bookings pay escrow? Proposal: no; hold disabled, everything settled at return.
25. Where to store agreement PDFs and inspection photos (Neon holds rows, not files)? Proposal: Postgres `bytea` for PDFs (small, transactional with the rental) and the same for photos capped at 2 MB each; object storage later. Accept?
26. Serve the agreement PDF inside the D-002 envelope as base64 (proposal), or allow `GET .../agreement/pdf` to return raw `application/pdf` as the single documented exception to D-002?
27. Default amounts (all Admin-editable, D-015): late fee 50 000 VND per device per started day after a 2-hour grace; waiver approval threshold 200 000 VND; cancellation free for 10 minutes then 5 % of the rental fee (from Q60). Confirm or give values; loss and damage schedules are seeded as labelled demo values.
28. A waiver above the threshold is approved by another Operator who did not inspect the device (proposal), or by an Admin?
29. The prompt asked for a "Rental lifecycle state machine (7 states)"; the charter's graded pair is Device (7) and Incident (5). All three are delivered. Which pair does Review 2 present? Proposal: Device and Incident, with Rental as a supporting figure.

**MF-02 to MF-04 parameters and rules**

30. Episode window 300 s, retro-tag grace 60 s, cadence threshold 6 positions in 60 s (`gateway-sync` Q3 to Q5)? Proposal: accept as defaults, recalibrate after task 0.4's routine-interval capture.
31. After `RESOLVED`, a new device event within the window reopens the Incident to `DETECTED` so someone must acknowledge again (proposal), or to `IN_PROGRESS`?
32. Escalation: an Incident unacknowledged for 120 s alerts all Operators and Admins again. Accept the value?
33. Who may resolve and close an Incident? Proposal: Operators only; Guides acknowledge and add notes.
34. MTTA and MTTR start at the first event of the episode (proposal) or at Incident creation? They differ only for late-created suspected episodes.
35. Monitoring defaults: device stale 120 s, gateway stale 120 s, maximum plausible speed 30 km/h, battery warning 30 %, critical 15 %. Accept?
36. Admin sessions receive the full position stream like Operators? Proposal: yes (fleet scale is small).
37. E02-6 says ordering uses queue sequence and priority, not cross-host wall clocks; O-001 says order by the payload timestamp. Reading applied: E02-6 governs the gateway flush, the payload timestamp governs backend display and correlation. Confirm, and update the SSOT wording (C-004).
38. `specs/gateway-sync/requirements.md` carries Story ID `US-101`, which is not in the backlog (E4 is US-041 to US-052; the firmware queue is US-102). Keep, or replace with the E4 story list?

**Frontend and environment**

39. A locale layer in the operations app now? Charter §2 lists localisation as out of scope; Q9's locale requirement is the landing page's. Proposal: no, but keep strings grouped per feature.
40. Neon (D-010 open item): one shared dev database or a branch per developer? Needed before the first shared migration. Proposal: one shared dev database, migrations applied only from `dev` by CI or the leader.
41. Seed data (Q40 said not yet scoped). Proposal: one user per role plus two extra Guides, the four variants, 10 devices, 2 packages, 2 trips (one `BOOKING_OPEN`, one `IN_PROGRESS`), labelled demo pricing. Accept?

### C-004 | cloud to orchestrator | 2026-09-25T06:30Z | REQUEST

Proposed SSOT edits, as files under `_handoff/outbound/` laid out by target path. None is applied;
each file names the question it depends on. Written against the `treklink-docs@089374b` snapshot,
which predates PR #27, so apply by hand against current `dev`.

| File | Target | Summary |
|---|---|---|
| `treklink-docs/_docs/00-project-context/03-decisions-and-risk-register.proposed.md` | decision register | drafts D-025 (error code in `result`), D-026 (op-dispatch scope), D-027 (`platform` module); five risk rows: `nodeNum` overflow, the `gateway-sync` boundary breach, backlog-drain episode splitting, never-beaconing SOS, new dependencies |
| `treklink-docs/_docs/00-project-context/06-requirements-foundation.proposed.md` | requirements foundation | UC-27 to UC-42; context-diagram edits; BR-04 and BR-22 wording; honest-status row |
| `treklink-docs/_docs/00-project-context/05-main-flows.proposed.md` | main flows | MF-01 `Scheduled` to `READY`; MF-01 swimlane reorder; E02-6 clarification; new E03-8; parameter key names |
| `treklink-docs/_docs/01-conventions/04-architecture-conventions.proposed.md` | architecture conventions | `platform` in §1; transaction and lazy-hook patterns in §1.1; `BigInt` node numbers; device table §2.1; episode lookup ownership §3 |
| `capstone/Documents/reports/Report3_SRS-FR-catalogue.proposed.md` | Report 3 SRS | full FR catalogue (existing and new IDs) with the EARS requirements defining each |

Also requested, no file: record the answers to C-003 in `07-clarification-answers.md` as a new
session block, and regenerate the backlog if the leader wants stories for the gaps marked "none,
gap" in the traceability tables (trip lifecycle, PSK provisioning, booking cancellation, unassigned
SOS triage).

### C-005 | cloud to orchestrator | 2026-09-25T06:30Z | DELIVERY

Review 2 and SDD diagrams, 20 figures, each as `.mmd` (Mermaid 12.0.0 source) and `.svg` (rendered
with 12.0.0, valid XML, checked visually on a sample):
`_handoff/outbound/capstone/Documents/reports/sdd-diagrams/`, with a `README.md` giving source
file, figure number, rendered size, estimated smallest label and caption per figure, and the
mapping to the Review 2 template slides.

Contents: context diagram; architecture; module dependencies; core ERD for the slide; system ERD
in six parts; state machines for Rental (7), Incident (5, graded), Device (7, graded), Booking (6)
and Trip (8); MF-01 activity in three parts; MF-03 activity in two parts. Every figure is estimated
at or above the 7 pt floor; the handbook's own measurement harness was not available here, so the
figures should be re-measured with `build_handbook.py --measure` before they go into a graded
document. The use case diagram is unchanged pending UC-27 to UC-42 (C-004).

### C-006 | cloud to orchestrator | 2026-09-25T06:45Z | STATUS

Phase A complete. **Requesting spec approval.** Stopped; no production code, migration or UI will
be written until an `O-` entry approves and names the Phase B modules (C-003 item 6).

- Draft PR into `dev`: https://github.com/TrekLink-Team/treklink-web/pull/9
- Branch: `feat/module-specs-and-backend-foundation`, 13 commits, all pushed.
- Delivered: 10 spec suites (`platform` proposed plus the nine modules), 102 endpoint and contract
  files, 20 SDD figures (C-005), SSOT proposals (C-004), session record
  `docs/sessions/2026-09-25-0311-module-specs.md`.
- Blocking before Phase B: C-003 items 1 to 6. Blocking specific tasks: the remaining items, each
  referenced from the `tasks.md` that waits on it.
- Correction to C-003's preamble, which is not edited in place: the sentence "Questions 7 to 42 of
  the MF-01 answers" should read "The MF-01 answers Q30 to Q73 (Session 8) are Recorded, not
  Confirmed; items 7, 12 to 24 ask for their confirmation as interpreted."

On resume the session will pull, read new `O-` entries, apply the answers to the specs in one pass,
then start `specs/platform/tasks.md` Phase 1.
