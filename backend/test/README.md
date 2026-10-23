# Backend test suites

Run from the repository root after `npm ci` and `npm --prefix backend run prisma:generate`.

| Command | Scope | Database |
|---|---|---|
| `npm --prefix backend test -- --runInBand` | Unit tests | Mocked |
| `npm --prefix backend run test:e2e -- --runInBand` | HTTP pipeline and replay harness | Stubbed |
| `npm --prefix backend run test:db -- --ci` | Incident repository concurrency, constraints and rollback | Migrated Postgres 16 |

For `test:db`, set `DATABASE_URL` and `DATABASE_DIRECT_URL` explicitly to a disposable test database,
then run `npm --prefix backend run prisma:deploy` against that database. CI uses its Postgres service.
The suite checks the explicit variables before constructing its client and passes that URL directly
to Prisma. It creates fixtures with a unique run ID and never deletes existing rows. Discard the test
container after the run.

The incident database tests exercise persistence independently of the lifecycle: fixture states and
transitions are written directly. Routing, ownership, state transitions, dispatcher delivery and HTTP
authorization belong to the subsequent incident tasks. These tests do not claim those tasks complete.
