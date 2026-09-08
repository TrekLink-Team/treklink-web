<!--
Filename: implementation.md — for PRs from features/Implementation_{Name} into develop.
Force this template: append ?expand=1&template=implementation.md to the PR compare URL.
-->

## Definition of Done (DoD)
* [ ] Feature satisfies all EARS criteria in `specs/{module}/requirements.md`
* [ ] Module boundaries respected — no direct cross-module repository/entity access (see `docs/01-conventions/04-architecture-conventions.md` §1.1)
* [ ] Response envelope matches the standard (`result`/`isSuccess`/`statusCode`/`message`) on every new/changed endpoint
* [ ] Unit and integration tests written and passing (100% pass rate)
* [ ] No sensitive data, hardcoded secrets, or `.env` values committed
* [ ] `specs/{module}/api-design/*.md` updated in this same PR if any endpoint changed
* [ ] Rebased cleanly on `origin/develop`
* [ ] Lint + typecheck pass with 0 errors
* [ ] CI pipeline green

---

## Review Checklist
* [ ] PR is linked to a GitHub Issue (Story/Task)
* [ ] PR title follows the tag convention (`[Feature]`, `[Fix]`, `[Refactor]`, `[Test]`, `[Spec]`, `[Security]`, `[Perf]`, `[Docs]`, `[Chore]`)
* [ ] Code is modular; no cross-module coupling beyond exported services
* [ ] Auth guard **and** role/CASL policy present on every mutating endpoint
* [ ] Error handling uses centralized error codes, not ad-hoc strings
* [ ] Database queries avoid N+1 issues; unique constraints match idempotency/uniqueness requirements
* [ ] No debug logs, commented-out code, or unresolved `TODO`s

---

## Test Coverage
* **Unit tests**: [e.g. 24 passed / 0 failed]
* **Integration tests**: [e.g. 6 passed / 0 failed]
* **Manual verification**: [Swagger UI / Postman, per `specs/{module}/api-design/00-api-testing-guide.md`]

---

## Change Description
* [Bullet-point summary of what changed and why]

---

## Related Tasks / Issues
* Resolves: #[IssueNumber]
* Design branch (if applicable): `features/Design_{Name}` — PR #[Number]
