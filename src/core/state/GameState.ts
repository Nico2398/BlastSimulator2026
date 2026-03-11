// BlastSimulator2026 — Central game state
// Pure data. No side effects. All game data lives here.

/** Save format version — increment when GameState shape changes. */
export const SAVE_VERSION = 1;

export interface GameConfig {
  seed: number;
}

/**
 * The full game state — a single serializable object.
 * Every system reads/writes to this. Save/load serializes this to JSON.
 */
export interface GameState {
  version: number;
  seed: number;

  /** Elapsed game time in milliseconds. */
  time: number;
  /** Number of ticks processed. */
  tickCount: number;
  /** Speed multiplier: 1, 2, 4, or 8. */
  timeScale: number;
  /** Whether the game loop is paused. */
  isPaused: boolean;

  // Subsystem state slots — populated as phases are implemented
  // world: WorldState;
  // economy: EconomyState;
  // employees: EmployeeState[];
  // vehicles: VehicleState[];
  // buildings: BuildingState[];
  // events: EventState;
  // campaign: CampaignState;
  // scores: ScoreState;
}

/** Create a fresh GameState from config. */
export function createGame(config: GameConfig): GameState {
  return {
    version: SAVE_VERSION,
    seed: config.seed,
    time: 0,
    tickCount: 0,
    timeScale: 1,
    isPaused: false,
  };
}
