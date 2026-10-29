# 2026-10-30 03:21, HoangTK, MF-03 escalation timers (TK-144)

## Goal

- Build incidents task 3.1 after PR #114 merged on 2026-10-29 (`16b1421`), so MF-03 runs past the happy path: no acknowledgement walks the tiers to `ESCALATED`, a silent owner escalates, and an ended episode closes when its reopen window ends.
- Story US-UC31 (TK-144); the closing half of US-UC37 (TK-150) rides along, because the third timer is the same loop.

## Context checked

- PR #114 merged by KhoaDD with the leader ruling in `ed8689e` and `16b1421`: no device packet ends an incident. Past the window, an SOS closes the episode as `SYSTEM` under the normal guard. A window never set has not ended.
- `IncidentLifecycle` already holds the `TIER_TIMEOUT`, `STALE_LIMIT` and `REOPEN_WINDOW_ENDED` edges and their deadline guards (task 1.2). The schema already has the `(state, deadline)` indexes. No lifecycle or schema change was needed.
- Two module-boundary rulings asked of the leader in treklink-web#118: R1, how incidents reads Staff recipients; R2, who serves api-design 13.

## Decisions

1. **One job class, three scheduled methods.** `IncidentTimersJob` in `jobs/incident-timers.job.ts`, instead of the three files the task listed: the three jobs differ only in states, column and reason code. Task 3.1 **Files** updated.
2. **One transaction per incident, up to 100 per run.** A failure on one incident does not roll back the others. `STALE_VERSION` and `INVALID_STATE_TRANSITION` mean a person or an SOS moved it first, so the job skips it silently; anything else is logged and the incident is due again next run.
3. **Recipients** come from `RoutingService.recipientsOf(organizationId, now, tx)`, the routed organization's tiers at run time, so the Staff gap stays in one place (`NO_STAFF`). The window close alerts no tier; the lifecycle still writes the organization's API event row.
4. **Staff behind R1.** `ESCALATED` is reached and recorded and alerts the organization's Managers. Staff get nothing until #118 is ruled. No new cross-module access was added.
5. **Null window.** `dueTimers` filters `reopenWindowEndsAt <= now`, so a null window is never selected, matching the ruling.

## Changed

| File | Change |
|---|---|
| `backend/src/modules/incidents/jobs/incident-timers.job.ts` | New: `tierTimeouts` (5 s), `staleResponses` (30 s), `closeAfterReopenWindow` (60 s) |
| `backend/src/modules/incidents/incidents.repository.ts` | `dueTimers(states, column, now, take)` |
| `backend/src/modules/incidents/routing.service.ts` | `recipientsOf(organizationId, at, tx)` |
| `backend/src/modules/incidents/incidents.module.ts` | Registers the job |
| `backend/test/mf03-escalation.db-spec.ts` | New: AC-02 walk with the empty backup skipped, stale escalation with the owner kept, the window close, the null window, a deadline firing once |
| Unit specs | Job, routing, repository read, module wiring |
| `specs/incidents/tasks.md` | 3.1 note; 1.3 ticked (LongLP built it in `60652b7`); 7.1 owner corrected to HoangTK (D-053 rule 4, matches frontend 8.1 to 8.3) |
| `specs/incidents/design.md` | §6: per-incident transaction, batch, retry, null window |

## Not done

- Staff alerts on `ESCALATED` (R1, #118).
- A fake-clock restart test. The db spec moves deadlines into the past instead; a deadline is stored, so a restarted process selects it the same way.
