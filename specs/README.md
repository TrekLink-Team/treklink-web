# TrekLink Living Specifications (`specs/`)

> **Spec-Driven Development Workflow**: no production code is implemented without an approved specification suite in this directory (`treklink-docs/_docs/01-conventions/02-spec-driven-development-workflow.md`, AGENTS.md §2.1).
>
> **Rewritten 2026-10-04** for the enterprise device-rental platform (`treklink-docs` D-033 to D-038). The booking-scope suites, schema and migrations are in `../.deprecated/` (D-036) and are never built against. Source of every suite: Report 3 SRS (2026-10-04) in `capstone/Documents/reports/`.

## 1. Directory Topology

```text
specs/{module_name}/
├── requirements.md     # EARS requirements traced to SRS UC, FR, BR and exception scenarios
├── design.md           # data model slice, lifecycle, services and ports, errors, Mermaid figures
├── tasks.md            # phased implementation checklist
└── api-design/         # one file per endpoint, GENERATED (see §4), plus hand-written contracts
```

## 2. Module Index

Status: every suite drafted 2026-10-04, **awaiting its owner's review** before implementation (AGENTS.md §2.3). Order is dependency order (`platform/design.md` Figure 3).

| Module | Main Flow | Scope | Owner |
|---|---|---|---|
| [`platform/`](./platform/) | all | Envelope, errors, configuration, parameters, audit, scheduler, health; **system context, architecture, module graph, ports, domain events, ERD overview**; [Configuration Matrix](platform/configuration-matrix.md) | KhoaDD, LongLP (Phase 2) |
| [`auth/`](./auth/) | all | Email sign-in, tokens, codes, roles as data, organization scoping, API-key guard, TrekLink accounts; [Permission Matrix](auth/permission-matrix.md) | LongLP, KhoaDD, LongNN |
| [`organizations/`](./organizations/) | MF-01, MF-03, MF-04 | **New.** Registration, verification, approval, suspension; members; on-duty roster; API keys; Field Station credentials (D-037) | KhoaDD |
| [`devices/`](./devices/) | MF-01, MF-05 | Variants, registration, **8-state device lifecycle**, intake, reset, maintenance, stock-take | LongLP |
| [`billing/`](./billing/) | MF-01, MF-05 | Prices, damage schedule, term and day-plan invoices, late, damage and loss charges, SePay sandbox, counter payments | LongLP |
| [`rentals/`](./rentals/) | MF-01, MF-05 | **Rental-contract lifecycle**, approval with reservation, counter handover with signed note, terms, notice, check-in, inspection, default, close | TanNB, LongLP |
| [`incidents/`](./incidents/) | MF-03 | **12-state incident lifecycle** (D-034), tiered alerts, outbox, authority reports | HoangTK, KhoaDD |
| [`gateway-sync/`](./gateway-sync/) | MF-02 | MQTT ingestion Stage A to C, `eventId` dedup, sync audit, broker hooks, Field Station executable | KhoaDD |
| [`monitoring/`](./monitoring/) | MF-04 | Organization-scoped stream, WebSocket and REST replay, live map, organization API, history, reports, system health | LongNN |
| [`frontend/`](./frontend/) | all | FSD web client, routes per SRS Table 72, Leaflet map with the sovereignty overlay | LongNN |

`trips/` is retired: there are no trips, trek packages or bookings in the platform (D-033, rejected alternative (e)).

## 3. Review 2 design artefacts

| Artefact | Where |
|---|---|
| Context diagram | `platform/design.md` Figure 1 |
| Architecture, module graph | `platform/design.md` Figures 2 and 3 |
| Core ERD | `platform/design.md` Figure 4; module slices are Figure 1 of each `design.md` |
| State machines | `devices/design.md` Figure 2 (graded), `incidents/design.md` Figure 2 (graded), `organizations/design.md` Figure 2, `rentals/design.md` Figure 2 |
| Sequence diagrams | Figure 3 of `organizations`, `devices`, `rentals`, `incidents`, `gateway-sync`; `billing` Figure 2; `monitoring` Figure 1 |

## 4. Generated files: edit the source, never the output

| Output | Source | Command |
|---|---|---|
| `*/api-design/NN-*.md`, `*/api-design/README.md` | `scripts/specs/endpoints/<module>.py` | `python3 scripts/specs/build_api_design.py [module]` |
| `platform/configuration-matrix.md`, `auth/permission-matrix.md`, `backend/prisma/migrations/20261004120100_seed/` | `scripts/specs/catalog.py` | `python3 scripts/specs/build_seed.py` |
| `backend/prisma/migrations/20261004120000_initial_schema/` | `backend/prisma/schema.prisma` + `backend/prisma/constraints.sql` | `backend/scripts/rebuild-baseline.sh` |

Hand-written contracts under `api-design/` (lower-case names, kept by the generator): `gateway-sync` MQTT ingress, queue-health payload, Field Station local page; `monitoring` WebSocket contract; `platform` testing guide. The baseline and seed are rewritten in place only while no shared database has applied them (D-036); after that, changes are forward migrations.

## 5. Conventions every file here follows

- EARS requirement IDs per module: `REQ-UBI`, `REQ-EVT`, `REQ-STA`, `REQ-ERR`, `REQ-OPT`; each cites the SRS identifiers it implements.
- Every endpoint returns the D-002 envelope; on failure `result` is `{ "errorCode": "..." }` (D-026). The one exception is the SePay webhook (D-038).
- An organization member or API key never sees another organization's record: 404, never 403 (`platform/design.md` §4.2).
- No module imports a module above it; upward needs go through ports (`platform/design.md` §2.1).
- Every business parameter is a catalogue key with a default and an owner (D-015).
- Mermaid only (D-017).
