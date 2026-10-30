# 2026-10-30 Task K: finish PR #151 and two follow-ups of #135 (KhoaDD under D-078)

## Done

1. `fix/review-nits-142-148` rebased onto `origin/dev` and force-pushed with lease. The conflict in
   `handover-note.renderer.ts` kept dev's `unicodeFont()`; LongLP's commit and its `Checksum:`
   trailer are unchanged. Commits on top:
   - `88bf552` fix: refresh the contract named by a device handover event (LiveProvider, 5 tests)
   - `ef10dfc` test: log a partly delivered Staff contract email as partial
2. `fix/organization-close-race` (from `origin/dev`), contracts request race:
   - `OrganizationsRepository.lockStatus` (FOR SHARE) and `OrganizationsService.lockActive`;
     `ContractsService.request` calls `lockActive` in its transaction.
   - Unit tests in `organizations.service.spec.ts` and `contracts.service.request.spec.ts`.
   - `backend/test/organization-close-race.db-spec.ts`: both interleavings. Run on a local
     Postgres 16: passes with the fix, both cases fail without it.

## Checks run

Backend lint (0 errors, 1 pre-existing warning in `test/incidents.e2e-spec.ts`), boundary check
passed, tsc clean, unit tests organizations and rentals 628 passed, db specs close-race,
organization-lifecycle and rentals 12 passed. Frontend lint, typecheck, LiveProvider tests 5 passed.

## Not done (next steps)

- `scripts/specs/endpoints/organizations.py` endpoints 08 to 11: name `OrganizationStatusController`
  and `OrganizationStatusService` (both exist in `backend/src/modules/organizations/`), call billing
  and rentals through the `ORGANIZATION_EXIT_CHECKS` port in the sequences, sample the actor as an
  account name (`transitions` maps `actorId` to the full name, `SYSTEM` when null), add the 403 row
  for an Org Operator on 11 (`managerOnly()` in `organization-status.service.ts`), at most one `alt`
  per sequence. Regenerate with `python3 scripts/specs/build_api_design.py organizations`.
- Optionally note the FOR SHARE step in the rentals api-design 01 steps (`scripts/specs/endpoints/rentals.py`).
- Push this branch again after those commits; no PR is opened by the agent.
