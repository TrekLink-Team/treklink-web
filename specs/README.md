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

Order is dependency order (`platform/design.md` Figure 3). Owners are the lanes of roadmap §5.1 (remapped 2026-10-18); KhoaDD, LongLP and TanNB cover a lane that falls behind.

| Module | Main Flow | Scope | Owner |
|---|---|---|---|
| [`platform/`](./platform/) | all | Envelope, errors, configuration, parameters, audit, scheduler, health; **system context, architecture, module graph, ports, domain events, ERD overview**; [Configuration Matrix](platform/configuration-matrix.md) | KhoaDD |
| [`auth/`](./auth/) | all | Email sign-in, tokens, codes, roles as data, organization scoping, API-key guard, TrekLink accounts; [Permission Matrix](auth/permission-matrix.md) | LongLP |
| [`organizations/`](./organizations/) | MF-01, MF-03, MF-04 | **New.** Registration, verification, approval, suspension; members; on-duty roster; API keys; Field Station credentials (D-037), NDA and licence, compliance cases (D-046) | TanNB |
| [`devices/`](./devices/) | MF-01, MF-05 | Variants, registration, **device lifecycle**, intake, reset, loss cases, disposal, periodic maintenance (D-045, D-047), stock-take | KhoaDD |
| [`billing/`](./billing/) | MF-01, MF-05 | Prices, damage schedule, term and day-plan invoices, late, damage and loss charges, SePay sandbox, counter payments | LongLP |
| [`rentals/`](./rentals/) | MF-01, MF-05 | **Rental-contract lifecycle**, approval with reservation, counter handover with signed note, terms, notice, check-in, inspection, default, mid-contract replacement, close | LongLP |
| [`incidents/`](./incidents/) | MF-03 | **12-state incident lifecycle** (D-034), tiered alerts, outbox, authority reports | HoangTK |
| [`gateway-sync/`](./gateway-sync/) | MF-02 | MQTT ingestion Stage A to C, `eventId` dedup, sync audit, broker hooks, Field Station executable | KhoaDD |
| [`monitoring/`](./monitoring/) | MF-04 | Organization-scoped stream, WebSocket and REST replay, live map, organization API, history, reports, system health | LongNN (backend and screens, D-056); HoangTK task 2.3 |
| [`frontend/`](./frontend/) | all | FSD web client, routes per SRS Table 78, Leaflet map with the sovereignty overlay | LongNN |

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
| `platform/configuration-matrix.md`, `auth/permission-matrix.md`, `backend/prisma/migrations/20261004120100_seed/`, `backend/src/modules/platform/parameters/parameter-registry.ts` | `scripts/specs/catalog.py` | `python3 scripts/specs/build_seed.py` |
| `backend/prisma/migrations/20261004120000_initial_schema/` | `backend/prisma/schema.prisma` + `backend/prisma/constraints.sql` | `backend/scripts/rebuild-baseline.sh` |

Hand-written contracts under `api-design/` (lower-case names, kept by the generator): `gateway-sync` MQTT ingress, queue-health payload, Field Station local page; `monitoring` WebSocket contract; `platform` testing guide. The baseline and seed are rewritten in place only while no shared database has applied them (D-036); after that, changes are forward migrations.

## 5. Conventions every file here follows

- EARS requirement IDs per module: `REQ-UBI`, `REQ-EVT`, `REQ-STA`, `REQ-ERR`, `REQ-OPT`; each cites the SRS identifiers it implements.
- Every endpoint returns the D-002 envelope; on failure `result` is `{ "errorCode": "..." }` (D-026). The one exception is the SePay webhook (D-038).
- An organization member or API key never sees another organization's record: 404, never 403 (`platform/design.md` §4.2).
- No module imports a module above it; upward needs go through ports (`platform/design.md` §2.1).
- Every business parameter is a catalogue key with a default and an owner (D-015).
- Mermaid only (D-017).

## 6. Working a task list

Rewritten 2026-10-18 (D-051), ownership per D-052. The leader writes every suite; each member
studies the suites of their lane, owns and defends them, and implements them. Screen layouts are
delegated to members with a 2 to 3 day deadline. Each `tasks.md` is complete enough to code from
without re-deriving the design; a defect found while studying goes to the leader as a PR or a comment.

| Field on a task | Meaning |
|---|---|
| `(owner NAME)` | Who implements it. The lane owner unless stated |
| **Files** | Where the code goes; create the file if it does not exist |
| **Do** | The behaviour, in order; names come from `design.md` and `api-design/*.md` |
| **Test** | The test file and the cases it must contain |
| **Done when** | The observable result a reviewer checks |
| _Requirements_ | EARS IDs of this module, then SRS IDs |
| _Story_ | The backlog story (`treklink-docs/_docs/03-backlog/02-user-stories.md`); its Jira key names the branch |
| _Depends on_ | Tasks that must be merged on `dev` first, `module N.N` for another module |

Rules:

1. One branch per story, `feat/<jira-key>-<short-desc>`; a task without a story (foundation, tests)
   rides the branch of the first story that needs it.
2. Tick the box in the same PR that implements the task. A task the code proves wrong is corrected in
   `tasks.md` (and `design.md` if needed) in that PR, never left stale.
3. `python3 scripts/specs/check_tasks.py` must stay clean: every requirement, endpoint, SRS FR and
   backlog story is named by a task.
4. Controllers declare `@ResponseMessage` with the exact message of the endpoint's `api-design` file;
   every Validation row of that file has an e2e test.
5. Every module extends `backend/test/tenancy.e2e-spec.ts` with its cross-organization 404 cases.
