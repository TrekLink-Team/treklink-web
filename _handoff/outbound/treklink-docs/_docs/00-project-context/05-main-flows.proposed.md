# Proposed edits: `_docs/00-project-context/05-main-flows.md`

> From the `treklink-web` cloud session, 2026-09-25, REQUEST C-004. Apply only after the matching C-003 answers; each item names its question.

1. **MF-01 postcondition and step 7, "trip in `Scheduled`".** Q66's trip states contain no `Scheduled`. `specs/trips/design.md` reads it as `READY` ("On Start"). Replace `Scheduled` with `READY` in the postcondition and step 7 once confirmed.
2. **MF-01 ordering of "Reserve device".** The swimlane places `c3 Reserve device` after Staff confirmation (`c4 --> c3`); the main-path text (step 3) and E01-1 place it before confirmation. `specs/rentals/` follows the text and E01-1. Redraw the swimlane edge as `s2 --> c3 --> s3 --> t1` so the figure and the text agree.
3. **MF-02 E02-6.** Add: "The gateway flush orders by queue sequence and priority. The backend orders display, trails and episode correlation by the event's own timestamp when it is valid, because stock firmware drains a queued backlog one entry per reconnect (O-001)." This reconciles E02-6 with O-001 fact 3.
4. **MF-03 exception scenarios.** Add E03-8: "A fall auto-SOS, or an SOS raised before the first GPS fix, sends no beacons, so losing its single text frame loses the episode; cadence detection cannot fire. Mitigated by the firmware fixes of `onboard-queue` Phase 9." (O-001 fact 1.)
5. **MF-05 E05-3.** Align with the BR-22 decision (see the `06-requirements-foundation` proposal §4).
6. **Configurable parameters** lists: add the parameter keys each module registered (`rentals.customerHoldMinutes`, `billing.lateGraceHours`, `incidents.episodeWindowSeconds`, `monitoring.deviceStaleSeconds`, and the rest), so the Configuration Matrix and the flows name the same keys.
