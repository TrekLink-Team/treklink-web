-- W43 additive controls: demo-owned provenance and profile snapshot only.
CREATE TABLE "demo_scenario_runs" (
  "id" SERIAL PRIMARY KEY,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "records" JSONB NOT NULL DEFAULT '[]',
  "error" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "demo_control_states" (
  "id" TEXT PRIMARY KEY,
  "version" INTEGER NOT NULL DEFAULT 0,
  "snapshot" JSONB
);
