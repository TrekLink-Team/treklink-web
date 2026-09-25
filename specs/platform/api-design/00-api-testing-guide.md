# API Testing Guide (all modules)

How to exercise any TrekLink endpoint by hand. Module guides (`specs/{module}/api-design/00-api-testing-guide.md`) add only their own walkthrough and link here for setup.

## 1. Start the stack

```bash
docker compose up -d postgres mosquitto
cp .env.example .env
npm ci
npm --prefix backend run prisma:migrate
npm --prefix backend run start:dev
```

Swagger UI: `http://localhost:3000/api/docs`. Every operation there documents the D-002 envelope.

## 2. Get a token

```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"admin","password":"<seeded admin password>"}'
```

Copy `result.accessToken`, then:

```bash
export TOKEN=<accessToken>
```

The seed creates one user per role (`admin`, `operator`, `guide`, `customer`); passwords come from `SEED_*_PASSWORD` in `.env` and are never committed.

## 3. Call an endpoint

```bash
curl -s http://localhost:3000/api/settings/parameters \
  -H "Authorization: Bearer $TOKEN"
```

Every response, success or failure, has exactly four keys: `result`, `isSuccess`, `statusCode`, `message`. On failure `result` is `{ "errorCode": "..." }`.

## 4. Check the correlation id

Every response carries `X-Request-Id`. Quote it when reporting a 500; the backend log line with the same id holds the stack trace.

## 5. Postman

Import `http://localhost:3000/api/docs-json` into Postman as an OpenAPI 3 collection. Set a collection variable `TOKEN` and a pre-request script that refreshes it through `POST /api/auth/refresh` when a call returns 401.

## 6. What every module e2e test asserts

For each file under `api-design/`: the success sample's shape and `message`, and every row of its Validation table (status code and `result.errorCode`). A row with no test is a gap in the Definition of Done (`02-templates/04-api-endpoint-template.md`, reuse notes).
