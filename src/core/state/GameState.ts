// BlastSimulator2026 — Central game state
// Pure data. No side effects. All game data lives here.

import type { DrillHole } from '../mining/DrillPlan.js';
import type { HoleCharge } from '../mining/ChargePlan.js';
import type { FinanceState } from '../economy/Finance.js';
import { createFinanceState } from '../economy/Finance.js';
import type { ContractState } from '../economy/Contract.js';
import { createContractState } from '../economy/Contract.js';
import type { LogisticsState } from '../economy/Logistics.js';
import { createLogisticsState } from '../economy/Logistics.js';
import type { BuildingState } from '../entities/Building.js';
import { createBuildingState } from '../entities/Building.js';
import type { VehicleState } from '../entities/Vehicle.js';
import { createVehicleState } from '../entities/Vehicle.js';
import type { EmployeeState } from '../entities/Employee.js';
import { createEmployeeState } from '../entities/Employee.js';
import type { ScoreState } from '../scores/ScoreManager.js';
import { createScoreState } from '../scores/ScoreManager.js';
import type { DamageState } from '../entities/Damage.js';
import { createDamageState } from '../entities/Damage.js';
import type { ZoneState } from '../entities/Zone.js';
import { createZoneState } from '../entities/Zone.js';

/** Save format version — increment when GameState shape changes. */
export const SAVE_VERSION = 1;

export interface GameConfig {
  seed: number;
  mineType?: string;
  startingCash?: number;
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

  /** Mine type preset ID used for this game. */
  mineType: string;

  /** World terrain — not serialized directly (too large), reconstructed from seed. */
  world: WorldState | null;

  /** Set of surveyed column keys "x,z". */
  surveyedPositions: Set<string>;

  /** Player cash balance. */
  cash: number;

  /** Current drill plan holes. */
  drillHoles: DrillHole[];

  /** Current charge plan per hole (keyed by hole ID). */
  chargesByHole: Record<string, HoleCharge>;

  /** Detonation sequence: hole ID → delay in ms. */
  sequenceDelays: Record<string, number>;

  /** Named saved blast plans. */
  savedPlans: Record<string, SavedBlastPlan>;

  /** Finance system state. */
  finances: FinanceState;
  /** Contract system state. */
  contracts: ContractState;
  /** Fragment logistics state. */
  logistics: LogisticsState;

  /** Building state. */
  buildings: BuildingState;
  /** Vehicle fleet state. */
  vehicles: VehicleState;
  /** Employee state. */
  employees: EmployeeState;
  /** Score state (well-being, safety, ecology, nuisance). */
  scores: ScoreState;
  /** Damage/accident tracking. */
  damage: DamageState;
  /** Safety zone state. */
  zone: ZoneState;
}

export interface WorldState {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  /** The VoxelGrid is NOT stored in JSON — it's regenerated from seed on load. */
  gridReady: boolean;
}

export interface SavedBlastPlan {
  drillHoles: DrillHole[];
  chargesByHole: Record<string, HoleCharge>;
  sequenceDelays: Record<string, number>;
}

const DEFAULT_STARTING_CASH = 50000;

/** Create a fresh GameState from config. */
export function createGame(config: GameConfig): GameState {
  return {
    version: SAVE_VERSION,
    seed: config.seed,
    time: 0,
    tickCount: 0,
    timeScale: 1,
    isPaused: false,
    mineType: config.mineType ?? 'desert',
    world: null,
    surveyedPositions: new Set(),
    cash: config.startingCash ?? DEFAULT_STARTING_CASH,
    drillHoles: [],
    chargesByHole: {},
    sequenceDelays: {},
    savedPlans: {},
    finances: createFinanceState(config.startingCash ?? DEFAULT_STARTING_CASH),
    contracts: createContractState(),
    logistics: createLogisticsState(),
    buildings: createBuildingState(),
    vehicles: createVehicleState(),
    employees: createEmployeeState(),
    scores: createScoreState(),
    damage: createDamageState(),
    zone: createZoneState(),
  };
}
