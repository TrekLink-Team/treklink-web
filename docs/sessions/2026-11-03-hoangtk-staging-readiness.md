# HoangTK Week 9 staging readiness

Assignment: Friday Nov 6 staging demo, PRs by Wednesday Nov 4, workflow before Thursday.
Starting dev 0696befe. PR324 is merged and CI green. No overlapping incident PRs; Jira TK-142 is
assigned to HoangTK. No Jira completion claim or shared infrastructure change.

## Incident episode panel

Staff inline detail on /t/incidents now consumes the finalized API13 ordered array. New
entities/incident/episode.ts and IncidentHistory/IncidentEpisode.tsx use an incident/id/events key,
so existing incident.changed invalidation refetches the evidence. Server authorization/custody
scope remains authoritative; no device-history substitution or caller-selected window.
Screen8.2 requires text coordinates and Fleet map navigation to /t/map, not an embedded new map.
Rows keep server order and eventId keys; unavailable times/coordinates are labelled, timestamps
show the viewer zone with UTC on hover, and the list scrolls without truncating results.
Loading, empty and independent error/retry states are present.403 hides evidence;404 rechecks the
main record and the existing page clears inaccessible detail. API13 contract unchanged.

Final focused frontend22 tests pass, including17 Staff screen tests. New hook and widget
have100% lines/branches/functions coverage; Staff screen has100% lines and91.75% branches.
Full frontend108 files/1182 tests pass (262.31s); final focused rerun covers the added paging/report
regression and stable access-refetch callback. Rebased onto merged #343 at81cdd1b4 using a retained
recovery stash; final frontend lint/typecheck/build all exit0. A test-hook return value accidentally registered the API mock as a
cleanup callback; braces corrected that fixture defect, then access tests passed.

## Issue325

Tests-only PR343 follows the explicit ruling: p95 at most2000ms, every burst alert at most5000ms,
single alert unchanged at2000ms, with NFR-PERF-04 comment. Real socket/Postgres5/5 pass; backend
lint/boundaries/typecheck/build pass. The earlier2071.68ms CI failure is preserved. Existing five
samples mean nearest-rank p95 is still the maximum; the PR discloses this statistical limitation
instead of claiming the intermittent failure is eliminated. No production dispatcher change.
KhoaDD merged #343 after all CI passed and explicitly accepted the five-sample limitation; a larger
load is deferred unless the flake recurs. Integration81cdd1b4ceff3a2d662659498b80b389892f2612.

## Actual staging evidence and blocker

https://treklink-web.vercel.app responds200; /api/health returns database up, MQTT unknown,
version0.1.0. Four demo roles available. D-094 pins deployments, owned by KhoaDD; no deployment
commit is exposed by health and GitHub deployment list is empty. No promotion or secret change.
Authenticated Staff and Operator API13 reads pass; existing TL0009 episode has335 events, exceeding
the few-hundred reporting trigger of issue118. No cap/pagination was added.

Fresh TL0010 simulated-node rehearsal, preserving existing TL0009 episode:
SOS -> acknowledge -> RESPONDING -> status update -> RESOLVED, all HTTP success. Incident
c344e57a-94cf-4ff7-ac08-2f2cf9ac8897, code INC-2026-000003. Staff detail and API13 reads pass.
Only the newly created simulated node e35ef2e2-73f2-44a6-b195-00d00648e520 was stopped afterward.
No shared DB resets, migrations, time shifts or existing incidents modified.
Authenticated Chrome screenshot confirms Staff sees RESOLVED and the status update. The deployed
UI has no Episode evidence panel. Therefore full integrated staging MF03 is NOT passed: KhoaDD
must promote a reviewed dev containing the panel and provide/record its deployment SHA, then the
trail UI and workflow need verification there. Current asset index-F-LhHFca.js is a fingerprint,
not a verified commit. Screenshot/logs remain private under ignore/hoangtk/nov3-staging-*.

Daily Report deadline was already past12:00 ICT when this work began; do not backdate. Inspect
treklink-docs issue157 for duplicates before posting one factual HoangTK report. Credentials remain
private, unchanged. Both recovery stashes and unrelated backend/ignore/ are preserved.
