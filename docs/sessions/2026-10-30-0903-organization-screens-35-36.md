# 2026-10-30 09:03, KhoaDD under D-078, organization screens 3.5 and 3.6

Handoff for the leader. Branch `feat/organization-screens-35-36`, rebased onto `dev` `2d99717` (after #134). This file doubles as the PR body.

## Resealing

Every commit on the branch needs resealing locally: the rebased wip commit `2faf419` (its old `Checksum` line no longer matches) and the four new commits after it, plus the commit that adds this file. Author is Do Dang Khoa (D-049); no trailers.

## What

- Screen 3.5 `FieldStationsPage` at `/o/field-stations` on organizations api-design 23 to 26 from #134: release card, station health table with `outdated`, "n of limit" with Create disabled at the limit, the credential shown once (MF-01 step 7), and revoke with the reason hint of the 2026-10-30 ruling (optional for a Manager, required for Staff and Admin).
- Screen 3.6: `ComplianceCasesPage` (`/t/compliance-cases`), `ComplianceCasePage` (`/t/compliance-cases/:id`) and `ChannelKeySection` in the organization panel of `/t/organizations`.
- Backend: compliance cases (api-design 28 to 32) and channel key rotation (27), with permissions `complianceCase.manage` and `organization.rotateKey` (migration `20261030160000_compliance_and_rotation`).

Fixed in this session, on top of the wip commit:

- The backend did not compile against #134: `RotateChannelKeyDto` did not exist, and `ApiKeysService.revoke` was called with a transaction it does not take. Both revocations now run just before the case transaction, after a check that the case exists and is `OPEN`.
- The `CMP-` code lock used `$queryRaw`, which Prisma cannot read (a `void` column), so opening any case answered 500 (reproduced against Postgres). It now uses `$executeRaw`.
- The migration re-added the CHECK `compliance_cases_police_reference_to_close` from `20261014090000_asset_loss_and_compliance` and failed on a fresh database. It now adds only the two permissions.
- The case page imported helpers from the list page; they moved to `entities/organization`.

## Spec changes

- `specs/frontend/ui-design/3-5-fieldstationspage.md`: the revoke hint names Staff or Admin.
- `scripts/specs/endpoints/organizations.py`: api-design 27 sample `expectedVersion` 3, regenerated (the file had been hand-edited).
- `specs/frontend/tasks.md`: 3.5 ticked, 3.6 partly done. `specs/organizations/tasks.md`: 2.9 and 2.10 partly done.

## Tests

- Backend: `npm run lint` clean with the module boundary check passing; `tsc --noEmit` clean; jest 152 suites, 1644 tests passed.
- Database (local Postgres 16, fresh database): every migration applies; `prisma migrate diff` against the schema shows no drift; `test:db` 10 suites, 73 tests passed, plus the new `test/compliance-cases.db-spec.ts`, 3 passed.
- Frontend: eslint clean, typecheck clean, vitest 34 files, 436 tests passed.

## Not verified

- The pages were not opened in a browser; only component tests ran.
- The demo seed was not run.

## Not in this PR

- Linking loss cases to a compliance case, and `openOrLink` for devices (decision 1).
- `markKeyExposed` with the Manager notification, and `channelKeyVersion(orgId)` for rentals (organizations 2.9).
- The linked contract picker of the open case dialog.

## Open decisions for the leader

1. **Loss case id contract.** organizations 29 takes `linkedLossCaseIds` as `uuid[]`, while 28 and 32 return `linkedLossCases` as codes (`LOSS-0003`). Today a non-empty list is refused with 400 and responses carry `[]`, because `LossCase` belongs to `devices`, which imports `organizations`. The wip commit wrote this in open point 5 of the 3.6 design as "Ruling 2026-10-30"; that ruling is unverified.
   - (a) Keep the current behaviour for the demo; after it, `devices` provides a port for linking and reading, and responses keep codes. Recommended.
   - (b) Return ids in responses as well.
   - (c) Take linking out of scope.
2. **Admin and key rotation.** The migration grants `organization.rotateKey` to Admin (FR-AUTH-10 inheritance), and the UI shows Record key rotation to Admin through `hasAnyRole`. Open point 3 of the 3.6 design hides it from Admin until ruled.
   - (a) Accept the inheritance and update the design. Recommended.
   - (b) Hide it from Admin in the UI.

## Demo steps

Seeded users on the demo seed; passwords from the `SEED_*_PASSWORD` variables.

1. As `manager@treklink.local`: Field stations, Create Field Station, enter a Name, Create, copy the secret, Done, then Revoke on the new row and confirm.
2. As `staff@treklink.local`: Compliance cases, Open case (Organization, Type `Other breach`, Evidence), open its code, Record action (`Other`, a Note), then Close case with an Outcome.
3. As `staff@treklink.local`: Organizations, select an active organization, Record key rotation, enter a Reason, confirm.
