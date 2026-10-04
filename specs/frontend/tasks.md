# Implementation Tasks: frontend

> Rewritten 2026-10-04 (D-036). Owner: LongNN. Each phase follows its backend module's API Presentation
> phase. Jira keys assigned when the backlog is regenerated.

## Phase 1: Shell

- [ ] 1.1 `apiClient` envelope unwrap, `ApiError`, single refresh-and-retry; auth context; router with role guards
  - _Requirements: REQ-UBI-01, REQ-UBI-02, REQ-EVT-02_
- [ ] 1.2 Replace MapLibre with Leaflet and the overlay in `shared/config/map.ts` and `LiveMapWidget`; remove `maplibre-gl`
  - _Requirements: REQ-UBI-06, AC-03, D-031_
- [ ] 1.3 `socketClient` with cursor and reconnect banner; global alert banner
  - _Requirements: REQ-EVT-01, REQ-EVT-03_

## Phase 2: Public and auth pages

- [ ] 2.1 Plans, registration, sign-in, forgot, reset, welcome

## Phase 3: Organization workspace

- [ ] 3.1 Map, incident queue and detail (one-tap acknowledge)
  - _Requirements: REQ-UBI-03, REQ-UBI-07, AC-02_
- [ ] 3.2 Contracts, request with quote, holder labels, invoices, SePay payment page
  - _Requirements: REQ-UBI-08_
- [ ] 3.3 Members, roster, API keys, Field Stations

## Phase 4: TrekLink workspace

- [ ] 4.1 Organization queues; contract approval; counter handover and check-in; inspection
- [ ] 4.2 Fleet, device detail with history, stock-take; incident escalation queue and authority reports
- [ ] 4.3 Billing, damage approvals, reports; administration pages

## Phase 5: Verification

- [ ] 5.1 Playwright journeys MF-01 to MF-05; axe-core on every route; responsive check at 360 px
  - _Requirements: REQ-UBI-03, REQ-UBI-04, AC-01, AC-04_
