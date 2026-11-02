# Flow-level UI/UX audit of the TrekLink web app (UX-1)

> 2026-11-02, read-only audit for KhoaDD, base `origin/dev` at `5f0c416`. No product code changed.
> Status: **draft in progress**, pushed early; sections below are filled as each journey is walked.

## 1. Method and what ran

- Standard checked against: `specs/frontend/ui-design/0-ui-standard.md` (WCAG 2.2 AA), plus the W3C
  Understanding pages, the WAI-ARIA Authoring Practices, the GOV.UK Design System, Carbon and Nielsen's
  heuristics where a criterion does not apply.
- The docs root `../treklink-docs/_docs/` is not present in this sandbox (only `treklink-web` was
  cloned), so the conventions, the decision register and the firmware ground truth were not read. Rules
  are cited from the copies inside `specs/frontend/`.
- Stack: being started (Postgres 16 local, `npm ci`). Until it runs, findings come from the code and the
  screen specs.

## 2. Journeys walked

1. Contracts and their devices (code): `ContractsPage`, `ContractApprovalPage`, `ContractDetailPage`,
   `ContractRequestPage`, `DeviceDetailPage`, `FleetPage`.

## 3. Findings (first journey)

| # | Journey, step | Route, file | What the user sees | Why it is a problem | Criterion or practice | Severity | Fix pattern |
|---|---|---|---|---|---|---|---|
| F1 | Contracts, devices of a contract | `/o/contracts/:id`, `/t/contracts/:id`, `pages/ContractDetailPage.tsx:298` | The asset tag is plain text; the only link on the row is "History", to telemetry, and only after handover | No path from a contract's unit to the unit itself | Carbon list-detail; Nielsen 3 (user control) | Slows | Asset tag links to the device detail in both scopes |

(Draft: the full table follows.)
