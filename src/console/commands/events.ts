// BlastSimulator2026 — Console commands for events, corruption, mafia, and time (Phase 6)
// Split into cohesive modules (#695) — this file is now a barrel re-exporting
// the same public names it exported before the split.

export { buildEventContext, eventCommand } from './eventResolution.js';
export { tickCommand } from './tick.js';
export { corruptCommand } from './corruption.js';
export { mafiaCommand } from './mafia.js';
export { timeCommand } from './time.js';
