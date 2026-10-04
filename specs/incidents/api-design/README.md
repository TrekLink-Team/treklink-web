# API Design Index: incidents

> Generated from `scripts/specs/endpoints/incidents.py`. Contract: D-002 envelope; on failure `result = { errorCode }` (`specs/platform/requirements.md` REQ-UBI-04). Organization members and API keys only ever see their own organization's records (FR-AUTH-11).

| # | Method | Route | Permission | Spec File |
| --- | --- | --- | --- | --- |
| 01 | GET | `/api/incidents` | Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin | [01-get-incidents.md](01-get-incidents.md) |
| 02 | GET | `/api/incidents/:id` | Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin | [02-get-incidents-id.md](02-get-incidents-id.md) |
| 03 | POST | `/api/incidents/:id/acknowledge` | Org Manager, Org Operator: own | [03-post-incidents-id-acknowledge.md](03-post-incidents-id-acknowledge.md) |
| 04 | POST | `/api/incidents/:id/responding` | Owner (Org Manager or Org Operator) | [04-post-incidents-id-responding.md](04-post-incidents-id-responding.md) |
| 05 | POST | `/api/incidents/:id/status-updates` | Owner (Org Manager or Org Operator) | [05-post-incidents-id-status-updates.md](05-post-incidents-id-status-updates.md) |
| 06 | POST | `/api/incidents/:id/resolve` | Owner (Org Manager or Org Operator) | [06-post-incidents-id-resolve.md](06-post-incidents-id-resolve.md) |
| 07 | POST | `/api/incidents/:id/false-alarm` | Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin: UNROUTED only | [07-post-incidents-id-false-alarm.md](07-post-incidents-id-false-alarm.md) |
| 08 | POST | `/api/incidents/:id/authority-reports` | TrekLink Staff, TrekLink Admin | [08-post-incidents-id-authority-reports.md](08-post-incidents-id-authority-reports.md) |
| 09 | POST | `/api/authority-reports/:reportId/close-case` | TrekLink Staff, TrekLink Admin | [09-post-authority-reports-reportid-close-case.md](09-post-authority-reports-reportid-close-case.md) |
| 10 | POST | `/api/authority-reports` | TrekLink Staff, TrekLink Admin | [10-post-authority-reports.md](10-post-authority-reports.md) |
| 11 | GET | `/api/authority-reports` | TrekLink Staff, TrekLink Admin | [11-get-authority-reports.md](11-get-authority-reports.md) |
| 12 | GET | `/api/incidents/:id/transitions` | Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin | [12-get-incidents-id-transitions.md](12-get-incidents-id-transitions.md) |
| 13 | GET | `/api/incidents/:id/events` | Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin | [13-get-incidents-id-events.md](13-get-incidents-id-events.md) |
| 14 | GET | `/api/incidents/:id/alerts` | Org Manager: own; TrekLink Staff, TrekLink Admin | [14-get-incidents-id-alerts.md](14-get-incidents-id-alerts.md) |

Transitions taken by the system have no endpoint (incidents design §2): creation and routing from ingestion (UC-29), tier timeouts (UC-31), the stale limit (FR-INC-07), reopen on a new episode and close when the reopen window ends (UC-36, UC-37), and the owner leaving the organization.


Manual testing: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).
