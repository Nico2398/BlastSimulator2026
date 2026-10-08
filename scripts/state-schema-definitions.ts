// BlastSimulator2026 — Game/UI state schema definitions
//
// Field-by-field schema for the state JSON validate-state-schema.ts checks
// scenario dumps against — one entry per field `serializeGameState()`
// (command mode) or `window.__gameState()` (interaction mode) emits. Split
// from the validator itself so a new field (one line here, same pattern as
// #553-#557) never competes with that script's own file-size budget.

export interface SchemaField {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';
  optional?: boolean;
  description?: string;
}

export type Schema = Record<string, SchemaField | Record<string, SchemaField>>;

/**
 * Game state schema — mirrors `SerializableGameState` in src/console-api.ts,
 * which is what both `serializeGameState()` (command mode) and
 * `window.__gameState()` (interaction mode) emit.
 *
 * Keep in lockstep with that interface. `tests/unit/console-api.test.ts`
 * asserts the emitted field set, so a field added there without a matching
 * entry here shows up as drift rather than passing silently.
 */
export const GAME_STATE_SCHEMA: Schema = {
  seed: { type: 'number', description: 'PRNG seed the game was created with' },
  time: { type: 'number', description: 'Elapsed game time' },
  tickCount: { type: 'number', description: 'Simulation ticks elapsed' },
  isPaused: { type: 'boolean' },
  timeScale: { type: 'number', description: 'Simulation speed multiplier (1/2/4/8) set by `time speed`' },
  mineType: { type: 'string', description: 'Terrain preset identifier' },
  weather: { type: 'string', optional: true, description: 'Current weather state (WeatherCycle.ts); null until a game exists (GameState.weather)' },
  worldSizeX: { type: 'number', optional: true, description: 'Live world bounding box (#473)' },
  worldSizeZ: { type: 'number', optional: true },
  worldMinX: { type: 'number', optional: true },
  worldMinZ: { type: 'number', optional: true },
  drillHoles: { type: 'array' },
  chargesByHole: { type: 'object' },
  finances: { type: 'object', description: 'Finance sub-state; cash mirrors the flat field' },
  holeCount: { type: 'number' },
  wetHoleCount: { type: 'number', description: 'Drill holes whose water level is past the wet threshold (wetHoles, #1350)' },
  orderedHoleCount: { type: 'number', description: 'Holes ordered but not yet drilled (state.plannedDrillHoles.length, #553)' },
  orderedChargeCount: { type: 'number', description: 'Charges ordered but not yet loaded (Object.keys(state.plannedChargesByHole).length, #554)' },
  orderedRampSegmentCount: { type: 'number', description: 'Segments ordered but not yet dug across all in-flight ramps (state.plannedRamps, #555)' },
  builtRampCount: { type: 'number', description: 'Finished ramps (state.builtRamps.length, #1298)' },
  builtRampWidth: { type: 'number', description: 'Width in voxels of the first built ramp, 0 when none is built (#1298)' },
  orderedBuildingCount: { type: 'number', description: 'Buildings ordered but not yet built (state.plannedBuildings.length, #556)' },
  chargedCount: { type: 'number' },
  researchQueueLength: { type: 'number', description: 'Research tasks queued at a Research Center, in progress or pending (state.buildings.researchQueue.length)' },
  surveyCount: { type: 'number', description: 'Completed survey results (state.surveyResults.length)' },
  unreachableGhostCount: { type: 'number', description: 'Ghost previews flagged unreachable (drawn red): no actor able to perform the action can reach it (state.ghostPreviews with unreachable === true)' },
  pendingActionCount: { type: 'number', description: 'Queued-but-not-yet-claimed PendingActions, including auto-inserted rest tasks (state.pendingActions.length)' },
  buildingCount: { type: 'number' },
  maxBuildingTier: { type: 'number', description: 'Highest tier among standing buildings, 0 when none' },
  vehicleCount: { type: 'number' },
  trafficJamCount: { type: 'number', description: 'Active traffic jams at chokepoints, silencing ignored (findTrafficJams, #1208)' },
  trafficJams: { type: 'array', description: 'One {kind, rampId} per active traffic jam; kind is ramp_head, pit_exit or passage (#1208)' },
  pendingEvent: { type: 'boolean', description: 'An event awaits the player\'s decision (state.events.pendingEvent !== null)' },
  vehicleBoardingCount: { type: 'number', description: 'Fleet-wide count of driver-boarding events (state.vehicles.driverBoardingCount, #1083)' },
  employeeCount: { type: 'number' },
  qualificationCount: { type: 'number', description: 'Qualifications held across the whole roster' },
  proficiencyTotal: { type: 'number', description: 'Sum of every held qualification\'s proficiency level' },
  trainingCount: { type: 'number', description: 'Employees currently enrolled in training' },
  collapsedCount: { type: 'number', description: 'Employees currently in the collapsing state' },
  minFatigue: { type: 'number', description: 'Lowest fatigue (0-100, 100=rested) across the roster — closest employee to collapse, 100 with none' },
  stuckEmployeeCount: { type: 'number', description: 'Employees currently in the isMoveStuck state — pathfinding failed STUCK_THRESHOLD consecutive times' },
  activeContractCount: { type: 'number', description: 'Contracts currently accepted and in progress (state.contracts.active)' },
  fillableOreSaleOffered: { type: 'boolean', description: 'An offered ore_sale asks for no more of its ore than storage already holds — the condition to wait on before accepting, since the pool re-rolls which ore and how much every refresh' },
  rubbleDisposalOffered: { type: 'boolean', description: 'At least one rubble_disposal offer is present in the pool — the condition to wait on before opening the Contracts panel for its Accept button, since the pool re-rolls its contents every refresh' },
  fillableSaleOffered: { type: 'boolean', description: 'The pool holds an ore_sale or rubble_disposal offer the site can fill in full right now (ore against collected ore, rubble against stored mass) — the free-play condition to wait on before clicking Accept' },
  deathCount: { type: 'number', description: 'Employees killed so far (state.damage.deathCount)' },
  levelEnded: { type: 'boolean' },
  levelEndReason: { type: 'string', optional: true, description: 'null while the level runs' },
  bankrupt: { type: 'boolean', description: 'Loss condition' },
  revolted: { type: 'boolean', description: 'Loss condition' },
  ecologicalShutdown: { type: 'boolean', description: 'Loss condition' },
  arrested: { type: 'boolean', description: 'Loss condition' },
  cash: { type: 'number' },
  profit: { type: 'number', description: 'Total wealth accumulated this level' },
  wellBeing: { type: 'number', description: '0-100 score (ScoreState)' },
  safety: { type: 'number', description: '0-100 score (ScoreState)' },
  ecology: { type: 'number', description: '0-100 score (ScoreState)' },
  nuisance: { type: 'number', description: '0-100 score (ScoreState)' },
  muckPile: { type: 'object', optional: true, description: 'Fragment size, speed and clearance spread after a blast' },
  storedMassKg: { type: 'number', description: 'Mass held in warehouse storage (LogisticsState.storedMassKg)' },
  collectedOreTotal: { type: 'number', description: 'Sum across every material key in state.collectedOre (kg, #671)' },
  dangerZoneClear: { type: 'boolean', description: 'computeDangerZone clear of every vehicle/employee (#557)' },
  corruptionLevel: { type: 'number', description: '0-100 corruption meter (CorruptionState.level, #1407)' },
};

/** UI state schema — mirrors window.__uiState() in src/main.ts. */
export const UI_STATE_SCHEMA: Schema = {
  panels: { type: 'object', description: 'Per-panel visibility and pointer-events' },
  blastPanelButtons: { type: 'array', description: 'Blast panel controls with computed styles' },
};
