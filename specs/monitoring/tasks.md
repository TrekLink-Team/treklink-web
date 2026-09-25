# Implementation Tasks: monitoring

> Approved by: pending (`_handoff/SYNC.md`) · Branch: `feat/module-specs-and-backend-foundation` · Jira: US-038, US-053, US-055, US-056, US-058, US-065, US-066
>
> Fulfills `design.md`. MF-04 is "specified" at Review 2 (roadmap W7): these tasks are scheduled after MF-03, and the backend part (TanNB) and the UI part (LongNN) proceed in parallel against `api-design/03`.

## Phase 1: Foundation

- [ ] 1.1 `MonitoringModule` importing the exported services it reads; no Prisma models
- [ ] 1.2 Parameter keys of requirements §4; error codes of design §2.4
- [ ] 1.3 Message frame type and the event catalogue as a shared TypeScript contract re-exported for `frontend/`

## Phase 2: Core Service Logic

- [ ] 2.1 `MonitoringGateway` on namespace `/monitoring`: JWT verification with `ver` check, room computation, expiry timer
  - _Requirements: REQ-UBI-01, REQ-EVT-01, REQ-EVT-08_
- [ ] 2.2 Event routing to entitled rooms; `seq`; throttle per device
  - _Requirements: REQ-UBI-02, REQ-UBI-03, REQ-EVT-02, REQ-EVT-03_
- [ ] 2.3 Connectivity sweep on the platform scheduler; transitions only; `BUFFERING` precedence
  - _Requirements: REQ-EVT-04, REQ-EVT-05, REQ-STA-01, REQ-STA-02_
- [ ] 2.4 Scope changes on `trip.status.changed` and guide assignment events
  - _Requirements: REQ-EVT-06, AC-07_
- [ ] 2.5 Unit tests: room computation per role, routing, throttle keeps the latest value, sweep transitions

## Phase 3: Query / Retrieval

- [ ] 3.1 Snapshot with scope, battery level and connectivity; `seq` consistency
  - _Requirements: REQ-EVT-07, AC-05_
- [ ] 3.2 Trail with plausibility filter and thinning
  - _Requirements: REQ-ERR-02, AC-06_

## Phase 4: API Presentation Layer

- [ ] 4.1 `MonitoringController` per api-design 01 and 02
- [ ] 4.2 E2E: every Validation row; socket tests with `socket.io-client` against the running app for AC-01 to AC-08, including the silent-socket scope test (AC-01)
- [ ] 4.3 Latency measurement commit to emit (≤2 s)

## Phase 5: Frontend Integration

- [ ] 5.1 `socketClient`, live store, map, gateway and incident widgets (tracked in `specs/frontend/tasks.md`)

## Phase 6: End-to-End Verification & DoD Audit

- [ ] 6.1 Tests green; 6.2 lint, boundary check, typecheck clean; 6.3 api-design matches behaviour; 6.4 session file
