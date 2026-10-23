# `ComplianceCasePage` and channel key rotation

| | |
|---|---|
| Owner | TanNB |
| Task | `specs/frontend/tasks.md` 3.6 |
| Assigned, due | 2026-10-21, 2026-10-23 |
| Status | Ready for review |
| Routes | `/t/compliance-cases`, `/t/compliance-cases/:id` for the case queue and detail; the channel key rotation control itself renders on [`OrganizationReviewPage`](3-2-organizationreviewpage-for-staff-and-admin.md)'s detail view (`/t/organizations/:id`), per `design.md` §2's route row "channel key exposure and rotation" under `/t/organizations`. This file documents its full action spec since the task bundles it here; 3-2 cross-references back to this section rather than repeating it. |
| Roles | TrekLink Staff: open a case, read, revoke a Field Station or API key from a case, close a case, rotate the channel key. TrekLink Admin inherits all of that (FR-AUTH-10) and alone may record the Suspend action. |
| Use case, FRs, story | UC-63, UC-60; FR-ORG-08, FR-ORG-09, FR-DEV-13, BR-40, D-046, D-045; US-UC63 |
| Requirements | REQ-EVT-12, REQ-EVT-13, REQ-ERR-08 (`specs/organizations/requirements.md`) |
| Wireframe | ![ComplianceCasePage and channel key rotation](3-6-compliancecasepage-and-channel-key-rotation.svg) |

Scope from the task: organizations api-design 27 to 31; open a case, record actions (suspend for
Admin only), close with outcome and authority reference (required for fraud and theft); rotate key
on the organization page clears the exposed flag.

## Data

| Shown | Source (api-design file, property) |
|---|---|
| Queue rows: code, organization.code, type, status, openedAt | organizations api-design 28, `GET /api/compliance-cases` `items[]` |
| Case detail: code, organization, type, status, evidence, linkedContractIds, linkedLossCases, authorityReference, outcome, openedAt, actions[] | organizations api-design 28/29, same shape on list and detail |
| Channel key panel on `OrganizationReviewPage` (3-2): channelKeyVersion, channelKeyExposedAt | organizations api-design 03 (`GET /api/organizations/:id`); exposure is set by `devices` (FR-DEV-13) and shown here only as the trigger for rotation |

## Actions

| Control | Endpoint | Confirmation | Success message |
|---|---|---|---|
| Open a case (Staff, Admin) | `POST /api/organizations/:id/compliance-cases` (29) | none | "Compliance case opened" (server `message`) |
| Record: Suspend organization (Admin only) | `POST /api/compliance-cases/:id/actions` (30), `kind=SUSPEND_ORGANIZATION` | yes, "Suspend {organization.legalName} from this case?" | "Action recorded" (server `message`) |
| Record: Revoke a Field Station or API key (Staff, Admin) | `POST /api/compliance-cases/:id/actions` (30), `kind=REVOKE_FIELD_STATION` or `REVOKE_API_KEY` | yes, "Revoke {name}?" | "Action recorded" (server `message`) |
| Record: Other (Staff, Admin) | `POST /api/compliance-cases/:id/actions` (30), `kind=OTHER` | none | "Action recorded" (server `message`) |
| Close the case (Staff, Admin) | `POST /api/compliance-cases/:id/close` (31) | yes, "Close case {code}?" | "Compliance case closed" (server `message`) |
| Rotate the channel key (Staff; renders on [3-2](3-2-organizationreviewpage-for-staff-and-admin.md)) | `POST /api/organizations/:id/channel-key/rotate` (27) | yes, "Rotate the channel key for {legalName}?" | "Channel key rotated" (server `message`) |

## States

| State | What the user sees |
|---|---|
| Loading | Queue and detail panel show skeleton rows independently; every action shows its pending state at once |
| Empty | "No results match your filters." (MSG01) |
| Error 400 `VALIDATION_FAILED` | MSG02 under the field that failed (open case: evidence; close: outcome; rotate: reason) |
| Error 403, suspend attempted by Staff (`FORBIDDEN`, custom text) | Not reached in normal use, the Suspend control is hidden for Staff client-side; if forced (stale role state), the server `message` ("Ask a TrekLink Admin to suspend the organization.") is shown, not MSG26, since its text is more specific than MSG26's generic denial |
| Error 404 `NOT_FOUND` / generic 403 | MSG26 |
| Error 409 `INVALID_STATE_TRANSITION` | MSG28, shown when acting on or closing an already-`CLOSED` case |
| Error 409 `POLICE_REFERENCE_REQUIRED` | MSG02 under the `authorityReference` field, required only when `type` is `SUSPECTED_FRAUD` or `SUSPECTED_THEFT` (client mirrors BR-40 before submit; the server check is the source of truth) |
| Error 409 `STALE_VERSION` (rotate key, on 3-2) | MSG36, a dialog with Reload that keeps the reason field's text |

## Form fields (if any)

| Step | Field | Type | Required | Rule |
|---|---|---|---|---|
| 1 Open case (one step) | type | select (SUSPECTED_FRAUD, SUSPECTED_THEFT, IP_VIOLATION, NDA_BREACH, OTHER_BREACH) | yes | one of the five values |
| 1 Open case | evidence | textarea | yes | non-empty |
| 1 Open case | linkedContractIds | multi-select, this organization's contracts | no | — |
| 1 Open case | linkedLossCaseIds | multi-select, this organization's loss cases | no | — |
| 1 Record action (one step) | kind | select (SUSPEND_ORGANIZATION, REVOKE_FIELD_STATION, REVOKE_API_KEY, OTHER); `SUSPEND_ORGANIZATION` shown only to Admin | yes | one of the four values |
| 1 Record action | targetId | select, the organization's Field Stations or API keys, shown only when `kind` is a revocation | conditionally required | required when `kind` is `REVOKE_FIELD_STATION` or `REVOKE_API_KEY` |
| 1 Record action | note | textarea | yes | non-empty |
| 1 Close case (one step) | outcome | textarea | yes | non-empty |
| 1 Close case | authorityReference | text | conditionally required | required when `type` is `SUSPECTED_FRAUD` or `SUSPECTED_THEFT` (BR-40) |
| 1 Rotate key (one step, on 3-2) | reason | textarea | yes | non-empty |

## Mobile, accessibility, live data

- 360 px layout: not one of NFR-UI-01's mandatory screens; below 760 px the queue collapses to one
  card per case (code, organization, type, status) and the detail panel's action history becomes a
  single-column timeline.
- Tab order and focus after each action: queue row to detail panel follows visual order; after Open,
  Record action or Close, focus moves to the new entry at the top of the action history/status badge;
  the `targetId` field appears and receives focus only once `kind` selects a revocation, so tab order
  never skips a hidden control.
- WebSocket events and invalidated query keys: none. No `/live` event exists for a compliance case or
  a channel key rotation (`ws-live-contract.md` carries no such type); every mutation above
  invalidates `['complianceCases', filters]` and `['complianceCase', id]`, or `['organization', id]`
  for the rotate action, through TanStack Query.

## Checklist

Chapter 06 §7 (Screen Design Checklist) and §8 (UI and UX practices), ticked by the owner before review.

- [x] Route and roles match `design.md` §2; the rotate control's actual location (on 3-2) is stated
  plainly rather than duplicating a second control on this page.
- [x] Data: every field names its api-design source.
- [x] Actions: every control names its endpoint, confirmation and message, including the Admin-only
  gate on Suspend.
- [x] States: one row per error code the five endpoints return, with the non-standard 403 text called
  out as not MSG26.
- [x] Forms: each dialog is one step of at most 4 fields; the conditional fields and their trigger are
  stated.
- [x] Mobile: not mandatory; collapse behaviour and the conditional-field tab-order rule are stated.
- [x] Accessibility: tab order and the post-action focus target are stated.
- [x] Live data: stated as none, with the query keys invalidated instead.
- [x] Traceability: UC-63, UC-60, the FRs, BR-40, D-045, D-046 and US-UC63 are in the header table.
