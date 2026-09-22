# Session: 2026-09-13 — cross-repo system critique (Week 1→2 boundary)

**Milestone**: pre-coding audit across all 3 repos (backlog, firmware wire format, `treklink-web`
scaffold) before real implementation starts, per "docs first, code later." First real use of the
namespaced session-file convention (`01-conventions/01-session-based-development-and-ssot.md` §4,
Session 4 revision) — this file exists specifically so the findings below don't have to be
re-derived by a future session.

## Findings and where each one landed (don't re-derive these — read the target file)

| Finding | Landed in |
|---|---|
| SOS beacon retransmits (all but the first packet) send at `BACKGROUND` mesh priority, not `MAX` — `PositionModule::sendOurPosition()` sets priority by device role | `treklink-docs/_docs/00-project-context/04-firmware-ground-truth.md` §2 (new Session 4 block) + new risk-register row + new D-008 firmware-fix candidate |
| `MeshPacket.id`'s doc-comment claims IDs can be 0 for no-ack/non-broadcast packets — checked against `Router::allocForSending()`, ruled out (every packet gets a real id) | `04-firmware-ground-truth.md` §3 |
| `nodeNum` is MAC-derived with local-collision-avoidance fallback — answers `specs/gateway-sync/requirements.md` Q8 (device identity stability) in the team's favor | `04-firmware-ground-truth.md` §3 |
| `TELEMETRY_APP` is a protobuf `oneof` (DeviceMetrics vs EnvironmentMetrics etc.) with no explicit variant tag in the JSON envelope — low risk but undocumented | `04-firmware-ground-truth.md` §4 |
| Two SOS-cancel gestures look identical (3s hold) but mean different things depending on whether `triggerSOS()` has already fired — pre-alarm suppression vs. post-trigger local-silence-only | `04-firmware-ground-truth.md` §2 |
| No backlog story existed for the cadence-inferred `SUSPECTED` episode workflow (the mitigation for the Critical single-text-frame risk) | New `US-088` in `treklink-docs/_docs/03-backlog/`, assigned Khoa, reviewer TanNB — `01-epics.md`/`02-user-stories.md`/xlsx regenerated via `build_backlog.py` |
| `backend/prisma/schema.prisma` still had the pre-D-006 `eventId` formula asserted as fact in a comment | Fixed directly in `schema.prisma` (this repo) |
| `gateway/src/serial/serial-reader.ts`'s `handleFrame()` signature still uses `(deviceId, sessionId, sequenceNumber)` | Logged as a sharpened acceptance criterion on `specs/gateway-sync/tasks.md` Phase 9.1 |
| `gateway/src/mqtt/mqtt-client.ts`'s `flushQueue()` fires all publishes concurrently instead of ack-ordered, and only triggers on `connect` (no ongoing drain) | Logged as sharpened acceptance criteria on `specs/gateway-sync/tasks.md` Phase 9.5, with two new test cases specified |
| `treklink-web/docs/conventions/` is a raw, unreconciled copy of the unrelated `dev-flow` template repo — zero TrekLink-specific content, drifted filenames vs. the authoritative `treklink-docs/_docs/01-conventions/` | Not yet fixed — architecture critique delivered in conversation; user to decide fork-vs-redirect (see `03-decisions-and-risk-register.md` if/when logged as a decision) |
| Session-ledger mechanism existed on paper (`01-conventions/01`, `/08`, `/09`) but wasn't concurrency-safe or enforced — this session's own findings sat only in chat output until flagged | `01-conventions/01`, `/08`, `/09` revised (Session 4) to mandatory + namespaced per-session files — this file is the first real instance |

## Immediate next steps

1. Decide the `treklink-web/docs/conventions/` fork-vs-redirect question (flagged, not yet resolved).
2. Regenerate/review `specs/incidents/requirements.md` (still a blank template) with US-088's
   Suspected/Confirmed distinction in mind once that module's spec gets written for real.
3. When gateway-sync Phase 9 (Stage B) actually starts, `tasks.md` 9.1/9.5 already carry the
   sharpened acceptance criteria from this session — read them before touching `gateway/src`.
