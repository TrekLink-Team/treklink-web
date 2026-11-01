# Screen designs (`ui-design/`)

One file per page task of `specs/frontend/tasks.md` (Phases 2 to 9), `<task>-<page-slug>.md` (for
example `5-1-contractrequestpage-with-quote.md` for task 5.1), with its wireframe image of the same
name in `.png` or `.svg` next to it. The files are scaffolded by `scripts/specs/scaffold_ui_design.py`,
which never overwrites an existing file. Written in the SD phase of the
story by the screen's owner (D-053) and checked against the Screen Design Checklist,
`treklink-docs/_docs/01-conventions/06-frontend-conventions.md` §7, and the UI and UX practices, §8.

**Read first**: [`0-ui-standard.md`](0-ui-standard.md), the UI standard (WCAG 2.2 AA, data tables,
state changes, forms, dark mode) every screen file and every component of `frontend/src/shared/ui`
follows (2026-11-01).

## Lanes

| Screens | Owner |
|---|---|
| Auth pages, contracts (`/o/contracts*`, `/t/contracts*`, `/t/counter/*`), invoices, payments, prices, damage charges | LongLP |
| Organization pages (`/register`, `/o/members`, `/o/roster`, `/o/api-keys`, `/o/field-stations`, `/t/organizations*`, `/t/compliance-cases*`) | TanNB |
| Incident pages (`/o/incidents*`, `/t/incidents`) | HoangTK |
| Fleet and maintenance (`/t/fleet`, `/t/devices/*`, `/t/stock-take`, `/t/maintenance`, `/t/loss-cases*`, `/o/loss-cases`) | KhoaDD |
| Shared layout and components, maps (`/o/map`, `/t/map`), public plans page, reports, administration (`/t/admin/*`), SRS §3.1.2 and §3.1.3 | LongNN |

Deadline 2 to 3 days from the assignment; the leader finishes what is not done (D-052).

## Assignments

<!-- assignments:start -->
Assigned 2026-10-21, due 2026-10-23. Owners follow `specs/frontend/tasks.md` (D-053); the leader may reassign in this table. Per owner: HoangTK 3, KhoaDD 5, LongLP 11, LongNN 9, TanNB 6.

| Task | Screen file | Owner | Stories | Due |
|---|---|---|---|---|
| 2.1 | [Sign-in, forgot, reset, welcome (set password)](2-1-sign-in-forgot-reset-welcome-set.md) | LongLP | US-UC08, US-UC09 | 2026-10-23 |
| 2.2 | [Account menu: profile and change password](2-2-account-menu-profile-and-change-password.md) | LongLP | US-UC08 | 2026-10-23 |
| 2.3 | [Plans page](2-3-plans-page.md) | LongNN | US-UC15 | 2026-10-23 |
| 3.1 | [`RegisterPage`](3-1-registerpage.md) | TanNB | US-UC01 | 2026-10-23 |
| 3.2 | [`OrganizationReviewPage` for Staff and Admin](3-2-organizationreviewpage-for-staff-and-admin.md) | TanNB | US-UC02, US-UC03, US-UC07 | 2026-10-23 |
| 3.3 | [Members and roster](3-3-members-and-roster.md) | TanNB | US-UC04, US-UC05 | 2026-10-23 |
| 3.4 | [API keys](3-4-api-keys.md) | TanNB | US-UC06 | 2026-10-23 |
| 3.5 | [`FieldStationsPage`](3-5-fieldstationspage.md) | TanNB | US-UC06, US-UC42 | 2026-10-23 |
| 3.6 | [`ComplianceCasePage` and channel key rotation](3-6-compliancecasepage-and-channel-key-rotation.md) | TanNB | US-UC63 | 2026-10-23 |
| 4.1 | [Hardware variants admin](4-1-hardware-variants-admin.md) | KhoaDD | US-UC13 | 2026-10-23 |
| 4.2 | [Fleet table, register, intake, `DeviceDetailPage`](4-2-fleet-table-register-intake-devicedetailpage.md) | KhoaDD | US-UC11, US-UC12, US-UC44, US-UC53, US-UC62 | 2026-10-23 |
| 4.3 | [`MaintenancePage` and `MaintenanceApprovalPage`](4-3-maintenancepage-and-maintenanceapprovalpage.md) | KhoaDD | US-UC52, US-UC64, US-UC65 | 2026-10-23 |
| 4.4 | [`LossCasePage`](4-4-losscasepage.md) | KhoaDD | US-UC49, US-UC60 | 2026-10-23 |
| 4.5 | [Stock-take](4-5-stock-take.md) | KhoaDD | US-UC54 | 2026-10-23 |
| 5.1 | [`ContractRequestPage` with quote](5-1-contractrequestpage-with-quote.md) | LongLP | US-UC15 | 2026-10-23 |
| 5.2 | [`ContractDetailPage` and contract lists](5-2-contractdetailpage-and-contract-lists.md) | LongLP | US-UC18, US-UC23, US-UC25, US-UC55 | 2026-10-23 |
| 5.3 | [`ContractApprovalPage`](5-3-contractapprovalpage.md) | LongLP | US-UC16, US-UC17 | 2026-10-23 |
| 5.4 | [`CounterPage` handover](5-4-counterpage-handover.md) | LongLP | US-UC14, US-UC20, US-UC21 | 2026-10-23 |
| 5.5 | [Check-in, inspection, replacement, close](5-5-check-in-inspection-replacement-close.md) | LongLP | US-UC43, US-UC44, US-UC51, US-UC61 | 2026-10-23 |
| 6.1 | [`InvoicePage` and invoice list](6-1-invoicepage-and-invoice-list.md) | LongLP | US-UC55 | 2026-10-23 |
| 6.2 | [SePay payment page](6-2-sepay-payment-page.md) | LongLP | US-UC19 | 2026-10-23 |
| 6.3 | [Counter payments](6-3-counter-payments.md) | LongLP | US-UC22 | 2026-10-23 |
| 6.4 | [Prices, damage rates, `DamageChargesPage`](6-4-prices-damage-rates-damagechargespage.md) | LongLP | US-UC48, US-UC56 | 2026-10-23 |
| 7.1 | [TrekLink accounts](7-1-treklink-accounts.md) | LongNN | US-UC10 | 2026-10-23 |
| 7.2 | [Roles and permissions](7-2-roles-and-permissions.md) | LongNN | US-UC10 | 2026-10-23 |
| 7.3 | [Authentication events](7-3-authentication-events.md) | LongNN | US-UC58 | 2026-10-23 |
| 7.4 | [Parameters and audit log](7-4-parameters-and-audit-log.md) | LongNN | US-UC57, US-UC58 | 2026-10-23 |
| 8.1 | [Organization incident queue and `IncidentDetailPage`](8-1-organization-incident-queue-and-incidentdetailpage.md) | HoangTK | US-UC32, US-UC33, US-UC34 | 2026-10-23 |
| 8.2 | [`StaffIncidentsPage`](8-2-staffincidentspage.md) | HoangTK | US-UC29, US-UC31 | 2026-10-23 |
| 8.3 | [Authority reports](8-3-authority-reports.md) | HoangTK | US-UC35, US-UC37 | 2026-10-23 |
| 9.1 | [`LiveMapPage` for organizations and the fleet](9-1-livemappage-for-organizations-and-the-fleet.md) | LongNN | US-UC38, US-UC41 | 2026-10-23 |
| 9.2 | [Device telemetry history](9-2-device-telemetry-history.md) | LongNN | US-UC40 | 2026-10-23 |
| 9.3 | [`SystemHealthPage`](9-3-systemhealthpage.md) | LongNN | US-UC42 | 2026-10-23 |
| 9.4 | [Reports](9-4-reports.md) | LongNN | US-UC59 | 2026-10-23 |
<!-- assignments:end -->

## Template

```markdown
# <Page name> (`<route>`)

| | |
|---|---|
| Roles | <roles; what each sees> |
| Use case, FRs, story | UC-nn; FR-...; US-UCnn |
| Wireframe | ![<page>](<route-slug>.png) |

## Data
| Shown | Source (api-design file, property) |

## Actions
| Control | Endpoint | Confirmation | Success message |

## States
| State | What the user sees |
| Loading | |
| Empty | |
| Error `<CODE>` | MSGnn |
| Not found or forbidden | MSG26 |

## Form fields (if any)
| Step | Field | Type | Required | Rule |

## Mobile, accessibility, live data
- 360 px layout:
- Tab order and focus after each action:
- WebSocket events and invalidated query keys:
```
