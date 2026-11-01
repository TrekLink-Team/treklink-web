# 2026-11-01 08:00: attribution follow-up of #234 (task W14)

KhoaDD under D-078, run by the leader's cloud agent. Branch `fix/attribution-audit-detail` from
`origin/dev` at `f143f54` (#234 merged). Scope: the two suggestions and two nits of the #234 review.

## Done

| Item | Where |
|---|---|
| The `ACCEPTED_UNATTRIBUTED` audit row carries the reason as its detail, code first; the Detail column of the Field data sync audit list already renders `detail`, so no frontend change | `gateway-sync/attribution.ts` `UNATTRIBUTED_DETAIL`, `ingestion.service.ts`, REQ-ERR-06 |
| `Custody.nearBoundary` and the margin argument of `custodyAt` removed; the margin rule lives only in `attribute()` | `rentals/contracts.service.ts`, `custody-resolver.provider.ts`, rentals design §6, gateway-sync design sequence |
| AC-08 asserts the refusal detail on Postgres | `test/station-attribution.db-spec.ts` |
| `FieldStationsService.stationByUsername` returns the station without the secret hash, for ingestion and the health handler; `byUsername` keeps the hash for the broker check (task 3.1) | `organizations/field-stations.{repository,service}.ts`, organizations design §5 |

## Facts confirmed

- Before this branch, `nearBoundary` had no reader outside rentals' own tests: ingestion decides the margin
  from `handedOverAt` and `endedAt`, and the CUSTODY_RESOLVER provider passed margin 0.
- The station health handler also received the secret hash through `byUsername` and never used it.
- MF-02 on a demo-seeded local Postgres 16.15: TL-0009 and TL-0010 node position packets received past the
  attribution margin after the seed's handover come out `ACCEPTED`, `ATTRIBUTED`, ORG-0001.

## Open

An unattributed event whose outcome is `INVALID_POSITION` or `IMPLAUSIBLE_POSITION` carries no reason;
the detail is set only on `ACCEPTED_UNATTRIBUTED` rows, as the review asked.
