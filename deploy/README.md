# Deployment endpoints

`system-endpoints.json` tells the public landing page (`TrekLink-Team.github.io`, on GitHub Pages and
Vercel) where the operations system is (D-088). The landing page reads it from this repository's
`main` branch through `raw.githubusercontent.com` when a visitor presses "Open the system", probes each
candidate's `health` URL in order, and opens the first candidate's `url` that answers within its
`timeoutMs`. If none answers, the page stays and shows its unavailable message.

Moving the system, for example to the AWS staging of D-055, means editing this file in a pull request to
`main`: put the hosted candidate first and keep the demo laptop last. The landing page code does not
change. GitHub serves the file with a five-minute cache, so a change takes up to five minutes to reach
visitors.

| Field | Meaning |
|---|---|
| `version` | Shape of this file; the landing page ignores a version it does not know and uses its built-in fallback |
| `candidates[].name` | A label for logs and reviews |
| `candidates[].url` | Where the visitor is sent: the frontend's root, which shows the public plans page |
| `candidates[].health` | The backend's `GET /api/health`, readable from any origin (specs/platform REQ-EVT-04) |
| `candidates[].timeoutMs` | How long to wait. A loopback candidate needs about 10 s, because Chrome holds a request from a public page to `localhost` on a local network access prompt until the visitor answers it |

## The Vercel production (D-089)

`vercel.json` at the repository root deploys two services in one Vercel project, `treklink-web`, at
`https://treklink-web.vercel.app`:

| Service | Root | What Vercel does |
|---|---|---|
| `frontend` | `frontend/` | `scripts/vercel-install.sh`, `npm run build`, serves `dist/` with a rewrite to `index.html` |
| `backend` | `backend/` | `scripts/vercel-install.sh`, then `scripts/vercel-build.sh`; NestJS runs as one Vercel Function from `src/main.ts` |

`scripts/vercel-install.sh` installs both workspaces once per deployment (the marker in `node_modules`
holds the deployment id, because Vercel restores `node_modules` from the previous build cache) and
moves the packages npm nests in `backend/node_modules` to the root `node_modules`. The NestJS builder
makes `backend/dist` the function root and keeps each traced file at its path from the repository
root, so a package left in `backend/node_modules` ships where `main.js` cannot resolve it.

Requests to `/api/...` and `/socket.io/...` go to the backend with their path unchanged (the global
prefix is `api`); everything else goes to the frontend. The frontend calls the API on the same origin
(`VITE_API_BASE_URL=/api`).

`scripts/vercel-build.sh` runs `prisma migrate deploy` and the idempotent `seed:demo` only on a
production build and only when both database URLs name `treklink_prod`, the database on the Neon
branch `vercel-prod`. The shared Neon `dev` database is never migrated or seeded from a build.

Known gaps on Vercel Functions: no MQTT subscriber (`MQTT_INGESTION_ENABLED=false`, so the gateway does
not reach it; instead `FIELD_SIMULATOR_ENABLED=true` feeds simulated positions for TL-0009 and TL-0010
through the normal ingestion path, one batch a minute while requests arrive, and testers are told the
field data is simulated), no socket (the frontend build sets `VITE_LIVE_MODE=poll`, so screens refetch their live views every 15 seconds and the header says "Auto refresh"), scheduled
jobs run from a tick after requests (`JOBS_TICK_ON_REQUEST=true` in Production, at most once a
minute per instance, so a quiet production runs nothing until the next visit), signed handover notes are kept in the database (`HANDOVER_NOTE_STORE=database`, because a function's `/tmp`
does not outlive one request; notes signed before 2026-11-01 15:30 were not backfilled), and email goes to the
function log (`MAIL_TRANSPORT=console`) until an SMTP account is configured.

The backend function runs in `sin1` (Singapore, `regions` in `vercel.json`), next to the Neon branch in
`ap-southeast-1`. In the default `iad1` every query crossed the Pacific, and `GET /api/map/snapshot` took
about 10 seconds.

Project settings in the Vercel dashboard: framework preset Services, root directory empty (the repository root), Node.js 22.x to match CI. The project's environment variables are set in the Vercel dashboard; secrets (database URLs, JWT
secrets, seed passwords) are entered by the leader. The list of names lives with the leader, not here.
