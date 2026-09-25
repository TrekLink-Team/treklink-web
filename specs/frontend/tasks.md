# Implementation Tasks: frontend

> Approved by: pending (`_handoff/SYNC.md`) · Branch: `feat/module-specs-and-backend-foundation` · Jira: UI tasks of every story; `TK-63`, `TK-64`, `TK-73` (LongNN) per D-023
>
> Fulfills `design.md`. Phase B is backend first (prompt §2), so these tasks follow each backend module's Phase 4. The order below matches the Main Flow order.

## Phase 1: Foundation

- [ ] 1.1 Layer lint rule (`eslint-plugin-boundaries`) and the no-raw-fetch rule (AC-01, AC-02)
- [ ] 1.2 `apiClient` envelope unwrap, `ApiError`, silent refresh (REQ-UBI-02, REQ-EVT-01)
- [ ] 1.3 Router with route guards from `/api/auth/me`; `AuthProvider`
- [ ] 1.4 UI kit: Button, Modal (focus trap, Escape), Table with Pattern A, EmptyState, ErrorBanner, Pagination (REQ-UBI-07, REQ-ERR-02)
- [ ] 1.5 Time-zone and VND formatting helpers (REQ-UBI-09)
- [ ] 1.6 Test stack: Vitest, Testing Library, axe, Playwright; `ci.yml` frontend test step (dependency approval in C-003)

## Phase 2: MF-01 screens

- [ ] 2.1 Auth pages
- [ ] 2.2 Packages, package detail with quote
- [ ] 2.3 Booking wizard with hold countdown, E01-1 handling, sandbox pay (REQ-EVT-05, REQ-STA-04, AC-07)
- [ ] 2.4 Bookings queue with blockers; booking confirm and reject
- [ ] 2.5 Trips, trip detail, assign guides with availability
- [ ] 2.6 Rental desk: allocate, agreement and signature pad, check-out wizard
- [ ] 2.7 Guide: my trips, readiness checklist, handover check
- [ ] 2.8 Fleet list, device detail, register, transitions, maintenance

## Phase 3: MF-02 and MF-03 screens

- [ ] 3.1 Admin sync health and sync audit (RQ1 evidence view)
- [ ] 3.2 `socketClient`, live store, reconnect indicator, snapshot resync (REQ-EVT-02, AC-04)
- [ ] 3.3 Incident queue widget, acknowledge button, incident detail with both timelines, dismiss (REQ-EVT-03, REQ-EVT-06, REQ-STA-03, AC-05)

## Phase 4: MF-04 and MF-05 screens

- [ ] 4.1 Live map layers, stale and buffering markers, gateway indicator, map error state (REQ-STA-01, REQ-STA-02, REQ-EVT-04, AC-03)
- [ ] 4.2 Check-in, inspection, settlement, waivers, customer invoices
- [ ] 4.3 Admin users, roles, parameters, pricing, audit log

## Phase 5: Verification

- [ ] 5.1 axe clean on every page (AC-06); keyboard-only run of acknowledge and check-out
- [ ] 5.2 Playwright: MF-01 path, acknowledge race, reconnect resync
- [ ] 5.3 Sovereignty screenshots over Hoàng Sa and Trường Sa filed (D-012 acceptance test)
- [ ] 5.4 Lint, typecheck, build green; session file
