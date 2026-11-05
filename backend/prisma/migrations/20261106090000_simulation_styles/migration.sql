-- Movement styles of the field simulation (specs/demo/design.md section 9.1, leader ruling 2026-11-06).
-- Additive: existing nodes keep a null style, which keeps the steady walk at their speed.
CREATE TYPE "SimulationStyle" AS ENUM ('JOGGER', 'HIKER', 'CAMPER', 'EXPLORER', 'TRAIL_WALKER', 'WANDERER', 'GROUP_FOLLOWER', 'STRAGGLER');

ALTER TABLE "simulated_nodes" ADD COLUMN "style" "SimulationStyle";
ALTER TABLE "simulated_nodes" ADD COLUMN "styleSeed" INTEGER NOT NULL DEFAULT 0;
