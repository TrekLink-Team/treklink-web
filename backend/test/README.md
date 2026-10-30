# Backend test suites

Run from the repository root after `npm ci` and `npm --prefix backend run prisma:generate`.

| Command | Scope | Database |
|---|---|---|
| `npm --prefix backend test -- --runInBand` | Unit tests | Mocked |
| `npm --prefix backend run test:e2e -- --runInBand` | HTTP pipeline and replay harness | Stubbed |
| `npm --prefix backend run test:db -- --ci` | Incident repositories and lifecycle: concurrency, constraints, rollback and after-commit events | Migrated Postgres 16 |

For `test:db`, set `DATABASE_URL` and `DATABASE_DIRECT_URL` explicitly to a disposable test database,
then run `npm --prefix backend run prisma:deploy` against that database. CI uses its Postgres service.
The suite checks the explicit variables before constructing its client and passes that URL directly
to Prisma. It creates fixtures with a unique run ID and never deletes existing rows. Discard the test
container after the run.

`rentals-acceptance.db-spec.ts` and `billing-acceptance.db-spec.ts` run the rentals and billing
acceptance criteria through the real services: `db-rental-flow.ts` compiles `AppModule` against the
same database without init, so after-commit listeners and scheduled jobs stay off and no email is
sent, and `db-app-env.ts` sets the remaining boot variables (MQTT ingestion off, signed handover
notes under the system temporary directory, a SePay webhook key). The jobs are called with explicit
times. `contracts-http.db-spec.ts` goes through HTTP: `compileRentalFlow({ http: true })` starts the whole
application with the scheduler replaced, and `send` calls it as a flow account. `auth-http.db-spec.ts`
starts the application the same way on its own. Some of these suites read every due row of the database (the term rollover, the alert
dispatcher), so run the whole suite on a fresh database, as CI does. `mf03.db-spec.ts` drains the due
alert backlog before it checks its own rows, so it also passes on a second run against the same
database (checked 2026-10-30: three runs, 21 of 21 suites each).

The incident database tests create fixture states and initial history directly. Subsequent lifecycle
actions run through the real repositories, parameter service and transaction/event wrapper. They cover
acknowledgement races, timer races, empty-tier skipping, persisted deadlines, response/reopen and atomic
rollback. Routing service integration, dispatcher delivery and HTTP authorization remain separate tasks.
