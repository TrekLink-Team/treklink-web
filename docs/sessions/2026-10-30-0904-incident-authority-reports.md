# Incident authority reports, MF-03 step 7 (KhoaDD under D-078), 2026-10-30

Handoff of task D: incidents api-design 08 to 11 and frontend screen 8.3, built by the leader's agent
under D-078 (cards owned by HoangTK and LongNN).

## Ruling and base

The leader ruled that HoangTK's PR #137 (`feat/TK-148-authority-reports`, api-design 08, 09 and 11
with unit, e2e and db specs) wins the authority reports backend, as #134 won the Field Station
backend. This branch was rebuilt on his head `c6a35cf`: my own 08, 09 and 11 (routes, service
methods, repository methods and their specs) were dropped, and the rest was ported onto his service.
His commits are unchanged. The previous tip of this branch was `0f29e01`.

## Commits (oldest first)

HoangTK's, from #137, unchanged:

- `a29ce92` feat(TK-148): report an incident to the authorities and record the case closed
- `62987f2` test(TK-148): e2e for api-design 08, 09 and 11 and AC-04 against Postgres
- `5547c70` docs(TK-148): task notes and session record for the authority reports backend
- `c6a35cf` docs(TK-148): record the rebase onto dev and the rerun gates

KhoaDD's (D-078), on top:

- `4fce12e` feat: add the authority reports tab and report form to /t/incidents
- `872603a` feat: seed an unrouted incident for the authority report demo
- `8b7e739` feat: show authority reports as cards on narrow screens
- `3e9b023` docs: name the authority report service AuthorityReportsService in the incidents spec
- `ec6965d` feat: report a defaulted contract to the authorities (api-design 10)
- `8d70ee8` fix: follow the TK-148 rules for closure time and text length on screen 8.3
- `f3c2adb` docs: tick incidents 4.3 and frontend 8.3 over the TK-148 backend
- this file, `docs: ...`

No commit carries a trailer or a `Checksum` line; the leader seals them locally.

## Restack once #137 merges

#137 merges into `dev` by rebase or squash, so its commits get new ids. Drop them from this branch by
rebasing only my commits onto the new `dev`:

```bash
git fetch origin dev
git rebase --onto origin/dev c6a35cf feat/incident-authority-reports
git push --force-with-lease origin feat/incident-authority-reports
```

`c6a35cf` is HoangTK's head that this branch sits on. If #137 gains commits before it merges, rebase
onto its new head first (`git rebase --onto origin/feat/TK-148-authority-reports c6a35cf
feat/incident-authority-reports`), then use that head in the command above.

## What this branch adds over #137

- api-design 10: `AuthorityReportsService.reportContract` and `POST /authority-reports`
  (`manage AuthorityReport`). The status comes from the new `ContractsService.statusOf` (rentals,
  plain read, no row lock). A missing contract is 404, another status 409 `CONTRACT_NOT_DEFAULTED`
  naming it; the contract state never changes. `ContractsService` is the last constructor parameter
  of his service, so his `authority-reports.service.spec.ts` and `test/authority-reports.db-spec.ts`
  each gain one constructor argument; nothing else in his files changed except the service and
  controller additions for 10.
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

- Backend: `npm --prefix backend run lint` clean, boundary check passed (345 files, 9 modules),
  `tsc --noEmit` clean. `npx jest` (all unit specs) 151 suites, 1640 tests passed.
- Backend e2e, no database needed (services stubbed): `test/authority-reports.e2e-spec.ts` (his),
  `test/authority-reports-contract.e2e-spec.ts` (mine) and `test/incidents.e2e-spec.ts`, 3 suites,
  82 tests passed.
- `backend/test/*.db-spec.ts`, including his `authority-reports.db-spec.ts`: not run, no Postgres in
  the session container. CI runs them.
- Frontend: lint clean, typecheck clean, `vitest --run` 31 files, 421 tests passed.

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
