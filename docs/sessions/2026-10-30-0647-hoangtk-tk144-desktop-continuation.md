# 2026-10-30 06:47, HoangTK, TK-144 desktop continuation

## Why

Picks up `2026-10-30-0627-hoangtk-tk144-device-handoff.md` on the desktop PC: runs the verification the laptop could not (`test:e2e`, `test:cov`, `build`, `test:db` on a disposable Postgres), rebases on `dev`, and opens the draft PR. No code or spec changed in this session.

## State on arrival

| | |
|---|---|
| Branch | `feat/TK-144-escalation-timers` at `3364121f4021b929b5fa9accee0a3469abd4655c`, equal to its remote |
| `origin/dev` | `c52c77e`, two commits past the base `16b1421`: `28a3a28` (monitoring uses the rentals `device.checkedIn` event) and `c52c77e` (monitoring 2.2). Neither touches `incidents/` or the schema |
| treklink-web#118 | Open, no comments, last update 2026-10-29T20:14Z. R1 and R2 unruled |
| Leader decisions since the handoff | None that change 3.1. `treklink-docs` `f5cafcf` (D-038 rule 2 confirmed, 2026-10-29) states the past-window SOS close is "the same close the timer of incidents task 3.1 makes", which the job already does |

## Desktop setup found

- Node 22.15.0, npm 11.18.0, git 2.48.1, Docker 29.9.2, Python 3.12.10 with `cryptography`, `gh` signed in.
- `treklink.member` HoangTK, `treklink.model` claude-opus-5-5. `core.hooksPath` is the global no-ai-trailer folder, whose `commit-msg` hands over to `.git/hooks/commit-msg` (the Checksum hook). `capstone/.provenance/keys.json` present.
- No `node_modules`: ran `npm ci`. npm 11 blocked seven install scripts (`allow-scripts`) and `bcrypt` failed to load, so `npm rebuild bcrypt` was run alone. No allowlist or config changed. `prisma:generate` run.
- No `DATABASE_URL` or `DATABASE_DIRECT_URL` in the shell and no `.env`, so nothing pointed at Neon. Neon was not touched.

## Rebase

- Backup branch `backup/TK-144-pre-rebase-3364121` (local only).
- `git rebase origin/dev`: no conflicts. `git range-diff` shows the four commits patch-identical: `364d8de` docs spec, `2a48ec9` feat job, `e798899` tests, `69917a2` handoff. Each keeps its `Checksum` trailer and subject.

## Verified after the rebase, on `c52c77e` plus the branch

| Gate | Result |
|---|---|
| `typecheck` | pass |
| `lint` | 0 errors, the existing warning at `test/incidents.e2e-spec.ts:256`; boundaries pass, 287 files, 9 modules, acyclic |
| `test:e2e` | 12 suites, 166 tests pass |
| `test:cov` | 122 suites, 1361 tests pass. All files 92.77 % lines, 84.87 % branches. `incident-timers.job.ts`, `incidents.repository.ts`, `routing.service.ts`, `incidents.module.ts` at 100 % statements, branches, functions and lines (D-053) |
| `build` | pass |
| `test:db` | `postgres:16` on port 55432, `prisma:deploy` applied every migration, 7 suites and 54 tests pass. Container removed |

The same gates also passed before the rebase (120 suites, 1338 unit tests). The first post-rebase `test:db` attempt failed with "test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL" because the run script left `DATABASE_DIRECT_URL` empty; rerun with both set, it passed. Gateway and frontend suites not run: the branch does not touch them.

## Task 3.1: done and not done

Done, proven against Postgres in `backend/test/mf03-escalation.db-spec.ts`:

- `tierTimeouts` walks `NOTIFY_PRIMARY`, skips the empty backup tier, `NOTIFY_MANAGER`, then `ESCALATED` (AC-02).
- `staleResponses` moves `ACKNOWLEDGED` or `RESPONDING` past `statusDueAt` to `ESCALATED` with the owner kept (REQ-EVT-07).
- `closeAfterReopenWindow` closes `RESOLVED` and `FALSE_ALARM` past the window as `SYSTEM`; a window never set is not selected.
- A deadline that fired is not selected again; a raced human action wins through `apply()` with the expected state.

Not done, so the box stays `[ ]`:

1. **R1 (treklink-web#118)**: `ESCALATED` alerts the routed organization's Managers only. Staff (MSG34) get nothing until the leader rules how `incidents` reads Staff accounts.
2. **Restart test (platform AC-09, incidents REQ-ERR-04, design §8 "restart test with pending deadlines (fake clock)")**: D-053 sets coverage only and does not address it. The db spec uses one job instance and moves stored deadlines into the past; it does not stop and restart the process or use a fake clock. Question put to KhoaDD on the PR.

## Delivery

- This file committed as `docs(TK-144)`, branch pushed with `--force-with-lease`, draft PR opened against `dev` with KhoaDD (`ruskicoder`) as reviewer. Not merged. Jira not moved.
