# TrekLink Living Specifications (`specs/`)

> **Spec-Driven Development Workflow (SDSDW)**: Specification is the architectural blueprint of software. No production code is implemented without an approved specification suite in this directory.

## 1. Directory Topology

Per [`treklink-docs/_docs/01-conventions/02-spec-driven-development-workflow.md`](../../treklink-docs/_docs/01-conventions/02-spec-driven-development-workflow.md), each module adheres to the 3-file specification suite + `api-design/` endpoint index:

```text
specs/{module_name}/
├── requirements.md     # EARS syntax functional requirements & acceptance criteria
├── design.md           # Architecture, domain models, sequence flows, state machines
├── tasks.md            # Phased, granular implementation checklist
└── api-design/         # Canonical API endpoint specifications
    └── README.md
```

## 2. Module Index

| Module | Scope | Primary Weeks | Depends On |
|---|---|---|---|
| [`gateway-sync/`](./gateway-sync/) | LoRa-serial frame parser (Meshtastic protobufs), SQLite P0-P3 queue, MQTT sync, idempotency key (`eventId`) | TP1–TP2 (Wk 1–6) | Firmware schema freeze |
| [`auth/`](./auth/) | User authentication, JWT issuance & refresh, RBAC & CASL policies | TP3 (Wk 3–7) | None |
| [`devices/`](./devices/) | Device registry, hardware variants (v1–v4), 7-state device lifecycle FSM, telemetry | TP3 (Wk 3–7) | None |
| [`rentals/`](./rentals/) | Device allocation, check-out/in wizard, rental agreements, deposit & damage fee tracking | TP3 (Wk 3–7) | `devices`, `trips` |
| [`trips/`](./trips/) | Trek packages, trip scheduling, guide assignment, roster management | TP5 (Wk 6–10) | `auth` |
| [`incidents/`](./incidents/) | SOS event ingestion, 5-state incident FSM, audit logging, escalation notifications | TP4 (Wk 5–9) | `gateway-sync`, `devices` |
| [`monitoring/`](./monitoring/) | Real-time Leaflet.js map, Socket.io push for device positions, telemetry & gateway health | TP4 (Wk 5–9) | `incidents`, `trips` |
| [`billing/`](./billing/) | Pricing rules, invoices, deposits, sandbox payment processing | TP5 (Wk 6–10) | `rentals`, `trips` |
| [`frontend/`](./frontend/) | Role-based views (Admin, Staff, Guide, Customer), FSD component architecture | TP3–TP5 (Wk 3–10) | Backend APIs |
