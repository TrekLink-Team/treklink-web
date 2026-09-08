# Technical Design: gateway-sync

> Fulfills `requirements.md` in the same `specs/{module}/` folder. Do not start `tasks.md` or code until this is reviewed.

## 1. Domain Model & Data Schema

### Entity: [EntityName]
- `id` (UUID, PK)
- `status` (enum: …) — if this entity has a lifecycle, render it below as a state diagram
- Audit fields: `createdAt`, `updatedAt` (see `01-conventions/04-architecture-conventions.md` §2)

```mermaid
erDiagram
    DEVICE ||--o{ RENTAL : "allocated to"
    RENTAL ||--o{ INCIDENT : "may raise"
```

### State machine (if applicable — e.g. Device 7-state, Incident 5-state)
```mermaid
stateDiagram-v2
    [*] --> Available
    Available --> Reserved
    Reserved --> Rented
    Rented --> InField
    InField --> Returned
    Returned --> Maintenance
    Returned --> Available
    Maintenance --> Available
    Maintenance --> Retired
    Available --> Retired
```

---

## 2. Service / Business Logic Design

### Mutating operations
- `create{Thing}(dto)` → returns `{Thing}ResponseDto`
- `update{Thing}Status(id, newStatus)` → validates against the transition table, throws `ConflictException` on an illegal transition

### Read operations
- `find{Thing}sPaged(query)` → returns `PagedResultDto<{Thing}ResponseDto>`

### Cross-module dependencies
- Depends on: `{OtherModule}Service.{method}` (imported via DI, per `01-conventions/04-architecture-conventions.md` §1.1 — never a direct repository import)

---

## 3. Sequence Flow

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Controller
    participant Service
    participant DB as Database

    Client->>Controller: POST /api/{resource}
    Controller->>Service: create(dto)
    Service->>Service: validate state transition
    alt Invalid
        Service-->>Controller: throw ConflictException
        Controller-->>Client: 409 { isSuccess:false, message }
    end
    Service->>DB: save (transaction)
    DB-->>Service: persisted
    Service-->>Controller: ResponseDto
    Controller-->>Client: 201 { result: ResponseDto, isSuccess:true }
```

---

## 4. API Endpoints in this module
List each endpoint and link its file under `api-design/`, using `02-templates/04-api-endpoint-template.md`:
- `POST /api/{resource}` → `api-design/01-post-{resource}-create.md`
- `GET /api/{resource}` → `api-design/02-get-{resource}-list.md`

---

## 5. Frontend impact (if applicable)
- New screens/widgets: […]
- New Zod schema mirroring the DTO above: […]
