// BlastSimulator2026 — Central game state
// Pure data. No side effects. All game data lives here.

import { STARTING_CASH } from '../config/balance.js';
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
import type { EmployeeState, SkillCategory } from '../entities/Employee.js';
import { createEmployeeState } from '../entities/Employee.js';
import type { VehicleRole } from '../entities/Vehicle.js';
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
import type { SitePolicy } from '../entities/SitePolicy.js';
import { createSitePolicy } from '../entities/SitePolicy.js';

/** Save format version — increment when GameState shape changes. */
export const SAVE_VERSION = 3;

export interface GameConfig {
  seed: number;
  mineType?: string;
  startingCash?: number;
}

/** The type of action a player has issued, waiting for an employee to execute. */
export type ActionType =
  | 'drill_hole'
  | 'charge_hole'
  | 'set_sequence'
  | 'place_building'
  | 'demolish_building'
  | 'survey'
  | 'fragment_debris'
  | 'haul_debris'
  | 'rest';

/** A lightweight renderer preview entry — mirrors a PendingAction for ghost-mesh display. */
export interface GhostPreview {
  id: number;
  type: ActionType;
  targetX: number;
  targetZ: number;
  targetY: number;
}

/** A pending action waiting for a qualified employee to execute it. */
export interface PendingAction {
  id: number;
  type: ActionType;
  /** Required skill category, or null if no skill is required (e.g. rest). */
  requiredSkill: SkillCategory | null;
  /** Required vehicle role, or null if on-foot task. */
  requiredVehicleRole: VehicleRole | null;
  /** Grid position for ghost rendering and employee pathfinding. */
  targetX: number;
  targetZ: number;
  targetY: number;
  payload: Record<string, unknown>;
  /** If set, only this employee may claim the action. null = any qualified employee. */
  targetEmployeeId: number | null;
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

  // ── Campaign & Win/Lose ──

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
  /** Site policy governing shift scheduling and rest thresholds. */
  sitePolicy: SitePolicy;
  /** Whether the current level has ended (any game-over or completion). */
  levelEnded: boolean;
  /** Reason the level ended, or null if still active. */
  levelEndReason: 'completed' | 'bankruptcy' | 'arrest' | 'ecological_shutdown' | 'worker_revolt' | null;
  /** Pending actions waiting for qualified employees. */
  pendingActions: PendingAction[];
  /** Next ID to assign to a newly created PendingAction. */
  nextPendingActionId: number;
  /** Lightweight ghost-mesh preview entries for the renderer. */
  ghostPreviews: GhostPreview[];
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
    cash: config.startingCash ?? STARTING_CASH,
    drillHoles: [],
    chargesByHole: {},
    sequenceDelays: {},
    savedPlans: {},
    finances: createFinanceState(config.startingCash ?? STARTING_CASH),
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
    sitePolicy: createSitePolicy('shift_8h'),
    levelEnded: false,
    levelEndReason: null,
    pendingActions: [],
    nextPendingActionId: 1,
    ghostPreviews: [],
  };
}
