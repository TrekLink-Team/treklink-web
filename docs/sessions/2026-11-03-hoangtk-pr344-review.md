# PR344 review fixes

KhoaDD's review: https://github.com/TrekLink-Team/treklink-web/pull/344#pullrequestreview-5750268861.
Read every review and issue comment, REST inline comments and GraphQL review threads. No inline
comments/threads exist. The review says Freeze for two fixes; it is not approval or merge permission.

Both blockers addressed on feat/incident-episode-panel:
- Incident entity defines the six-kind EpisodeEventKind union, matching gateway-sync's wire kinds,
  and an exhaustive Record label map: Fall SOS, SOS button, Position, Telemetry, Text, Chat.
  Unknown kinds fall back to their wire value, including object-prototype names safely. The
  incident entity keeps its own type rather than importing another entity's runtime module.
- Scroll list has tabIndex0, a descriptive aria-label and the shared visible focus ring. All events
  remain in the list without a cap. The count suggestion is also implemented, with singular/plural.

Focused31 tests pass:14 episode tests and17 Staff screen tests. Changed production files100% lines,
branches and functions. Frontend lint/typecheck/build exit0. Full frontend108 files/1192 tests pass
(259.15s) before rebase; post-rebase focused/gates are recorded in the private handoff. Regression cases cover all six labels, unknown fallback,335 retained rows, count and
focusability; existing loading/empty/access/retry behavior remains covered.

Local Chrome rehearsal uses the actual React component and CSS with synthetic335-row data, not
staging. Tab focuses the list, End scrolls to25734px of26118px (viewport384px), computed outline is
solid2px. Axe scrollable-region-focusable has zero violations. Codex viewed the resulting PNG.
Initial private harness needed Vite's React preamble and an explicit browser context for axe;
those harness setup errors were corrected without production changes.

API13 contract, episode ordering/custody authorization and lifecycle/outbox behavior unchanged.
KhoaDD explicitly owns staging promotion and says he will record the SHA before Friday. Full
staging MF03 including the panel remains unverified until reviewed merge, promotion, deployed SHA
verification and a new integrated rehearsal, targeted before Thursday Nov5. Prior API-only
SOS-to-RESOLVED and Staff screenshot are historical partial evidence, not a full staging pass.
No deployment, Jira, duplicate Daily Report, secret/data reset or agent merge action.
