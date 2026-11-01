# API Design Index: demo

> Generated from `scripts/specs/endpoints/demo.py`. Contract: D-002 envelope; on failure `result = { errorCode }` (`specs/platform/requirements.md` REQ-UBI-04). Organization members and API keys only ever see their own organization's records (FR-AUTH-11).

| # | Method | Route | Permission | Spec File |
| --- | --- | --- | --- | --- |
| 01 | GET | `/api/demo/status` | Any signed-in user | [01-get-demo-status.md](01-get-demo-status.md) |
| 02 | GET | `/api/demo/scenarios` | TrekLink Admin (`demo.stage`) | [02-get-demo-scenarios.md](02-get-demo-scenarios.md) |
| 03 | POST | `/api/demo/scenarios/:id/stage` | TrekLink Admin (`demo.stage`) | [03-post-demo-scenarios-id-stage.md](03-post-demo-scenarios-id-stage.md) |
| 04 | POST | `/api/demo/switch-role` | Any seeded role (`demo.switchRole`, `demo.switchRole.org`) | [04-post-demo-switch-role.md](04-post-demo-switch-role.md) |
| 05 | GET | `/api/demo/accounts` | Public (`DEMO_TEST_ACCOUNTS_ENABLED`) | [05-get-demo-accounts.md](05-get-demo-accounts.md) |

The module is loaded only when `DEMO_CONTROLS_ENABLED` is `true`; otherwise routes 01 to 04 answer 404 (specs/demo/requirements.md REQ-UBI-01). The `POST` routes refuse a production process and a database that is not on a loopback host before anything else (design §2). Route 05, the public test accounts list, is the exception: it has its own flag, `DEMO_TEST_ACCOUNTS_ENABLED`, and no other guard (D-089).


Manual testing: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).
