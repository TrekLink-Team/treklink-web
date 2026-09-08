# TrekLink Web Platform

> **Capstone FA26SE159** · TrekLink Team · GitHub Org: [`github.com/TrekLink-Team`](https://github.com/TrekLink-Team)
> Active term deliverable: Gateway Bridge + NestJS backend + React frontend.

This repository (`treklink-web`) contains the operational software components of TrekLink:
- `backend/` — NestJS modular monolith backend (Auth, Devices, Rentals, Trips, Gateway-Sync, Incidents, Monitoring, Billing) with Prisma ORM and PostgreSQL.
- `gateway/` — Node.js/TypeScript Gateway Bridge service (LoRa serial parser with Meshtastic protobufs, SQLite priority queue P0–P3, MQTT store-and-forward client).
- `frontend/` — React/TypeScript web application (Admin, Staff, Guide, and Customer views) using Feature-Sliced Design (FSD), Tailwind CSS, and Leaflet.js maps.
- `specs/` — Living specification suite (`requirements.md` → `design.md` → `tasks.md` → `api-design/`) per module.
- `ignore/` — Local developer scratchpad & AI agent digital garden (gitignored by default).

---

## 1. Prerequisites

- **Node.js**: `v22.x` or newer (`node --version`)
- **npm**: `v10.x` or newer (`npm --version`)
- **Docker & Docker Compose**: For local PostgreSQL and Mosquitto MQTT broker (`docker compose version`)

Compatible across **Linux, macOS, and Windows** (native or WSL2).

---

## 2. Quickstart

### Step 1: Clone sibling repositories
Ensure all 3 sibling repositories are cloned inside a single parent folder:
```bash
capstone/
├── treklink-docs/      # Single Source of Truth & conventions
├── treklink-firmware/  # Inherited LoRa mesh firmware (read-only)
└── treklink-web/       # This repository (active code)
```

### Step 2: Environment Configuration
Copy the example environment file:
```bash
cp .env.example .env
```

### Step 3: Start Infrastructure Services
Spin up local PostgreSQL and Mosquitto MQTT broker via Docker Compose:
```bash
docker compose up -d
```

### Step 4: Install Dependencies
From the repository root:
```bash
npm install
```

### Step 5: Start Development Services
Run all services concurrently:
```bash
npm run dev
```
Or start individual packages:
- Backend: `npm run dev:backend` (Runs on `http://localhost:3000`, API docs at `/api/docs`)
- Gateway: `npm run dev:gateway` (Runs on `http://localhost:3001`)
- Frontend: `npm run dev:frontend` (Runs on `http://localhost:5173`)

---

## 3. Engineering Conventions & Git Workflow

- **SSOT Documentation**: Refer to [`../treklink-docs/README.md`](../treklink-docs/README.md).
- **Branching Model**: Active development integrates into `dev`. Mainline demo-ready branch is `main`.
- **Commit Convention**: Bracket tags are mandatory (`[Feature]`, `[Fix]`, `[Refactor]`, `[Test]`, `[Spec]`, `[Chore]`).
- **Spec-Driven**: Never write production code before requirements (EARS), design, and tasks are defined in `specs/{module}/`.
- **AI Agents**: See [`AGENTS.md`](./AGENTS.md) for strict pre-action and epistemic rules.
