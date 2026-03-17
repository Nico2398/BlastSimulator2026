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
import type { EventSystemState } from '../events/EventSystem.js';
import { createEventSystemState } from '../events/EventSystem.js';
import type { CorruptionState } from '../economy/Corruption.js';
import { createCorruptionState } from '../economy/Corruption.js';
import type { MafiaState } from '../events/MafiaActions.js';
import { createMafiaState } from '../events/MafiaActions.js';
import type { CampaignState } from '../campaign/Campaign.js';
import { createCampaignState } from '../campaign/Campaign.js';
import type { BankruptcyState } from '../campaign/Bankruptcy.js';
import { createBankruptcyState } from '../campaign/Bankruptcy.js';
import type { ArrestState } from '../campaign/CriminalArrest.js';
import { createArrestState } from '../campaign/CriminalArrest.js';
import type { EcologicalState } from '../campaign/EcologicalDisaster.js';
import { createEcologicalState } from '../campaign/EcologicalDisaster.js';
import type { RevoltState } from '../campaign/WorkerRevolt.js';
import { createRevoltState } from '../campaign/WorkerRevolt.js';
import type { LevelStats } from '../campaign/SuccessTracker.js';
import { createLevelStats } from '../campaign/SuccessTracker.js';

/** Save format version — increment when GameState shape changes. */
export const SAVE_VERSION = 2;

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
  /** Event system state (timers, pending events, follow-up queue). */
  events: EventSystemState;
  /** Corruption state (bribery history, mafia unlock). */
  corruption: CorruptionState;
  /** Mafia state (exposure, smuggling, frames). */
  mafia: MafiaState;

  // ── Phase 7: Campaign & Win/Lose ──

  /** Campaign progression (unlocked levels, profit history). Persists across level restarts. */
  campaign: CampaignState;
  /** Bankruptcy tracker (resets each level). */
  bankruptcy: BankruptcyState;
  /** Criminal arrest tracker (resets each level). */
  arrest: ArrestState;
  /** Ecological shutdown tracker (resets each level). */
  ecological: EcologicalState;
  /** Worker revolt tracker (resets each level). */
  revolt: RevoltState;
  /** Per-level success statistics. */
  levelStats: LevelStats;
  /** Whether the current level has ended (any game-over or completion). */
  levelEnded: boolean;
  /** Reason the level ended, or null if still active. */
  levelEndReason: 'completed' | 'bankruptcy' | 'arrest' | 'ecological_shutdown' | 'worker_revolt' | null;
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

import { STARTING_CASH } from '../config/balance.js';
const DEFAULT_STARTING_CASH = STARTING_CASH;

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
    events: createEventSystemState(),
    corruption: createCorruptionState(),
    mafia: createMafiaState(),
    campaign: createCampaignState(),
    bankruptcy: createBankruptcyState(),
    arrest: createArrestState(),
    ecological: createEcologicalState(),
    revolt: createRevoltState(),
    levelStats: createLevelStats(),
    levelEnded: false,
    levelEndReason: null,
  };
}
