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
