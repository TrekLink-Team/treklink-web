# Requirements Specification: rentals

**User Story**: As a [role: Admin/Staff/Guide/Customer], I want to [action], so that [business benefit].
**Story ID**: [e.g. US-101] | **Story Points**: [1/2/3/5/8/13] | **Priority**: [High/Medium/Low] | **Sprint/Milestone**: [e.g. Sprint 2]

---

## 1. Domain Context & Scope
- **In-Scope**: [explicit boundaries]
- **Out-of-Scope**: [deferred capabilities — cross-check against `00-project-context/01-project-charter.md` §2 "Out of scope"]
- **Depends on**: [other modules/specs this requires to exist first — e.g. gateway-sync depends on the eventId schema being frozen]

---

## 2. EARS Functional Criteria

### Ubiquitous (always active)
- **REQ-UBI-01**: The system SHALL [always-true behavior, e.g. record UTC `createdAt`/`updatedAt` on every entity].

### Event-Driven (triggered by an action)
- **REQ-EVT-01**: WHEN [trigger], the system SHALL [response].

### State-Driven (context-dependent)
- **REQ-STA-01**: WHILE [state], the system SHALL [response].

### Unwanted Behavior / Error Cases
- **REQ-ERR-01**: IF [condition/error], THEN the system SHALL [response, incl. HTTP status + error code].

### Optional Features
- **REQ-OPT-01**: WHERE [feature/flag], the system SHALL [response].

---

## 3. Non-Functional Requirements (if this module has its own — otherwise reference the charter's §5 table)
- [Latency / reliability / security constraint specific to this module]

---

## 4. Acceptance Criteria (for the linked GitHub Issue / backlog row)
- AC-01: …
- AC-02: …

---

## 5. Open Questions (must be answered before Phase 2 design — see `01-conventions/02-spec-driven-development-workflow.md`)
- [ ] Question 1
- [ ] Question 2
