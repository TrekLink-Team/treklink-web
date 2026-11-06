# DeviceHubPage, one connected unit with its info and maintenance actions (`/t/device-hub`)

| | |
|---|---|
| Owner | KhoaDD |
| Task | `specs/frontend/tasks.md` 4.7 (devices task 10.13) |
| Assigned, due | 2026-11-04, brief W18, due 2026-11-06 |
| Status | Built on brief W18; devices design §12.13 Q8 to Q10 built as option A, pending the leader's ruling |
| Routes | `/t/device-hub`, nav entry "Device hub" in the Staff Devices group; the device view of screen 4.6 links here ("Open in the device hub") |
| Roles | TrekLink Staff and TrekLink Admin. Organization accounts: no route, no nav entry (devices REQ-UBI-07) |
| Use case, FRs, story | UC-11, UC-14, UC-44; FR-DEV-02, FR-DEV-07, FR-DEV-21; US-UC11, US-UC14 |
| Requirements | `specs/devices/requirements.md` REQ-UBI-08, REQ-UBI-09, REQ-EVT-44 to REQ-EVT-46, REQ-ERR-11, REQ-ERR-31 to REQ-ERR-33; AC-41 to AC-44 |
| Wireframe | Not drawn: the layout table below is the reference until the renders of `feat/variant-images` merge |

Scope from the brief: a phone-utility style page. Connect a unit on USB and see one page with everything about it
on the right and the unit on the left, with its maintenance actions. It is a view over the device connector's
registry (screen 4.6): it opens no port of its own.

## Layout

| Width | Placement |
|---|---|
| 1100 px and up (1280) | Unit switcher row on top when two or more units are connected. Below, two columns: left 18rem, the unit card (render 240 px high, asset tag, status and connection state as text); right, the Device info card (two-column definition list) above the Actions card (a grid of labelled buttons, two per row, each with its reason as text under it) |
| 600 to 1099 px (900) | The same two columns with a 14rem left column; the Device info list in one column; actions one per row |
| Below 600 px (360) | One column: the unit card (render 160 px high), Device info, Actions as full-width 44 px buttons; the switcher wraps |

## Data

| Shown | Source (api-design file, property) |
|---|---|
| Switcher | the connector registry's open connections (devices design §12.4): asset tag or "Unknown unit {nodeId}", the state as text |
| Render | `/variants/<hardwareVariant.code>-detail.png`, `alt` "{variant name}, front view"; the labelled slot of REQ-ERR-31 |
| Asset tag, variant, status, firmware on record, last seen, key version and organization | devices 30 `device` |
| Node number, node id, owner names, build environment, reported firmware, hardware model, battery and voltage, region and modem preset, primary channel name | the unit's handshake (devices design §8.2 and §12.13), memory only (REQ-UBI-08) |
| Battery when the unit reports none | devices 30 `device.batteryPct` with "from the server" |
| Contract and organization | devices 30 `contract.code`, `contract.status`, `contract.organization.code`; "None" |
| Last reset, next step | devices 07 `lastReset.createdAt`, `nextStep.action` |

## Actions

| Control | Shown when | Endpoint | Confirmation | Success message |
|---|---|---|---|---|
| Connect a unit | always; disabled without Web Serial | none; the browser's port chooser | the chooser | the unit appears and is selected |
| Provision | devices design §12.3 offers it (counter context only); otherwise disabled with "Provision from the counter of its contract." and Open its counter for a `RESERVED` unit | rentals 21, 09 | as screen 4.6 | as screen 4.6 |
| Quick swap | §12.3 offers it; otherwise disabled with "Quick swap runs from a contract's counter." | rentals 32 | as screen 4.6 | as screen 4.6 |
| Configure uplink | §12.3 offers it; otherwise disabled with the reason | none on the server | the dialog of screen 4.2 | "{assetTag} is configured as an uplink to {broker}." |
| Update firmware | task 8.3 registered its panel; otherwise disabled with "Firmware releases are not published yet" | devices 28, 29 | as screen 4.3 | as screen 4.6 |
| Reboot | the unit is Ready and no write runs | none on the server | none | toast "{name} restarted." |
| Factory reset | registered, `RETURNED`, next step `RESET` | devices 10 with `nodeNum` | `Dialog` "Factory reset {assetTag}?": "This wipes from the unit the channel key of {organization}, the owner names, the node database and the Wi-Fi and broker settings. The owner is set back to {assetTag} and the region {region} is written back. The unit restarts twice, and the reset is recorded for this return."; buttons Cancel and Factory reset (danger) | toast "{assetTag} is reset. Inspect it at the counter next." |
| Open device page | registered | navigation to `/t/devices/:id` | none | none |

## States

| State | What the user sees |
|---|---|
| Not connected | "No unit connected. Plug a unit in with its USB cable, then choose Connect a unit." with Connect a unit |
| No Web Serial (REQ-ERR-11) | "Docking needs Chrome or Edge on a desktop. Open TrekLink there to connect units."; Connect a unit disabled |
| Reading, checking | The unit card says "Reading the unit" or "Checking with the server"; Device info shows "Not read" and actions stay disabled with "Wait until the unit is read." |
| Unknown unit | Device info shows the unit's values and "Not registered"; Factory reset says "Register this unit first."; the register action of screen 4.6 |
| Write in progress | The step as text on the unit card ("Writing settings", "Restarting the unit"); every write action disabled with "Another unit is being written." on other units |
| Reconnect | "Waiting for the unit to be reconnected" with Reconnect and Stop |
| Factory reset refused (REQ-ERR-32) | The reason as text under the disabled button (devices design §12.13 Errors) |
| Failure (REQ-ERR-33) | Alert with the failed step; for the factory reset "Nothing was recorded. Dock {assetTag} and run Factory reset again." |
| Error `NODE_MISMATCH`, `ALREADY_RESET`, `INVALID_STATE_TRANSITION` (devices 10) | The server's message in the alert; the record is read again |
| Not found or forbidden | MSG26 |

## Form fields (if any)

None of its own; the uplink and swap dialogs are those of screens 4.2 and 4.6.

## Mobile, accessibility, live data

- 360 px: one column as in Layout, nothing scrolls sideways, buttons 44 px high.
- Tab order: switcher, Connect a unit, the unit card, Device info, then the actions in the table's order. The switcher's buttons carry `aria-pressed`. After Reboot or Factory reset, focus moves to the Actions heading, because their buttons are disabled while the unit is written and read again (and Factory reset stays disabled once the unit is reset); after any other action, focus returns to the action's button. Status, connection state and every reason are text, never colour alone. The factory reset dialog traps focus and returns it to its button.
- Both themes through the theme tokens; no raw colour.
- Query keys: `['devices-by-node', nodeNum]` (through the registry) and `['device', id]` for devices 07, both invalidated after a factory reset.

## Checklist

- [x] Data: every field names devices 07, 10, 30 or the unit (devices design §12.13)
- [x] Actions: the six of the brief, each with its availability and reason
- [x] States: not connected, no Web Serial, every REQ-ERR of §12.13
- [ ] Wireframe: waits for the renders
- [x] Accessibility: switcher pressed state, focus return, text status

## Redesign after the leader's UAT (W39, 2026-11-06)

Added by KhoaDD under D-078 for devices design §12.14. The leader's verdict: "a bunch of text and a bunch of
buttons", and the hub "locks Staff out of its own tools by device status". Where this section and the sections
above disagree, this section wins.

### Layout

| Width | Placement |
|---|---|
| 1100 px and up (1440, 1280) | Header card across the page (render 96 px, opens the focus view; asset tag; status badge; variant; reported firmware with "Update available"; Refresh with "Refreshed {time}"; Connect a unit). Below, two columns: left (minmax 0, 1fr) the field groups as cards in a two-column grid, then the actions; right 22rem the History panel, its list scrolling inside it. The columns scroll inside one region; the header stays |
| 600 to 1099 px (900) | Header card; one scroll region with the field groups in one column, the actions, then History (its list capped at 24rem and scrolling inside) |
| Below 600 px (360) | Header card compact (render 64 px, badges wrap); one scroll region: actions first (the main action reachable on the first screen), then the field groups, then History |

The document and `#main` never scroll (chapter 06 §11.1). A scroll region without a focusable child carries
`tabindex="0"` and a name.

### Field groups

| Group (icon) | Fields |
|---|---|
| Identity (`IdCard`) | asset tag, node number and id, owner long and short names, hardware model, build environment |
| Radio and region (`RadioTower`) | region, modem preset, primary channel name ("Preset default" when empty) |
| Power (`BatteryMedium`) | a battery gauge (`meter`, value and label "Battery {n} %"), voltage, the source ("from the unit" or "from the server"); "External power" above 100 |
| Custody and contract (`Handshake`) | status, contract code and status, organization, key version and organization, last reset, next step |
| Firmware (`Cpu`) | reported by the unit, on record, newest release for the variant |

### Actions

Three labelled groups, each a list of buttons with their reason as text under an unavailable one: Configure
(Provision or Re-provision, Quick swap, Configure uplink, Restore TrekLink defaults, Reboot), Firmware (Update
firmware), Danger zone (Factory reset, danger button, in a card with a danger edge). The availability is that of
devices design §12.14: never the status.

| Control | Confirmation | Success message |
|---|---|---|
| Provision or Re-provision (no counter context) | none; it opens `/t/counter/{contractId}` with the connector focused on the unit | as screen 5.4 |
| Configure uplink | the uplink dialog; for `RESERVED` or `RENTED` the typed asset tag first | "{assetTag} is configured as an uplink to {broker}." |
| Restore TrekLink defaults | `Dialog` "Restore TrekLink defaults on {assetTag}?": "This writes the owner {assetTag}, puts channel 0 back on the TrekLink default key, removes any other channel and its key, and turns Wi-Fi and MQTT off. Region, LoRa preset, node database and firmware stay. The unit restarts once, and its record no longer shows it provisioned."; typed asset tag for `RESERVED` or `RENTED` | toast "{assetTag} is back on the TrekLink defaults."; the key version shows None after the refresh |
| Reboot | none, or the typed confirmation for `RESERVED` or `RENTED` | toast "{name} restarted." |
| Update firmware | the flash panel (screen 4.3 panel, devices design §12.14) in a `Dialog`; the typed confirmation for `RESERVED` or `RENTED` | "{version} written and verified on {assetTag}." |
| Factory reset | the dialog above; typed asset tag for `RESERVED` or `RENTED`; the custody note for a `RETURNED` unit still in custody | toast "{assetTag} is reset." |

The confirmation field: label "Type {assetTag} to confirm", the confirm button disabled until it matches; the
dialog names "{assetTag} is {status} on {contractCode} for {organizationCode}.".

### History

A panel "History" lists monitoring api-design 07 for the device (the source of the device page's History),
newest first, 20 rows with Load more: an icon per kind (state, intake, provisioning, reset, inspection,
maintenance, hub action, contract, incident), the summary and the time. Its list scrolls inside the panel. An
unknown unit shows "Register this unit to keep its history."

### States added

| State | What the user sees |
|---|---|
| Refresh | Refresh spins while the recognition runs; "Refreshed {time}" after |
| Confirmation refused (400 `CONFIRMATION_REQUIRED`) | the server's message in the dialog; nothing written |
| Hub action failed | Alert with the failed step; the action is recorded `FAILED` |
