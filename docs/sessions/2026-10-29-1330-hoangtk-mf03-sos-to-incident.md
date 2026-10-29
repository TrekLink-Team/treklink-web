# HoangTK MF-03 SOS to incident, happy path (SD and CO), 2026-10-29

## Goal and dates

- MF-03 runs its main success scenario end to end by Saturday 2026-10-31 (D-066). Issue #98 records that MF-02 stores an SOS but no incident opens.
- This PR runs the D-053 phases for the MF-03 happy path. The SD commits are due today at 17:00 ICT and the CO commits today at 23:00 ICT. UT, to the D-053 bar of 80% branch and 100% line coverage on changed files, and RV follow on the same PR.
- Branch `feat/TK-142-mf03-sos-to-incident` from dev `582c1f2`. TK-142 is the key of the earlier incident PRs #56, #66 and #81.

## Rulings approved by HoangTK before SD

1. CO covers the backend happy path and the organization queue and detail page (frontend 8.1). Timers (3.1), owner deactivation (4.2 listener), authority reports (4.3), the stale flag (4.4), close checks (1.3), the Staff page (8.2) and the authority report page (8.3) are out of this PR.
2. Routing needs `RosterService.tiersAt` (organizations 2.6, TanNB). HoangTK adds the read only, `tiersAt(orgId, instant)`. Shift create, edit, delete and list stay with TanNB.
3. The dispatcher sends the WebSocket and web inbox channels. Email and the organization API stream follow later.
4. SD records the cut list, the design notes below and the spec corrections, on one PR with CO.

## Cut list: the MF-03 happy path

The scenario: a holder on an active contract presses SOS. The event is ingested and attributed (MF-02). An incident opens and routes to the organization's primary tier. The on-duty member gets the MSG31 alert on the banner and in the queue, acknowledges, marks responding, posts a status and resolves.

| Task | Part in this PR | Left for later |
|---|---|---|
| incidents 2.3 | `onSos` with the five correlation steps of design §4, including reopen | `onPosition`, cadence `SUSPECTED` creation, retro-tagging of positions |
| incidents 2.2 | `RoutingService`: route to the attributed contract and organization, `tiersAt`, empty tiers skipped, `UNATTRIBUTED` to `UNROUTED` | Staff recipients (see design note 3) |
| incidents 2.1 | outbox dispatcher job, WEB and WEBSOCKET channels, retry with backoff, `FAILED` at the limit | EMAIL, API_EVENT |
| incidents 4.1 | MSG27 text with the owner's name and time (auth `contactCard` is on dev) | none |
| incidents 4.2 | member false alarm (api-design 07) | Staff false alarm from `UNROUTED`, the `member.deactivated` listener |
| incidents 5.1 | list (01) and detail (02) with device, holder and owner | transitions, events, alerts (12 to 14), monitoring reads |
| incidents 6.1 | `IncidentsController` for api-design 01 to 07 | 08 to 14, `AuthorityReportsController` |
| monitoring 2.3 | `incident.alert` listener in `LiveGateway` to `user:<id>` | none |
| gateway-sync | ingestion calls `onSos` inside its transaction and links the event to the incident | `onPosition` hand-off |
| organizations 2.6 | `tiersAt` read only | everything else of 2.6 |
| frontend 8.1 | `/o/incidents` queue, `/o/incidents/:id` detail, acknowledge, responding, status, resolve, false alarm | transitions, events and alerts tabs (12 to 14) |
| seed | one roster shift for the demo organization, so the demo SOS reaches a primary member | none |

## Design notes (SD)

1. **Recipient ids are user ids.** `Incident.ownerId` and `AlertDelivery.recipientId` reference `User`, and the lifecycle sets the owner from the actor's user id. `tiersAt(orgId, at)` therefore returns user ids: the primary and the backup of the shift with `startsAt <= at < endsAt`, each only while the member is active, and every active `ORG_MANAGER`. No shift, or a shift without a primary, gives an empty tier, which the lifecycle skips (EMPTY_TIER).
2. **Routing input.** Ingestion already holds the custody of `ContractsService.custodyAt` (`contractId`, `organizationId`). It passes both to `onSos`, so routing reads no rentals table. An unattributed SOS routes to `UNROUTED`. A suspended organization is still routed (BR-36); `tiersAt` does not check organization status.
3. **Staff recipients are empty in this PR (gap).** Figure 3 of platform design has no `incidents --> auth` edge, and Staff accounts belong to `auth`. `UNROUTED` and `ESCALATED` transitions therefore write no Staff alert row today, only the API event. The happy path does not reach either state. The fix is a leader ruling: an `auth` port such as a Staff directory provided to `incidents`, or a new Figure 3 edge. Raised in the PR body.
4. **Creation history.** `onSos` inserts the incident in `DETECTED`, writes transition 1 (`fromState` null, reason `CREATED`, `refEventId` the SOS), then calls `IncidentLifecycle.apply` with `ROUTED` for transition 2. Existing lifecycle code is unchanged.
5. **Linking the event.** `field_events` belongs to `gateway-sync`. `onSos` returns the incident id, and `IngestionRepository` sets `incidentId` on its own row in the same transaction (the schema allows the one-way link).
6. **Append and upgrade.** An SOS on an open incident increments `eventCount`, moves `lastEventAt` and the last position, and upgrades `SUSPECTED` to `CONFIRMED`. It does not change the state or the version, so a member's `expectedVersion` stays valid, the same rule as a status update.
7. **Dispatcher.** `incidents.deliverAlerts` runs every 2 s (`*/2 * * * * *`). In one transaction it selects up to 100 `PENDING` rows due now for the channels that have a sender, `FOR UPDATE SKIP LOCKED`. WEB counts as sent once the row exists, since the queue page reads it. WEBSOCKET emits `incident.alert` through the in-process event emitter and counts as sent when the listener returns. A failure bumps `attempts` and sets `nextAttemptAt` to `now + incidents.alertRetryBaseSeconds × 2^attempts`; at `incidents.alertMaxAttempts` the row is `FAILED` and logged. EMAIL and API_EVENT rows stay `PENDING` until their senders land, which is visible in the alert list rather than lost.
8. **Alert payload.** `{ incidentId, code, deviceLabel, holderName, at, message }` (ws-live-contract). `deviceLabel` is the asset tag (`DevicesService.assetTags`). `holderName` is the holder label of the contract device (a new rentals read). `message` is MSG31: `SOS: {device} ({holder}), {time}. Acknowledge now.`, with the time in ICT, HH:mm.
9. **The personal event on the wire.** `incident.alert` goes to `user:<id>` as a `stream` event with `seq: 0`. It is not stored in the stream table, because stream entries are scoped by organization, not by person. The client delivers an `incident.alert` without reading or moving its replay cursor. A missed alert is still in the queue, through the WEB row.
10. **Names.** The owner and status-update authors need `fullName`, which belongs to `auth`. `incidents` reads them through a new `OrganizationsService.memberNames(userIds)`, built on the `contactCard` read organizations already uses. MSG27, `{actor} took this incident at {time}.`, uses the same read and the time of the latest `ACKNOWLEDGED` transition (the 2026-10-26 ruling 5).
11. **Holder label.** A new read in `rentals`, `ContractsService.holderLabels(pairs)` for `(contractId, deviceId)`, returns `holderName` and `holderPhone` of the contract device row. It returns nothing after the contract closes, because the label is erased then (FR-CON-14).
12. **Permissions.** Reads use `ability.can('read', 'Incident')` (`incident.read` for Staff, `incident.read.own` for members), and member actions use `ability.can('respond', 'Incident')` (`incident.respond.own`). The service still checks the organization and answers 404 for another organization's incident.

## Cross-lane edits in this PR

| File | Lane | Why |
|---|---|---|
| `organizations/roster.service.ts`, `OrganizationsService.memberNames` | TanNB | rulings 2, design note 10 |
| `rentals/contracts.service.ts` `holderLabels` | LongLP | design note 11 |
| `gateway-sync/ingestion.service.ts`, `ingestion.repository.ts` | KhoaDD | design notes 2 and 5 |
| `prisma/seed-demo.ts` | KhoaDD | one roster shift for the demo |
| `frontend/src/shared/socket/socketClient.ts` | LongNN | design note 9 |

Every edit adds a read or a call. None changes an existing behaviour of that lane.

## Spec corrections made in SD

- `specs/incidents/tasks.md` 2.1, 2.2, 4.1: notes on the narrowed scope, the Staff-recipient gap, and MSG27 now unblocked.
- `specs/organizations/tasks.md` 2.6: `tiersAt` lands with incidents; the rest stays with TanNB.
- `specs/incidents/design.md` §3: the wire form of `incident.alert` (design note 9).

## Open for the leader

- Design note 3, the Staff recipients of `UNROUTED` and `ESCALATED`.
