# TrekLink Living Specifications (`specs/`)

> **Spec-Driven Development Workflow**: no production code is implemented without an approved specification suite in this directory (`treklink-docs/_docs/01-conventions/02-spec-driven-development-workflow.md`, AGENTS.md §2.1).

## 1. Directory Topology

Each module has the three-file suite plus an `api-design/` folder:

```text
specs/{module_name}/
├── requirements.md     # EARS requirements, traced to MF, UC, FR, BR and exception scenarios
├── design.md           # Prisma models, module boundary, CASL policies, error catalogue, Mermaid diagrams
├── tasks.md            # phased implementation checklist
└── api-design/         # one file per endpoint (template 04), README index, 00-api-testing-guide.md
```

## 0. Rescope after Review 1 (2026-10-03): read first

TrekLink is now an enterprise device-rental platform built on asset management (`treklink-docs`
D-033 to D-035, Report 3 SRS regenerated in `capstone`). Corporate organizations rent devices by
monthly or day plan; there are no bookings, trek packages, trips, Customers or Guides. The module
specs below were written for the booking scope and are rewritten module by module against the SRS,
each through its own clarification and approval gate.

| Module | Status against the rescope |
|---|---|
| `platform/` | Current. Audit rows gain an optional `organizationId` |
| `auth/` | Revise: organization scoping from the token, Org Manager and Org Operator roles, API keys; Customer and Guide removed |
| `organizations/` | **New**: registration, verification, approval, members, on-duty roster, API keys, suspension |
| `devices/` | Revise: 8-state lifecycle (D-035), intake check, reset on return, stock-take |
| `trips/` | **Retired**: no trips or trek packages; do not build |
| `rentals/` | Rewrite: rental contracts, monthly terms and day plans, handover at the counter, notice, overdue and default; booking endpoints 01 to 08 retired |
| `gateway-sync/` | Current. Field Station is Stage C (D-033); incident routing goes through `incidents` |
| `incidents/` | Rewrite: tiered-alert lifecycle (D-034), outbox delivery, authority reports |
| `monitoring/` | Revise: scoping by organization, organization API stream with cursor replay |
| `billing/` | Rewrite: term and day-plan pricing, late, damage and loss charges, SePay sandbox payments |
| `frontend/` | Revise: TrekLink views and organization views; customer portal retired |

Until a module's rewritten suite is approved, do not implement against its booking-scope spec.

## 2. Module Index

Status as of 2026-09-25: every suite drafted on branch `feat/module-specs-and-backend-foundation`, awaiting approval. Order is Main Flow order (D-016).

| Module | Main Flow | Scope | Depends on | Owner lane |
|---|---|---|---|---|
| [`platform/`](./platform/) | all | Envelope and error codes, validated configuration, runtime parameters, audit log, scheduler, health; **system context, architecture and the system-wide ERD** | none | KhoaDD (proposed module, see D-027 draft) |
| [`auth/`](./auth/) | MF-01, all | Username accounts, JWT and rotating refresh, data-driven RBAC with CASL, Guide scope | platform | LongLP |
| [`devices/`](./devices/) | MF-01, MF-05 | Variant catalogue, registration, **7-state device FSM**, PSK provisioning record, maintenance, retirement | platform, auth | KhoaDD |
| [`trips/`](./trips/) | MF-01, MF-04 | Packages, **8-state trip FSM**, guide assignment, readiness, seats | platform, auth, devices | TanNB |
| [`rentals/`](./rentals/) | MF-01, MF-05 | Bookings, device holds, **7-state rental FSM**, agreement PDF, check-out, handover, check-in, inspection; **MF-01 activity diagram** | devices, trips, billing | LongLP |
| [`gateway-sync/`](./gateway-sync/) | MF-02 | MQTT ingress, Strategy normalizer, `eventId` dedup, sync audit, gateways, Stage B queue health | devices, incidents | KhoaDD |
| [`incidents/`](./incidents/) | MF-03 | **5-state incident FSM**, episode correlation, suspected episodes, acknowledgement, audit, MTTA and MTTR; **MF-03 activity diagram** | devices, rentals | HoangTK |
| [`monitoring/`](./monitoring/) | MF-04 | Server-scoped Socket.io feed, connectivity sweep, snapshot and trail | devices, trips, incidents, gateway-sync, rentals | TanNB (backend), LongNN (UI) |
| [`billing/`](./billing/) | MF-05, MF-01 escrow | Pricing rules, quotes, escrow, settlement, sandbox payments, waivers | trips, devices | LongLP |
| [`frontend/`](./frontend/) | all | FSD views per role, live map encodings, client contracts | every backend `api-design/` | LongNN |

The module dependency graph is `platform/design.md` Figure 3; it is acyclic.

## 3. Review 2 design artefacts

| Artefact | Where |
|---|---|
| Context diagram | `platform/design.md` Figure 1 |
| Architecture | `platform/design.md` Figures 2 and 3 |
| ERD (core and system-wide) | `platform/design.md` Figures 4 to 10 |
| State machines | `devices/design.md` Figure 1 (graded), `incidents/design.md` Figure 1 (graded), `rentals/design.md` Figures 1 and 2, `trips/design.md` Figure 1 |
| Activity diagrams | `rentals/design.md` Figures 3 to 5 (MF-01), `incidents/design.md` Figures 2 and 3 (MF-03) |
| Screen flows | `frontend/design.md` Figures 1 to 3 |

## 4. Conventions every file here follows

- EARS requirement IDs per module: `REQ-UBI`, `REQ-EVT`, `REQ-STA`, `REQ-ERR`, `REQ-OPT`.
- Requirements resting on a Recorded (not Confirmed) clarification answer carry `[Qnn]`.
- Every endpoint returns the D-002 envelope; on failure `result` is `{ "errorCode": "..." }` (D-025 draft).
- Every business parameter is a registered key with a default and an owner (D-015); each module lists its keys in `requirements.md` §4.
- Mermaid only, rendered and checked against Mermaid 12.0.0; figures in `design.md` files clear the 7 pt print floor (D-017).
