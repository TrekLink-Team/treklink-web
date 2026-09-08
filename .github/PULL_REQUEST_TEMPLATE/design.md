<!--
Filename: design.md — for PRs from features/Design_{Name} into develop.
Force this template: append ?expand=1&template=design.md to the PR compare URL.
-->

## Definition of Done (DoD)
* [ ] `requirements.md` written in EARS syntax, all edge cases from the clarification interview captured
* [ ] `design.md` includes domain model, sequence diagram(s), and (if applicable) a Mermaid state diagram
* [ ] Every new/changed endpoint has an `api-design/*.md` file using `docs/02-templates/04-api-endpoint-template.md`, response envelope included
* [ ] `tasks.md` phased checklist written and reviewed
* [ ] Design reviewed and approved (by lead, or supervisor for Review 1/2-relevant modules)
* [ ] No conflicts with `docs/00-project-context/03-decisions-and-risk-register.md` — any new OPEN decision this design surfaces is logged there

---

## Review Checklist
* [ ] Naming/structure consistent with `docs/01-conventions/02-spec-driven-development-workflow.md` §2 directory layout
* [ ] Cross-module dependencies explicitly listed (which other modules' exported services this design will call)
* [ ] API contracts include full request/response samples and the failure-case table
* [ ] Mermaid diagrams render correctly (checked in GitHub preview, not just locally)
* [ ] No missing states in any FSM shown (all 7 device states / 5 incident states accounted for, if relevant)

---

## Change Description
* [What this design covers, and what it deliberately defers]

---

## Attachments / Links
* Related requirements: `specs/{module}/requirements.md`
* Figma (frontend design branches only): [link]

---

## Related Tasks / Issues
* Issue: #[IssueNumber]
* Sibling implementation branch (once started): `features/Implementation_{Name}`
