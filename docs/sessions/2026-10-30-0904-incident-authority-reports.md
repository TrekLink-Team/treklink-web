# Incident authority reports, MF-03 step 7 (KhoaDD under D-078), 2026-10-30

Handoff of task D: incidents api-design 08 to 11 and frontend screen 8.3, built by the leader's agent
under D-078 (cards owned by HoangTK and LongNN).

## Ruling and base

The leader ruled that HoangTK's PR #137 (TK-148, api-design 08, 09 and 11 with unit, e2e and db specs)
wins the authority reports backend, as #134 won the Field Station backend. My own 08, 09 and 11 were
dropped and the rest was ported onto his service. #137 is now merged into `dev` (its last commit
`232426e`), and this branch sits directly on `origin/dev` `eb1b31e`: no commit of HoangTK's is on the
branch any more. Before the merge it sat on his branch head `c6a35cf`, whose files are identical to
what landed in `dev`. Previous tips of this branch: `0f29e01` (own backend), `dba246f` (on #137).

## Commits (oldest first, all KhoaDD under D-078, on `origin/dev` `eb1b31e`)

HoangTK's TK-148 work is in `dev` as `be102ec`, `6cf05fd`, `81a161d` and `232426e`; none is on this
branch.

- `3eb0610` feat: add the authority reports tab and report form to /t/incidents
- `3e1cc5f` feat: seed an unrouted incident for the authority report demo
- `483e692` feat: show authority reports as cards on narrow screens
- `98463ec` docs: name the authority report service AuthorityReportsService in the incidents spec
- `7a03b9f` feat: report a defaulted contract to the authorities (api-design 10)
- `3e525d7` fix: follow the TK-148 rules for closure time and text length on screen 8.3
- `fd36412` docs: tick incidents 4.3 and frontend 8.3 over the TK-148 backend
- `1835830` docs: hand off the authority reports branch rebuilt on TK-148
- `b67b83d` fix: build the authority reports db spec against the three-argument DevicesService
- `8e115ee` fix: close a reported incident only when no other report on it is open
- `951b8d2` docs: use report UUIDs and list the closedAt 400 rows in incidents api-design
- this file's update, `docs: ...`

No commit carries a trailer or a `Checksum` line; the leader seals them locally.

## Restacking

Not needed for #137 any more. Done with
`git rebase --onto origin/dev c6a35cf feat/incident-authority-reports` (the TK-148 branch was
deleted after the merge, so its old head `c6a35cf` is the cut point). If `dev` moves again before
this branch merges: `git fetch origin dev && git rebase origin/dev`, then
`git push --force-with-lease origin feat/incident-authority-reports`.

## Review follow-ups on #137, folded in

- `scripts/specs/endpoints/incidents.py`: report ids in the 02, 09, 10 and 11 examples are UUIDs
  (10 and 02 were changed too, for the same reason); api-design 09 lists the two 400 rows (`closedAt`
  in the future, `closedAt` before `reportedAt`) and the open-report condition; the participant is
  `AuthorityReportsService` (already renamed in `98463ec`). Regenerated.
- `authority-reports.service.ts` `closeCase`: a `REPORTED` incident moves to `CLOSED` only when
  `AuthorityReportsRepository.countOpenOnIncident` finds no other open report on it. The count runs
  after the incident row lock, so two closures on one incident serialise and the last one closes it.
  Unit tests: the new case in `authority-reports.service.spec.ts`, and
  `authority-reports.repository.spec.ts`. The close dialog states the rule.
- Found on the way: `dev` did not type-check. The devices merge gave `DevicesService` three
  constructor parameters and `test/authority-reports.db-spec.ts` still passed one (`tsc` TS2554 on
  `origin/dev`). `b67b83d` passes the same stubs as `mf03.db-spec.ts`.

## What this branch adds over #137

- api-design 10: `AuthorityReportsService.reportContract` and `POST /authority-reports`
  (`manage AuthorityReport`). The status comes from the new `ContractsService.statusOf` (rentals,
  plain read, no row lock). A missing contract is 404, another status 409 `CONTRACT_NOT_DEFAULTED`
  naming it; the contract state never changes. `ContractsService` is the last constructor parameter
  of his service, so his `authority-reports.service.spec.ts` and `test/authority-reports.db-spec.ts`
  each gain one constructor argument.
- Frontend screen 8.3 on `/t/incidents`: the Authority reports tab, the two-step Record report dialog,
  Record case closed, Report to authorities on a selected `UNROUTED` or `ESCALATED` incident, and
  labelled cards below the sm breakpoint. Hooks in `frontend/src/entities/incident/authorityReports.ts`,
  UI in `frontend/src/widgets/AuthorityReports/`.
- The demo seed block and the spec naming below.

Where his behaviour differs from my first build, his is kept and the frontend follows it:

- GET `/authority-reports` checks `read AuthorityReport` (granted by `authorityReport.manage`).
- `closedAt` may not be in the future or before `reportedAt` (400). The dialog states both bounds and
  shows a refused time under Closed at.
- 409 messages are his ("This cannot be done while it is {state}." with the raw state); the dialog
  reloads the incident and shows MSG28 with the state label.
- Agency and reference are capped at 200 characters; the inputs carry `maxLength` 200, and the
  api-design 10 DTO uses the same bound.
- `open=false` reads closed cases only; the tab never sends it.

## Checks

On the final tip, on `origin/dev` `eb1b31e`:

- Backend: `npm --prefix backend run lint` clean, boundary check passed (367 files, 9 modules),
  `tsc --noEmit` clean. `npx jest` (all unit specs) 158 suites, 1726 tests passed.
- Backend e2e, no database needed (services stubbed): `test/authority-reports.e2e-spec.ts`,
  `test/authority-reports-contract.e2e-spec.ts` and `test/incidents.e2e-spec.ts`, 3 suites, 82 tests
  passed.
- `backend/test/*.db-spec.ts`, including `authority-reports.db-spec.ts` (AC-04): not run, no Postgres
  in the session container. CI runs them.
- Frontend: lint clean, typecheck clean, `vitest --run` 34 files, 445 tests passed.

## Spec changes

- `scripts/specs/endpoints/incidents.py`: api-design 10 gains a 404 `NOT_FOUND` row; the service is
  named `AuthorityReportsService` in the 08 to 11 sequences. api-design 08 to 11 regenerated.
- `specs/incidents/design.md` Figures 4 and 10: `AuthorityReportService` renamed `AuthorityReportsService`.
- Ticked: incidents 4.3 (10 was its last open part) and frontend 8.3. Dated lines on incidents 6.1.

## Shared files touched

`error-code.enum.ts` (`CONTRACT_NOT_DEFAULTED`), `rentals/contracts.service.ts` and
`contracts.repository.ts`, `backend/prisma/seed-demo.ts` (own commented block), one invalidation in
`frontend/src/app/providers/LiveProvider.tsx`. No catalog, migration, router or navigation change.

## Not done

- The entry to Record report from `/t/contracts/:id` (frontend task 5.2 owns that page).
- Handbook gate (AGENTS.md §2.8, D-067) for the two renamed diagrams in design.md (Figure 4 class
  view, Figure 10 UC-35 sequence). Only the participant name changed, but the handbook PDF is in
  `capstone/Documents/templates/`, which this session cannot read, and no Mermaid renderer could run
  here (`check_mermaid.py` needs `mmdc` from the SRS scripts; a mermaid-cli download was refused). A
  member re-reads the handbook section, renders both figures and records it in the PR body.

## Demo data

`backend/prisma/seed-demo.ts` seeds one `UNROUTED` incident on `TL-0001`, an AVAILABLE device in no
custody, in its own commented block: created only while `TL-0001` has no incident, code numbered as
`IncidentsRepository.nextCode` does, transitions `CREATED` and `ROUTED`, version 1. Type-checked and
linted; not run, no Postgres here. No tier-timeout job exists on `dev` (incidents 3.1 open), so
nothing reaches `ESCALATED` on its own.

A further `UNROUTED` incident comes from an SOS sent by another AVAILABLE device, for example
`TL-0002` (node `0xde000002` = 3724541954), with the local stack (`docker compose up -d`, open
Mosquitto on 1883, backend with `MQTT_BROKER_URL=mqtt://localhost:1883`). Topic and payload follow
`specs/gateway-sync/api-design/mqtt-ingress-contract.md` and `SOS_PREFIX` in
`gateway-sync/normalizer/text.strategy.ts`; the command was not run in this session (unverified).

```bash
mosquitto_pub -h localhost -p 1883 -q 1 -t 'treklink/2/json/LongFast/!de000002' \
  -m "{\"id\":$(date +%s),\"timestamp\":$(date +%s),\"to\":4294967295,\"from\":3724541954,\"channel\":0,\"type\":\"text\",\"sender\":\"!de000002\",\"payload\":{\"text\":\"SOS - HELP\"}}"
```

## Demo steps

1. Run `npm --prefix backend run seed:demo`. Sign in as `staff@treklink.local` (password from
   `SEED_STAFF_PASSWORD`).
2. Open `/t/incidents`. The seeded incident on `TL-0001` is in "Unrouted and escalated". Click its code.
3. Click **Report to authorities**. Fill Agency, Authority reference and Reported at (not in the
   future), then **Record report**. The badge shows "Reported to authority".
4. Open the **Authority reports** tab. Click **Record case closed** on the row, set Closed at (after
   the report time, not in the future), confirm.
5. Click **View incident**: the incident is CLOSED, and the row leaves Open cases only.

## Earlier answers from the leader (same day)

Seed an `UNROUTED` incident; build the phone cards; name the service `AuthorityReportsService` in the
spec; keep the closure note on the incident transition and the audit record (no migration, which is
also what TK-148 does).
