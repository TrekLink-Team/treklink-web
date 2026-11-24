// Demo tool constants of the demo panel (specs/demo/design.md §11, D-110). They bound the password guard
// and the reseed of a demo tool, not a business rule, so they live here as the simulation constants of
// design §9 live in field-simulation.ts. D-110 rule 4 sets the five minutes between reseeds.

// Wrong or missing passwords one client address may send in one window before it is refused (REQ-PNL-11).
export const PANEL_MAX_FAILURES = 5;
// The fixed window of the failure count, from the first failure (REQ-PNL-11).
export const PANEL_FAILURE_WINDOW_MS = 10 * 60_000;
// The most client addresses the failure counter holds; expired windows are dropped first.
export const PANEL_FAILURE_CAPACITY = 10_000;
// The least time between two reseeds (D-110 rule 4, REQ-PNL-12).
export const PANEL_RESET_SPACING_MS = 5 * 60_000;
// The typed confirmation of a reseed (REQ-PNL-09).
export const PANEL_RESET_CONFIRMATION = 'RESET DEMO DATA';
// The request header that carries the panel password (REQ-PNL-02).
export const PANEL_PASSWORD_HEADER = 'x-demo-panel-password';
// The audit role of a panel command (REQ-PNL-04) and the registry actor of its demo run.
export const PANEL_AUDIT_ROLE = 'DEMO_PANEL';
export const PANEL_RUN_ACTOR = 'demo-panel';
