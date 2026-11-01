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
| `frontend` | `frontend/` | `npm ci --ignore-scripts` at the root, `npm run build`, serves `dist/` with a rewrite to `index.html` |
| `backend` | `backend/` | `npm ci` at the root, then `scripts/vercel-build.sh`; NestJS runs as one Vercel Function from `src/main.ts` |

Requests to `/api/...` and `/socket.io/...` go to the backend with their path unchanged (the global
prefix is `api`); everything else goes to the frontend. The frontend calls the API on the same origin
(`VITE_API_BASE_URL=/api`).

`scripts/vercel-build.sh` runs `prisma migrate deploy` and the idempotent `seed:demo` only on a
production build and only when both database URLs name `treklink_prod`, the database on the Neon
branch `vercel-prod`. The shared Neon `dev` database is never migrated or seeded from a build.

Known gaps on Vercel Functions: no MQTT subscriber (`MQTT_INGESTION_ENABLED=false`, so MF-02 field data
and the gateway do not reach it), no persistent socket push (screens refresh on reload), scheduled
jobs run only while an instance is warm, handover notes are written to `/tmp`, and email goes to the
function log (`MAIL_TRANSPORT=console`) until an SMTP account is configured.

The project's environment variables are set in the Vercel dashboard; secrets (database URLs, JWT
secrets, seed passwords) are entered by the leader. The list of names lives with the leader, not here.
