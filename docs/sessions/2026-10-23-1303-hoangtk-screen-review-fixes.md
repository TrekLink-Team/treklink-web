# HoangTK screen design review follow-up, 2026-10-23

## Approved scope

- The member confirmed the leader reviewed and merged PR #45 and asked to continue.
- PR #45 was approved and merged at `e8b52c9`. The approval explicitly assigns the screen updates to a follow-up PR, rather than holding the original design merge.
- Read the leader's review and D-059 rule 7 in docs `61a1270`; verified the applied contracts in merged web PR #46, now on `dev`.
- Created `docs/ui-design-hoangtk-review-fixes` from web `dev` at `e8b52c9`. Both repository working trees were clean before the follow-up. No runtime implementation or leader-owned spec rewrite is part of this change.

## Review findings applied

| Review item | Verified source | Screen change |
|---|---|---|
| H-01 | Incidents API 01 overview: `tierDeadlineAt` ascending, nulls last, then newest `firstEventAt`; API 11 overview: open cases first, then newest `reportedAt`. No sort parameter in either endpoint. | Tasks 8.1, 8.2 and 8.3 name their exact server order and close the old sorting checklist items under D-059 rule 7. Wireframes identify the order without adding a control. |
| H-02 | API 02 overview and non-empty response samples: `statusUpdates[]` with `id`, `note`, `author {id, fullName}`, `createdAt`; `authorityReports[]` with `id`, `agency`, `reference`, `reportedAt`, `caseClosedAt`; both newest first. | Task 8.1 specifies both lists, including status author, empty states, mobile cards and read-only report status. The desktop wireframe shows both non-empty collections; mobile uses disclosures. Organization roles never need API 11. |
| H-04 | API 03 overview and validation table: 409 `STALE_VERSION` maps to MSG36; `ALREADY_OWNED` is checked first and maps to MSG27. | Task 8.1 now cites API 03 for the stale-version case and preserves owner-before-version error precedence. One-tap acknowledgement remains one step. |
| GitHub links | The leader noted that links outside the repository resolve locally but fail in GitHub. | Removed cross-repository Markdown links from all three designs. The SRS and decision register are named sources; repository-internal API, image and session links remain clickable. |

The earlier session record preserves the original investigation. This follow-up supersedes its pending H-01, H-02 and H-04 dispositions. H-03, H-05 and H-06 retain the behavior the leader confirmed in the review. No unresolved decision from these six notes blocks the screen designs after this follow-up is approved.

## Verification and handoff

- `git diff --check` and the project's prose checker pass.
- All 48 remaining Markdown links resolve inside `treklink-web`; no design link escapes the repository root. The four cross-repository links were replaced with named sources.
- The artifact check covers every documented incident error code used by each screen, the approved nested row fields, both incident order columns, owner-before-version acknowledgement precedence and removal of superseded review holds.
- All three SVGs parse with title/description alternatives and 360 px frames. They render through the existing Sharp runtime; text fits the canvas. Inspected the desktop and mobile boards, including the newly expanded author/status and authority-report rows.
- Selected wireframe palette pairs retain a minimum measured contrast of 5.02:1. This is an artifact check, not a runtime accessibility audit.
- The human phrase scan reports no violations. The structure pass has no flags. Readability and silhouette metrics remain advisory for the required template, literal API references and table cells; those references are preserved.
- Runtime tests and application lint/typecheck were not run locally because this change is Markdown and SVG only. Existing CI will validate the submitted commit.
- Private generation, verification, PNG previews and audit JSON remain in the ignored personal folder. No project dependency or generated API file changed.

The follow-up will be committed through HoangTK's Checksum hook with the RV stage and submitted to `dev` for review. It carries only the three designs, their three SVGs and this session record. No merge or production implementation is part of this submission.
