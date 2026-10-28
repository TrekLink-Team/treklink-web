# `RegisterPage` (`/register`)

| | |
|---|---|
| Owner | LongLP (reassigned from TanNB 2026-10-27, issue #98) |
| Task | `specs/frontend/tasks.md` 3.1 |
| Assigned, due | 2026-10-21, 2026-10-23 |
| Status | Ready for review |
| Routes | `/register`, public, linked from sign-in; after success the page shows the confirmation in place (`specs/frontend/design.md` §2) |
| Roles | Guest: the form. A signed-in account sees the same public form. |
| Use case, FRs, story | UC-01; FR-ORG-01; US-UC01 |
| Requirements | `specs/organizations/requirements.md` REQ-EVT-01, REQ-ERR-01 |
| Wireframe | None drawn. The built screen was walked in a browser on local PGlite on 2026-10-28 (ORG-0002 registered). |

Scope from the task: organizations api-design 01; MSG04 on success; MSG10 on a duplicate

## Data

| Shown | Source (api-design file, property) |
|---|---|
| The new organization code after success | organizations 01 `result.code` |

## Actions

| Control | Endpoint | Confirmation | Success message |
|---|---|---|---|
| Register | organizations 01 `POST /api/organizations/register` | none | MSG04 "Registration received. Visit the TrekLink counter or call us to verify your organization.", with the code and the note that the Manager receives an email to set a password |
| Already registered? Sign in | none, link to `/sign-in` | none | none |

## States

| State | What the user sees |
|---|---|
| Sending | Register shows its loading state and is disabled |
| Empty required field | "{Label} is required." under each empty field; nothing is sent |
| Error `VALIDATION_FAILED` | the server's message under the field it names |
| Error `CONFLICT_UNIQUE` | MSG10, the server's message, as an error Alert above the fields |
| Any other failure | the server's message, or "Something went wrong.", as an error Alert |
| Success | the form is replaced by a card with MSG04 as a success Alert and the organization code |

## Form fields (if any)

| Step | Field | Type | Required | Rule |
|---|---|---|---|---|
| 1 | Registered company name | text | yes | not blank |
| 1 | Tax code | text | yes | hint "10 or 13 digits."; trimmed; the server checks the format and uniqueness |
| 1 | Registered address | text | yes | not blank |
| 1 | Company phone | tel | yes | not blank |
| 1 | Manager full name | text | yes | not blank |
| 1 | Manager email | email | yes | hint "Becomes the sign-in."; trimmed; unique (MSG10) |
| 1 | Manager phone | tel | yes | not blank |

## Mobile, accessibility, live data

- 360 px layout: one column, the card fills the width with the 16 px gutter; Register spans the card.
- Tab order and focus after each action: fields in the order above, then Register, then the sign-in link. A field error is linked to its input (`aria-describedby`) and announced; the confirmation is a status Alert.
- WebSocket events and invalidated query keys: none; the page is public and holds no cached query.

## Checklist

Chapter 06 §7 (Screen Design Checklist) and §8 (UI and UX practices), ticked by the owner before review.

- [x] Built on the `shared/ui` components (Card, Field, Input, Alert, Button), token classes only, both themes
- [x] Required marks on every field, errors under the field, one primary action
- [x] Component-tested: required fields, MSG04 with the code (`OnboardingPages.test.tsx`)
