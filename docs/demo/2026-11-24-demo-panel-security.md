# Demo panel security note (D-110, TK-243)

Written 2026-11-24 on `feat/demo-panel`. The demo panel is `/demo/panel` (screen `specs/demo/ui-panel.md`)
and the four routes `/api/demo/panel*` (api-design 13 to 16, design §11). It needs no account. One shared
password guards every route, and a reseed can delete every demo record. This note covers who it protects
against, what the guard covers and what it does not, and the routine before and after each defence.

## 1. Threat model

| Who | Can | Must not |
|---|---|---|
| A spectator on the public site (the defence audience, anyone with the address) | See `/demo` and its "Open the demo panel" link, open the password prompt, send requests to `/api/demo/panel*` | Read the panel, run an action, start a playback or reseed |
| A signed-in user of any role, Admin included | Use the real screens as their role allows | Reach the panel through their account: no token, role or permission opens it (D-110 rule 1) |
| The panel operator, presenter and site clicker | Use the panel with the password the leader shared | Reseed any database except the dedicated Neon demo branch |
| A mistake by the team (the wrong `.env`, a staging host, a double click) | | Wipe a database that is not the demo branch, or run two reseeds or a reseed under a playback |

The assets are the demo branch's data, which is fictitious, and the integrity of what the panel shows
while the examiners watch. No real personal data is in reach: the seed is fictitious and every panel
record is marked as demo provenance.

## 2. What the guard covers

- **Off by default.** The routes exist only when `DEMO_PANEL_PASSWORD_HASH` holds a hash that parses. Without
  one, every panel route answers 404, and the whole-app boot test checks this
  (`backend/test/demo-gate-boot.db-spec.ts`).
- **Every route, reads included.** `DemoPanelGuard` sits on the controller class. A unit test reads every
  route from the controller's metadata and requires 401 with no header and with a wrong password, so a new
  route without the guard fails CI (`backend/src/modules/demo/demo-panel.controller.spec.ts`).
- **Only a hash is configured.** It is scrypt with a random 16-byte salt and a 32-byte key. The typed
  password is derived with the same salt and compared with `timingSafeEqual`. A missing header costs the
  same work as a wrong one. The password and the hash are never logged, returned or stored, and the
  guard's warning names only the client address.
- **Guessing is bounded.** Five wrong or missing passwords from one address within ten minutes and that
  address gets 429 until the window ends, before any comparison. Each attempt is counted before its
  password is compared, so parallel guesses reach at most five comparisons, and an IPv6 client is counted
  by its /64. The address is the right-most
  `X-Forwarded-For` entry only when the direct peer is a private or loopback proxy (Caddy on the AWS
  host). A client that connects directly cannot choose its own key.
- **Actions keep the product rules.** Every action calls the owning module's service as the seeded or
  live account whose screen it stands for. State machines, versions, membership, stock, payment and
  custody checks apply as on the real screens. Every command is one `demo.panel.<command>` audit entry
  with no actor and the client address. Writes are refused on any database that is neither local,
  `treklink_prod`, nor the `DEMO_DATABASE_HOST` branch.
- **The reseed checks five things before it touches a row.** `DEMO_RESET_ENABLED` must be `true`. The host of
  `DATABASE_URL` must be exactly `DEMO_DATABASE_HOST`, the direct URL must point at the same endpoint, and
  neither URL may carry a host or database override. The typed text must be exactly `RESET DEMO DATA`. No
  reseed may have run in the last five minutes, checked in memory and against the audit log, so a restart
  does not reopen the window. No playback, panel action or other reseed may be running, and while the
  reseed runs every action and playback step is refused. The URL the database client actually uses and
  the live `current_database()` are checked before the wipe. The wipe runs no schema statement. Its audit
  entry is written after the wipe, on success and on failure, so it is kept and names any error.
- **The browser keeps the password in memory only.** The page holds it in a module variable for the tab,
  never in storage, a cookie or the URL, and sends it only in the `X-Demo-Panel-Password` header. **Lock**,
  a reload or a closed tab forgets it. A panel 401 never triggers the session token refresh.

## 3. What it does not cover

- **A shared secret is only as good as its sharing.** Anyone who has the password has the whole panel. Share
  it in the team's private channel only, never on a slide, in a screenshot or in a commit.
- **Shoulder surfing during the defence.** Type the password before the projector is on, or in a window
  that is not shared.
- **Per-address limits do not stop a distributed guesser.** Use a long random password (at least 16
  characters; the hash script refuses shorter ones) and rotate it after each defence.
- **A second backend process.** The failure count, the playback and the in-process reseed lock live in
  memory, which fits the single AWS backend. The five-minute reseed spacing also reads the audit log.
- **Cost of a guess.** Each wrong password costs one scrypt derivation (N 16384) before it counts against
  the address. This is acceptable for a few requests a second; the panel is not meant to stay on outside
  a rehearsal or a defence.
- **The AWS image cannot reseed yet.** It ships only `dist/` and no `ts-node`, so the seed file does not
  load there and the reseed answers 409 `DEMO_SEED_NOT_CONFIGURED` before any row is touched. Actions and
  playback work. Compiling the seed into the image is a separate, leader-approved change.

## 4. Before each defence (leader)

1. Make the hash on a trusted machine, typing the password at the prompt:

   ```bash
   npm --prefix backend run demo:panel-hash
   ```

2. Add the three keys to `deploy/aws/.env.aws` (they are not in `up.sh`'s `FIXED_KEYS`, so they reach the
   host's `.env`):
   - `DEMO_PANEL_PASSWORD_HASH`: the line printed by step 1.
   - `DEMO_DATABASE_HOST`: the host of the dedicated Neon demo branch, as in its `DATABASE_URL`.
   - `DEMO_RESET_ENABLED`: `true` only if the reseed is wanted.

   Point `DATABASE_URL` and `DATABASE_DIRECT_URL` at that branch, then run `deploy/aws/up.sh`.
   `deploy/aws/compose.yml` is unchanged: nothing is on unless the keys are set.
3. Share the password in the team's private channel.
4. Check from a browser that is not signed in: `/demo/panel` asks for the password, a wrong password says
   so, and the right one shows the three views.

## 5. After each defence (rotation)

1. Remove `DEMO_PANEL_PASSWORD_HASH` (the panel then answers 404) and set `DEMO_RESET_ENABLED=false`, or
   replace the hash with one for a new password. Run `deploy/aws/up.sh` again.
2. Treat the old password as spent: never reuse it, and delete it from the channel message.
3. Read the panel audit entries (`demo.panel.*`, actor role `DEMO_PANEL`) on the audit log screen for
   anything the team did not do.
