# AI Agent Rules & Steering Directives — TrekLink

All AI coding assistants (Claude Code, Cursor, Copilot, Antigravity) working within this repository MUST strictly follow the conventions and quality gates established in [`treklink-docs`](../treklink-docs):

1. **AI Agent Steering & Thinking Discipline**:
   [`../treklink-docs/_docs/01-conventions/08-ai-agent-steering-and-discipline.md`](../treklink-docs/_docs/01-conventions/08-ai-agent-steering-and-discipline.md)
   - Read-before-write: never edit unread code.
   - Blast radius assessment for migrations and cross-module changes.
   - Epistemic reality anchor: categorize context (Known, Inferred, Unknown).
   - Minimal sufficient change.

2. **Git & GitHub Conventions**:
   [`../treklink-docs/_docs/01-conventions/07-github-workflow-git-conventions.md`](../treklink-docs/_docs/01-conventions/07-github-workflow-git-conventions.md)
   - Active integration branch is `dev` (standardized across repositories).
   - Mandatory bracket-tag commit convention (`[Feature]`, `[Fix]`, `[Refactor]`, `[Test]`, `[Spec]`, `[Chore]`).
   - PR templates required for design and implementation branches.

3. **Living SSOT & Spec-Driven Development**:
   [`../treklink-docs/_docs/01-conventions/02-spec-driven-development-workflow.md`](../treklink-docs/_docs/01-conventions/02-spec-driven-development-workflow.md)
   - No production code without approved specs in `specs/{module}/`: `requirements.md` (EARS) → `design.md` → `tasks.md` → `api-design/*.md`.

4. **Architecture & Contracts**:
   - Backend: NestJS modular monolith with strict module isolation ([`../treklink-docs/_docs/01-conventions/04-architecture-conventions.md`](../treklink-docs/_docs/01-conventions/04-architecture-conventions.md)).
   - Non-negotiable response envelope: `{ "result": ..., "isSuccess": bool, "statusCode": int, "message": string }` ([`../treklink-docs/_docs/01-conventions/05-backend-conventions.md`](../treklink-docs/_docs/01-conventions/05-backend-conventions.md)).
   - ORM: Prisma ORM ([`backend/prisma/schema.prisma`](backend/prisma/schema.prisma)).
   - Frontend: Feature-Sliced Design (FSD), Tailwind CSS, Leaflet.js, TanStack Query ([`../treklink-docs/_docs/01-conventions/06-frontend-conventions.md`](../treklink-docs/_docs/01-conventions/06-frontend-conventions.md)).
   - Developer scratchpad: `/ignore/` folder is gitignored for all personal notes and agent intermediate artifacts.
