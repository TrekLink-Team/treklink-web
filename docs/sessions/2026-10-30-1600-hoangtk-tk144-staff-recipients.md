# 2026-10-30 16:00, HoangTK, TK-144 Staff recipients and review follow-up

## Goal

- Finish PR #120 (incidents task 3.1) after KhoaDD's comments: D-079 Staff recipients on `ESCALATED`, the restart-test ruling, and the `NEXT[state]!` review nit.
- Keep the `member.deactivated` listener (treklink-web#130) out of this PR.

## Found on the branch

- KhoaDD pushed two commits to `feat/TK-144-escalation-timers` before this session (`13b32d2`, `ba5bfe2`):
  - `AccountsService.activeStaffIds`, the active accounts holding the `STAFF` role.
  - `RoutingService.recipientsOf` reading it in the timer's transaction.
  - The `incidents --> auth` edge in platform design Figure 3, and an inactive-Staff check in `mf03-escalation.db-spec.ts`.
  - The 3.1 tick with the restart-test ruling.
- Those two commits carry no Checksum trailer, so `checksum / verify` labels them "unsealed, review by hand". Only their author can seal them; this session does not.

## Done

1. Rebased onto `origin/dev` `2d99717` (41 new commits), preserving all seven branch commits; backup branch `backup/TK-144-pre-rebase-ba5bfe2`.
2. **`NEXT` typing** (review nit): a `TimedState` union, `Timer.states: TimedState[]`, `NEXT: Record<Timer['states'][number], IncidentState>`. `IncidentsRepository.dueTimers` is generic over the requested states, so `NEXT[state]` needs no non-null assertion.
3. **Unit test**: a tier timeout to `ESCALATED` writes one row per channel for each Staff member, a Staff id listed twice gets one set, and Managers keep tier `MANAGER`.
4. **Db test**: a second active Staff account; both get one row per channel, the inactive one none, and a second timer run adds no alert rows.
5. **Design**: incidents design §3 named "every TrekLink Staff and Admin" for `ESCALATED` and `UNROUTED`. D-079 and REQ-EVT-04 name Staff, and the code reads the `STAFF` role. The row now matches the code, with a note that an `ADMIN`-only account is not alerted, and KhoaDD is asked to confirm (handbook §1.5: the document must match the software).
6. **Tasks**: 3.1 note extended; 4.2 note records the `member.deactivated` listener as its own task (#130).

## Handbook gate (D-067), platform design Figure 3

- Sections re-read from the PDF: §1.5 and §2.3, the architecture rows of chapter 13 §1.1.
- Render: Figure 3 rendered with Mermaid 10.9.1 in the browser pane and looked at by the agent. Edge `L-INC-AUTH-0` is drawn solid from `incidents` to `auth`.
- Cross-checked against `incidents.module.ts` (imports `AuthModule`) and `routing.service.ts` (`AccountsService`). The module boundary check, which reads Figure 3's solid edges, passes.

## Verified

- Disposable `postgres:16` on localhost:55435, `prisma migrate deploy`; shared Neon not used. Container stopped after the run.
- `test:db`: 11 suites, 77 tests pass.
- `test:cov`: 148 suites, 1614 tests pass. `incident-timers.job.ts`, `routing.service.ts`, `incidents.repository.ts` and `accounts.service.ts` are at 100 % lines and branches. In `accounts.repository.ts` the new `activeStaffIds` is covered; the one uncovered line (297) predates this branch.
- `test:e2e`: 181 tests pass.
- `typecheck` and `build` exit 0. `lint`: 0 errors, the single warning in `test/incidents.e2e-spec.ts:299` predates this branch. Module boundary check passed.

## Not done

- `member.deactivated` listener (#130), a separate task.
- `UNROUTED` Staff recipients (task 2.2).
- Whether `ADMIN`-only accounts should also be alerted: question to KhoaDD.
