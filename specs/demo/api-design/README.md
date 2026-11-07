# API Design Index: demo

> Generated from `scripts/specs/endpoints/demo.py`. Contract: D-002 envelope; on failure `result = { errorCode }` (`specs/platform/requirements.md` REQ-UBI-04). Organization members and API keys only ever see their own organization's records (FR-AUTH-11).

| # | Method | Route | Permission | Spec File |
| --- | --- | --- | --- | --- |
| 01 | GET | `/api/demo/status` | Any signed-in user | [01-get-demo-status.md](01-get-demo-status.md) |
| 02 | GET | `/api/demo/scenarios` | TrekLink Admin (`demo.stage`) | [02-get-demo-scenarios.md](02-get-demo-scenarios.md) |
| 03 | POST | `/api/demo/scenarios/:id/stage` | TrekLink Admin (`demo.stage`) | [03-post-demo-scenarios-id-stage.md](03-post-demo-scenarios-id-stage.md) |
| 04 | POST | `/api/demo/switch-role` | Any seeded role (`demo.switchRole`, `demo.switchRole.org`) | [04-post-demo-switch-role.md](04-post-demo-switch-role.md) |
| 05 | GET | `/api/demo/accounts` | Public (`DEMO_TEST_ACCOUNTS_ENABLED`) | [05-get-demo-accounts.md](05-get-demo-accounts.md) |
| 06 | GET | `/api/demo/simulation` | TrekLink Admin (`demo.simulate`) | [06-get-demo-simulation.md](06-get-demo-simulation.md) |
| 07 | POST | `/api/demo/simulation/nodes` | TrekLink Admin (`demo.simulate`) | [07-post-demo-simulation-nodes.md](07-post-demo-simulation-nodes.md) |
| 08 | PATCH | `/api/demo/simulation/nodes/:id` | TrekLink Admin (`demo.simulate`) | [08-patch-demo-simulation-nodes-id.md](08-patch-demo-simulation-nodes-id.md) |
| 09 | POST | `/api/demo/simulation/nodes/:id/stop` | TrekLink Admin (`demo.simulate`) | [09-post-demo-simulation-nodes-id-stop.md](09-post-demo-simulation-nodes-id-stop.md) |
| 10 | POST | `/api/demo/simulation/nodes/:id/events` | TrekLink Admin (`demo.simulate`) | [10-post-demo-simulation-nodes-id-events.md](10-post-demo-simulation-nodes-id-events.md) |
| 11 | GET | `/api/demo/quick` | TrekLink Admin (`demo.stage`) plus ADMIN role | [11-get-demo-quick.md](11-get-demo-quick.md) |
| 12 | POST | `/api/demo/quick/:action` | TrekLink Admin (`demo.stage`) plus ADMIN role | [12-post-demo-quick-action.md](12-post-demo-quick-action.md) |

Control routes require `DEMO_CONTROLS_ENABLED=true` and explicit `VITE_APP_ENV` sandbox or staging; otherwise they answer 404 (REQ-QUICK-01). Legacy stage and role-switch writes additionally refuse NODE_ENV production and non-loopback databases (design §2). Additive quick actions 11 and 12 allow staging production, require an Admin role and `demo.stage`, and check both database URLs. Route 05 is the public test accounts list under its independent `DEMO_TEST_ACCOUNTS_ENABLED` flag (D-089). Simulation control routes 06 to 10 require both the control/environment gate and `DEMO_SIMULATION_ENABLED`; their writes require a local or named staging database and may run in staging production. The field simulator job retains its separate flag.


Manual testing: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).
