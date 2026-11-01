# Requirements Specification: demo (local demo control panel)

**User Story**: As the **presenter of a TrekLink demo on a laptop**, I want to stage the starting state of each main flow on the local database from one button and switch the signed-in role in one click, so that a local demo needs no terminal.
**Story ID**: none, a demo aid outside the backlog (D-088) | **Priority**: High for the 2026-11-01 demo | **Milestone**: Review demo

> **Authority**: D-088 (demo control panel, treklink-docs register, merged 2026-11-01), D-062 (the shared Neon database is never reset), D-078 (deadline takeover), D-057 (one account type per permission), D-002 (envelope). The manual procedure this module replaces is `docs/demo/2026-11-01-demo-script.md` §1.2, §1.3 and §8.

---

## 1. Domain Context & Scope

- **In-Scope**:
  - A reset of the local database to the migration seed plus the demo seed (`backend/prisma/seed-demo.ts`)
  - Seven named scenarios, each a reset plus the steps that reach one flow's starting state through other modules' exported services
  - A role switch to the seeded account of a role, issuing a normal token pair
  - The Admin screen `/t/admin/demo` (screen 7.5) and a role switcher in the account menu
- **Out-of-Scope**:
  - Any use against a shared or production database; the module refuses both
  - New business rules: a scenario only calls services that already exist, or a small exported read or command added to the owning module
  - Loss cases (scenario 7 is listed as unavailable until treklink-web#228)
- **Depends on**: `platform`, `auth`, `organizations`, `devices`, `billing`, `rentals`, `gateway-sync` (design Figure 1).

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL load the `demo` module only WHEN `DEMO_CONTROLS_ENABLED` is `true`; otherwise every `/api/demo` route SHALL answer 404. The variable defaults to `false`.
- **REQ-UBI-02**: The system SHALL answer every demo endpoint in the D-002 envelope, behind the JWT guard; `POST` endpoints SHALL also carry a CASL policy: `demo.stage` (TrekLink Admin) for staging, `demo.switchRole` or `demo.switchRole.org` (every seeded role) for the role switch.
- **REQ-UBI-03**: The system SHALL reach every other module's data only through that module's exported services (NFR-MNT-01).

### Event-driven

- **REQ-EVT-01**: WHEN a signed-in user reads `GET /api/demo/status`, the system SHALL return `enabled`, `databaseLocal` and the last staged scenario with its time, or null.
- **REQ-EVT-02**: WHEN an Admin reads `GET /api/demo/scenarios`, the system SHALL return the seven scenarios with `id`, `title`, `flow`, `summary`, `available` and `unavailableReason`.
- **REQ-EVT-03**: WHEN an Admin stages an available scenario, the system SHALL, in order: truncate every table of the `public` schema except `_prisma_migrations` and the migration-filled reference tables (design §3), in one transaction with `RESTART IDENTITY`; run the demo seed in-process; apply the scenario's steps; write one audit entry `demo.stage`; and return `{ scenarioId, stagedAt, records, firstSteps, session }`, where `session` is a token pair and account for the seeded Admin, so the presenter stays signed in.
- **REQ-EVT-04**: WHEN a signed-in user switches to a role, the system SHALL issue a token pair for the seeded account of that role as a sign-in would, and SHALL record an auth event `DEMO_SWITCH` for that account.

### Unwanted behaviour

- **REQ-ERR-01**: IF `NODE_ENV` is `production`, THEN a stage or a role switch SHALL answer 403 `DEMO_DISABLED`.
- **REQ-ERR-02**: IF the host of `DATABASE_URL` is not a loopback address (`localhost`, `127.0.0.0/8`, `::1`), THEN a stage or a role switch SHALL answer 403 `DEMO_DATABASE_NOT_LOCAL` with "Demo controls run only against a local database." and SHALL change nothing. A Neon host (`*.neon.tech`) is the case this protects (D-062).
- **REQ-ERR-03**: IF a stage or a role switch is running, THEN a second one SHALL answer 409 `DEMO_BUSY`.
- **REQ-ERR-04**: IF the scenario is unknown, THEN 404 `NOT_FOUND`; IF it is not available, THEN 409 `DEMO_SCENARIO_UNAVAILABLE` with its reason; both before any row is touched.
- **REQ-ERR-05**: IF a `SEED_*_PASSWORD` variable is missing, THEN a stage SHALL answer 409 `DEMO_SEED_NOT_CONFIGURED` naming the variables, before any row is touched.
- **REQ-ERR-06**: IF the seeded account of the requested role does not exist or may not sign in, THEN a role switch SHALL answer 404 `NOT_FOUND` "No seeded account for this role. Stage a scenario first."

## 3. Acceptance Criteria

- **AC-01**: With `DEMO_CONTROLS_ENABLED=false`, `GET /api/demo/status` is 404.
- **AC-02**: With `DATABASE_URL` on `ep-x.ap-southeast-1.aws.neon.tech`, a stage is 403 `DEMO_DATABASE_NOT_LOCAL` and no SQL runs.
- **AC-03**: Staging `clean`, then `contract-ready-for-handover`, then `term-ended` on a local Postgres leaves, respectively: RC-2026-0001 to RC-2026-0003 and no ORG-0002; RC-2026-0004 APPROVED with five reserved v3 units and its holding fee paid; RC-2026-0002 RETURN_DUE.
- **AC-04**: After a stage the presenter's window is signed in as the seeded Admin without a sign-in page.
