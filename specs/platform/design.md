# Technical Design: platform (cross-cutting backend foundation)

> Fulfills `requirements.md` in this folder. Also the home of the **system-level design artefacts** for Review 2 and the SDD: the context diagram, the architecture diagram, the module dependency graph and the system-wide ERD. Module-level ERD slices, state machines and sequence diagrams live in each module's own `design.md`.

---

## 1. System context

See **Figure 1**. It is the Level-0 view the Review 2 template asks for: the platform as one process, every external actor and system around it, and the data each flow carries.

```mermaid
flowchart TB
    CUS["Customer"]
    STF["Operator"]
    GUI["Guide"]
    ADM["Admin"]
    SYS(("TrekLink<br/>Operations<br/>Platform"))
    BRK["MQTT Broker"]
    DEV["TrekLink Device"]
    GWB["Gateway Bridge<br/>Stage C"]
    MAP["Goong Maps"]
    PAY["Sandbox<br/>Payment"]
    MAIL["Email<br/>service"]
    CUS <-->|"booking, payment<br/>/ quote, invoice"| SYS
    STF <-->|"operations<br/>/ queues, alerts"| SYS
    GUI <-->|"checks, notes<br/>/ own trip, alerts"| SYS
    ADM <-->|"users, config<br/>/ audit, health"| SYS
    DEV -->|"SOS, position,<br/>telemetry"| BRK
    DEV -.->|"serial, BLE"| GWB
    GWB -.->|"buffered<br/>events"| BRK
    BRK -->|"JSON<br/>envelopes"| SYS
    SYS -->|"map config<br/>to browser"| MAP
    SYS <-->|"charge<br/>/ result"| PAY
    SYS -->|"OTP"| MAIL
    style SYS stroke-width:3px
```

***Figure 1***: Context diagram. One process, four human actors, the field hardware, and four external systems. On two-way edges the label reads *inbound / outbound*. Dashed edges are the Stage C basecamp path (D-018, D-020), which is specified and deferred. Map traffic goes from the browser to Goong directly; the platform only supplies configuration.

Differences from `06-requirements-foundation.md` Figure 1, stated so the two are reconciled rather than left to drift: the MQTT broker is drawn as its own external system (it is operated infrastructure, not platform code), and "Notification channel" is narrowed to **Email service**, because email OTP is the only outbound channel the MF-01 answers require (Q31, Q35). Incident alerts travel over the platform's own WebSocket. A REQUEST entry proposes the same edit to the SSOT figure.

---

## 2. Architecture

See **Figure 2**. Every arrow is labelled with its protocol, per the Review 2 template tip.

```mermaid
flowchart TB
    subgraph Client["Browser: React SPA, FSD"]
        UI["Pages, widgets, features"]
        QC["TanStack Query<br/>server state"]
        WS["socketClient<br/>live state store"]
        ML["MapLibre GL"]
    end
    subgraph Backend["NestJS modular monolith"]
        HTTP["REST controllers<br/>JwtAuthGuard + PoliciesGuard"]
        GWY["Socket.io gateway<br/>monitoring"]
        MODS["auth · devices · trips · rentals<br/>billing · incidents · gateway-sync"]
        PLT["platform: envelope, config,<br/>parameters, audit, scheduler"]
        BUS["EventEmitter2<br/>in-process domain events"]
        ING["MQTT ingress adapter"]
    end
    DB[("PostgreSQL<br/>Neon or local Docker")]
    BRK["Mosquitto"]
    GOONG["Goong tiles"]
    UI --> QC
    UI --> WS
    UI --> ML
    QC -->|"HTTPS REST, JSON envelope"| HTTP
    WS <-->|"WSS Socket.io, JWT handshake"| GWY
    ML -->|"HTTPS style.json, tiles"| GOONG
    HTTP --> MODS
    MODS --> PLT
    MODS -->|"Prisma"| DB
    PLT -->|"Prisma"| DB
    MODS --> BUS
    BUS --> GWY
    BRK -->|"MQTT QoS 1, JSON"| ING
    ING --> MODS
```

***Figure 2***: Architecture. One deployable backend; modules talk through exported services or domain events, never through each other's tables.

### 2.1 Module dependency graph

See **Figure 3**. Solid edges are DI imports of an exported service; dashed edges are domain events. The graph is acyclic by construction, which `04-architecture-conventions.md` §1.1 requires.

```mermaid
flowchart TB
    PLT["platform"]
    AUTH["auth"]
    DEVS["devices"]
    TRIPS["trips"]
    RENT["rentals"]
    BILL["billing"]
    INC["incidents"]
    GWS["gateway-sync"]
    MON["monitoring"]
    AUTH --> PLT
    DEVS --> AUTH
    TRIPS --> AUTH
    TRIPS --> DEVS
    BILL --> TRIPS
    BILL --> DEVS
    RENT --> DEVS
    RENT --> TRIPS
    RENT --> BILL
    INC --> DEVS
    INC --> RENT
    GWS --> DEVS
    GWS --> INC
    MON --> DEVS
    MON --> TRIPS
    MON --> INC
    MON --> GWS
    MON --> RENT
    TRIPS -.->|"trip.status.changed"| RENT
    GWS -.->|"device.position.updated"| MON
    INC -.->|"incident.opened"| MON
    DEVS -.->|"device.status.changed"| MON
```

***Figure 3***: Module dependencies. `billing` never imports `rentals`; `rentals` pushes the settlement facts into `billing`, which is what keeps the graph acyclic while honouring Q64 (payment lives in `billing` only, `rentals` calls outward).

### 2.2 Cross-module transactions

Several flows must be atomic across module boundaries: reserving a device (rentals plus devices), checking out (rentals plus devices), ingesting an SOS (gateway-sync plus devices plus incidents). The rule:

- A service method that may take part in a caller's transaction accepts an optional last parameter `tx?: Prisma.TransactionClient` and uses `tx ?? this.prisma`.
- Only the module that **starts** the business operation opens `prisma.$transaction`. Callees never open their own.
- A callee still queries **only its own tables**, even when handed a `tx`. The transaction client is a connection, not a licence to reach into another module's tables.
- Row locks a callee must take on its own rows (for example `devices` locking candidate device rows) are taken by the callee through an exported method such as `DevicesService.lockForAllocation(ids, tx)`.

Enforcement: a boundary check script (tasks 1.9) maps each Prisma model to its owning module and fails CI when `backend/src/modules/<a>/` references a model owned by `<b>`.

### 2.3 Domain events

| Event | Emitted by | Consumed by | Payload (ids only plus the changed fields) |
|---|---|---|---|
| `audit.record` | any module | platform | actor, action, subject, before, after |
| `device.status.changed` | devices | monitoring | deviceId, from, to, reason |
| `device.position.updated` | gateway-sync | monitoring | deviceId, lat, lon, receivedAt |
| `device.telemetry.updated` | gateway-sync | monitoring | deviceId, batteryPct, receivedAt |
| `device.queue.reported` | gateway-sync | monitoring | deviceId, depthByTier, buffering |
| `gateway.health.changed` | gateway-sync | monitoring | gatewayId, state, lastPacketAt |
| `trip.status.changed` | trips | rentals, monitoring | tripId, from, to |
| `incident.opened` | incidents | monitoring | incidentId, deviceId, tripId, confidence |
| `incident.updated` | incidents | monitoring | incidentId, from, to, actor |
| `incident.escalated` | incidents | monitoring | incidentId |

Events are emitted **after commit** (`@nestjs/event-emitter` listeners invoked from a post-commit hook), never inside a transaction that may still roll back. Delivery of an event never gates the business write (E03-7).

---

## 3. Domain Model & Data Schema

### 3.1 Core ERD for the Review 2 slide

The Review 2 template asks for the 5 to 8 entities central to the system. See **Figure 4**.

```mermaid
erDiagram
    USER ||--o{ BOOKING : "places"
    USER ||--o{ TRIP_GUIDE_ASSIGNMENT : "guides"
    TRIP ||--o{ TRIP_GUIDE_ASSIGNMENT : "staffed by"
    TRIP ||--o{ BOOKING : "receives"
    BOOKING ||--o| RENTAL : "fulfilled by"
    RENTAL ||--|{ RENTAL_ITEM : "contains"
    DEVICE ||--o{ RENTAL_ITEM : "rented as"
    DEVICE ||--o{ GATEWAY_EVENT : "emits"
    DEVICE ||--o{ INCIDENT : "raises"
    GATEWAY_EVENT |o--o| INCIDENT : "opens"
    TRIP ||--o{ INCIDENT : "context of"
    RENTAL ||--o{ INVOICE : "billed by"
```

***Figure 4***: Core ERD, eight central entities. Keys and defining attributes follow in Figures 5 to 10.

### 3.2 System-wide ERD

Split into six figures so every label stays above the 7 pt floor (`13-diagram-and-figure-conventions.md` §7: entity count and attribute rows drive size). Each entity shows its keys and the attributes that define it; the complete column list of every model is the Prisma block in the owning module's `design.md` §1. Every entity also carries `createdAt` and, where mutable, `updatedAt`.

See **Figure 5**, identity and roles.

```mermaid
erDiagram
    direction LR
    USER {
        uuid id PK
        string username UK
        string email UK "nullable"
        enum accountType
        bool isActive
        datetime deletedAt
    }
    ROLE {
        uuid id PK
        string key UK
        enum accountType
        bool isSystem
    }
    PERMISSION {
        uuid id PK
        string key UK
        string action
        string subject
        json conditions
    }
    USER_ROLE {
        uuid userId FK
        uuid roleId FK
    }
    ROLE_PERMISSION {
        uuid roleId FK
        uuid permissionId FK
    }
    GUIDE_PROFILE {
        uuid userId PK
        string skills
    }
    USER ||--o{ USER_ROLE : "holds"
    ROLE ||--o{ USER_ROLE : "granted as"
    ROLE ||--o{ ROLE_PERMISSION : "allows"
    PERMISSION ||--o{ ROLE_PERMISSION : "in"
    USER ||--o| GUIDE_PROFILE : "has"
```

***Figure 5***: System ERD part 1 of 6, identity and roles. Roles and permissions are rows (US-001), so a new Staff sub-role such as Manager is data, not code (Q33). Owner: `auth`.

See **Figure 6**, sessions and administration.

```mermaid
erDiagram
    direction LR
    USER {
        uuid id PK
        string username UK
    }
    REFRESH_TOKEN {
        uuid id PK
        uuid userId FK
        uuid familyId
        string tokenHash UK
        datetime revokedAt
    }
    ONE_TIME_CODE {
        uuid id PK
        uuid userId FK
        enum purpose
        string codeHash
        datetime expiresAt
    }
    AUDIT_LOG {
        uuid id PK
        uuid actorId FK
        string action
        string subjectType
        string subjectId
    }
    BUSINESS_PARAMETER {
        string key PK
        json value
        int version
    }
    PARAMETER_HISTORY {
        uuid id PK
        string key FK
        uuid changedById FK
    }
    USER ||--o{ REFRESH_TOKEN : "owns"
    USER ||--o{ ONE_TIME_CODE : "receives"
    USER |o--o{ AUDIT_LOG : "acts in"
    BUSINESS_PARAMETER ||--o{ PARAMETER_HISTORY : "changed in"
    USER ||--o{ PARAMETER_HISTORY : "changes"
```

***Figure 6***: System ERD part 2 of 6, sessions, one-time codes, the generic audit log and runtime business parameters. Owners: `auth` (tokens, codes), `platform` (audit, parameters).

See **Figure 7**, fleet and trips.

```mermaid
erDiagram
    direction LR
    HARDWARE_VARIANT {
        uuid id PK
        string code UK
        bool mqttCapable
    }
    DEVICE {
        uuid id PK
        string assetTag UK
        uuid hardwareVariantId FK
        bigint nodeNum UK
        enum status
        int pskVersion
    }
    DEVICE_STATUS_HISTORY {
        uuid id PK
        uuid deviceId FK
        enum toStatus
        string reason
    }
    MAINTENANCE_RECORD {
        uuid id PK
        uuid deviceId FK
        enum status
    }
    TREK_PACKAGE {
        uuid id PK
        string code UK
        enum status
    }
    TRIP {
        uuid id PK
        uuid packageId FK
        datetime startAt
        datetime endAt
        int capacity
        enum status
    }
    TRIP_GUIDE_ASSIGNMENT {
        uuid tripId FK
        uuid guideId FK
        enum role
    }
    HARDWARE_VARIANT ||--o{ DEVICE : "classifies"
    DEVICE ||--o{ DEVICE_STATUS_HISTORY : "audited in"
    DEVICE ||--o{ MAINTENANCE_RECORD : "serviced in"
    TREK_PACKAGE ||--o{ TRIP : "scheduled as"
    TRIP ||--o{ TRIP_GUIDE_ASSIGNMENT : "staffed by"
```

***Figure 7***: System ERD part 3 of 6, device fleet and trips. `DEVICE.nodeNum` is `bigint` because a Meshtastic node number is an unsigned 32-bit value. Owners: `devices`, `trips`.

See **Figure 8**, bookings and rentals.

```mermaid
erDiagram
    direction LR
    TRIP {
        uuid id PK
    }
    DEVICE {
        uuid id PK
    }
    BOOKING {
        uuid id PK
        uuid tripId FK
        uuid customerId FK
        enum channel
        enum status
    }
    DEVICE_ALLOCATION {
        uuid id PK
        uuid deviceId FK
        uuid bookingId FK
        tstzrange window
        enum status
    }
    RENTAL {
        uuid id PK
        uuid bookingId FK
        uuid custodianGuideId FK
        enum status
        datetime dueAt
    }
    RENTAL_ITEM {
        uuid id PK
        uuid rentalId FK
        uuid deviceId FK
        enum state
    }
    RENTAL_AGREEMENT {
        uuid id PK
        uuid rentalId FK
        int version
        string signedSha256
    }
    RETURN_INSPECTION {
        uuid id PK
        uuid rentalItemId FK
        enum condition
        bool serviceable
    }
    TRIP ||--o{ BOOKING : "receives"
    BOOKING ||--o{ DEVICE_ALLOCATION : "holds"
    DEVICE ||--o{ DEVICE_ALLOCATION : "booked in"
    BOOKING |o--o| RENTAL : "fulfilled by"
    RENTAL ||--|{ RENTAL_ITEM : "contains"
    DEVICE ||--o{ RENTAL_ITEM : "rented as"
    RENTAL ||--o{ RENTAL_AGREEMENT : "documented by"
    RENTAL_ITEM ||--o| RETURN_INSPECTION : "inspected in"
```

***Figure 8***: System ERD part 4 of 6, bookings and rentals. `DEVICE_ALLOCATION.window` carries a Postgres exclusion constraint so no device is ever allocated twice for overlapping time: BR-01 enforced by the database, not only by application code. `TRIP` and `DEVICE` appear as key-only stubs. Owner: `rentals`.

See **Figure 9**, billing.

```mermaid
erDiagram
    direction LR
    PRICING_RULE {
        uuid id PK
        enum scope
        enum unit
        decimal amount
        decimal depositPerDevice
    }
    DAMAGE_FEE_RULE {
        uuid id PK
        enum condition
        decimal amount
    }
    INVOICE {
        uuid id PK
        string number UK
        enum kind
        enum status
        decimal balanceDue
    }
    INVOICE_LINE {
        uuid id PK
        uuid invoiceId FK
        enum type
        decimal amount
    }
    PAYMENT {
        uuid id PK
        uuid invoiceId FK
        enum direction
        enum status
        string idempotencyKey UK
    }
    FEE_WAIVER {
        uuid id PK
        uuid invoiceLineId FK
        uuid decidedById FK
        enum status
    }
    INVOICE ||--|{ INVOICE_LINE : "itemises"
    PRICING_RULE ||--o{ INVOICE_LINE : "prices"
    DAMAGE_FEE_RULE ||--o{ INVOICE_LINE : "prices"
    INVOICE ||--o{ PAYMENT : "settled by"
    INVOICE_LINE ||--o{ FEE_WAIVER : "reduced by"
```

***Figure 9***: System ERD part 5 of 6, billing. Every fee is its own `INVOICE_LINE`, so a late fee is never folded into an unexplained total (E05-1). Owner: `billing`.

See **Figure 10**, field events and incidents.

```mermaid
erDiagram
    direction LR
    DEVICE {
        uuid id PK
    }
    GATEWAY {
        uuid id PK
        string gatewayKey UK
        datetime lastPacketAt
    }
    GATEWAY_EVENT {
        uuid id PK
        string eventId UK
        uuid deviceId FK
        enum kind
        enum priority
        datetime receivedAt
        uuid incidentId FK
    }
    SYNC_AUDIT_LOG {
        uuid id PK
        string eventId
        enum outcome
    }
    DEVICE_QUEUE_REPORT {
        uuid id PK
        uuid deviceId FK
        json depthByTier
    }
    INCIDENT {
        uuid id PK
        uuid deviceId FK
        uuid openedByEventId FK
        enum confidence
        enum status
        datetime lastEventAt
        int version
    }
    INCIDENT_AUDIT {
        uuid id PK
        uuid incidentId FK
        enum action
        uuid actorId FK
    }
    GATEWAY ||--o{ GATEWAY_EVENT : "delivered"
    DEVICE ||--o{ GATEWAY_EVENT : "emits"
    DEVICE ||--o{ DEVICE_QUEUE_REPORT : "reports"
    GATEWAY_EVENT ||--o{ SYNC_AUDIT_LOG : "logged as"
    DEVICE ||--o{ INCIDENT : "raises"
    INCIDENT ||--o{ GATEWAY_EVENT : "correlates"
    INCIDENT ||--|{ INCIDENT_AUDIT : "transitions"
```

***Figure 10***: System ERD part 6 of 6, field events and incidents. `GATEWAY_EVENT.eventId` is the D-006 packet key; episode membership is the separate `incidentId` link, which is the split that stops a beacon storm from minting one Incident per packet. Owners: `gateway-sync`, `incidents`.

### 3.3 Corrections to the current `schema.prisma`

The first migration is written from Figures 5 to 10 and the module Prisma blocks, not from the current schema, which has no migrations yet. Differences that are corrections, not additions:

| Current | Problem | Correction |
|---|---|---|
| `Device.nodeNum Int?` | Meshtastic `nodeNum` is an unsigned 32-bit value derived from MAC bytes 2 to 5 (`NodeDB.cpp:1127`). Postgres `integer` is signed 32-bit, so any node number above 2147483647 overflows on insert. | `BigInt?` |
| `User.role Role` single enum | Q33 requires Staff sub-roles, extensible, and a user may be both Operator and Guide | `USER_ROLE` join to data-driven `ROLE` |
| `User.email @unique` required | Q41: username is the primary identifier; email is optional and linkable later | `username @unique`, `email @unique` nullable |
| `IncidentAudit ... onDelete: Cascade` | A cascade is a delete path on an append-only trail (BR-11) | `onDelete: Restrict`, plus a trigger rejecting `UPDATE` and `DELETE` |
| `Incident.eventId @unique` | Pre-D-006 conflated key, already marked stale in-file | `openedByEventId` FK, `lastEventAt`, `confidence` |
| `RentalStatus` 4 values, `TripStatus` 4 values | Do not cover the MF-01 and MF-05 exception scenarios | 7-state rental, 8-state trip (see those modules) |
| `Rental.deviceId` single device | Q57: a Guide booking carries many devices | `RENTAL_ITEM` |

### 3.4 Schema rules settled by the leader (PR #12 review, 2026-09-26)

The figures above show keys and defining attributes only. These rules decide everything they leave open, and `backend/prisma/schema.prisma` follows them. No database held data when they were settled, so they are folded into the single initial migration rather than stacked as fix-up migrations.

| # | Rule | Consequence in the schema |
|---|---|---|
| 1 | `gateway_events` is append-only with one exception: an `UPDATE` that only sets `incidentId` from `NULL` to a value. Every other `UPDATE`, and every `DELETE`, is rejected. `priority` is set at insert. | The table has its own trigger function, `gateway_events_append_only()`, instead of `raise_append_only()` (§4.5). |
| 3 | Columns keep the Prisma field names (camelCase); only table names are mapped with `@@map`. | Raw SQL quotes the real names, for example `"deviceId"`, `"windowStart"`. |
| 4 | Every reference column is a foreign key: parent ids of detail and history rows, `Incident.tripId`, `Invoice.rentalId` and `bookingId`, and every actor column (`*ById`, `actorId`) to `users`. No FK on polymorphic references (`InvoiceLine.sourceId`, `AuditLog.subjectId`, `DeviceStatusHistory.refId`, `MaintenanceRecord.sourceRefId`) or on `SyncAuditLog.eventId`, because an `UNKNOWN_DEVICE` row carries an eventId with no event. `FeeWaiver` uses `decidedById` (Figure 9), because the same column records an approval or a rejection. `onDelete` stays Prisma's default except `IncidentAudit` (`Restrict`). | 100 foreign keys. |
| 7 | Every `DateTime` is `@db.Timestamptz(3)`. | Required anyway for `device_allocations.windowStart` and `windowEnd`: `tstzrange()` over `timestamp` is not immutable and cannot back the exclusion constraint. |
| 12 | Every foreign-key column leads an index, and `business_parameter_history` is indexed on `(key, changedAt)` for the paged history (api-design/04). | An FK column that already leads a composite index, unique constraint or primary key gets no second index. |
| 13 | `GatewayEvent` has no `processedAt`. `receivedAt` and `eventTime` carry the timing, and an append-only row could never set it. | Column removed. |

---

## 4. Service / Business Logic Design

### 4.1 Envelope

`ResponseInterceptor` already wraps success bodies. Two additions:

- `@ResponseMessage('Device registered')` decorator, read by the interceptor through `Reflector`, so each endpoint's `message` is the one its `api-design/*.md` declares rather than a blanket `Success`.
- A paged result is returned by services as `PagedResult<T>` and passed through unchanged; the interceptor never re-shapes `result`.

`GlobalExceptionFilter` already produces the failure envelope. Changes:

- Business exceptions extend `DomainException(httpStatus, errorCode, message)`. The filter sets `result = { errorCode }`.
- `ValidationPipe` gets an `exceptionFactory` that throws `DomainException(400, VALIDATION_FAILED, "<prop> <constraint>; ...")`.
- `Prisma.PrismaClientKnownRequestError` codes `P2002` and `P2025` map to REQ-ERR-03 and REQ-ERR-04.
- A `RequestIdMiddleware` sets `X-Request-Id` and puts it on an `AsyncLocalStorage` context read by the logger and the audit sink.

### 4.2 Error catalogue

One enum, `common/errors/error-code.enum.ts`, grouped by module prefix. Each module's `design.md` lists its own codes with HTTP status; the enum is the union. Cross-cutting codes:

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | DTO validation failed |
| `UNAUTHENTICATED` | 401 | missing, malformed or expired access token |
| `FORBIDDEN` | 403 | authenticated, policy denies |
| `NOT_FOUND` | 404 | resource does not exist or is outside the caller's scope |
| `CONFLICT_UNIQUE` | 409 | unique constraint |
| `INVALID_STATE_TRANSITION` | 409 | FSM guard rejected the transition |
| `STALE_VERSION` | 409 | optimistic-lock version mismatch |
| `PAYLOAD_TOO_LARGE` | 413 | body limit |
| `PARAMETER_OUT_OF_RANGE` | 400 | parameter value rejected |
| `INTERNAL_ERROR` | 500 | unhandled |

**Scoped 404 rule.** When a Guide requests a trip that is not theirs, the API answers 404 `NOT_FOUND`, not 403. A 403 confirms the resource exists, which leaks another guide's trip ids. This applies to every scoped read (E04-5, BR-13).

### 4.3 Configuration

`@nestjs/config` with a `validate` function built on `class-validator` over an `EnvironmentVariables` class (the backend already depends on `class-validator`; no new library). Each module contributes a typed config namespace (`registerAs('rentals', ...)`) holding its environment-level defaults.

### 4.4 Runtime business parameters

```prisma
model BusinessParameter {
  key         String    @id            // "rentals.customerHoldMinutes"
  value       Json
  valueType   ParameterType             // INT, DECIMAL, PERCENT, DURATION_SECONDS, BOOL, JSON
  bounds      Json?                      // { "min": 1, "max": 120 }
  unit        String?
  ownerModule String
  description String
  version     Int       @default(1)
  updatedById String?
  updatedAt   DateTime  @updatedAt
  history     BusinessParameterHistory[]
  @@map("business_parameters")
}
```

- `ParameterService.get<T>(key)` reads through an in-memory cache with TTL `PARAMETER_CACHE_TTL_SECONDS`; an update invalidates the local cache immediately.
- Keys are declared once, in `platform/parameters/parameter-registry.ts`, with type, bounds, default and owner module. A seed migration inserts every registered key with its default. A key missing from the registry cannot be read (compile-time union type).
- Each module lists its keys in its own `requirements.md` §4. The registry is the union and is what the Configuration Matrix is generated from.

### 4.5 Audit sink

```prisma
model AuditLog {
  id          String   @id @default(uuid())
  actorId     String?
  actorRoles  String[]
  action      String          // "booking.confirm", "user.roles.update"
  subjectType String
  subjectId   String?
  before      Json?
  after       Json?
  requestId   String?
  ip          String?
  createdAt   DateTime @default(now())
  @@index([subjectType, subjectId, createdAt])
  @@index([actorId, createdAt])
  @@map("audit_log")
}
```

The migration adds `CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION raise_append_only()`; the same function guards `business_parameter_history`, `incident_audits`, `device_status_history`, `device_provisioning`, `trip_readiness_checks`, `handover_checks`, `return_inspections` and every other `*_status_history` table. `gateway_events` has its own function, `gateway_events_append_only()`, which also permits an `UPDATE` that only sets `incidentId` from `NULL` to a value (§3.4 rule 1). A redaction list (`passwordHash`, `tokenHash`, `codeHash`, `psk`) is applied to `before` and `after` before insert.

### 4.6 Scheduler

`@nestjs/schedule` hosts every time-triggered rule. Jobs registered by modules:

| Job | Owner | Default cadence | Rule |
|---|---|---|---|
| `rentals.expireHolds` | rentals | 30 s | release allocations past `holdExpiresAt` (E01-1 cleanup, Q59) |
| `rentals.markOverdue` | rentals | 60 s | rental past due plus grace becomes `OVERDUE` (E05-1, E05-3) |
| `devices.markLost` | devices | 15 min | non-return grace exceeded, raise loss record (E05-3, FR-DEV-09) |
| `monitoring.staleSweep` | monitoring | 15 s | emit stale transitions (E04-1, E04-2) |
| `incidents.escalate` | incidents | 15 s | unacknowledged past timeout, escalate (MF-03 parameter) |

Single-instance execution uses a Postgres advisory lock per job name (`pg_try_advisory_lock`), so a second backend replica skips rather than double-runs.

---

## 5. API Endpoints in this module

| Method | Route | Permission | Spec |
|---|---|---|---|
| GET | `/api/health` | Public | [`api-design/01-get-health.md`](api-design/01-get-health.md) |
| GET | `/api/settings/parameters` | Admin, Operator (read) | [`api-design/02-get-parameters-list.md`](api-design/02-get-parameters-list.md) |
| PATCH | `/api/settings/parameters/:key` | Admin | [`api-design/03-patch-parameter-update.md`](api-design/03-patch-parameter-update.md) |
| GET | `/api/settings/parameters/:key/history` | Admin | [`api-design/04-get-parameter-history.md`](api-design/04-get-parameter-history.md) |
| GET | `/api/audit-logs` | Admin | [`api-design/05-get-audit-logs-list.md`](api-design/05-get-audit-logs-list.md) |

Testing walkthrough: [`api-design/00-api-testing-guide.md`](api-design/00-api-testing-guide.md).

---

## 6. Sequence Flow: an Admin changes a parameter

See **Figure 11**.

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    participant C as ParametersController
    participant S as ParameterService
    participant DB as Postgres
    participant A as Audit sink
    Admin->>C: PATCH .../parameters/{key} {value 15}
    C->>S: update(key, 15, actor)
    S->>S: validate type and bounds from registry
    alt out of bounds
        S-->>C: 400 PARAMETER_OUT_OF_RANGE
        C-->>Admin: 400, value unchanged
    end
    S->>DB: UPDATE value, INSERT history
    S->>S: invalidate cache entry
    S-)A: audit.record parameter.update
    S-->>C: ParameterDto
    C-->>Admin: 200 Parameter updated
```

***Figure 11***: Parameter update. The history row and the value change commit together; the audit entry is emitted after commit.

---

## 7. Frontend impact

- `shared/api/apiClient.ts` unwraps the envelope once and throws `ApiError { statusCode, errorCode, message }` on failure (`06-frontend-conventions.md` §6.1).
- Admin pages: Parameters (list, inline edit with bounds shown, history drawer) and Audit Log (filterable table). Specified in `specs/frontend/`.
