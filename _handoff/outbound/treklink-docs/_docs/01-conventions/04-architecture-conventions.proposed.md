# Proposed edits: `_docs/01-conventions/04-architecture-conventions.md`

> From the `treklink-web` cloud session, 2026-09-25, REQUEST C-004.

1. **§1 module topology.** Add `platform/` (envelope, configuration, runtime parameters, audit sink, scheduler, health), pending the C-003 answer on whether it becomes a module or folds into `common/`.
2. **§1.1 cross-module rule.** Add the transaction pattern used by every spec: a callee that takes part in a caller's transaction accepts `tx?: Prisma.TransactionClient` and still queries only its own tables; only the module starting the business operation opens `$transaction`. Add the lazy `ModuleRef` hook pattern (`SCOPE_PROVIDER`, `RESCHEDULE_GUARD`) as the sanctioned way to break an import cycle without a shared module.
3. **§2 Prisma example.** `nodeNum` is an unsigned 32-bit value derived from the MAC (`NodeDB.cpp:1127`); the example and every schema must type it `BigInt`, because Postgres `integer` is signed and overflows above 2147483647.
4. **§2.1 device transition table.** Replace the sketch with the table in `treklink-web/specs/devices/design.md` §2.1. The additions, each required by an exception scenario: `RENTED → MAINTENANCE` (E01-3), `RESERVED → MAINTENANCE`, `RENTED → RETIRED` and `IN_FIELD → RETIRED` (loss, E05-3). The sketch's `RENTED → RETURNED` and `RETURNED → AVAILABLE` are kept.
5. **§3 idempotency.** The episode lookup belongs to `incidents`, reached through `IncidentsService.correlateSos` inside the ingestion transaction; `gateway-sync` must not query the `Incident` table (a boundary violation found and fixed in `gateway-sync/design.md` §2.4).
