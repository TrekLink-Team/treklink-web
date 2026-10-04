# API Design Index: organizations

> Generated from `scripts/specs/endpoints/organizations.py`. Contract: D-002 envelope; on failure `result = { errorCode }` (`specs/platform/requirements.md` REQ-UBI-04). Organization members and API keys only ever see their own organization's records (FR-AUTH-11).

| # | Method | Route | Permission | Spec File |
| --- | --- | --- | --- | --- |
| 01 | POST | `/api/organizations/register` | Public | [01-post-organizations-register.md](01-post-organizations-register.md) |
| 02 | GET | `/api/organizations` | TrekLink Staff, TrekLink Admin | [02-get-organizations.md](02-get-organizations.md) |
| 03 | GET | `/api/organizations/:id` | TrekLink Staff, TrekLink Admin; members: own | [03-get-organizations-id.md](03-get-organizations-id.md) |
| 04 | PATCH | `/api/organizations/:id` | Org Manager: own; TrekLink Admin | [04-patch-organizations-id.md](04-patch-organizations-id.md) |
| 05 | POST | `/api/organizations/:id/verification` | TrekLink Staff | [05-post-organizations-id-verification.md](05-post-organizations-id-verification.md) |
| 06 | POST | `/api/organizations/:id/approve` | TrekLink Admin | [06-post-organizations-id-approve.md](06-post-organizations-id-approve.md) |
| 07 | POST | `/api/organizations/:id/reject` | TrekLink Admin | [07-post-organizations-id-reject.md](07-post-organizations-id-reject.md) |
| 08 | POST | `/api/organizations/:id/suspend` | TrekLink Admin | [08-post-organizations-id-suspend.md](08-post-organizations-id-suspend.md) |
| 09 | POST | `/api/organizations/:id/reactivate` | TrekLink Admin | [09-post-organizations-id-reactivate.md](09-post-organizations-id-reactivate.md) |
| 10 | POST | `/api/organizations/:id/close` | TrekLink Admin | [10-post-organizations-id-close.md](10-post-organizations-id-close.md) |
| 11 | GET | `/api/organizations/:id/transitions` | TrekLink Staff, TrekLink Admin; Org Manager: own | [11-get-organizations-id-transitions.md](11-get-organizations-id-transitions.md) |
| 12 | GET | `/api/organizations/:id/members` | Org Manager, Org Operator: own; TrekLink Staff | [12-get-organizations-id-members.md](12-get-organizations-id-members.md) |
| 13 | POST | `/api/organizations/:id/members` | Org Manager: own | [13-post-organizations-id-members.md](13-post-organizations-id-members.md) |
| 14 | PATCH | `/api/organizations/:id/members/:memberId` | Org Manager: own | [14-patch-organizations-id-members-memberid.md](14-patch-organizations-id-members-memberid.md) |
| 15 | POST | `/api/organizations/:id/members/:memberId/deactivate` | Org Manager: own | [15-post-organizations-id-members-memberid-deactivate.md](15-post-organizations-id-members-memberid-deactivate.md) |
| 16 | GET | `/api/organizations/:id/roster` | Org Manager, Org Operator: own | [16-get-organizations-id-roster.md](16-get-organizations-id-roster.md) |
| 17 | POST | `/api/organizations/:id/roster` | Org Manager: own | [17-post-organizations-id-roster.md](17-post-organizations-id-roster.md) |
| 18 | PATCH | `/api/organizations/:id/roster/:shiftId` | Org Manager: own | [18-patch-organizations-id-roster-shiftid.md](18-patch-organizations-id-roster-shiftid.md) |
| 19 | DELETE | `/api/organizations/:id/roster/:shiftId` | Org Manager: own | [19-delete-organizations-id-roster-shiftid.md](19-delete-organizations-id-roster-shiftid.md) |
| 20 | GET | `/api/organizations/:id/api-keys` | Org Manager: own | [20-get-organizations-id-api-keys.md](20-get-organizations-id-api-keys.md) |
| 21 | POST | `/api/organizations/:id/api-keys` | Org Manager: own | [21-post-organizations-id-api-keys.md](21-post-organizations-id-api-keys.md) |
| 22 | POST | `/api/organizations/:id/api-keys/:keyId/revoke` | Org Manager: own | [22-post-organizations-id-api-keys-keyid-revoke.md](22-post-organizations-id-api-keys-keyid-revoke.md) |
| 23 | GET | `/api/organizations/:id/field-stations` | Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin | [23-get-organizations-id-field-stations.md](23-get-organizations-id-field-stations.md) |
| 24 | POST | `/api/organizations/:id/field-stations` | Org Manager: own | [24-post-organizations-id-field-stations.md](24-post-organizations-id-field-stations.md) |
| 25 | POST | `/api/organizations/:id/field-stations/:stationId/revoke` | Org Manager: own; TrekLink Staff, TrekLink Admin | [25-post-organizations-id-field-stations-stationid-revoke.md](25-post-organizations-id-field-stations-stationid-revoke.md) |


Manual testing: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).
