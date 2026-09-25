# Proposed additions: `_docs/00-project-context/03-decisions-and-risk-register.md`

> From the `treklink-web` cloud session, 2026-09-25, REQUEST C-004. Draft entries; the leader assigns final numbers and status. Numbers below assume D-024 is the last entry on `dev`; renumber if PR #27 or later added decisions.

## Draft D-025: Failure envelope carries the error code in `result`

- **Status**: Proposed.
- **Context**: D-002 fixes the four keys. The frontend needs a stable machine-readable code (for example `DEVICE_NOT_AVAILABLE` to drive the E01-1 message), and `message` is human text.
- **Options**: (1) `result: { "errorCode": "..." }` on failure, keys unchanged; (2) `result: null`, code prefixed in `message`; (3) a fifth key, which breaks D-002.
- **Proposal**: option 1. Every `treklink-web` api-design file is written that way.

## Draft D-026: Scope of "one endpoint per module, dispatched by operation"

- **Status**: Proposed.
- **Context**: `specs/gateway-sync/design.md` §4 records a Session 7 team decision for a single `POST /api/gateway-sync` route with an `op` discriminator. It appears nowhere else and conflicts with the REST example in `05-backend-conventions.md` §5.
- **Proposal**: keep it for `gateway-sync` only (four operational reads, Admin-heavy), and use REST routes for every other module, which is how their api-design files are written. Alternative: revert `gateway-sync` to REST for uniformity; its own design lists the cost of op-dispatch (policy moves inside dispatch, no HTTP caching).

## Draft D-027: A cross-cutting `platform` module

- **Status**: Proposed.
- **Context**: the runtime parameter store (UC-19), the audit-log viewer (UC-20), health (US-077), the scheduler and the envelope belong to no business module.
- **Proposal**: `backend/src/modules/platform/` plus `specs/platform/`; alternative: fold into `auth` as "identity and administration", rejected because every module would then import `auth` for reasons unrelated to identity.

## Risk rows

| Risk | Likelihood | Impact | Mitigation | Status |
|---|---|---|---|---|
| **[Added W3, web session]** `Device.nodeNum Int?` in the current `schema.prisma` overflows for any node number above 2147483647, and node numbers are unsigned 32-bit values from the MAC. Ingestion would fail for roughly half of all units. | High | High | Type `BigInt` in the first migration (platform design §3.3); test with `4294967295` (devices AC-03). | Open, fixed in spec |
| **[Added W3]** `gateway-sync/design.md` §2.4 queried the `Incident` table directly, a module-isolation breach, and excluded `RESOLVED` incidents from the episode lookup, which would have created a second Incident where E03-6 requires a reopen. | High | Medium | Lookup moved behind `IncidentsService.correlateSos`; `RESOLVED` in window reopens. | Mitigated in spec |
| **[Added W3]** Stock firmware drains a queued backlog one entry per reconnect (O-001), so an arrival-time episode window could split one SOS into several Incidents. | Medium | High | Ordering and windows use the event timestamp when valid (`gateway-sync` REQ-UBI-02). | Mitigated in spec |
| **[Added W3]** A fall auto-SOS or a pre-fix SOS sends no beacons, so losing its single text frame loses the episode entirely; cadence detection cannot fire (O-001). | Medium | Critical | Firmware `onboard-queue` Phase 9 adds beacons; until then state it in the Guide training material. | Open |
| **[Added W3]** Several new backend and frontend dependencies are needed (`@casl/prisma`, `@nestjs/throttler`, `@nestjs/schedule`, `@nestjs/event-emitter`, `pdfkit`, Vitest, Testing Library, axe, Playwright, `eslint-plugin-boundaries`). | Medium | Low | Listed in C-003 for approval before Phase B installs them. | Open |
