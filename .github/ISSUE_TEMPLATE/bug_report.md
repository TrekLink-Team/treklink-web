---
name: Bug Report
about: A standalone defect. Fast path — this never enters Jira unless it escalates.
title: "[Bug] "
labels: "type:bug"
assignees: ""
---

<!--
WHERE DOES THIS BUG BELONG? See 01-conventions/10-jira-tracking-and-workflow.md §5.

  Found while REVIEWING an active story?  -> Jira status BUG on that card. Not here.
  Standalone, fix is < half a day?        -> HERE. Cleared via a fix/ branch + PR.
  Fix is > half a day, or changes a spec? -> Escalate to a Jira `Bug` work item.

If in doubt, file it here. Escalating later is cheap; a lost defect is not.
-->

## Module
<!-- module:auth | module:devices | module:rentals | module:trips | module:gateway-sync |
     module:incidents | module:monitoring | module:billing | module:frontend | module:devops -->

## Severity
<!-- Critical (security / data corruption / broken build) | Medium | Low -->

## Steps to Reproduce
1.
2.
3.

## Expected Behavior


## Actual Behavior


## Evidence
<!-- Exact log output, stack trace, failing test name, or screenshot.
     Attach what you actually observed. Do not speculate about the cause here. -->

## Environment
- Repo / branch / commit:
- Component: [gateway / backend / frontend / firmware-interaction / docs]

## Escalation check
- [ ] Fix is estimated at **more than half a day**, or it **changes a spec**
      → if checked, create a Jira `Bug` work item and link it below.

**Jira (only if escalated)**: TK-
