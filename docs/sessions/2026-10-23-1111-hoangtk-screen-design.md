# HoangTK incident screen designs, 2026-10-23

## Scope and starting state

- The member confirmed the study phase complete and authorized frontend screen tasks 8.1, 8.2 and 8.3.
- Deliver three Markdown designs and three matching SVG wireframes. No production code, commit, push or pull request is authorized.
- Fetched both remotes. Created `docs/ui-design-hoangtk` from web `origin/dev` at `5a1f030`; the starting web tree was clean.
- Fast-forwarded the clean docs `dev` checkout to `fc2a00d`. D-056, D-057 and D-058 are included.
- Sources: the 2026-10-21 meeting handoff; frontend requirements, design and tasks; incidents requirements, design and API 01 to 14; the monitoring live contract; auth 04; rentals 02 and 03; SRS use cases, FRs and messages; chapter 06 sections 7 and 8.
- No session dated October 22 or 23 was found in the existing tracked or personal session folders during discovery.

## Review notes for KhoaDD

The leader owns contract changes under D-052. Carry these notes into the eventual PR description.

| ID | Evidence | Design treatment and requested ruling |
|---|---|---|
| H-01 | Incidents API 01 and 11 expose pagination and filters, but no sort parameter. Chapter 06 section 8 item 4 requires sortable tables. | Preserve server order and pagination. Do not invent a sort query or sort one page as though it were the full result. Confirm a server sort contract or approve this exception. |
| H-02 | Incidents API 02 returns empty `statusUpdates` and `authorityReports` samples without nested schemas. API 05 defines the newly saved status note, but not the GET collection. | Show collection empty states; cite the intended collections. Confirm non-empty shapes before implementing their nested rows. Staff reports use the fully specified API 11 list. |
| H-03 | API 08 returns an incident, not the newly created authority report ID. API 11 has no incident or contract filter. | Reload the report list after creation. Page through it; do not treat an empty current page as proof that the subject has no report. Request subject filters or the created report ID for direct selection. |
| H-04 | API 03 accepts `expectedVersion`, but neither its failure table nor `ALREADY_OWNED` defines a structured winner/version payload. `incident.alert` carries no version. | Fetch API 02 after the one-tap banner action, then submit API 03. Show MSG27 for a losing acknowledgement and refetch the owner. Do not add a second confirmation or retry the mutation automatically. Confirm stale-version error coverage for acknowledge. |
| H-05 | API 08 forbids future `reportedAt`; API 10 and 09 do not specify temporal bounds for `reportedAt` and `closedAt`. String limits are absent from these contracts. | Enforce documented types and required fields only, plus the explicit API 08 future bound. Ask the leader to define other limits; do not invent them in the client. |
| H-06 | API 09 states that closing a report transitions a `REPORTED` incident, but an organization may acknowledge a `REPORTED` incident. No failure is specified for closing a report linked to a now-`ACKNOWLEDGED` incident. | Recheck incident state before opening its close form. Offer incident closure only while `REPORTED`; contract reports record closure only. The leader must confirm behavior after an organization resumes ownership. |

## Delivery state

- Completed frontend `ui-design/8-1-organization-incident-queue-and-incidentdetailpage.md`, `8-2-staffincidentspage.md` and `8-3-authority-reports.md`, each with a matching SVG and `Ready for review` status.
- Each design maps data, actions, forms, permissions, error codes, messages, responsive behavior, keyboard/focus behavior, live events and query invalidation to approved contracts. Unresolved contract questions stay in the checklists and this review record.
- The organization wireframe draws both queue and detail at exactly 360 px. Staff and authority-report boards also include mobile layouts. All three include desktop views and action/recovery states.
- Updated no production code, generated API sources, requirements, route tables or backlog. Frontend task checkboxes remain open because the pages are not implemented.
- No files were staged, committed or pushed; no pull request was opened. Reviewers remain KhoaDD and LongNN under the meeting handoff.
- The meeting guide calls 2026-10-23 Thursday; the actual weekday is Friday. The numeric deadline was retained; the meeting source was not edited.

## Verification

- `git diff --check`: passed.
- Project `check_prose.py` on the three designs and this record: passed.
- All 52 local Markdown links in the designs resolve to files.
- Every documented error code from the incident endpoints used by each design appears in its error handling.
- Three SVGs parse as XML, include title/description alternatives, contain exact 360 px frames, and rasterize with the bundled Sharp runtime. Text bounds fit the image canvases.
- Inspected all rendered boards. Corrected the organization banner's crowded copy and the mobile queue card boundary, then rendered again and inspected the revised board.
- Selected text color pairs pass 4.5:1: white on brand green 5.02:1; muted slate on white 7.58:1; red alert text 7.60:1; amber alert text 6.84:1; white shell text 12.22:1. This checks the wireframe palette, not a running application's accessibility.
- Human audit: no phrase violations and no structure flags. Soft silhouette/readability flags were reviewed. The fixed handoff template explains repeated headings; API names and identifiers explain repetition/reading level. Short-unit flags occur in table cells, FR/story lists and a semicolon-separated source list; those literal references and concise table values are protected. No prose rewrite was justified by these metrics.
- Private generation, audit tools, PNG previews and JSON reports are in `ignore/HoangTK/screen-design/`; they are excluded from Git. They use existing runtimes and add no project dependency.
- Application tests and a browser accessibility audit were not run because this task changes design documents and SVGs only.

## Next action

HoangTK reviews the three designs and can explain their fields and lifecycle guards. KhoaDD rules on H-01 to H-06; LongNN checks shell, shared components and cross-screen consistency. If authorized later, create one sealed design commit or commits and one PR from `docs/ui-design-hoangtk` to `dev`, carrying the six review notes. Implementation remains a separate phase.

## Review and submission continuation

The member subsequently said "carry out" in response to the review-and-PR sequence. That authorizes the local review, supported corrections, sealed commit, branch push and one PR to `dev`. It does not authorize merging, production implementation, or substituting an agent's opinion for KhoaDD's approval.

The initial review notes above remain as the investigation record. The dispositions below supersede their initial requested actions:

| Note | Current disposition | Evidence and action |
|---|---|---|
| H-01 | Awaiting KhoaDD | Keep server order/pagination. Request a documented sorting contract or a checklist exception; no new query parameter. |
| H-02 | Awaiting KhoaDD | Request explicit non-empty `statusUpdates[]` and `authorityReports[]` shapes for API 02. No nested fields are invented. |
| H-03 | Clarified, non-blocking | API 11 already supplies paged report rows. Refresh and select an actual row after saving; returning the created report ID or adding subject filters is an optional API improvement, not a design prerequisite. |
| H-04 | Bounded by existing contract | Use detail GET for the version and the server message for MSG27. The documented errors are supported without structured winner fields. Ask the reviewer to confirm whether acknowledge needs a documented `STALE_VERSION` response; do not add it to the endpoint or promise it in the UI. |
| H-05 | Bounded by existing contract | Required/type rules and API 08's explicit future-time bound are the current client rules. Any additional text or time limits need a leader-owned contract change; they do not prevent reviewing this layout. |
| H-06 | Resolved in local review | API 09's activity diagram, and `scripts/specs/endpoints/incidents.py` close-case `steps`, first set `caseClosedAt` and conditionally close only a `REPORTED` incident. Removed the draft's unsupported UI restriction. Report closure stays available after organization acknowledgement while that response keeps its state. |

Local design critique also corrected two visual details: the authority report mobile card now includes its reported time, and internal H-02 references were removed from the organization screen's evidence labels. The Markdown still records that contract gap for reviewers.

The authenticated GitHub account is `wangf28`, matching HoangTK in `.github/schedule.yml`; configured Git author also uses `wangf28`. Reviewer handles are `ruskicoder` (KhoaDD) and `NgocLong216` (LongNN). No pre-existing PR for this design branch was found during the submission check.

Pre-publication checkpoint: the approved diff is the three design Markdown files, their three SVGs and this session record. Local checks pass again after review corrections. The branch matches the fetched `origin/dev` base. Installed the repository's Checksum hook and bound its Python runner to the bundled Windows interpreter; the cryptographic implementation is unchanged. The declaration is GPT-6, SD, using only HoangTK's key whose registered login matches `wangf28`. Private PR body and verification artifacts remain ignored. The submission will request review rather than merge or implement the designs.
