// BlastSimulator2026 — Central game state
// Pure data. No side effects. All game data lives here.

import { STARTING_CASH, STARTING_SITE_STAFFED_COMPOSITION } from '../config/balance.js';
import type { DrillHole, PlannedHole } from '../mining/DrillPlan.js';
import type { HoleCharge, PlannedCharge } from '../mining/ChargePlan.js';
import type { SurveyResult } from '../mining/SurveyCalc.js';
import type { BlastOreReport } from '../mining/BlastOreReport.js';
import type { BlastReport } from '../mining/BlastExecution.js';
import type { BlastPreviewSummary } from '../mining/Software.js';
import type { TubingState } from '../mining/Tubing.js';
import { createTubingState } from '../mining/Tubing.js';
import type { FinanceState } from '../economy/Finance.js';
import { createFinanceState } from '../economy/Finance.js';
import type { ContractState } from '../economy/Contract.js';
import { createContractState } from '../economy/Contract.js';
import type { LogisticsState } from '../economy/Logistics.js';
import { createLogisticsState } from '../economy/Logistics.js';
import type { BuildingState, Building } from '../entities/Building.js';
import { createBuildingState } from '../entities/Building.js';
import { NavGrid } from '../nav/NavGrid.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { SerializedVoxels } from './VoxelGridCodec.js';
import type { VehicleState } from '../entities/Vehicle.js';
import { createVehicleState, purchaseVehicle } from '../entities/Vehicle.js';
import type { EmployeeState, SkillCategory } from '../entities/Employee.js';
import { createEmployeeState, hireEmployee, calculateSalary } from '../entities/Employee.js';
import type { VehicleRole } from '../entities/Vehicle.js';
import { Random } from '../math/Random.js';
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
// v8 -> v9: Employee gained a `taskQueue: number[]` field (#549 cost-based
// per-employee action selection). See SaveLoad.ts's migrateV8ToV9 stub.
// v9 -> v10: Vehicle gained a `reservedForActionId: number | null` field
// (#550 vehicle-gated actions become executable). See SaveLoad.ts's
// migrateV9ToV10 stub.
// v10 -> v11: GameState gained `plannedDrillHoles: PlannedHole[]` (#553
// drilling becomes work — a drill plan queues one `drill_hole` action per
// hole instead of writing holes into state instantly). See SaveLoad.ts's
// migrateV10ToV11 stub.
// v11 -> v12: GameState gained `plannedChargesByHole: Record<string,
// PlannedCharge>` (#554 charging becomes work — a charge order queues one
// `charge_hole` action per hole instead of writing charges into state
// instantly). See SaveLoad.ts's migrateV11ToV12 stub.
export const SAVE_VERSION = 12;

export interface GameConfig {
  seed: number;
  mineType?: string;
  startingCash?: number;
  eventFreqMultiplier?: number;
  /** Opt-in: opens the site with a pre-hired roster and pre-purchased vehicle fleet (#551). */
  staffed?: boolean;
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
  | 'rest'
  | 'general_work';

/**
 * Lifecycle status of a PendingAction — 'queued' (waiting, unclaimed),
 * 'assigned' (claimed by an employee still walking to the target), or
 * 'in_progress' (the employee has arrived and is executing it). The record
 * (and its ghost) is only removed on completion (#547).
 */
export type PendingActionStatus = 'queued' | 'assigned' | 'in_progress';

/** A lightweight renderer preview entry — mirrors a PendingAction for ghost-mesh display. */
export interface GhostPreview {
  id: number;
  type: ActionType;
  targetX: number;
  targetZ: number;
  targetY: number;
  /** True once an employee has claimed the underlying action (#547). */
  claimed: boolean;
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
  /** Lifecycle status — see PendingActionStatus (#547). */
  status: PendingActionStatus;
  /** Employee currently holding (assigned to/working) this action, or null while 'queued' (#547). Distinct from targetEmployeeId, which restricts eligibility rather than recording who claimed it. */
  holderId: number | null;
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

  /** Navigation grid derived from the voxel surface, buildings, and drill holes. Null until built. */
  navGrid: NavGrid | null;

  /** Set of surveyed column keys "x,z". */
  surveyedPositions: Set<string>;
  /** Completed survey records, ordered by completedTick. */
  surveyResults: SurveyResult[];
  /** Next ID to assign to a newly created SurveyResult. */
  nextSurveyId: number;

  /** Player cash balance. */
  cash: number;

  /** Current drill plan holes. */
  drillHoles: DrillHole[];

  /** Holes ordered but not yet drilled — each queues one `drill_hole` action and lands in `drillHoles` on completion (#553). */
  plannedDrillHoles: PlannedHole[];

  /** Current charge plan per hole (keyed by hole ID). */
  chargesByHole: Record<string, HoleCharge>;

  /** Charges ordered but not yet loaded — each queues one `charge_hole` action and lands in `chargesByHole` on completion (#554). */
  plannedChargesByHole: Record<string, PlannedCharge>;

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
  /** Accumulated ore collected from fragments, keyed by ore type ID, value in kg. */
  collectedOre: Record<string, number>;

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
  /** Ore report from the most recent blast, or null if no blast has occurred yet. */
  lastOreReport: BlastOreReport | null;
  /** Structured summary of the most recent blast, for BlastReportModal (redesign P4/§5.A). Null until the first blast. */
  lastBlastReport: BlastReport | null;
  /** Purchased blast-preview software tier (0 = none, up to MAX_SOFTWARE_TIER). */
  softwareTier: number;
  /** Structured result of the last blast_preview run, for the Preview step (redesign P4/§5). Null until first run. */
  lastBlastPreview: BlastPreviewSummary | null;
  /** Tubing inventory and installed-hole set, for waterproofing charges against rain. */
  tubingState: TubingState;
}

export interface WorldState {
  /**
   * Width of the site's live bounding box, NOT an upper bound on x: the site
   * grows as the player claims chunks (#473), so iterate `minX .. minX+sizeX`
   * rather than `0 .. sizeX`.
   */
  sizeX: number;
  sizeY: number;
  /** Depth of the site's live bounding box. See `sizeX`. */
  sizeZ: number;
  /** West edge of the bounding box. 0 for a site that has never grown west. */
  minX: number;
  /** North edge of the bounding box. 0 for a site that has never grown north. */
  minZ: number;
  /**
   * The level's original width/depth — the generation datum every chunk,
   * however late it is claimed, is generated against (#473 D3). Unlike
   * `sizeX`/`sizeZ` these never change.
   */
  baseSizeX: number;
  baseSizeZ: number;
  /** The VoxelGrid is not stored directly — either restored from `voxels` (v6+) or regenerated from seed. */
  gridReady: boolean;
  /**
   * Serialized playable voxel data (v6+, #458 T0.3), embedded lazily right
   * before a save — see saveCommand / SavesModal's getState callback. Absent
   * on saves from before v6 or on a state that hasn't been saved yet; a
   * loader falls back to regenerating pristine terrain from the seed in that
   * case (the pre-v6 behaviour — blast craters/ramps don't survive that path).
   */
  voxels?: SerializedVoxels;
}

export interface SavedBlastPlan {
  drillHoles: DrillHole[];
  chargesByHole: Record<string, HoleCharge>;
  sequenceDelays: Record<string, number>;
}

/** A world state for a site that starts as the square `sizeX × sizeZ` at the origin, before any expansion (#473). */
export function createWorldState(sizeX: number, sizeY: number, sizeZ: number, gridReady: boolean): WorldState {
  return {
    sizeX, sizeY, sizeZ,
    minX: 0, minZ: 0,
    baseSizeX: sizeX, baseSizeZ: sizeZ,
    gridReady,
  };
}

/** Create a fresh GameState from config. */
export function createGame(config: GameConfig): GameState {
  const state: GameState = {
    version: SAVE_VERSION,
    seed: config.seed,
    time: 0,
    tickCount: 0,
    timeScale: 1,
    isPaused: false,
    mineType: config.mineType ?? 'desert',
    world: null,
    navGrid: null,
    surveyedPositions: new Set(),
    surveyResults: [],
    nextSurveyId: 1,
    cash: config.startingCash ?? STARTING_CASH,
    drillHoles: [],
    plannedDrillHoles: [],
    chargesByHole: {},
    plannedChargesByHole: {},
    sequenceDelays: {},
    savedPlans: {},
    finances: createFinanceState(config.startingCash ?? STARTING_CASH),
    contracts: createContractState(),
    logistics: createLogisticsState(),
    collectedOre: {},
    buildings: createBuildingState(),
    vehicles: createVehicleState(),
    employees: createEmployeeState(),
    scores: createScoreState(),
    damage: createDamageState(),
    zone: createZoneState(),
    events: createEventSystemState(config.eventFreqMultiplier ?? 1),
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
    lastOreReport: null,
    lastBlastReport: null,
    softwareTier: 0,
    lastBlastPreview: null,
    tubingState: createTubingState(),
  };

  if (config.staffed) {
    applyStaffedComposition(state);
  }

  return state;
}

/**
 * Hires STARTING_SITE_STAFFED_COMPOSITION.employees and purchases
 * STARTING_SITE_STAFFED_COMPOSITION.vehicles into `state`, for the opt-in
 * staffed starting site (#551). Called from `createGame` when `config.staffed`
 * is truthy; the roster and fleet composition are defined in
 * `STARTING_SITE_STAFFED_COMPOSITION` (src/core/config/balance.ts).
 */
function applyStaffedComposition(state: GameState): void {
  const rng = new Random(state.seed);

  // Small deterministic offsets near the site origin — no navGrid exists yet
  // (this runs before regenerateGrid), so there is no reachable-cell snap
  // available; simple staggered placement is all that's needed here.
  STARTING_SITE_STAFFED_COMPOSITION.employees.forEach((slot, i) => {
    const { employee } = hireEmployee(state.employees, slot.role, rng, i * 2, 0, state.tickCount);
    // Staffing is free at game-open — hiringCost is intentionally not deducted from cash.
    employee.qualifications = slot.qualifications.map(q => ({
      category: q.category,
      proficiencyLevel: q.proficiencyLevel,
      xp: 0,
    }));
    employee.salary = calculateSalary(employee);
  });

  STARTING_SITE_STAFFED_COMPOSITION.vehicles.forEach((slot, i) => {
    // Purchase cost is intentionally not deducted from cash, same as hiring above.
    purchaseVehicle(state.vehicles, slot.role, i * 2, 2, slot.tier);
  });
}

/**
 * Build a NavGrid from the current world state and store it on the game state.
 * Call this after terrain generation (VoxelGrid is ready) to make navigation available.
 * If the voxel grid is degenerate (sizeX <= 0 or sizeZ <= 0), navGrid stays null.
 */
export function buildGameNavGrid(
  state: GameState,
  voxelGrid: VoxelGrid,
  buildings: Building[],
  drillHoles: DrillHole[],
): void {
  if (voxelGrid.sizeX <= 0 || voxelGrid.sizeZ <= 0) return;
  state.navGrid = NavGrid.buildNavGrid(voxelGrid, buildings, drillHoles);
}

/**
 * Copy the grid's live bounding box onto `state.world`, so everything reading
 * the state dump (minimap, UI pickers, interaction mode) follows the site as
 * it grows. `baseSizeX`/`baseSizeZ` are left untouched — they are the
 * generation datum, not a measurement of the site.
 */
export function syncWorldBounds(state: GameState, voxelGrid: VoxelGrid): void {
  if (!state.world) return;
  state.world.minX = voxelGrid.minX;
  state.world.minZ = voxelGrid.minZ;
  state.world.sizeX = voxelGrid.sizeX;
  state.world.sizeZ = voxelGrid.sizeZ;
}
