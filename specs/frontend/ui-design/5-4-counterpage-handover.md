# `CounterPage` handover (`/t/counter/:contractId`)

| | |
|---|---|
| Owner | LongLP |
| Task | `specs/frontend/tasks.md` 5.4 |
| Assigned, due | 2026-10-21, 2026-10-23 |
| Status | Ready for review |
| Routes | `/t/counter/:contractId` for an `APPROVED` contract; the same route serves check-in for a contract with devices out (screen 5.5) (`specs/frontend/design.md` §2 and §5) |
| Roles | TrekLink Staff (and Admin, D-057 rule 7): the whole page. Organization accounts: MSG26. The Org Manager is present at the counter and signs on the Staff member's screen. |
| Use case, FRs, story | UC-14, UC-20, UC-21; FR-CON-05, FR-CON-06, FR-DEV-05, BR-09, E01-4, E01-5, D-037; US-UC14, US-UC20, US-UC21 |
| Requirements | `specs/rentals/requirements.md` REQ-EVT-04 to REQ-EVT-06, REQ-UBI-05, REQ-ERR-04, REQ-ERR-07, REQ-ERR-08 |
| Wireframe | ![CounterPage handover](5-4-counterpage-handover.svg) |

Scope from the task: rentals api-design 07 to 10 in four steps (design §5): devices with scan, provisioning, battery and GPS check and swap; payment status; preview note; signature pad (PNG) and identity field; nothing stored in the browser after submit

## Data

| Shown | Source (api-design file, property) |
|---|---|
| Header: contract code, organization, status, plan, variant, quantity, requested start | rentals 03 `code`, `organization.code`, `legalName`, `status`, `planType`, `hardwareVariant.code`, `quantity`, `requestedStartDate` |
| Reserved devices by asset tag | rentals 03 `devices[].deviceId`, `assetTag` |
| Organization's current key version (the version to write and record) | organizations 03 `channelKeyVersion` |
| Provisioning recorded per device | rentals 09 `result.keyVersion`, `provisionedAt` |
| Swap result: released and newly reserved device | rentals 07 `released.assetTag`, `status`; `reserved.assetTag`, `status` |
| First payment: amount, paid, payment status and sandbox flag | billing 08 with `contractId` (`items[].id`, `status`); billing 09 `lines[]` of type `HOLDING_FEE` (monthly) or the day-plan fee line, `amountVnd`, `paidVnd`; `payments[].status`, `method`, `isSandbox` |
| Note preview (unsigned PDF) | rentals 08 `pdfBase64` |
| Signing Managers to choose from | organizations 12 `items` with `role` `MANAGER` and active, `id`, `fullName` |
| After completion: devices issued, note hash | rentals 10 `result.devices[].assetTag`, `handoverNoteSha256` |

## Actions

| Control | Step | Endpoint | Confirmation | Success message |
|---|---|---|---|---|
| Scan or type asset tag | 1 Devices | none; highlights the matching reserved row, MSG12 if the tag is not reserved to this contract | none | row focused |
| Dock and provision (row, draft D-080, replaces Record provisioning) | 1 Devices | Web Serial to the unit (`devices` design §8.4), then rentals 09 `POST /api/contracts/:id/devices/:deviceId/provisioning` with `channelKeyVersion` and the docked `nodeNum` | the browser's port chooser on the first docking of the visit | the row shows "Provisioned v{n}" |
| Swap (row) | 1 Devices | rentals 07 `POST /api/contracts/:id/devices/:deviceId/swap` | dialog: "Send {assetTag} to maintenance and reserve another {variant}?" with the reason field | toast MSG03; the row is replaced by the new asset tag, which needs its own provisioning and check |
| Record counter payment (link) | 2 Payment | navigation to screen 6.3 for the first invoice, returning here | none | none |
| Next and Back | all | none | none | none |
| Complete handover (primary) | 4 Sign | rentals 10 `POST /api/contracts/:id/handover` | none: the signed preview is the confirmation | toast MSG06; the page shows the issued devices and the note download (screen 5.2); the signature, identity text and preview are cleared from memory |
| Clear signature | 4 Sign | none | none | none |

## States

| State | What the user sees |
|---|---|
| Loading | Header and device table skeletons; each row action shows its pending state; Complete handover is disabled until the server answers |
| Empty | Not applicable: an `APPROVED` contract always has reserved devices |
| Before the start date | Amber banner "Handover is possible from {requestedStartDate}." (`BEFORE_START_DATE`); Complete handover disabled |
| Error `VALIDATION_FAILED` (400, rentals 07, 09, 10) | MSG02 under the field the server names |
| Error `DEVICE_NOT_ON_CONTRACT` (409, rentals 07, 09) | MSG12 |
| No Web Serial (draft, D-080) | Amber banner at the top of step 1: "Docking needs Chrome or Edge on a desktop. Open this page there to provision units."; Dock and provision disabled |
| Docking in progress (draft) | The row shows the step: reading, writing owner, writing key, checking; other rows' Dock buttons are disabled |
| Wrong unit docked (draft, REQ-ERR-12) | "The docked unit is {nodeId}, not {assetTag}. Nothing was written." on the row |
| Write failed, read-back differs, unit disconnected or port busy (draft, REQ-ERR-13) | The failed step named on the row, then "Dock {assetTag} again before handover."; nothing recorded |
| Error `NODE_MISMATCH` (409, rentals 09, draft) | As wrong unit docked |
| Error `KEY_VERSION_MISMATCH` (409, rentals 09) | MSG24; the page reloads organizations 03 for the current version |
| Error `INSUFFICIENT_DEVICES` (409, rentals 07) | MSG11 dialog: no replacement exists, so the handover is held (E01-5) |
| Error `FIRST_PAYMENT_MISSING` (409, rentals 10) | MSG23 on step 2, with the link to screen 6.3 |
| Error `DEVICE_NOT_PROVISIONED` (409, rentals 10) | MSG24 on the device row; step 1 opens |
| Error `DEVICE_CHECK_FAILED` (409, rentals 10) | MSG17 on the device row with Swap |
| Error `LOW_BATTERY` (409, rentals 10) | MSG19 amber banner on the row with "Proceed anyway"; resending sets `acknowledgeLowBattery` |
| Error `BEFORE_START_DATE` (409, rentals 10) | The server's `message` ("Handover is possible from {date}."); no SRS code |
| Error `SIGNER_NOT_MANAGER` (400, rentals 10) | The server's `message` under Signing Manager ("Only a Manager of the organization can sign."); no SRS code |
| Error `INVALID_STATE_TRANSITION` (409, rentals 07 to 10) | MSG28 with the contract's state |
| Error `STALE_VERSION` (409, rentals 10) | MSG36 dialog with Reload |
| Not found or forbidden | `NOT_FOUND` (404) or `FORBIDDEN` (403): MSG26 |
| Success | Toast MSG06; contract `ACTIVE`, devices `RENTED` |

## Form fields (if any)

| Step | Field | Type | Required | Rule |
|---|---|---|---|---|
| 1 Devices | Asset tag | text, scanner input | no | a tag reserved to this contract |
| 1 Devices | Battery %, per device | integer 0 to 100 | yes | below `devices.handoverMinBatteryPct` needs the acknowledgement (rentals 10 `deviceChecks[].batteryPct`) |
| 1 Devices | GPS fix, per device | checkbox | yes | a failed fix means Swap before handover (rentals 10 `deviceChecks[].gpsFixOk`) |
| 1 Devices | Swap reason | text, in the swap dialog | yes | what failed (rentals 07 `reason`) |
| 2 Payment | none | | | read-only status |
| 3 Preview note | none | | | read-only PDF |
| 4 Sign | Signing Manager | select | yes | an active Manager of the organization (rentals 10 `signedByMemberId`) |
| 4 Sign | Identity document checked | text | yes | document type and last digits seen, never the full number (rentals 10 `identityChecked`) |
| 4 Sign | Signature | signature pad, PNG | yes | not blank (rentals 10 `signaturePng`) |

Four steps (`design.md` §5, NFR-USE-01). Step 1 holds one row per reserved device with two inputs each,
plus the scan field; the other steps have at most three fields. The request sends the contract
`version` as `expectedVersion`. Nothing is stored in the browser after submit: no `localStorage`,
`sessionStorage` or cache entry holds the signature or the identity text.

## Mobile, accessibility, live data

- 360 px layout: the counter runs on a desktop or tablet; on a narrow screen the steps stack, the device table becomes one card per device with its inputs and actions, and the signature pad takes the full width at a fixed height.
- Tab order and focus after each action: the scan field has focus on step 1 and keeps it after each scan; the matching row is announced. Next moves focus to the next step's heading. The signature pad has a text alternative ("Signature area, drawn by the Manager") and Clear signature next to it; Complete handover follows it. Errors are announced and move focus to the failing row or field.
- WebSocket events and invalidated query keys: no live events. Query keys `['contract', id]`, `['organization', orgId]`, `['org-members', orgId]`, `['invoices', { contractId }]`, `['invoice', invoiceId]`, `['handover-preview', id]`; every mutation invalidates `['contract', id]`; completion also invalidates `['contracts', ...]` and removes `['handover-preview', id]`.

## Checklist

Chapter 06 §7 (Screen Design Checklist) and §8 (UI and UX practices), ticked by the owner before review.

- [x] Route and roles match `design.md` §2 and §5; organization accounts get MSG26
- [x] Data: every field names rentals 03, 07 to 10, organizations 03 and 12, or billing 08 and 09
- [x] Actions: scan, provisioning, swap, payment link, complete handover (MSG06)
- [x] States: loading, start-date banner, every error code of rentals 07 to 10, 403 and 404, success
- [x] Forms: four steps, with type, requirement and rule per field; nothing kept after submit
- [x] Mobile: narrow layout described
- [x] Accessibility: scan focus, step headings, signature pad text alternative, announced errors
- [x] Live data: none; query keys listed
- [x] Traceability: UC-14, UC-20, UC-21; US-UC14, US-UC20, US-UC21
