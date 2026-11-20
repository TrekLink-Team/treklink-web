# TK-219 billing unit coverage

- Date: 2026-11-20, Asia/Saigon.
- Base: dev, 551186a79123acb91aacd479a25a2803c805e5ff.
- Delivery branch: test/billing-unit-coverage. Push only; no pull request or merge.
- Scope: 11 billing test files, plus this evidence record. Production code and specs/ have no final changes.
- Baseline: 26 suites, 297 tests. Final: 30 suites, 434 tests. Added: 137 tests.
- Overall lines: 90.12% to 99.32%. Branches: 79.33% to 92.27%.

## Coverage method

The requested command was run first from backend/:

```sh
npx jest --runInBand --coverage --collectCoverageFrom='src/modules/billing/**/*.ts' src/modules/billing
```

The initial attempt hit stale Prisma types and missing dependencies in the checkout. Dependency installation, Prisma generation and the bcrypt native rebuild resolved these local setup issues without tracked dependency changes. The exact command was rerun successfully after setup, but reports zero covered files because backend/package.json sets Jest rootDir to src. Both comparable measurements use the corrected glob relative to that root:

```sh
npx jest --runInBand --coverage --collectCoverageFrom='modules/billing/**/*.ts' src/modules/billing
```

All 15 initially deficient files now exceed 80% lines and branches. Asterisks mark files initially below 80% in either metric. Percentages come from Istanbul, without rounding up.

| File under backend/src/modules/billing/ | Lines before | Lines after | Branches before | Branches after |
| --- | ---: | ---: | ---: | ---: |
| balance.service.ts | 100 | 100 | 94.23 | 94.23 |
| billing-reads.service.ts | 91.66 | 91.66 | 85 | 85 |
| billing.module.ts | 100 | 100 | 100 | 100 |
| charges.service.ts * | 90.29 | 100 | 76.36 | 89.09 |
| damage-charge.service.ts | 100 | 100 | 80.95 | 80.95 |
| damage-charges.controller.ts | 100 | 100 | 100 | 100 |
| damage-charges.repository.ts * | 100 | 100 | 33.33 | 100 |
| dto/billing-queries.dto.ts * | 93.02 | 100 | 16.66 | 100 |
| dto/damage-charges.dto.ts * | 100 | 100 | 50 | 100 |
| dto/pricing-admin.dto.ts * | 100 | 100 | 50 | 100 |
| dto/quote.dto.ts | 87.5 | 100 | 100 | 100 |
| dto/service-credits.dto.ts * | 88.88 | 100 | 0 | 100 |
| index.ts | 100 | 100 | 100 | 100 |
| invoices.controller.ts * | 60.46 | 100 | 81.81 | 100 |
| invoices.repository.ts * | 84.7 | 98.82 | 76.78 | 91.07 |
| invoices.service.ts | 95.23 | 100 | 91.66 | 91.66 |
| money.ts | 100 | 100 | 100 | 100 |
| payments.repository.ts * | 33.33 | 100 | 10.52 | 100 |
| payments.service.ts | 100 | 100 | 93.33 | 93.33 |
| ports/contract-directory.port.ts | 100 | 100 | 100 | 100 |
| ports/credit-basis.port.ts | 100 | 100 | 100 | 100 |
| pricing-admin.controller.ts * | 96.96 | 100 | 71.42 | 92.85 |
| pricing.controller.ts | 100 | 100 | 100 | 100 |
| pricing.repository.ts | 84.21 | 84.21 | 90.9 | 90.9 |
| pricing.service.ts | 100 | 100 | 100 | 100 |
| providers/loss-case-listener.provider.ts | 100 | 100 | 87.5 | 87.5 |
| providers/organization-exit-check.provider.ts | 100 | 100 | 100 | 100 |
| release-adjustments.ts | 100 | 100 | 93.33 | 93.33 |
| sepay-webhook.guard.ts * | 57.14 | 100 | 100 | 100 |
| sepay.controller.ts * | 59.09 | 100 | 100 | 100 |
| sepay.service.ts | 100 | 100 | 89.18 | 91.89 |
| service-credit-ledger.ts | 100 | 100 | 100 | 100 |
| service-credit.service.ts * | 88.73 | 99.29 | 73.91 | 89.56 |
| service-credits.controller.ts * | 51.85 | 100 | 0 | 100 |
| service-credits.repository.ts * | 30 | 100 | 0 | 100 |

## Local code-break checks

Each new describe block was selected with Jest --testNamePattern while its production code carried the mutation below. Every check produced a failing test assertion, rather than a compilation failure. Every mutation was restored in a finally block. The complete module then passed again on restored code.

1. **Payment persistence lifecycle coverage**
   - Source: payments.repository.ts.
   - Mutation: `status: PaymentStatus.EXPIRED -> status: PaymentStatus.CONFIRMED`.
   - Failing tests: `expires at the exact deadline using a pending-only update`.
   - Restored: yes.
2. **Service credit persistence coverage**
   - Source: service-credits.repository.ts.
   - Mutation: `version: { increment: 1 } -> version: { increment: 2 }`.
   - Failing tests: `locks before reading and increments the decision version`.
   - Restored: yes.
3. **Billing query and payment validation coverage**
   - Source: dto/billing-queries.dto.ts.
   - Mutation: `value === 'true' ? true -> value === 'true' ? false`.
   - Failing tests: `transforms overdue true into a boolean`.
   - Restored: yes.
4. **Damage decision validation coverage**
   - Source: dto/damage-charges.dto.ts.
   - Mutation: `typeof value === 'string' ? value.trim() : value -> typeof value === 'string' ? value : value`.
   - Failing tests: `requires a positive integer for a reduced decision and trims its note`; `rejects invalid decision note  `.
   - Restored: yes.
5. **Pricing DTO validation coverage**
   - Source: dto/pricing-admin.dto.ts.
   - Mutation: `typeof value === 'string' ? value.trim() : value -> typeof value === 'string' ? value : value`.
   - Failing tests: `accepts generic and variant rates undefined`; `accepts generic and variant rates null`; `accepts generic and variant rates b3541f2a-cd1d-4dfa-a623-a1ce0783816a`; `trims patch labels, preserves false and validates every patched field`.
   - Restored: yes.
6. **Service credit DTO validation coverage**
   - Source: dto/service-credits.dto.ts.
   - Mutation: `typeof value === 'string' ? value.trim() : value -> typeof value === 'string' ? value : value`.
   - Failing tests: `converts outage dates and trims notes while accepting source identifiers`; `validates decision APPROVE and trims reasons`; `validates decision REJECT and trims reasons`; `validates decision REDUCE and trims reasons`; `trims refund references and requires a nonempty bounded string`.
   - Restored: yes.
7. **Invoice controller lifecycle coverage**
   - Source: invoices.controller.ts.
   - Mutation: `invoicedVnd: Number(totals.invoicedVnd) -> invoicedVnd: Number(totals.paidVnd)`.
   - Failing tests: `returns numeric list totals and contract labels`.
   - Restored: yes.
8. **SePay controller and verification guard coverage**
   - Source: sepay-webhook.guard.ts.
   - Mutation: `this.sepay.assertWebhookKey(request.headers.authorization); -> void request.headers.authorization;`.
   - Failing tests: `verifies authorization before admitting the webhook: undefined`; `verifies authorization before admitting the webhook: Apikey key`.
   - Restored: yes.
9. **Service credit controller refund and policies coverage**
   - Source: service-credits.controller.ts.
   - Mutation: `ability.can('refund', 'ServiceCredit') -> ability.can('read', 'ServiceCredit')`.
   - Failing tests: `enforces refund policy`.
   - Restored: yes.
10. **First invoice release preview coverage**
   - Source: charges.service.ts.
   - Mutation: `newTotalVnd -= before - lowered -> newTotalVnd += before - lowered`.
   - Failing tests: `recomputes monthly fees without changing other charges, paid 0n`; `recomputes monthly fees without changing other charges, paid 150n`; `uses day-plan pricing and preserves already appended adjustments`.
   - Restored: yes.
   - Reporter note: Jest JSON reporter could not serialize BigInt assertion data; plain Jest output confirms three assertion failures.
11. **Damage repository default client coverage**
   - Source: damage-charges.repository.ts.
   - Mutation: `if (contractIds.length === 0) return Promise.resolve(0); -> if (contractIds.length === 0) return Promise.resolve(1);`.
   - Failing tests: `uses the injected client for pending reads and empty or populated contract counts`.
   - Restored: yes.
12. **Pricing controller patch and rate list coverage**
   - Source: pricing-admin.controller.ts.
   - Mutation: `{ isActive: dto.isActive } -> { isActive: !dto.isActive }`.
   - Failing tests: `lists variant rates and preserves explicit false and trimmed labels in patches`.
   - Restored: yes.
13. **Invoice refund and lifecycle persistence coverage**
   - Source: invoices.repository.ts.
   - Mutation: `refundedVnd: refund.amountVnd -> refundedVnd: 0n`.
   - Failing tests: `records all refund fields on the locked invoice`.
   - Restored: yes.
14. **Service credit release, list and refund lifecycle coverage**
   - Source: service-credit.service.ts.
   - Mutation: `await this.credits.update(credit.id, { status: ServiceCreditStatus.REFUND_DUE }, tx) -> await this.credits.update(credit.id, { status: ServiceCreditStatus.REFUNDED }, tx)`.
   - Failing tests: `returns requested close blockers and marks approved remainders refund due`.
   - Restored: yes.
15. **SePay request collision and verification coverage**
   - Source: sepay.service.ts.
   - Mutation: `const MAX_REFERENCE_TRIES = 5; -> const MAX_REFERENCE_TRIES = 1;`.
   - Failing tests: `SePay sandbox (billing task 3.2) SePay request collision and verification coverage retries a reference collision and succeeds on the next insert`; `SePay sandbox (billing task 3.2) SePay request collision and verification coverage stops after five reference collisions and propagates other database errors`.
   - Restored: yes.
16. **Invoice deposit deadline and first invoice coverage**
   - Source: invoices.service.ts.
   - Mutation: `contract.depositDueBy.getTime() < startsAt.getTime() -> contract.depositDueBy.getTime() > startsAt.getTime()`.
   - Failing tests: `keeps the term start for deposit deadline 2026-10-25T02:00:00.001Z`.
   - Restored: yes.

## Validation

- Prettier --write followed by --check on all 11 touched TypeScript files: pass.
- ESLint on those same 11 files: pass, zero warnings.
- npx tsc --noEmit --incremental false from backend/: pass. This includes all touched specs through the backend tsconfig.
- npm run lint:boundaries from backend/: pass, 671 TypeScript files, 65 owned models, 10 modules, acyclic graph.
- Restored-code billing coverage: 30 suites and 434 tests pass.
- git diff --check: pass.
- Nothing required remains unrun. No integration tests or full repository test suite were requested.

## Coverage added

Payment intents now have persistence checks for locks, pending state, expiry boundaries, independent received transfers and gateway transaction deduplication. SePay tests cover retries and retry exhaustion, same-length wrong keys and authorization guard rejection. Invoice tests cover lifecycle reads, refunds, stable sorting, number exhaustion, release previews and deposit deadline selection. Controller tests check numeric serialization, ownership filter propagation, policy actions and denial results. DTO tests check conditional validation, date and boolean conversion, trimming, enums and bounds. Service-credit tests cover release requests, list enrichment, close transitions and missing refund targets.
