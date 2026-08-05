// BlastSimulator2026 — Centralized Game Balance Configuration
// All tunable game constants live here. Human can adjust these values during polish.
// Real-world research notes are included for each value.

import type { BuildingType } from '../entities/Building.js';
import type { ResearchCondition } from '../entities/BuildingResearch.js';

// ─── Time ───────────────────────────────────────────────────────────────────────

/** Ticks per in-game day. 1 tick = 1 game-hour (see PAY_CYCLE_TICKS below). Matches TopBar's day/clock math. */
export const TICKS_PER_DAY = 24;

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

/** Minimum ticks that must elapse between consecutive events (2 min at 1× speed). */
export const MIN_EVENT_INTERVAL_TICKS = 120;

/** Random additional ticks (0 to value-1, i.e. 0–59 for value=60) added to the per-event cooldown. */
export const MIN_EVENT_INTERVAL_RANDOM_RANGE = 60;

/** Minimum number of user-initiated actions required between events. */
export const MIN_EVENT_INTERVAL_ACTIONS = 10;

// ─── Traffic ───────────────────────────────────────────────────────────────────

/** Minimum number of vehicles waiting on the same target cell to trigger a traffic jam. */
export const TRAFFIC_JAM_MIN_VEHICLES = 3;

/** Minimum consecutive waiting ticks per vehicle before it counts toward a traffic jam. */
export const TRAFFIC_JAM_MIN_TICKS = 10;

// ─── Vehicle Spawn Placement ────────────────────────────────────────────────────

/**
 * `vehicle buy` spreads new arrivals across a ring/grid pattern around the
 * depot point instead of stacking every purchase on one tile — a shared tile
 * fully occluded all but the tallest mesh (#411). SPAWN_RING_SIZE columns
 * before wrapping to the next row; SPAWN_TILE_SPACING tiles between spawns —
 * wide enough that adjacent vehicle meshes stay visually distinct (1-tile
 * spacing still let bodies merge, see TRAFFIC_JAM_MIN_TICKS's neighbour
 * vehicle-traffic-routing-visual fix) while staying near the depot.
 */
export const SPAWN_RING_SIZE = 3;
export const SPAWN_TILE_SPACING = 3;

/**
 * Render-only queue offsets for vehicles in the 'waiting' operational state
 * that share a contended target cell (#411 round 2). detectTrafficJam groups
 * waiting vehicles by exact targetX/targetZ, so the simulation intentionally
 * drives every contending vehicle toward the identical point — that grouping
 * must not change. Their *rendered* position, however, fanned out to
 * sub-tile-distance fractional coordinates as each approached along its own
 * path, fusing 3+ meshes into one blob. VehicleMesh spreads waiting vehicles
 * that share a target across these slots (world-unit offsets from the shared
 * target) purely for display — core vehicle.x/z and jam detection are
 * untouched. Reuses SPAWN_TILE_SPACING above rather than its own literal —
 * both need the same minimum gap (debris_hauler's widest body dimension is
 * 2.5, so anything much under 3 still overlaps), so one constant enforces it
 * for both instead of two numbers that could silently drift apart.
 */
const SPACING = SPAWN_TILE_SPACING;
export const WAITING_QUEUE_SLOT_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [SPACING, 0],
  [-SPACING, 0],
  [0, SPACING],
  [0, -SPACING],
  [SPACING, SPACING],
  [-SPACING, -SPACING],
  [SPACING, -SPACING],
];

// ─── Ore Report Events ───────────────────────────────────────────────────────────

/** Yield ratio threshold above which a blast is considered "Lucky Strike" (got more ore than surveyed). */
export const ORE_REPORT_LUCKY_RATIO = 1.2;

/** Yield ratio threshold below which a blast is considered "Barren Blast" (got less ore than surveyed). */
export const ORE_REPORT_BARREN_RATIO = 0.5;

/** Absurdium fraction threshold above which "Absurdium Jackpot" fires. */
export const ORE_REPORT_ABSURDIUM_FRACTION = 0.3;

// ─── Mining & Blasting ─────────────────────────────────────────────────────────

/** Maximum fragment volume (m³) that can be hauled directly without secondary fragmentation. */
export const OVERSIZED_FRAGMENT_THRESHOLD = 0.5;

/** Speed threshold (m/s) above which a fragment is classified as a dangerous projection.
 *  Real blasting: fly-rock can travel 500m+ at high speed. Scaled for gameplay. */
export const PROJECTION_SPEED_THRESHOLD = 15;

/** Epsilon for blast energy attenuation formula (prevents division by zero). */
export const BLAST_ENERGY_EPSILON = 4.0;

/** Energy below this (game energy units) is not worth propagating further, and is
 *  written off as dissipated. Rock absorption thresholds start at 200, so this is
 *  four orders of magnitude below anything that could fracture a voxel. */
export const PROPAGATION_ENERGY_EPSILON = 0.01;

/** Fraction of the energy passing through a voxel that is lost to heat and noise
 *  rather than handed to its neighbours, as
 *  `BASE + POROSITY_SCALE × porosity`.
 *  Porous rock damps a shock wave, dense rock carries it: across the catalog's
 *  porosity range (0.02–0.35) this spans roughly 9%–22% loss per voxel, which is
 *  what stops energy travelling forever and gives every blast a finite radius. */
export const TRANSMISSION_LOSS_BASE = 0.08;
export const TRANSMISSION_LOSS_POROSITY_SCALE = 0.40;

/** Kilograms of explosive that fill one metre of drill hole. Sets how long a
 *  charge column is, so a bigger charge works on a taller slice of rock instead
 *  of pushing harder on the same voxel. */
export const CHARGE_KG_PER_METRE = 2.0;

/** Converts catalog `energyPerKg` into the energy units voxel absorption thresholds
 *  are written in. The catalog numbers were tuned against an inverse-square field
 *  whose epsilon amplified them at close range; propagation conserves energy instead,
 *  so the conversion is explicit. Calibrated so a well-stemmed pattern breaks a
 *  realistic volume per kilogram (powder factor ≈ 0.3 kg/m³). */
export const EXPLOSIVE_ENERGY_SCALE = 10.0;

/** Kinetic energy (in joules) that one unit of blast energy imparts to a fragment
 *  it throws. Absorption thresholds are a balance scale rather than joules, so
 *  turning leftover energy into a speed needs an explicit conversion — without one
 *  a one-cubic-metre, two-tonne fragment could never reach a dangerous speed. */
export const PROJECTION_ENERGY_TO_KINETIC = 39000.0;

/** Share of a fragment's leftover energy that still throws it when its hole is
 *  perfectly stemmed. Stemming keeps the gases working on the rock instead of
 *  venting up the hole, so a well-stemmed shot breaks its burden and drops it,
 *  while an unstemmed one throws it — the difference between a good blast and
 *  flyrock over the pit. */
export const MIN_THROW_FRACTION = 0.05;

/** Fraction of its confined absorption threshold that rock at an open face needs
 *  before it breaks. Unconfined rock can shear and move instead of being crushed
 *  in place, which is the whole reason a bench blast breaks its burden out to the
 *  face rather than carving a sealed pocket underground. */
export const UNCONFINED_THRESHOLD_FACTOR = 0.35;

/** Metres of rock over a voxel before it counts as fully confined. */
export const CONFINEMENT_FULL_DEPTH = 6.0;

/** How strongly overflow prefers neighbours that are closer to a free face, per
 *  metre of relief gained. Spread evenly in all directions, a blast is a sphere
 *  that stalls at a fixed radius no matter how big the charge; real burden fails
 *  toward the face, which is what lets a bench blast break out to surface and
 *  what makes an over-buried charge fail to. */
export const FREE_FACE_BIAS = 2.0;

/** Thickest cap of intact rock (metres) that a blast can lift off an excavation
 *  it has undermined. Thicker burden bridges the gap and stays standing, which is
 *  what makes a charge buried too deep fail to break out to surface. */
export const BURDEN_BREAKOUT_MAX = 4;

/** Density at/above which a voxel is considered solid ground (0–1 scale). */
export const SOLID_VOXEL_DENSITY_THRESHOLD = 0.5;

/** Blast zone radius around each hole (voxels). Margin added to a blast's hole AABB
 *  to get the region actually affected — used both for BlastExecution's own cleared-
 *  region computation and, expanded further, for TerrainBody's collider-building scope. */
export const BLAST_ZONE_RADIUS = 5;

// ─── Fragment generation (blast step 3) ────────────────────────────────────────

/** How many pieces each axis of a broken voxel is diced into before fragments are
 *  clustered out of them. 2 gives 8 sub-cells of 0.125 m³ — fine enough for
 *  irregular shapes without making a large blast's clustering pass expensive. */
export const SUB_CELL_RESOLUTION = 2;

/** Seed points a barely-broken voxel contributes, and how many more it adds per
 *  unit of intensity above its breaking point. Below 1 the base means most gently
 *  broken voxels contribute none at all, so their rock joins a neighbour's
 *  fragment — which is exactly how an undercharged blast produces boulders. */
export const SEEDS_BASE = 0.35;
export const SEEDS_PER_INTENSITY = 0.8;

/** Ceiling on seeds from a single voxel, so one violently overcharged voxel cannot
 *  produce arbitrarily fine dust. */
export const MAX_SEEDS_PER_VOXEL = 8;

/** How far (voxels) a sub-cell will look for a seed to belong to. Rock further than
 *  this from any seed becomes an orphan lump instead. */
export const SEED_SEARCH_RADIUS = 3;

/** Largest orphan lump (in sub-cells) before it is split. 64 sub-cells is 8 m³ —
 *  a boulder well past what any hauler can take, which is the intended failure
 *  state for a blast that barely broke its rock. */
export const MAX_ORPHAN_COMPONENT_SUBCELLS = 64;

/** Guard on seeds per blast. Not a balance dial: fragment size must follow from the
 *  blast alone, so this only exists to stop pathological input from allocating
 *  without bound. Tripping it yields fewer, larger fragments — never less rock. */
export const MAX_FRAGMENTS_PER_BLAST = 50000;

// ─── Fragment throw and landing (blast step 4) ─────────────────────────────────

/** How much a fragment's direction follows the nearest free face rather than the
 *  energy gradient. Rock leaves by the face it can reach; the gradient alone would
 *  drive deep fragments further into solid rock. */
export const FREE_FACE_WEIGHT = 0.65;

/** Most fragments flown as independent bodies. Past this they are grouped, which
 *  caps the cost of motion without ever changing how the rock broke — grouped
 *  fragments split back into their own pieces the moment they land. */
export const MAX_ACTIVE_PROJECTILES = 256;

/** How close (metres) two fragments must be to travel as one projectile. */
export const PROJECTILE_GROUP_RADIUS = 2.0;

/** Minimum cosine between two fragments' headings for them to fly together —
 *  0.8 is about a 37 degree cone. */
export const PROJECTILE_GROUP_DIR_COS = 0.8;

/** Largest relative speed difference (0–1) between fragments flying together. */
export const PROJECTILE_GROUP_SPEED_TOL = 0.35;

/** Time step (seconds) when following a projectile's arc to the ground, and the
 *  longest flight worth tracing before setting the rock down where it got to.
 *  The limit has to clear the slowest possible flight or fast rock is abandoned
 *  mid-arc: straight up at MAX_PROJECTION_VELOCITY takes 16.3 s just to come
 *  back to the height it left, plus the fall into the pit below that. */
export const BALLISTIC_SAMPLE_DT = 0.05;
export const BALLISTIC_MAX_T = 30;

/** How widely a landed projectile's fragments scatter around its impact point,
 *  scaled by its mass. Without this a grouped projectile would drop its whole
 *  load on one square metre. */
export const SPLIT_SCATTER_RADIUS = 0.8;

/** Seconds of delay per metre of height before a collapsing fragment starts to
 *  fall. Rock low in the face gives way first and the burden follows it down, so
 *  the collapse ripples upward instead of every piece dropping at once. */
export const COLLAPSE_STAGGER_PER_METRE = 0.04;

// ─── Muck Pile ───────────────────────────────────────────────────────────────

/** Ground area (m²) of one pile column — one voxel footprint. A fragment raises
 *  the column it lands in by the volume it adds spread over this area, never by
 *  its own diameter: raising it per *piece* stacks a tower out of gravel. */
export const PILE_COLUMN_AREA = 1.0;

/** Swell factor of blasted rock. Broken rock traps air, so a cubic metre of
 *  solid rock occupies about this much once it is loose on the ground. */
export const RUBBLE_BULKING = 1.4;

/** Smallest height (metres) a fragment adds to its column, so that resting rock
 *  is never buried inside the pile it just landed on. */
export const MIN_PILE_RISE = 0.05;

/** How many columns a fragment may roll down before it is left where it is, and
 *  the slope loose rock holds before it rolls at all — 0.7 m per metre is about
 *  35 degrees, the angle of repose of muck. Rock rolls one column at a time and
 *  keeps going while the ground beside it is lower, which is what stops a heap
 *  from growing into a tower where a lot of rock lands on one spot. */
export const PILE_SPILL_STEPS = 24;
export const PILE_REPOSE_STEP = 0.7;

/** How far (metres) a settled fragment's underside may sit above the ground
 *  before it counts as floating. Loose rock perches on the pieces below it, so a
 *  little clearance is normal; a metre of it is a bug. */
export const FLOATING_FRAGMENT_CLEARANCE = 1.0;

/** How far rock may be thrown (metres) before a blast counts as bad, and as
 *  catastrophic. Distance rather than speed is what matters to the player: rock
 *  that lands back in its own muck pile is a good blast however fast it left,
 *  and rock that clears the pit is a danger to everything around it. */
export const THROW_DISTANCE_BAD = 12;
export const THROW_DISTANCE_CATASTROPHIC = 25;

/** Minimum fragment render height (voxels) above the grid floor. */
export const FRAGMENT_MIN_RENDER_Y = 0.05;

/** Default minimum search radius (metres) for the expanding-ring terrain-surface
 *  search in getBlastOriginSurfaceY (BlastOriginSampling.ts). A fixed 3m ring only
 *  clears a small blast's own crater; the search widens by this step until it
 *  clears a large blast's footprint too. */
export const BLAST_ORIGIN_SURFACE_SEARCH_MIN_RADIUS = 3;

/** Margin (metres) added to a blast's own half-bounding-box-diagonal when sizing
 *  the terrain-surface search ring in GameRenderer.onBlast, so the ring sits just
 *  outside the blast's own crater rather than exactly on its edge. */
export const BLAST_ORIGIN_SURFACE_SEARCH_MARGIN = 3;

/** Maximum iterations for the energy propagation overflow loop.
 *  Prevents infinite loops when energy is trapped with no dissipating neighbors.
 *  Real blasting energy dissipates in microseconds; this is a computational guard.
 *  Each iteration distributes overflow to neighbors. 500 iterations ensures
 *  energy can traverse at least 500 voxels (500 m) before forced termination. */
export const MAX_PROPAGATION_ITERATIONS = 500;
/** Energy must reach this multiple of a voxel's threshold to fragment it. */
export const FRAGMENTATION_MULTIPLIER = 1.0;

/** Fraction of its threshold a voxel must retain to be cracked without breaking.
 *  Below this the rock is unaffected; between this and FRAGMENTATION_MULTIPLIER it
 *  survives the blast but is left weakened. */
export const CRACKED_VOXEL_ENERGY_RATIO = 0.5;

/** Multiplier applied to a cracked voxel's fracture modifier, so rock that took a
 *  near-miss gives way more easily to the next blast. */
export const CRACKED_VOXEL_WEAKENING = 0.7;

/** Edge length of one voxel in centimetres. Voxels are 1 m³ (see world/VoxelGrid),
 *  so a fragment's size fraction of a voxel converts to cm by this factor —
 *  used by the FragPredict (tier 2) software preview. */
export const VOXEL_SIZE_CM = 100;

// ─── Danger Zone ──────────────────────────────────────────────────────────────────

/**
 * Padding (metres) added on every side of a drill plan's hole bounding box to
 * get a default blast danger zone (Zone.computeDangerZone) — a simplified
 * stand-in for a true physics-derived exclusion radius (max fragment
 * projection range depends on charge, rock, and geometry per hole, computed
 * only after Software preview tier 3). Good enough to warn "these entities
 * are standing too close," not a guarantee nothing outside it can be hit.
 */
export const BLAST_DANGER_MARGIN_M = 15;

// ─── Fragment Velocity Simulation ────────────────────────────────────────────────

/** Decay rate for surface proximity effect based on distance to air voxel. */
export const SURFACE_PROXIMITY_DECAY = 0.5;
/** Maximum velocity (m/s) for fragments classified as 'projected'. */
export const MAX_PROJECTION_VELOCITY = 80;
/** Velocity threshold (m/s) below which fragment is classified 'collapse'. */
export const PROJECTION_VELOCITY_THRESHOLD = 2.0;

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

/**
 * A* node-exploration budget formula (#458 T6.2/D14): actual cap is
 * `max(PATHFINDING_NODE_BUDGET_MIN, gridX * gridZ / PATHFINDING_NODE_BUDGET_AREA_DIVISOR)`,
 * computed by Pathfinding.ts where the grid's own dimensions are in scope — a
 * flat 500-node cap sized for the old ~64² levels falls back to direct-line
 * long before a legitimate cross-map route is found on D13's bigger levels
 * (up to 160×160).
 */
export const PATHFINDING_NODE_BUDGET_MIN = 500;
export const PATHFINDING_NODE_BUDGET_AREA_DIVISOR = 8;

/** A* node-exploration budget for a grid of the given dimensions. */
export function pathfindingNodeBudget(gridWidth: number, gridHeight: number): number {
  return Math.max(
    PATHFINDING_NODE_BUDGET_MIN,
    Math.floor((gridWidth * gridHeight) / PATHFINDING_NODE_BUDGET_AREA_DIVISOR),
  );
}

/** Number of consecutive failed re-route attempts before the agent transitions to stuck state. */
export const STUCK_THRESHOLD = 3;

/** Employee agent walking speed in grid cells per tick (1 tick = 1 game-hour). */
export const AGENT_WALK_SPEED = 2;

/** Morale penalty applied per tick to an employee stuck with no walkable path (see NEED_MORALE_PENALTIES for the analogous need-driven table). */
export const STUCK_MORALE_PENALTY = 2;

/** Height of one bench level in voxels. Affects benchLevel computation in NavGrid. */
export const NAV_BENCH_HEIGHT = 5;

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

/**
 * Fraction of purchaseCost paid back on `vehicle scrap`, further scaled by the
 * vehicle's current hp/maxHp — a wrecked vehicle is worth less for parts than
 * a pristine one. Unlike building demolition (which costs money, tearing a
 * structure down), scrapping a vehicle sells it for salvage.
 */
export const VEHICLE_SCRAP_RESIDUAL_FRACTION = 0.4;

// ─── Employee Skills ───────────────────────────────────────────────────────────

/**
 * Task-duration multipliers by proficiency level (1–5).
 * Applied as: ticksRequired = ceil(baseDuration * PROFICIENCY_MULTIPLIERS[level] / productivityMultiplier).
 * Lower value = shorter task duration. Rookie (1) is the baseline (×1.00);
 * Master (5) completes tasks 2.5× faster (×0.40).
 */
export const PROFICIENCY_MULTIPLIERS = {
  1: 1.00,
  2: 0.85,
  3: 0.70,
  4: 0.55,
  5: 0.40,
} as const;

/**
 * Cumulative XP required to reach each proficiency level. Level 1 is the starting level (0 XP).
 */
export const XP_THRESHOLDS = {
  1: 0,
  2: 100,
  3: 300,
  4: 600,
  5: 1000,
} as const;

/**
 * Salary bonus per pay cycle for each qualification proficiency level ($).
 * Salary = BASE_SALARY[role] + sum(QUALIFICATION_SALARY_BONUS[level]) for each qualification.
 * Bonuses are strictly increasing: higher skill = higher pay demand.
 */
export const QUALIFICATION_SALARY_BONUS: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 50,
  2: 120,
  3: 220,
  4: 350,
  5: 500,
} as const;

/**
 * Baseline duration (ticks) for a dispatched task before proficiency scaling.
 * Applied as: ticksRequired = ceil(BASE_TASK_DURATION_TICKS * PROFICIENCY_MULTIPLIERS[level]).
 */
export const BASE_TASK_DURATION_TICKS = 20;

// ─── Employee Training ─────────────────────────────────────────────────────────

/**
 * Which skills each training building teaches. A skill absent from every entry
 * here cannot be obtained by training, which for a skill no role is hired with
 * means it cannot be obtained at all.
 *
 * The Driving Center covers all three vehicle licences: excavator and drill-rig
 * work is reachable only through it, since no role is hired holding them.
 */
export const TRAINING_BUILDING_SKILLS = {
  driving_center: ['driving.truck', 'driving.excavator', 'driving.drill_rig'],
  blasting_academy: ['blasting'],
  management_office: ['management'],
  geology_lab: ['geology'],
} as const satisfies Partial<Record<BuildingType, readonly string[]>>;

/** Ticks a course takes at a Tier 1 school. */
export const TRAINING_BASE_TICKS = 20;

/** Course-length multiplier by school tier — a better school teaches faster. */
export const TRAINING_TIER_SPEED: Record<1 | 2 | 3, number> = {
  1: 1,
  2: 0.75,
  3: 0.5,
} as const;

/** Fee to teach a skill the employee does not hold yet ($). */
export const TRAINING_BASE_FEE = 2500;

/**
 * Fee and duration multiplier by the level being trained *to*. Reaching Master
 * costs several times what a first licence does, so raising one specialist is a
 * real alternative to hiring another body.
 */
export const TRAINING_LEVEL_COST_MULTIPLIER: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 1,
  2: 1.6,
  3: 2.4,
  4: 3.4,
  5: 4.6,
} as const;

/**
 * Tiles a training employee is relocated outward from the school's entry
 * corner (`building.x`/`building.z`), so the sprite clears the building's
 * opaque footprint instead of rendering occluded on top of it.
 */
export const TRAINING_RELOCATION_OFFSET = 1;

// ─── Research Center ───────────────────────────────────────────────────────────

/**
 * Duration and cost of a Research Center task by the tier it unlocks. Tier 3
 * research costs and takes more than tier 2 — a straight step up mirrors the
 * training level multiplier so late-game tiers stay a real investment rather
 * than a rubber-stamp.
 */
/** Cost, duration, and prerequisites for a single tier's research task. */
export interface ResearchTaskDef {
  cost: number;
  ticks: number;
  conditions: ResearchCondition[];
}

/**
 * Research task definitions per building type and tier. Tier 2 is a
 * cost-only first upgrade (no duration, no prerequisites); tier 3 adds a
 * duration and requires tier 2 already researched — a straight step up
 * mirrors the training level multiplier so late-game tiers stay a real
 * investment rather than a rubber-stamp.
 */
export const RESEARCH_TASK_DEFS: Record<BuildingType, { 2: ResearchTaskDef; 3: ResearchTaskDef }> = {
  driving_center: {
    2: { cost: 5000, ticks: 0, conditions: [] },
    3: { cost: 12000, ticks: 50, conditions: [{ kind: 'research_completed', buildingType: 'driving_center', tier: 2 }] },
  },
  blasting_academy: {
    2: { cost: 5000, ticks: 0, conditions: [] },
    3: { cost: 12000, ticks: 50, conditions: [{ kind: 'research_completed', buildingType: 'blasting_academy', tier: 2 }] },
  },
  management_office: {
    2: { cost: 5000, ticks: 0, conditions: [] },
    3: { cost: 12000, ticks: 50, conditions: [{ kind: 'research_completed', buildingType: 'management_office', tier: 2 }] },
  },
  geology_lab: {
    2: { cost: 5000, ticks: 0, conditions: [] },
    3: { cost: 12000, ticks: 50, conditions: [{ kind: 'research_completed', buildingType: 'geology_lab', tier: 2 }] },
  },
  research_center: {
    2: { cost: 5000, ticks: 0, conditions: [] },
    3: { cost: 12000, ticks: 50, conditions: [{ kind: 'research_completed', buildingType: 'research_center', tier: 2 }] },
  },
  living_quarters: {
    2: { cost: 5000, ticks: 0, conditions: [] },
    3: { cost: 12000, ticks: 50, conditions: [{ kind: 'research_completed', buildingType: 'living_quarters', tier: 2 }] },
  },
  explosive_warehouse: {
    2: { cost: 5000, ticks: 0, conditions: [] },
    3: { cost: 12000, ticks: 50, conditions: [{ kind: 'research_completed', buildingType: 'explosive_warehouse', tier: 2 }] },
  },
  freight_warehouse: {
    2: { cost: 5000, ticks: 0, conditions: [] },
    3: { cost: 12000, ticks: 50, conditions: [{ kind: 'research_completed', buildingType: 'freight_warehouse', tier: 2 }] },
  },
  vehicle_depot: {
    2: { cost: 5000, ticks: 0, conditions: [] },
    3: { cost: 12000, ticks: 50, conditions: [{ kind: 'research_completed', buildingType: 'vehicle_depot', tier: 2 }] },
  },
};

/** Look up the research task definition for a building type and tier. */
export function getResearchTaskDef(type: BuildingType, tier: 2 | 3): ResearchTaskDef {
  return RESEARCH_TASK_DEFS[type][tier];
}

// ─── Employee Needs ────────────────────────────────────────────────────────────

/** Drain rates per tick for each need gauge. */
export const NEED_DRAIN_RATES = {
  hunger:  { working: 1,   idle: 0.5  },
  fatigue: { working: 2,   idle: 0.5  },
  breakNeed: { working: 0.8, idle: 0 },
} as const;

/** Threshold values for productivity/morale effects. */
export const NEED_THRESHOLDS = {
  hunger:  { low: 30, critical: 10 },
  fatigue: { low: 40, critical: 15 },
  breakNeed: { low: 30, critical: 15 },
} as const;

/**
 * Productivity multipliers applied when a need gauge falls below a threshold.
 * `low` = uncomfortable but functioning; `critical` = severe impairment.
 * Multipliers are applied to the base effectiveness value.
 */
export const NEED_PRODUCTIVITY_MULTIPLIERS = {
  hunger:  { low: 0.80, critical: 0.60 },
  fatigue: { low: 0.75, critical: 0.50 },
} as const;

/**
 * Morale penalty (per tick) applied when breakNeed falls below its low threshold.
 */
export const NEED_MORALE_PENALTIES = {
  breakNeed: -2,
} as const;

/** Morale thresholds for drain-rate adjustment in tickNeedGauges. */
export const MORALE_THRESHOLDS = {
  high: 70,
  low: 30,
} as const;

/** Drain-rate multipliers applied by morale range in tickNeedGauges. */
export const NEED_MORALE_DRAIN_MULTIPLIERS = {
  high: 0.85,   // morale > MORALE_THRESHOLDS.high
  normal: 1.0,  // morale between low and high (inclusive)
  low: 1.20,    // morale < MORALE_THRESHOLDS.low
} as const;

/**
 * Thresholds (gauge values) for the per-gauge morale effect in needsMoraleEffect().
 */
export const NEED_MORALE_EFFECT_THRESHOLDS = {
  comfortable: 50,
  uncomfortable: 30,
  suffering: 15,
} as const;

/**
 * Per-tick morale penalties applied per gauge in needsMoraleEffect().
 */
export const NEED_MORALE_EFFECT_PENALTIES = {
  comfortable: 0,
  uncomfortable: -0.5,
  suffering: -1.5,
  critical: -3.0,
} as const;

/**
 * If ALL three gauges (hunger, fatigue, breakNeed) are simultaneously above this
 * threshold, the employee receives a well-rested morale bonus per tick.
 */
export const NEED_WELL_RESTED_THRESHOLD = 80;

/** The well-rested morale bonus applied per tick when all gauges are above the threshold. */
export const NEED_WELL_RESTED_BONUS = 1;

/**
 * Warning thresholds that trigger proactive rest routing.
 * @deprecated Use {@link NEED_WARNING_THRESHOLDS} instead — this constant has identical values
 *             and is kept only for backward compatibility.
 */
export const NEED_RESTORATION_THRESHOLDS = {
  hunger:  35,
  fatigue: 25,
  breakNeed: 30,
} as const;

/** Warning thresholds that trigger proactive need routing. */
export const NEED_WARNING_THRESHOLDS = {
  hunger:  35,
  fatigue: 25,
  breakNeed: 30,
} as const;

/** Collapse thresholds for each need gauge. */
export const NEED_COLLAPSE_THRESHOLDS = {
  hunger:  10,
  fatigue: 5,
  breakNeed: 15,
} as const;

/** Rest duration in ticks per need gauge when an employee collapses. */
export const NEED_REST_DURATIONS = {
  hunger: 2,
  fatigue: 8,
  breakNeed: 3,
} as const;

/**
 * Building type that services each need gauge during collapse rest.
 * All map to 'living_quarters' until dedicated canteen/bunkhouse/break_room
 * building types are added (future Chapter 1 expansion).
 */
export const NEED_REST_BUILDING_TYPES = {
  hunger: 'living_quarters',
  fatigue: 'living_quarters',
  breakNeed: 'living_quarters',
} as const satisfies Record<string, BuildingType>;

/**
 * Max grid-cell distance to search for a suitable rest building, scaled by
 * grid width (#458 T6.2/D14): `max(NEED_REST_SEARCH_RADIUS_MIN, gridX / NEED_REST_SEARCH_RADIUS_GRID_DIVISOR)`.
 * A flat radius sized for the old ~64-wide levels would leave a rest building
 * unreachable from most of a 160-wide level even when one exists.
 */
export const NEED_REST_SEARCH_RADIUS_MIN = 20;
export const NEED_REST_SEARCH_RADIUS_GRID_DIVISOR = 4;

/** Rest-building search radius for a grid of the given width. */
export function needRestSearchRadius(gridWidth: number): number {
  return Math.max(NEED_REST_SEARCH_RADIUS_MIN, gridWidth / NEED_REST_SEARCH_RADIUS_GRID_DIVISOR);
}

/**
 * Per-tick replenishment rates for each need gauge by building tier.
 * Keyed by need gauge (not building type) because the caller already knows
 * which need to replenish; the building-to-need mapping is handled upstream.
 * Tier 1 is the baseline; higher tiers improve replenishment rates.
 */
export const BUILDING_REPLENISH_RATES = {
  hunger:   { 1: 12, 2: 18, 3: 25 },
  fatigue:  { 1: 8,  2: 14, 3: 20 },
  breakNeed: { 1: 10, 2: 16, 3: 22 },
} as const;

/**
 * Ceiling a rest taken with no suitable building can raise a need gauge to.
 * Resting in the dirt keeps an employee working; it never leaves them fully
 * satisfied, so a site with no living_quarters is always worse off than one
 * with a Tier 1 — which replenishes to the full gauge, just slowly.
 */
export const NEED_REST_NO_BUILDING_CAP = 70;

/**
 * Rest-duration multiplier when no suitable building services the need — either
 * none exists or the nearest is beyond NEED_REST_SEARCH_RADIUS. Resting in place
 * takes this many times as long as the same rest at a Tier 1 building.
 */
export const NEED_REST_NO_BUILDING_DURATION_MULTIPLIER = 2;

/** Per-visit cost deducted from cash for each need gauge. Fatigue has no cost (0). */
export const NEED_REST_COSTS = {
  hunger: 50,
  fatigue: 0,
  breakNeed: 20,
} as const;

// ─── General ───────────────────────────────────────────────────────────────────

/** Maximum value for all need gauges (0–100 range). */
export const MAX_NEED_GAUGE = 100;

// ─── Shift / Rest Scheduling ────────────────────────────────────────────────

/** Shift duration in ticks for each policy mode. 1 tick = 1 game-hour. */
export const SHIFT_DURATIONS_TICKS = {
  shift_8h:  8,
  shift_12h: 12,
} as const;

/** Default rest/break thresholds used by createSitePolicy(). All gauges are 0–100. */
export const SITE_POLICY_DEFAULT_THRESHOLDS = {
  hungerRest:  40,
  fatigueRest: 25,
  socialBreak: 20,
} as const;

/** Number of ticks an employee works before shift cycle rest is forced. */
export const WORK_DURATION_TICKS = 6;

/** Number of ticks an employee rests during a shift-cycle sleep when bunkhouse tier >= 2. */
export const SHIFT_SLEEP_DURATION_TICKS = 8;

// ─── Survey System ────────────────────────────────────────────────────────────

/** Baseline noise std-dev applied to ore density estimates before skill adjustment. */
export const SURVEY_BASE_ERROR = {
  seismic:     0.15,
  core_sample: 0.05,
  aerial:      0.25,
} as const;

/** Survey disc radius (grid cells) around the centre point for each method. */
export const SURVEY_COVERAGE_RADIUS = {
  seismic:     20,
  core_sample:  0,
  aerial:      30,
} as const;

/** Error reduction applied per skill level above 1 (e.g. skill 3 → 2 × 0.12 = 0.24 reduction). */
export const SURVEY_SKILL_BONUS_PER_LEVEL = 0.12;

/** Number of consecutive Y-levels averaged together in a single seismic reading. */
export const SURVEY_SEISMIC_GROUP_SIZE = 3;

/** Ore estimate quantisation step: estimates are rounded to the nearest 0.05 band. */
export const SURVEY_ESTIMATE_STEP = 0.05;

/** Number of ticks after which a survey result is considered stale. */
export const SURVEY_STALE_TICKS = 100;

/** Survey cost ($) for each method. */
export const SURVEY_COSTS = {
  seismic:     3000,
  core_sample:  800,
  aerial:      1500,
} as const;

/** Survey duration (ticks) for each method. 1 tick = 1 game-hour. */
export const SURVEY_DURATION_TICKS = {
  seismic:     8,
  core_sample: 4,
  aerial:      3,
} as const;

/** Assumed bulk density of ore-bearing rock used for mass calculations (kg/m³). */
export const ORE_DENSITY_KG_M3 = 2500;

/** Radius (grid cells) within which a seismic survey's shockwave damages buildings. */
export const SEISMIC_SURVEY_DAMAGE_RADIUS = 5;

/** HP lost by each building within SEISMIC_SURVEY_DAMAGE_RADIUS of a seismic survey. */
export const SEISMIC_SURVEY_DAMAGE_HP = 10;

// ─── Physics ────────────────────────────────────────────────────────────────────

/** Gravitational acceleration (m/s²). Negative = downward. */
export const GRAVITY = -9.81;

/** Minimum horizontal overlap ratio (0–1) for a fragment to be considered "supported by" another. */
export const FRAGMENT_HORIZONTAL_OVERLAP_TOLERANCE = 0.5;
/** Maximum vertical gap (metres) between two fragments' AABB extents for stacking. */
export const FRAGMENT_SUPPORT_VERTICAL_GAP = 0.1;
