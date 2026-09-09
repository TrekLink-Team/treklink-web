# Implementation Tasks: auth

> Approved by: [lead/reviewer] · Branch: `features/Implementation_{Name}` · Design branch: `features/Design_{Name}`

## Phase 1: Foundation & Domain Modeling
- [ ] 1.1 Define entity/enum (Prisma, per D-001)
- [ ] 1.2 Write migration
- [ ] 1.3 Add DTOs + error codes

## Phase 2: Core Service / Mutation Logic
- [ ] 2.1 Implement service method with `class-validator` DTO input
- [ ] 2.2 Wrap multi-table writes in a transaction
- [ ] 2.3 Unit test success + failure paths (incl. every FSM transition, if applicable)

## Phase 3: Query / Retrieval
- [ ] 3.1 Implement paginated list/query endpoint
- [ ] 3.2 Unit test filter/sort/pagination boundaries

## Phase 4: API Presentation Layer
- [ ] 4.1 Controller + Guards (`JwtAuthGuard`, `PoliciesGuard`)
- [ ] 4.2 Swagger/OpenAPI annotations
- [ ] 4.3 Integration test matching `api-design/*.md` exactly (status codes + envelope shape)

## Phase 5: Frontend Integration (if applicable)
- [ ] 5.1 API client method + TypeScript types
- [ ] 5.2 Form (RHF+Zod) or view wired to TanStack Query / socketClient
- [ ] 5.3 Loading/empty/error states

## Phase 6: End-to-End Verification & DoD Audit
- [ ] 6.1 Full test suite green (`npm test`)
- [ ] 6.2 Lint + typecheck clean (`npm run lint && npm run typecheck`)
- [ ] 6.3 `specs/{module}/api-design/*.md` matches actual behavior
- [ ] 6.4 Session ledger (`docs/sessions/current.md`) updated
