# HoangTK lifecycle review fixes, 2026-10-24

## Approved scope

- The user authorized addressing KhoaDD's requested changes on PR 66.
- Blocking finding: a stale-limit escalation keeps the silent owner, and the original ownership guard rejects a different member acknowledging ESCALATED or REPORTED. REQ-EVT-05 permits that acknowledgement and replacement of the owner; REQ-EVT-07 requires retaining the owner during escalation itself.
- Add unit and Postgres takeover regressions, preserve concurrent acknowledgement loser precedence, remove the raw UUID from the lifecycle error message, and document domain-event enrichment and defensive CAS handling.
- Rebased the single PR commit onto current dev `f3c41bd`. Resolved the error-enum conflict by retaining both the merged auth codes and the incident codes. The rebased original commit `cb4494a` retains a valid HoangTK CO seal. The original published head is `b9a16b5a1f24fe9f3596225cd437e1498e00bdf4`.
- No diagram or source specification section is edited in this review fix, so the new D-067 diagram gate has no artifact to inspect here. No migration, dependency addition or endpoint change is part of this scope.

## Follow-up boundaries

- MSG27 display-name and acknowledgement-time enrichment belongs to the acknowledgement service in incidents task 4.1. The lifecycle must not expose a raw owner UUID in the banner message. The generic domain error retains ALREADY_OWNED; task 4.1 supplies the display text through the owning account service.
- incident.changed carries routing and owner IDs inside the process. Monitoring 1.1 enriches it to the client payload of its ws-live-contract: code, ownerName, lastPosition and stale, plus state and tier. This patch documents that boundary; it adds no cross-module table access.
- The row lock serializes normal writers. The CAS-failure branch remains defensive; a concurrent acknowledgement loser reads the winning owner when its lock wait completes.

## Reproduction and fix

- Added takeover regressions for ESCALATED and REPORTED. Both failed against the original guard with `DomainException: Account silent-operator already owns this incident.`
- Limited the ALREADY_OWNED guard to ACKNOWLEDGED and RESPONDING. Acknowledgement from ESCALATED/REPORTED now reaches the existing state/version and actor checks and replaces the owner through the same CAS path.
- Added stale-version takeover cases and extended concurrent-loser precedence to RESPONDING. The message assertion requires generic text without a raw account identifier.
- Added Postgres stale-escalation/Manager-takeover cases from both ACKNOWLEDGED and RESPONDING, and expanded concurrent acknowledgement races to ESCALATED and REPORTED with a retained owner.
- Added source comments for the in-process event enrichment boundary and defensive CAS branch. No WebSocket payload or endpoint changed.

## Verification

- Focused incident suite: 211 tests passed, 100% line/function coverage and 98.8% branch coverage across incident implementation. Lifecycle branch coverage is 98.56%.
- Full backend: 49 unit suites, 600 tests passed; seven HTTP/replay e2e suites, 44 tests passed. Backend lint and the acyclic module-boundary check passed, along with TypeScript and the Nest build.
- Database suite: two suites, 32 tests passed, including all 28 incident cases. Tests cover actual stale escalation from both owned states followed by another Manager acknowledging, plus races from NOTIFY_PRIMARY, ESCALATED and REPORTED.
- Existing migrations were applied only to a new disposable local Postgres 16 database, using explicit URLs. No migration or seed operation targeted Neon or the application's configured database.
- Formatting, whitespace and prose checks passed; task coverage reports zero gaps. Existing MQTT/health error logs are expected failure-path test output. The lockfile install retains the earlier frontend engine warnings on local Node 22.15.1; backend validation succeeded.
- The original and review-fix commits will be audited and published on PR 66. Because its single original commit was rebased, publication uses a lease pinned to the verified original remote head, so another contributor's update cannot be overwritten.
