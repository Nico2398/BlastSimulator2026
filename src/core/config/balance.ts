// BlastSimulator2026 — Centralized Game Balance Configuration
// All tunable game constants live here. Human can adjust these values during polish.
// Real-world research notes are included for each value.

// ─── Economy ──────────────────────────────────────────────────────────────────

/** Starting cash for a new game ($). Real open-pit mines cost $10M+ to open; scaled down for gameplay. */
export const STARTING_CASH = 50_000;

/** Ticks between employee pay cycles. 1 tick = 1 game-hour; 10 ticks ≈ 10 game-hours. */
export const PAY_CYCLE_TICKS = 10;

/** Hiring cost by role ($). Reflects real mining labor markets, scaled ~100×. */
export const HIRING_COSTS = {
  driller: 1000,
  blaster: 1500,
  driver: 800,
  surveyor: 1200,
  manager: 2000,
} as const;

/** Base salary per pay cycle by role ($). Real miners: $25–80k/year; scaled per tick. */
export const BASE_SALARIES = {
  driller: 500,
  blaster: 700,
  driver: 400,
  surveyor: 600,
  manager: 1000,
} as const;

/** Contract refresh interval in ticks. */
export const CONTRACT_REFRESH_INTERVAL = 20;
/** New contracts generated per refresh. */
export const CONTRACTS_PER_REFRESH = 3;
/** Max contracts available at once. */
export const MAX_AVAILABLE_CONTRACTS = 8;

/** Ore contract prices per kg ($). Blingite/sparkium are rare/valuable; dirtite is common. */
export const ORE_PRICES = {
  dirtite: 2,
  rustite: 4,
  blingite: 12,
  gloomium: 7,
  sparkium: 15,
  craktonite: 6,
  absurdium: 20,
  treranium: 9,
} as const;

/** Rubble disposal price per kg ($). Negative = cost to haul; positive = revenue from sale. */
export const RUBBLE_DISPOSAL_PRICE = 0.5;

// ─── Corruption ────────────────────────────────────────────────────────────────

/** Base bribery success rate (0–1). Real bribery conviction rates ~5–20%; we make it generous. */
export const BRIBERY_BASE_SUCCESS = 0.7;
/** Per-bribery reduction to success rate. */
export const BRIBERY_HISTORY_PENALTY = 0.03;
/** Number of bribes before mafia gets involved. */
export const MAFIA_UNLOCK_THRESHOLD = 3;

/** Bribery target costs ($). Inspector: cheap; Council: expensive. */
export const BRIBERY_COSTS = {
  inspector: 5000,
  council: 15000,
  judge: 25000,
  police: 8000,
} as const;

// ─── Scores ────────────────────────────────────────────────────────────────────

/** Score decay rate per tick (0–100 scale). All scores trend toward 50 without input. */
export const SCORE_DECAY_RATE = 0.05;

// ─── Campaign / Win-Lose Thresholds ────────────────────────────────────────────

/** Cash below which bankruptcy warning fires ($). */
export const BANKRUPTCY_THRESHOLD = 5_000;
/** Ticks of negative cash before game-over. */
export const BANKRUPTCY_GRACE_TICKS = 100;
/** Ticks before bankruptcy at which warning is shown. */
export const BANKRUPTCY_WARNING_TICKS = 30;

/** Ticks of ecology ≤ 0 before ecological shutdown. */
export const ECOLOGICAL_SHUTDOWN_TICKS = 150;
/** Ticks before shutdown at which warning is shown. */
export const ECOLOGICAL_WARNING_TICKS = 50;

/** Corruption exposure threshold (0–1) for criminal arrest. */
export const ARREST_EXPOSURE_THRESHOLD = 0.9;

/** Ticks of worker morale crisis before revolt. */
export const REVOLT_TICKS = 120;
/** Ticks before revolt at which warning is shown. */
export const REVOLT_WARNING_TICKS = 40;

// ─── Event System ──────────────────────────────────────────────────────────────

/** Base timer (ticks) between events per category. Higher = rarer. */
export const EVENT_BASE_TIMERS = {
  union: 25,
  politics: 40,
  weather: 30,
  mafia: 50,
  lawsuit: 35,
} as const;

// ─── Traffic ───────────────────────────────────────────────────────────────────

/** Minimum number of vehicles waiting on the same target cell to trigger a traffic jam. */
export const TRAFFIC_JAM_MIN_VEHICLES = 3;

/** Minimum consecutive waiting ticks per vehicle before it counts toward a traffic jam. */
export const TRAFFIC_JAM_MIN_TICKS = 10;

// ─── Mining & Blasting ─────────────────────────────────────────────────────────

/** Max fragments generated per voxel during a blast. Caps fragment count for performance. */
export const MAX_FRAGMENTS_PER_VOXEL = 20;

/** Speed threshold (m/s) above which a fragment is classified as a dangerous projection.
 *  Real blasting: fly-rock can travel 500m+ at high speed. Scaled for gameplay. */
export const PROJECTION_SPEED_THRESHOLD = 15;

/** Epsilon for blast energy attenuation formula (prevents division by zero). */
export const BLAST_ENERGY_EPSILON = 4.0;

// ─── Game Loop ──────────────────────────────────────────────────────────────────

/** Duration of one game tick in real milliseconds at 1× speed. 1 tick = 1 game-hour. */
export const BASE_TICK_MS = 1000;

/** Allowed game speed multipliers. */
export const VALID_SPEEDS = [1, 2, 4, 8] as const;

// ─── Auto-save ─────────────────────────────────────────────────────────────────

/** Auto-save interval in ticks (at 1×, 1 tick = 1s real time). Default: every 5 minutes. */
export const AUTO_SAVE_INTERVAL_TICKS = 300;

/** Number of save slots. */
export const SAVE_SLOT_COUNT = 5;

// ─── Performance ───────────────────────────────────────────────────────────────

/** Maximum total fragments on screen before oldest are culled. */
export const MAX_TOTAL_FRAGMENTS = 2000;

/** Terrain re-mesh radius in chunks after a blast (only nearby chunks update). */
export const BLAST_REMESH_RADIUS_CHUNKS = 2;

// ─── Buildings ─────────────────────────────────────────────────────────────────

/** Productivity well-being multiplier from Living Quarters by tier (and absent). */
export const LIVING_QUARTERS_WELLBEING_MULTIPLIERS = {
  absent: 0.85,
  t1: 0.90,
  t2: 1.00,
  t3: 1.10,
} as const;

/** Additional well-being penalty applied when employee count exceeds bed capacity. */
export const LIVING_QUARTERS_OVERCAPACITY_PENALTY = 0.10;

// ─── Vehicles ──────────────────────────────────────────────────────────────────

/**
 * Speed, capacity, workRate, HP, and cost scaling multipliers per equipment tier.
 * Tier 1 is the baseline (×1.0 for all stats).
 * Real-world reference: CAT 797F hauls ~363t; Liebherr R 9800 excavates ~42m³/pass.
 * Values scaled for gameplay.
 */
export const VEHICLE_TIER_MULTIPLIERS = {
  1: { speed: 1.0, capacity: 1.0, workRate: 1.0, maxHp: 1.0, purchaseCost: 1.0, maintenanceCostPerTick: 1.0, fuelCostPerTick: 1.0 },
  2: { speed: 1.3, capacity: 1.6, workRate: 1.4, maxHp: 1.5, purchaseCost: 2.0, maintenanceCostPerTick: 1.4, fuelCostPerTick: 1.4 },
  3: { speed: 1.8, capacity: 2.5, workRate: 2.0, maxHp: 2.2, purchaseCost: 4.0, maintenanceCostPerTick: 2.0, fuelCostPerTick: 2.0 },
} as const;

/** Tier-1 (base) stats for each vehicle role. Units: $, kg, m³, grid cells/tick. */
export const VEHICLE_BASE_STATS = {
  /** ~200 kg payload; cost scaled from real $1–5M dump trucks; diesel ~$150/hr scaled. */
  debris_hauler:      { workRate: 10, purchaseCost: 25_000, maintenanceCostPerTick: 3, fuelCostPerTick: 5, capacity: 200, speed: 3, maxHp: 100 },
  /** ~8 m³/tick excavation; most expensive vehicle — the key production bottleneck. */
  rock_digger:        { workRate: 8,  purchaseCost: 50_000, maintenanceCostPerTick: 5, fuelCostPerTick: 8, capacity: 50,  speed: 1, maxHp: 150 },
  /** 5 progress units/tick per hole; capacity = 2 holes/tick. */
  drill_rig:          { workRate: 5,  purchaseCost: 35_000, maintenanceCostPerTick: 4, fuelCostPerTick: 6, capacity: 2,   speed: 1, maxHp: 120 },
  /** 12 damage units/tick; ~100 kg/tick clearing rate. */
  building_destroyer: { workRate: 12, purchaseCost: 30_000, maintenanceCostPerTick: 4, fuelCostPerTick: 7, capacity: 100, speed: 2, maxHp: 130 },
  /** 9 fragments/tick output; ~90 kg/tick fragmentation throughput. */
  rock_fragmenter:    { workRate: 9,  purchaseCost: 32_000, maintenanceCostPerTick: 4, fuelCostPerTick: 7, capacity: 90,  speed: 2, maxHp: 125 },
} as const;
