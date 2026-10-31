# TK-143 dispatcher review fixes (#214, #215), 2026-10-31

- KhoaDD under D-078 finishes the held review items of HoangTK's PRs #214 and #215. `dev` is frozen for the 2026-11-01 demo; nothing merges before it.
- Branch `fix/tk-143-email-dispatch`: #214's head `a13cef8` rebased onto `dev` `043a2c1`, then the dispatcher fix. Branch `fix/tk-143-socket-verify`: #215's head rebased onto it, then the test fixes.
- Cause of #214 item 1: `mail.send` ran inside the claim transaction (Prisma's 5 s default). Fix: two lanes, `incidents.deliverAlerts` (WEB, WEBSOCKET, one short transaction per batch) and `incidents.deliverEmailAlerts` (EMAIL: claim and lease in a short transaction, send outside any transaction with a 10 s bound, settle each row in its own transaction).
- No catalog parameter bounds an SMTP send, so `EMAIL_SEND_TIMEOUT_MS = 10_000` is a named constant marked `TODO(params)`. The lease is twice that.
- Cause of #215 item 1: the 2 s cron alone cannot meet the 2 s bound. Fix: `IncidentLifecycle` emits `incident.alertsQueued` after commit when it queued rows; the dispatcher wakes both lanes, each lane claims again while a batch is full, and a lane never overlaps itself in one process (a wake mid-run schedules one more pass). The crons stay as the retry backstop.
- Checked on a local Postgres 16 (initdb in the sandbox, port 55432, all migrations applied, no Neon host): the incidents and MF-03 db-specs pass, including a new case where a 6 s send settles once and the next run does not resend.
- Spec edits: `specs/incidents/design.md` §3, §5 events, §6, the class diagram and Figure 6; `specs/platform/design.md` §4.6 job table; `specs/incidents/tasks.md` 2.1 **Partly done** line. All ten incidents diagrams render with mermaid-cli 11.
