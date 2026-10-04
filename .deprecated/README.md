# Deprecated artefacts

Nothing in this folder is built, linked from a live document, or cited as a requirement
(treklink-docs D-036). Each item keeps its original path below `.deprecated/`.

| Moved | From | Date | Why |
|---|---|---|---|
| `specs/` | `specs/` | 2026-10-04 | Every suite described the single-agency booking scope. Rewritten from Report 3 SRS and D-033 to D-035 |
| `backend/prisma/schema.prisma` | `backend/prisma/schema.prisma` | 2026-10-04 | Booking, trip and trek-package models; old device, incident and rental state machines |
| `backend/prisma/migrations/20260925120000_initial_schema`, `20260925120100_platform_seed` | `backend/prisma/migrations/` | 2026-10-04 | Baseline rewritten in place (D-036); the Neon database was never provisioned, so no shared database applied them |
| `backend/src/modules/trips/` | `backend/src/modules/trips/` | 2026-10-04 | No trips in the platform (D-033) |

Reuse is allowed as a reading source, for example the gateway-sync and platform suites, as long as
the rewritten document states the fact itself.
