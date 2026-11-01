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

The demo laptop candidate works only on the laptop running `npm run dev`; anyone else gets the
unavailable message, which is correct while the system is not hosted.
