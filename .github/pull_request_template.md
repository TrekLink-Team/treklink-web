<!--
TrekLink, single PR template (Conventions v2).
Title format: type(TK-nn): short imperative description
Base branch: dev  (only the leader opens dev -> main)

The Design DoD block is OPTIONAL, fill it only if this branch introduced or changed a spec.
-->

## Summary

<!-- What changed and why, in 2-5 bullets. Written for the reviewer, not for git. -->

-

**Jira**: TK-
**Backlog story**: US-
**Module**: `module:`

---

## AI Disclosure (mandatory)

> Required by `01-conventions/11-ai-first-doctrine-and-toolchain.md` §2.4. Self-declared,
> this is a guideline and a review prior, not an enforcement mechanism.

* **Model used**: <!-- e.g. Claude Opus 5 / Claude Sonnet 5 / GPT-6 Astra / hand-written -->
* [ ] If a restricted model (any Gemini, or any model outside the approved list) touched this
      code, I have said so above and explained why below.

---

## Definition of Done

* [ ] Satisfies the EARS acceptance criteria in `specs/{module}/requirements.md`
* [ ] **Unit tests written and passing locally**, `npm test` green before this PR was opened
* [ ] Lint + typecheck pass with 0 errors
* [ ] Module boundaries respected, no direct cross-module repository/entity access
* [ ] Response envelope `{ result, isSuccess, statusCode, message }` on every new/changed endpoint
* [ ] `specs/{module}/api-design/*.md` updated **in this same PR** if any endpoint changed
* [ ] No secrets, `.env` values, debug logs, dead code, or unresolved `TODO`s
* [ ] Rebased cleanly on `origin/dev`
* [ ] Jira card moved to `IN REVIEW`

<details>
<summary><b>Design DoD</b>, only if this branch introduced or changed a spec (optional)</summary>

* [ ] `requirements.md` in EARS syntax; every clarification-interview edge case captured
* [ ] `design.md` has the domain model, sequence diagram(s), and a Mermaid `stateDiagram-v2` for any FSM
* [ ] Every new/changed endpoint has an `api-design/*.md` from `02-templates/04-api-endpoint-template.md`
* [ ] `tasks.md` phased checklist written
* [ ] No conflict with `00-project-context/03-decisions-and-risk-register.md`; any new OPEN decision logged there
* [ ] Mermaid renders correctly in GitHub preview (not just locally)

</details>

---

## Test Evidence

> A feature with no tests is not done. Paste real output, not "tests pass".

```
<!-- npm test output, or the relevant excerpt -->
```

* **Unit**: [n passed / 0 failed]
* **Integration**: [n passed / 0 failed]
* **Manual**: [Swagger / Postman / UI, per `specs/{module}/api-design/00-api-testing-guide.md`]

---

## Reviewer Checklist

> Reviewer: `gh pr checkout {N} && npm ci && npm test`. **Run the tests yourself.**
> Reading the diff in the browser is not a review.

* [ ] I pulled the branch and ran the test suite locally
* [ ] PR title follows `type(TK-nn): description`
* [ ] Auth guard **and** role/CASL policy on every mutating endpoint
* [ ] Error handling uses centralized error codes, not ad-hoc strings
* [ ] No N+1 queries; indexes match the idempotency/uniqueness requirements
* [ ] Tests are meaningful, not written to pass
* [ ] Git history is clean and readable

**Decision**: `[APPROVED]` · `[CHANGES REQUESTED]` · `[NEEDS FIXES]`

---

## Merge Plan

* [ ] Single commit → **Rebase and merge** · Multiple commits → **Squash and merge**
* [ ] "Create a merge commit" is **prohibited**
* [ ] Delete source branch after merge (except `dev` → `main`)
* [ ] **Announce the merge in Zalo** so everyone pulls and rebases

---

## Related

* Resolves: #
* Jira: https://treklink-capstone.atlassian.net/browse/TK-
* Depends on: <!-- stacked PR, if any -->
