# 2026-10-30 06:27, HoangTK, TK-144 device handoff (laptop to desktop)

## Why

The laptop is too slow for Docker and Postgres runs. All TrekLink work pauses here and continues on the desktop PC. This is a device handoff. Task 3.1 is not finished and nothing was marked complete.

## Task in progress

- Story **US-UC31 (TK-144)**, with the closing half of **US-UC37 (TK-150)** riding along.
- Task **`specs/incidents/tasks.md` 3.1 Scheduler jobs**, owner HoangTK, still `[ ]`. The build is described in `2026-10-30-0321-hoangtk-escalation-timers.md`; read that file first, do not re-derive it.

## Branch state

| | |
|---|---|
| Repository | `TrekLink-Team/treklink-web` |
| Branch | `feat/TK-144-escalation-timers`, first pushed in this handoff |
| Base | `dev` at `16b1421ed7641d2257201b51e35ada0c70bafcca` (PR #114 merge) |
| Commits | `5c1d646` docs spec, `1fa680e` feat job, `c514e1b` tests, then this handoff file |
| PR | None. Not opened, by choice |
| Jira | TK-144 status not checked from this session (unknown); leave it as the board shows it |

## Verified on the laptop, 2026-10-30, before the pause

- `npm run typecheck`: pass.
- `npm run lint`: 0 errors, 1 warning in `test/incidents.e2e-spec.ts:256` (`_omitted` unused). That file is not touched by this branch, so the warning predates it.
- `lint:boundaries`: pass, 284 files, 9 modules, acyclic.
- `npx jest`: 120 suites, 1338 tests pass. Jest reported a worker that did not exit gracefully (open handle, not investigated).
- `test:db` against a disposable `postgres:16` container on port 55432, after `prisma:deploy`: 7 suites, 54 tests pass. Container removed.

Not run on the laptop: `test:e2e`, `test:cov`, `build`, the frontend and gateway suites.

## Remaining for task 3.1

1. **Blocker**: Staff recipients of `ESCALATED` wait for the leader ruling R1 in treklink-web#118 (open at 06:27). Until then `ESCALATED` alerts Managers only and the task box stays open.
2. Decide with the leader whether the moved-deadline db spec is accepted in place of the fake-clock restart test the task lists, or add a fake-clock test.
3. Optional: find the Jest open handle (`--detectOpenHandles`).
4. Before a PR: run `test:e2e`, `test:cov` and `build` on the desktop, rebase on the latest `dev`, then open the PR through `/treklink-pr` when HoangTK asks.

## Local-only files, not in git

- `ignore/HoangTK/envs/neon-dev.env`: Neon credentials. Move by a private channel, never by git or chat.
- `ignore/HoangTK/` notes, logs, `pr114/` drafts and `screen-design/` tools: copy if wanted.
- `capstone/.provenance/keys.json`: the Checksum hook reads member keys from it; the desktop needs `capstone/` as the parent folder.
- Per-machine setup: `pip install cryptography`, `git config --global treklink.member HoangTK`, `tk_checksum.py install` (chapter 07 §3.6), and `git config treklink.model` in each repository.

## Left untouched on the laptop

- `treklink-docs` on `dev`, 27 behind, with unstaged edits to the generated `_docs/03-backlog/01-epics.md` and `02-user-stories.md`. Not part of TK-144; not committed.
- `capstone` on `main`, 20 behind, untracked `.provenance/` and `Documents/meetings/2026-10-21-screen-design/`, plus a `.sync-lock` reading "SDD review fixes (HoangTK)" that pauses the auto-sync.
- Stashes `!!GitHub_Desktop<main>` in `capstone` and `!!GitHub_Desktop<dev>` in `treklink-docs`.
- Older local branches in `treklink-web` whose remotes are gone (`feat/TK-142-*`, `docs/ui-design-hoangtk*`, `backup/TK-142-pre-rebase`).
