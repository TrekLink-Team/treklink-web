# Implementation Tasks: devices

> Approved by: pending (`_handoff/SYNC.md`) · Branch: `feat/module-specs-and-backend-foundation` · Jira: stories US-011 to US-022 (keys `TK-19` to `TK-30` once Jira is populated)
>
> Fulfills `design.md`. **Q47 says the FSM is not final**: Phase 2.1 must not start until C-003 confirms the transition table.

## Phase 1: Foundation & Domain Modeling

- [ ] 1.1 Prisma models `HardwareVariant`, `Device` (with `nodeNum BigInt`), `DeviceStatusHistory`, `MaintenanceRecord`, `DeviceProvisioning`; enums (in the platform initial migration)
  - _Requirements: REQ-UBI-01, REQ-UBI-04, REQ-UBI-06, design §1_
- [ ] 1.2 Partial unique index for one open maintenance record; append-only triggers on history and provisioning
  - _Requirements: REQ-ERR-04, REQ-UBI-03_
- [ ] 1.3 Seed the four variants with `mqttCapable` (`v1` false) and `hasPsram` (`v3` false) per `04-firmware-ground-truth.md` §5 and the S7 risk row; the catalogue code is `treklink-v1` to `treklink-v4`, while the PlatformIO build env of v1 is `treklink` (O-001 fact 4), so the seed records the build env in `notes` and never derives one from the other
- [ ] 1.4 DTOs; `nodeNum` transform accepting decimal or `!hex` into `bigint`; `BigInt` JSON serialisation as number (safe: uint32 fits in a JS number)
  - _Requirements: REQ-UBI-04, AC-02, AC-03_
- [ ] 1.5 Error codes of design §2.5; parameter keys of requirements §4

## Phase 2: Core Service Logic

- [ ] 2.1 `device-fsm.ts` transition table with manual flag and actor set, exactly design §2.1 `[Q47, Q48]`
  - _Requirements: REQ-UBI-02, BR-05_
- [ ] 2.2 `DevicesService.transition()` with `FOR UPDATE`, guards, history, post-commit events
  - _Requirements: REQ-UBI-03, REQ-ERR-02, REQ-ERR-03, REQ-EVT-09_
- [ ] 2.3 Registration, update, variant CRUD
  - _Requirements: REQ-EVT-01, REQ-EVT-02, REQ-ERR-01, REQ-ERR-05_
- [ ] 2.4 Maintenance open, progress, complete, unrepairable, with transitions
  - _Requirements: REQ-EVT-08, REQ-EVT-10_
- [ ] 2.5 Provisioning record and `assertCheckoutEligible()` with the PSK guard `[Q51]`
  - _Requirements: REQ-EVT-11, REQ-STA-02, AC-05_
- [ ] 2.6 Exported helpers for other modules: `findByNodeNum`, `lockForAllocation`, `findAllocatableCandidates` (`SKIP LOCKED`), `updateProjection`, `isVariantAccepted`, `countAvailable`
  - _Requirements: design §2.2_
- [ ] 2.7 Unit tests: full transition matrix (every allowed and every disallowed pair), advisory computation, nodeNum parsing edge values `0`, `4294967295`, `4294967296`
  - _Requirements: AC-01, AC-03, AC-06_
- [ ] 2.8 Concurrency test: 20 parallel transitions on one device against Docker Postgres
  - _Requirements: AC-04_

## Phase 3: Query / Retrieval

- [ ] 3.1 Fleet list with filters, computed connectivity and advisory, Guide scope
  - _Requirements: US-015, US-021_
- [ ] 3.2 Detail and status history
  - _Requirements: US-016, US-022, AC-08_
- [ ] 3.3 Unit tests for filters, sort whitelist, page bounds

## Phase 4: API Presentation Layer

- [ ] 4.1 `VariantsController`, `DevicesController` per api-design 01 to 12 (13 is served by `rentals`)
- [ ] 4.2 Swagger annotations
- [ ] 4.3 E2E tests: every Validation row of 01 to 12; AC-01 to AC-08

## Phase 5: Frontend Integration

- [ ] 5.1 Fleet list, device detail, register form, transition menu, maintenance form (tracked in `specs/frontend/tasks.md`)

## Phase 6: End-to-End Verification & DoD Audit

- [ ] 6.1 Tests green; 6.2 lint, boundary check, typecheck clean; 6.3 api-design matches behaviour; 6.4 session file
- [ ] 6.5 Configuration Matrix rows for requirements §4 demonstrated live
