# Device connector panel, the Staff device hub (shell panel on every `/t/*` page)

| | |
|---|---|
| Owner | KhoaDD |
| Task | `specs/frontend/tasks.md` 4.6 (devices tasks 10.6 to 10.11) |
| Assigned, due | 2026-11-04, after the contract home UI (brief item 5) |
| Status | Approved 2026-11-04 (devices design §12.12 decided, option A each) |
| Routes | No route of its own: a shell panel opened from the header button "Devices" on every TrekLink Staff page (`specs/frontend/design.md` §2), and by the entry points of screens 4.2, 4.3 and 5.4. On the full-bleed map routes it opens only as a `Drawer` |
| Roles | TrekLink Staff and TrekLink Admin: the whole panel, actions filtered by their abilities (Admin adds nothing here). Organization accounts: no button, no panel; the endpoints answer 403 (devices REQ-UBI-07) |
| Use case, FRs, story | UC-11, UC-14, UC-20, UC-38; FR-DEV-02, FR-DEV-05, FR-DEV-21, FR-CON-05, FR-MON-02; US-UC11, US-UC14, US-UC20 |
| Requirements | `specs/devices/requirements.md` REQ-UBI-07 to REQ-UBI-10, REQ-EVT-31 to REQ-EVT-43, REQ-STA-05, REQ-STA-06, REQ-ERR-11, REQ-ERR-21 to REQ-ERR-31; AC-25 to AC-40 |
| Wireframe | Not drawn yet: drawn when the variant renders (`/variants/<code>-detail.png`, `-icon.png`) arrive |

Scope from the task: the device hub of devices design §12, "connect a unit and see what you can do with it":
every connected unit as one row, recognition by `nodeNum`, register on connect, provisioning with the quick swap
and hot provisioning at the counter, Configure uplink, the device view with the unit's info and its product
render, and Update firmware. Every page's docking control opens this panel instead of docking on its own
(REQ-UBI-10).

## Layout

| Width | Placement (chapter 06 §10.8) |
|---|---|
| 1100 px and up | Non-modal `aside` pushed beside the page, 360 px wide; focus moves to its heading "Connected units"; Escape or Close closes it. While it is open the Info pane closes (devices design §12.12 Q6, decided A) |
| 600 to 1099 px | Design system `Drawer` from the right over the page, focus trapped, returned to the opener on close |
| Below 600 px | The same `Drawer` as a bottom sheet |

Two levels inside the panel: the list of rows, and the device view of one unit with Back to the list as its first
control. Heights at 1280 px: panel header 52 px (title, count, Connect a unit, Close), each row 72 px, the device
view render 240 px.

## Data

| Shown | Source (api-design file, property) |
|---|---|
| Header button count "Devices (n)" | the connector registry: open connections (devices design §12.4) |
| Row image | `/variants/<hardwareVariant.code>-icon.png` (Q5 A); the generic unit icon for an unknown unit |
| Row title, subtitle | devices 30 `device.assetTag`, `device.hardwareVariant.name`; the node id from the unit; "Unknown unit" and the build environment when `device` is null |
| Row status | devices 30 `device.status` as text; "Not registered" for an unknown unit |
| Row contract | devices 30 `contract.code`, `contract.status` |
| Row connection state | the registry's state as text (Figure 18 of devices design §12.4) |
| Device view render | `/variants/<code>-detail.png`, `alt` "{variant name}, front view" |
| Device view, from the unit | node id, `nodeNum`, owner long and short names, build environment, reported firmware version (devices design §8.2, held in memory only, REQ-UBI-08) |
| Device view, from the server | devices 30 `device.assetTag`, `hardwareVariant` (the variant card of §10), `status`, `firmwareVersion`, `batteryPct`, `lastSeenAt`, `serviceDueAt`, `keyVersion`, `keyOrganization`, `openMaintenance` |
| Device view, contract | devices 30 `contract.code`, `organization.code`, `status`, `provisionedKeyVersion` against organizations 03 `channelKeyVersion` |
| Quick swap result | rentals 32 `released.assetTag`, `status`; `reserved.assetTag`, `status`; `contractVersion` |
| Provisioning result | rentals 09 `keyVersion`, `provisionedAt` |

## Actions

Each row shows Show device view first (Info icon, §9.5), then only the actions devices design §12.3 allows for that
unit on this page; a row with none states the reason as text. Icon buttons carry the §9.5 tooltip; below 600 px
they collapse into one Actions menu.

| Control | Shown when | Endpoint | Confirmation | Success message |
|---|---|---|---|---|
| Connect a unit (panel header) | Web Serial available | none on the server; the browser's port chooser | the chooser | a new row appears and reads the unit |
| Show device view (row, "Show TL-0042") | always | none | none | the device view opens, focus on its heading |
| New device: register it? (row) | unknown unit | navigation to the Register panel on `/t/fleet`, filled from the row; then devices 05 on that panel | none | MSG03 on the Register panel; the row shows the new asset tag and "In intake" |
| Provision for {contractCode} (row) | counter context, unit `RESERVED` to this contract, not at the current key version | rentals 21, then rentals 09 (devices design §8.4) | none | "Provisioned v{n}" on the row and on the counter row |
| Put {dockedTag} on {contractCode} in place of {reservedTag} (row) | counter context, unit `AVAILABLE`, contract variant, a reserved unit with no provisioning record | rentals 32, then rentals 21 and 09 on the held port | dialog "Put {dockedTag} on {contractCode}?": "{reservedTag} goes back to Available. {dockedTag} is reserved and provisioned now. Price and quantity do not change."; a select of the reserved units with no provisioning record, the first preselected (Q7 A); buttons Cancel and Swap and provision | toast "{dockedTag} replaces {reservedTag} on {contractCode}." then "Provisioned v{n}" |
| Configure uplink (row and device view) | registered, not `RETIRED` or `DISPOSED`, provisioned for an organization | none on the server; Web Serial (devices design §8.8) | the form of screen 4.2 in a `Dialog`; "The unit restarts once to apply the settings." | "{assetTag} is configured as an uplink to {broker}." |
| Update firmware (row and device view; disabled with the text "Firmware releases are not published yet" until task 8.3 registers its panel, devices design §12.7) | `MAINTENANCE` with an `OPEN` `FIRMWARE_UPDATE` record | devices 28 and 29, then the flash of devices design §9.2 on the handed-over port | the release picker of screen 4.3 and "The unit restarts after the write." | "Firmware {version} written and verified." and the row reads the unit again |
| Open in the device hub (device view) | always | navigation to `/t/device-hub` with this unit selected (screen 4.7, devices design §12.13) | none | the hub page shows the unit |
| Record intake check (row) | `IN_INTAKE` | navigation to `/t/devices/:id` | none | none |
| Open its counter, Open its contract, Open device page (row) | per devices design §12.3 | navigation | none | none |
| Retry (row) | `NoResponse`, `Busy`, `NotChecked` | the same step again | none | the row moves on |
| Reconnect (row) | the unit did not come back after a restart | the browser's port chooser | the chooser | the row resumes at Checking |
| Forget (row menu) | any row | none on the server; `SerialPort.forget()` where the browser has it | "Forget {assetTag or node id}? The browser asks again before it can connect to this unit." | the row leaves the list |

## States

| State | What the user sees |
|---|---|
| Loading | Each new row shows "Reading the unit" with a skeleton for the title, then "Checking with the server" |
| Empty | "No units connected. Plug a unit in with its USB cable, then choose Connect a unit." with Connect a unit |
| No Web Serial (REQ-ERR-11) | "Docking needs Chrome or Edge on a desktop. Open TrekLink there to connect units."; Connect a unit disabled |
| No response over USB (REQ-ERR-24) | "No response over USB. This unit's firmware has no USB console; update it or enter the node number manually." with Retry |
| Port in use (REQ-ERR-27) | "In use by another tab or app." with Retry |
| Lookup failed (REQ-ERR-28) | "Not checked: the server did not answer." with Retry; no other action |
| Writing, restarting, checking | The row names the step ("Writing settings", "Restarting the unit", "Checking"); every other row's write actions are disabled with "Another unit is being written." (REQ-STA-06) |
| Wrong unit for the action | "The connected unit is {nodeId}, not {assetTag}. Nothing was written." |
| On another contract (REQ-ERR-22) | "{assetTag} is reserved to {contractCode}." and Open its counter |
| Rented (REQ-ERR-23) | "{assetTag} is rented on {contractCode}. Check it in at the return counter." with the link |
| Variant mismatch (REQ-ERR-25) | "{assetTag} is {variant}; {contractCode} rents {contractVariant}." |
| Port lost after a quick swap (REQ-ERR-21) | The failed step, then "Dock {assetTag} again before handover."; the swap stands |
| Unplugged | "Unplugged" for 10 seconds, then the row leaves the list |
| Render missing (REQ-ERR-31) | The labelled empty slot with the variant name |
| Error `DEVICE_PROVISIONED` (409, rentals 32) | The server's message in the swap dialog; the select reloads the reserved units |
| Error `DEVICE_NOT_AVAILABLE`, `VARIANT_MISMATCH`, `NODE_MISMATCH` (409, rentals 32) | The server's message on the row; the row is checked again (devices 30) |
| Error `STALE_VERSION` (409, rentals 32) | MSG36 in the dialog with Reload; the counter reloads the contract |
| Error `INVALID_STATE_TRANSITION` (409, rentals 32) | MSG28 with the contract's state |
| Error `DEVICE_NOT_ON_CONTRACT` (409, rentals 32) | MSG12 |
| Error `NODE_MISMATCH` (409, devices 31) | Nothing visible: the hub never sends it; logged as a client defect without the unit payload |
| Not found or forbidden | MSG26 in the panel |
| Success | The toast of the action; the row and the page refetch |

## Form fields (if any)

| Step | Field | Type | Required | Rule |
|---|---|---|---|---|
| Quick swap | Replace | select of the reserved units with no provisioning record | yes | the first in the contract's order is preselected (Q7 A) |
| Configure uplink | as screen 4.2 | | | |
| Update firmware | Release | select of devices 28 for the variant | yes | as screen 4.3 |

## Mobile, accessibility, live data

- 360 px layout: the panel is a bottom sheet with its header pinned; rows as cards (icon render, title, status as text, one Actions menu); the device view stacks the render (160 px high), the unit block, the server block, the contract block and the actions as full-width 44 px buttons.
- Tab order and focus after each action: header (Close, Connect a unit), then the rows in order, each row's Show device view first. A row added by a `connect` event is announced in the panel's polite live region ("TL-0042 connected") and does not take focus. After an action focus returns to the row's first control; after Back it returns to the row that was opened. Status and connection state are text, never colour alone (chapter 06 §9.7). The panel header count is in the button's accessible name ("Devices, 2 connected").
- WebSocket events and invalidated query keys: none received by the panel. Query keys `['devices-by-node', nodeNum]`, invalidated by every action on that unit, by registration and by the `device.handedOver` and `device.released` stream entries; a quick swap also invalidates `['contract', id]` and `['devices']`. The dock session heartbeat (devices api-design 31 and 32) is not a query.

## Checklist

Chapter 06 §7 (Screen Design Checklist) and §8 (UI and UX practices), ticked by the owner before review.

- [x] Placement follows §10.8; tooltips §9.5; the rows' sideways strips §10.6
- [x] Data: every field names devices 30, rentals 09, 21, 30, organizations 03 or the unit (devices design §8.2)
- [x] Actions: per unit and page as devices design §12.3, each with its confirmation
- [x] States: every REQ-ERR of the connector and every error code of rentals 32
- [ ] Wireframe: waits for the renders
- [x] Accessibility: live region, focus return, text status
- [x] Live data: query keys listed; the map pin is screen 9.1's

## Card footer actions and Refresh (W39, leader UAT 2026-11-06)

Added by KhoaDD under D-078 for devices design §12.14 (REQ-EVT-49, REQ-EVT-50). Where this section and the
tables above disagree, this section wins.

- Each unit card's footer, left of More actions (...) and Show details (i), carries the main actions in fixed
  slots: for a registered unit Open in device hub, Update firmware, Reboot (three, so from the third the overflow
  menu holds them below 600 px); for an unknown unit Register. An unavailable action keeps its slot, disabled,
  with its reason as the tooltip and the accessible description (chapter 06 §11.4). Update firmware and Reboot
  open the device hub on the unit with that action, where its dialog and progress live.
- The panel header carries Refresh (icon button "Refresh the connected units") and "Refreshed {time}" as text. It
  recognizes every unit again (devices api-design 30) and invalidates the device queries. The same refresh runs by
  itself after Register device, a provisioning, a quick swap and every hub action, so a card never keeps an old
  status.
- Every unit image opens the focus view of devices design §12.14 (REQ-EVT-51).
