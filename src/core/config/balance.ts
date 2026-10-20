// BlastSimulator2026 — Centralized Game Balance Configuration
// All tunable game constants live here. Human can adjust these values during polish.
// Real-world research notes are included for each value.

import type { BuildingType, BuildingTier } from '../entities/Building.js';
import type { ResearchCondition } from '../entities/BuildingResearch.js';
import type { VehicleRole, VehicleTask, VehicleTier } from '../entities/Vehicle.js';
import type { EmployeeRole, SkillCategory, NeedKey } from '../entities/Employee.js';
import type { ActionType } from '../state/GameState.js';

// ─── Time ───────────────────────────────────────────────────────────────────────

/** Ticks per in-game day. 1 tick = 1 game-hour (see PAY_CYCLE_TICKS below). Matches TopBar's day/clock math. */
export const TICKS_PER_DAY = 24;

// ─── Economy ──────────────────────────────────────────────────────────────────

/** Starting cash for a new game ($). Real open-pit mines cost $10M+ to open; scaled down for gameplay. */
export const STARTING_CASH = 50_000;

/** Minimum final ecology score for the ecology star criterion. */
export const STAR_ECOLOGY_MIN = 60;

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

/** Proficiency level a hired blaster starts at (justifies the higher price over a driller). */
export const ROLE_BLASTER_START_LEVEL = 2;

/**
 * Qualifications each role arrives with at hire: every role can do its own job unaided.
 * A blaster's primary skill (index 0, raised by candidate skill bonuses) is blasting; it also
 * holds the tier-1 truck licence so it can drive a tier-1 charging truck and charge holes with
 * no course (#1667). Tier 2/3 trucks still need Driving Center licence levels. No drill-rig licence.
 */
export const ROLE_STARTING_QUALIFICATIONS: Record<
  EmployeeRole,
  readonly { category: SkillCategory; proficiencyLevel: 1 | 2 | 3 | 4 | 5 }[]
> = {
  driller: [{ category: 'blasting', proficiencyLevel: 1 }, { category: 'driving.drill_rig', proficiencyLevel: 1 }],
  blaster: [{ category: 'blasting', proficiencyLevel: ROLE_BLASTER_START_LEVEL }, { category: 'driving.truck', proficiencyLevel: 1 }],
  driver: [{ category: 'driving.truck', proficiencyLevel: 1 }, { category: 'driving.excavator', proficiencyLevel: 1 }],
  surveyor: [{ category: 'geology', proficiencyLevel: 1 }],
  manager: [{ category: 'management', proficiencyLevel: 1 }],
};

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
/** Number of most-common level ores that supply contracts may still ask for. */
export const SUPPLY_COMMON_ORE_COUNT = 4;
/** Ticks before a deadline at which an undelivered contract is flagged as about to expire. */
export const CONTRACT_EXPIRY_WARNING_TICKS = 10;
/** Max contracts available at once. */
export const MAX_AVAILABLE_CONTRACTS = 8;

/** Ore contract base prices per kg ($), slightly above catalog. Key order is rarity order: supply contracts use the first four. */
export const ORE_PRICES = {
  dirtite: 3,
  rustite: 12,
  blingite: 35,
  gloomium: 80,
  sparkium: 200,
  craktonite: 450,
  absurdium: 1000,
  treranium: 2500,
} as const;

/** Half-life (ticks) of an ore's market saturation (#1930). */
export const ORE_SATURATION_HALF_LIFE_TICKS = 500;
/** Price discount at full saturation (#1930). */
export const ORE_SATURATION_MAX_DISCOUNT = 0.5;
/** Saturation level at which the glut toast fires (#1930). */
export const ORE_SATURATION_TOAST_LEVEL = 0.5;
/** Base market depth (kg) per ore: sales volume that fully saturates it at the local tier (#1930). */
export const ORE_MARKET_DEPTH_KG: Record<keyof typeof ORE_PRICES, number> = {
  dirtite: 20_000, rustite: 15_000, blingite: 10_000, gloomium: 8_000,
  sparkium: 6_000, craktonite: 4_000, absurdium: 3_000, treranium: 2_000,
};
/** Market depth multiplier per buyer tier (#1930). */
export const ORE_DEPTH_TIER_MULT = { local: 1, regional: 2, national: 5, global: 12 } as const;

/** Rubble disposal price range per kg ($) used when generating contract offers. */
export const RUBBLE_DISPOSAL_PRICE_RANGE = { min: 0.5, max: 2.0 } as const;

// ─── Corruption ────────────────────────────────────────────────────────────────

/** Base bribery success rate (0–1). Real bribery conviction rates ~5–20%; we make it generous. */
export const BRIBERY_BASE_SUCCESS = 0.7;
/** Per-bribery reduction to success rate. */
export const BRIBERY_HISTORY_PENALTY = 0.03;
/** Corruption meter upper bound (meter runs 0..CORRUPTION_MAX) (#1407). */
export const CORRUPTION_MAX = 100;
/** Corruption level at which the mafia gets involved. */
export const MAFIA_UNLOCK_THRESHOLD = 20;
/** Corruption meter gap between mafia escalation tiers; tier 1 sits at the unlock threshold (#1407). */
export const MAFIA_ESCALATION_STEP = 10;
/** Shortest event timer reset (ticks) after score modulation, so a category never fires every tick. */
export const MIN_EVENT_TIMER_TICKS = 5;

/** Corruption meter increase per successful bribe, by target (#1407). */
export const BRIBE_CORRUPTION_DELTA = {
  judge: 15,
  politician: 12,
  union_leader: 8,
  inspector: 5,
  witness: 5,
} as const;
/** Days a successful bribe protects the player, by target; 0 = no timed protection (#1407). */
export const BRIBE_PROTECTION_DAYS = {
  judge: 5,
  politician: 4,
  union_leader: 4,
  inspector: 3,
  witness: 0,
} as const;
/** Cap (days) on how long a protection that has not yet shielded anything outlives its paid window (#1816). */
export const BRIBE_PROTECTION_MAX_LINGER_DAYS = 30;
/** Bribe price per protection day ($), by target; witness is a flat price (#1407). */
export const BRIBE_PRICE_PER_PROTECTION_DAY = {
  judge: 10000,
  politician: 7500,
  union_leader: 3750,
  inspector: 2700,
  witness: 10000,
} as const;
/** Lawsuit category timer multiplier while a judge protection is active (#1407). */
export const JUDGE_LAWSUIT_TIMER_STRETCH = 1.8;
/** Exposure risk reduction (0-1) granted by a witness bribe (#1407). */
export const WITNESS_EXPOSURE_REDUCTION = 0.25;
/** Event tag marking inspection events, shielded by an inspector bribe (#1407). */
export const INSPECTION_EVENT_TAG = 'inspection';

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
/**
 * Ecology loss per tonne of FRESH loose rock (the pulse a blast just threw onto the ground), per
 * tick. Fresh dust decays with `ECOLOGY_DUST_SETTLE_HALF_LIFE_TICKS`. Measured against ordinary play:
 * one spoil heap (+0.2/tick), a ~2,344 t pile left lying and a blast about every 600 ticks. At
 * 0.0002 the pulse costs ~0.47/tick at its peak, so ecology dips to the mid 30s and recovers
 * before the next blast, rather than falling off a cliff (#1733). It is also high enough that a pile
 * left lying with no heap drains 50 to 0 in ~240 ticks (0.00015 never got there: the 0.05/tick pull
 * toward 50 won against the settled term).
 */
export const ECOLOGY_DUST_PER_TONNE_PER_TICK = 0.0002;
/**
 * Ecology loss per tonne of SETTLED loose rock (lying past the fresh pulse), per tick. 0.000004
 * puts the same 2,344 t pile at ~0.0094/tick, well under one heap's +0.2, so one heap carries
 * ordinary play while rubble left lying and never hauled still bleeds ecology slowly (#1733).
 */
export const ECOLOGY_DUST_SETTLED_PER_TONNE_PER_TICK = 0.000004;
/**
 * Ticks for fresh dust to halve as it settles. 150 ticks keeps a blast's pulse mostly spent inside
 * the 600-tick blast cycle measured for one heap and 2,344 t, while a pulse every 100 ticks (3
 * heaps, no hauling) keeps the fresh term stacked and still reaches 0 within 3000 ticks (#1733).
 */
export const ECOLOGY_DUST_SETTLE_HALF_LIFE_TICKS = 150;

// ─── World / Sandbox ────────────────────────────────────────────────────────────

/** Grid edge length (voxels), X/Z, used when a size is not explicitly given. */
export const DEFAULT_GRID_SIZE = 64;
/** Fixed sandbox generation datum (voxel Y the site centre's surface lands on). Sandbox no longer exposes depth as a player control (#504). */
export const SANDBOX_DATUM = 17;
/** Sandbox biome ruggedness bands on pvAmplitude: flat below ROLLING, rolling below STEEP, else steep (#1686). */
export const SANDBOX_RUGGEDNESS_ROLLING_PV = 20;
export const SANDBOX_RUGGEDNESS_STEEP_PV = 40;

/**
 * Largest number of intermediate chunks `PlayableArea.claimArea` will bridge
 * in one claim to connect an action's footprint to the site (#558). Refused
 * with 'too_far' beyond this — a reach limit, not a hard wall, so a distant
 * action is still possible, just not in a single unbounded leap.
 */
export const MAX_CLAIM_BRIDGE_CHUNKS = 24;

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
/** Exposure (0–1) at which the one-shot arrest warning fires. */
export const ARREST_WARNING_EXPOSURE = 0.75;
/** Well-being score at or below which the player is alerted. */
export const WELL_BEING_ALERT_THRESHOLD = 20;

/** Exposure added by arranging an accident (applies on success and failure). */
export const ACCIDENT_EXPOSURE = 0.1;

/** Extra exposure added on top of ACCIDENT_EXPOSURE when an arranged accident fails. */
export const ACCIDENT_FAILURE_EXPOSURE_EXTRA = 0.1;

/** Exposure added when a framing is started (evidence planted). */
export const FRAMING_START_EXPOSURE = 0.05;

/** Exposure added when a framing is detected on completion. */
export const FRAMING_DETECTED_EXPOSURE = 0.15;

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
/** Ticks between a parent event resolving and its queued follow-up firing. */
export const FOLLOWUP_DELAY_TICKS = 30;

/** Random additional ticks (0 to value-1, i.e. 0–59 for value=60) added to the per-event cooldown. */
export const MIN_EVENT_INTERVAL_RANDOM_RANGE = 60;

/** Union events run on their own cooldown clock (#1907): base minimum ticks between union events. */
export const UNION_EVENT_MIN_INTERVAL_TICKS = 120;
/** Union events' own cooldown clock (#1907): random extra ticks (0 to value-1) added to the union cooldown. */
export const UNION_EVENT_MIN_INTERVAL_RANDOM_RANGE = 60;

/** Minimum number of user-initiated actions required between events, counted per clock: since the last non-union event (shared) and, separately, since the last union event. */
export const MIN_EVENT_INTERVAL_ACTIONS = 10;

// ─── Traffic ───────────────────────────────────────────────────────────────────

/** Minimum agents (drivers and walkers) stuck at one chokepoint to count as a jam (#1208). */
export const TRAFFIC_JAM_MIN_AGENTS = 3;

/** Tiles around a ramp's footprint that still count as that ramp's chokepoint (#1208). */
export const TRAFFIC_JAM_RAMP_MARGIN = 3;

/** Radius in tiles within which stuck agents merge into one passage jam (#1208). */
export const TRAFFIC_JAM_PASSAGE_RADIUS = 3;

/** Ticks a chokepoint stays silent after the player picks "reroute vehicles" (#1208). */
export const TRAFFIC_JAM_REROUTE_SILENCE_TICKS = 100;

/** Ticks a chokepoint stays silent after the player picks "ignore" (#1208). */
export const TRAFFIC_JAM_IGNORE_SILENCE_TICKS = 400;

/** Ticks a chokepoint stays silent after the player picks "widen ramp" (#1208). */
export const TRAFFIC_JAM_WIDEN_SILENCE_TICKS = 1000;

/** Well-being penalty applied when the player ignores a jam (#1208). */
export const TRAFFIC_JAM_IGNORE_WELLBEING_PENALTY = 5;

/**
 * Minimum consecutive waiting ticks per agent before it counts toward a traffic jam.
 * Invariant: strictly below AGENT_OCCUPANCY_WAIT_TICKS. At that many waited ticks the
 * occupancy ladder spreads the blocked mover and clears its itinerary, so a threshold
 * at or above it would see agents for a tick or less and never several at once.
 */
export const TRAFFIC_JAM_MIN_TICKS = 4;

// ─── Vehicle Spawn Placement ────────────────────────────────────────────────────

/**
 * Tiles between the vehicles of a staffed roster's authored starting row
 * (`applyStaffedComposition`), before terrain exists to place them on: wide
 * enough that adjacent vehicle meshes stay visually distinct (1-tile spacing
 * let bodies merge, see TRAFFIC_JAM_MIN_TICKS's neighbour
 * vehicle-traffic-routing-visual fix) and that two vehicles never tie on
 * octile cost (#591). Mid-game purchases spawn around the rally point instead
 * (`rallySpawnCell`, CREW_SPAWN_VEHICLE_SEPARATION).
 */
export const SPAWN_TILE_SPACING = 3;

/**
 * Cells between two starting vehicles when `placeStartingCrew`
 * (src/core/state/SpawnPlacement.ts) lays the fresh crew out on
 * climb-connected ground (#1166). Same job as SPAWN_TILE_SPACING's gap in the
 * old fixed row: at closer range two vehicles tie on octile cost and A* can
 * resolve a route onto the cell the other one blocks (#591). Kept as its own
 * constant because the two placements answer to different things — that one
 * to mesh legibility around a depot, this one to routing between crew and
 * fleet on natural ground.
 */
export const CREW_SPAWN_VEHICLE_SEPARATION = 3;

/**
 * Cell-count headroom for the crew-relocation search: the search visits this
 * many times the cells the spaced vehicle picks alone would need
 * (agents x SEPARATION^2), leaving room for employees to fill in around them.
 */
export const CREW_SPAWN_SEARCH_LIMIT_FACTOR = 2;

/**
 * Fewest legal-step neighbours (of 8, at vehicle clearance) a starting
 * vehicle's cell may have (#1648). A cell with only one or two is a thin
 * ridge or trench that one building corner can seal, leaving the vehicle
 * unable to drive out — every order needing its role then reads out of reach.
 */
export const CREW_SPAWN_VEHICLE_MIN_OPEN_NEIGHBOURS = 3;

/**
 * Cells between any two agents — employee or vehicle — when
 * `placeStartingCrew` fills employee cells in around the already-spaced
 * vehicle picks (#1263). Below this, `climbConnectedCells`' own nearest-first
 * BFS order hands every employee the closest still-free candidate, which in
 * a narrow corridor is the cell immediately touching whichever agent placed
 * just before it — the corridor itself never has room to space vehicles 3
 * apart AND leave employees anywhere except shoulder to shoulder with them.
 * Once ground-cell occupancy is uniform across every agent (#1206), that
 * packs the whole roster single-file with nobody able to step aside for
 * anybody else — confirmed live via ore-haul-dispatch's own seed 10 desert
 * start, a permanent drill-dispatch stall from tick 0. Matches
 * CREW_SPAWN_VEHICLE_SEPARATION: measured live, a gap of 2 still let a
 * relocated agent's own route out oscillate around a neighbour 2 cells away
 * on this same narrow terrain (an ordinary #1129 retrace tie, not a true
 * deadlock, but real added ticks); 3 gave every agent, driller included, a
 * clean run to its first task in the same repro. Still only a short extra
 * walk to board — well inside the room `Mount.ts`'s "within 1 tile" leaves
 * for a driver to close before boarding.
 */
export const CREW_SPAWN_AGENT_SEPARATION = 3;

/**
 * How much longer than a straight line the starting crew's route to the
 * middle of the site may run before `placeStartingCrew` treats its authored
 * spawn as walled in and moves it (#1166). Measured across desert seeds:
 * ordinary ground comes out at 0.98 — routes are effectively straight — while
 * a crew stuck behind a face measured 2.78 on average and 14.41 at worst. 1.5
 * sits well clear of ordinary terrain relief and well under any real detour.
 */
export const CREW_SPAWN_MAX_ROUTE_INFLATION = 1.5;

/**
 * How far from its authored spawn `placeStartingCrew` will look for ground
 * with an acceptable route (#1166). A level's spawn coordinates are a design
 * decision — work sites are authored near where the crew starts — so a crew
 * that must move moves as little as possible, and the search stays cheap
 * enough to run once at game open.
 */
export const CREW_SPAWN_SEARCH_RADIUS = 16;

/**
 * How much longer than a straight line a vehicle's route from its nearest
 * licensed driver may run before `placeStartingCrew`'s vehicle-reachability
 * fixup treats it as unreachable and relocates it near a licensed driver
 * (#1179). Paired with `CREW_SPAWN_VEHICLE_ROUTE_SLACK`:
 * `tolerance = CREW_SPAWN_VEHICLE_MAX_ROUTE_INFLATION + CREW_SPAWN_VEHICLE_ROUTE_SLACK / straightLineDistance`.
 */
export const CREW_SPAWN_VEHICLE_MAX_ROUTE_INFLATION = 1.5;

/**
 * Slack term in the same tolerance formula (#1179) — see
 * `CREW_SPAWN_VEHICLE_MAX_ROUTE_INFLATION`'s own doc comment. Keeps a vehicle
 * spawned close to its driver from reading as unreachable purely because a
 * near-zero straight-line distance makes any ratio at all look catastrophic.
 */
export const CREW_SPAWN_VEHICLE_ROUTE_SLACK = 2;

// ─── Rally Point ─────────────────────────────────────────────────────────────────

/**
 * Half-width, in cells, of the square of ground that must be flat around a
 * site's rally point (`chooseRallyPoint`, src/core/state/RallyPoint.ts): 2
 * gives a 5x5 area, room for the flag and the first arrivals standing on
 * level ground around it.
 */
export const RALLY_POINT_FLAT_RADIUS = 2;

/**
 * Most the ground may rise or fall, in metres, across the rally area for it to
 * count as flat. Matches `BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD`: ground flat
 * enough to build on is flat enough to park a fleet on.
 */
export const RALLY_POINT_MAX_HEIGHT_SPREAD_M = 1;

/**
 * Flat candidates whose route to the site's middle `chooseRallyPoint` will
 * check before settling for the nearest flat one. Bounds the cost of a
 * one-time choice on a rugged 160x160 site.
 */
export const RALLY_POINT_MAX_ROUTE_CHECKS = 64;

/**
 * Cells around the rally point `rallySpawnCell` will visit looking for a free
 * spawn cell — far more than a site ever holds agents, so a crowded flag
 * still spawns everyone on its own ground.
 */
export const RALLY_POINT_SPAWN_SEARCH_LIMIT = 600;

/** Cells a vehicle spawns away from the flag, so the flag is never inside a vehicle's body. */
export const RALLY_POINT_VEHICLE_STANDOFF = 2;

/**
 * Cells a level's opening buildings keep their footprints away from the rally
 * point, leaving the ground around the flag free for the crew and fleet that
 * spawn there.
 */
export const RALLY_POINT_BUILDING_CLEARANCE = 5;

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

/** Remaining mass below this (kg) after splitting a stored fragment is treated
 *  as fully consumed rather than left behind as a negligible remainder. */
export const FRAGMENT_SPLIT_EPSILON_KG = 1e-6;

/** Storage capacity (kg) of a fresh logistics state. Zero: capacity is whatever active
 *  Freight Warehouses provide, so before the first one is built nothing can be stored (#1369). */
export const INITIAL_STORAGE_CAPACITY_KG = 0;

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

/** Metres of float tolerance when testing charge column + stemming against hole
 *  depth, so an exact fit (8 kg + 2 m in a 6 m hole) is not refused by rounding. */
export const CHARGE_FIT_EPSILON = 1e-6;

/** Ticks to drill one hole at the reference depth/diameter (#553). */
export const DRILL_HOLE_BASE_DURATION_TICKS = 6;
/** Reference hole depth (m) that DRILL_HOLE_BASE_DURATION_TICKS is calibrated against (#553). */
export const DRILL_HOLE_REFERENCE_DEPTH_M = 8;
/** Max drillable hole depth (m) by drill rig tier (#1679). */
export const DRILL_RIG_MAX_DEPTH_M: Record<VehicleTier, number> = { 1: 12, 2: 24, 3: 40 };
/** Shallowest hole a drill plan may order (m) (#1679). */
export const DRILL_HOLE_MIN_DEPTH_M = 1;
/** Reference hole diameter (m) that DRILL_HOLE_BASE_DURATION_TICKS is calibrated against (#553). */
export const DRILL_HOLE_REFERENCE_DIAMETER_M = 0.15;

/** Diameter (m) used when a drill command/panel doesn't specify one — shared by
 *  drillPlan.ts's console default and Drill.ts's UI default (#965). */
export const DRILL_HOLE_DEFAULT_DIAMETER_M = 0.089;

/** Hole diameters (m) a drill plan may order (#1934). */
export const DRILL_HOLE_DIAMETER_OPTIONS_M: readonly number[] = [0.089, 0.127, 0.165];
/** Widest hole (m) a drill rig can bore, by tier (#1934). */
export const DRILL_RIG_MAX_DIAMETER_M: Record<VehicleTier, number> = { 1: 0.089, 2: 0.127, 3: 0.165 };
/** Metres a raw diameter may miss an option by and still snap to it (#1934). */
export const DRILL_HOLE_DIAMETER_SNAP_TOLERANCE_M = 0.0005;

/** Hole spacing (m) the grid tool's placement strip opens at before the player
 *  steps it (#1069) — the value a scenario's dragTiles rectangle is measured
 *  against when its interaction array never clicks the spacing stepper. Four
 *  metres so the tutorial's 8x8 drill region computes a 3x3 grid untouched (#1330). */
export const DRILL_GRID_DEFAULT_SPACING_M = 4;
/** Hole depth (m) the grid tool's placement strip opens at before the player
 *  steps it (#1069), same reasoning as DRILL_GRID_DEFAULT_SPACING_M; 8 m matches the tutorial's
 *  scripted plan (#1330). */
export const DRILL_GRID_DEFAULT_DEPTH_M = 8;

/** Ticks to load a charge at the reference amount (#554). */
export const CHARGE_HOLE_BASE_DURATION_TICKS = 4;
/** Reference charge amount (kg) that CHARGE_HOLE_BASE_DURATION_TICKS is calibrated against (#554). */
export const CHARGE_HOLE_REFERENCE_AMOUNT_KG = 5;

/** Minimum stemming column (m) a charge can carry. Matches the Charge
 *  panel's own floor (Charge.ts adjustStemming) so a console charge can
 *  never under-stem what a player could ever click. */
export const MIN_STEMMING_M = 0.5;

/** Default explosive amount (kg) the Charge panel opens with, and the tutorial's
 *  scripted charge (#1330, #1724). Chosen as the smallest charge that breaks out
 *  of an 8 m, 4 m-spaced 3x3 pattern with every hole's column lowered, on both
 *  the sandbox flat pad and the tutorial pit, rating at least good. Measured with
 *  boomite and 2.5 m stemming (executeBlast; sandbox desert_badlands seed 42 pad at
 *  28,18, tutorial_pit after the seismic survey, build_ramp 10,23-10,35 depth 6 and
 *  drill_plan at 14,24):
 *    kg    sandbox lowered/9, rating      tutorial lowered/9, rating
 *    4     0   bad (no_breakout)          0   good (2 columns open at the edge)
 *    4.5   0   bad (no_breakout)          0   good
 *    5     9   good                       5   good
 *    6     9   good                       5   good (1 projection)
 *    6.5   9   good                       6   good
 *    7     9   good                       9   good (1 projection, 5.5 m throw)
 *    8     9   good                       9   mediocre (8 projections)
 *  4 kg in a 8 m hole is a 2 m column under 6 m of burden: more than
 *  BURDEN_BREAKOUT_MAX of cap, so the rock stays sealed in the ground (#1724). 7 kg
 *  is the first charge the tutorial pit needs; it fits the hole (3.5 m column +
 *  2.5 m stemming <= 8 m). */
export const CHARGE_DEFAULT_AMOUNT_KG = 7;

/** Default stemming column (m) the Charge panel opens with, and the tutorial's
 *  scripted stemming (#1330, #1724). Stemming works fully from 30 % of the hole depth
 *  (`stemmingFactor`: 2.4 m of an 8 m hole), so 2.5 m is the shortest round column
 *  that gives full confinement: 1.5 m and 2 m throw rock, and anything longer
 *  changed no measured result (sweep 2-5 m at 5-7 kg). */
export const CHARGE_DEFAULT_STEMMING_M = 2.5;

/**
 * Largest rows×cols product `drill_plan grid` will build in one command
 * (#572, mirrors #569's MAX_CLAIM_BRIDGE_CHUNKS bound-the-work approach).
 * Checked before any hole is constructed — rows/cols are unauthenticated
 * console input, and looping rows×cols to build the plan is the cost this
 * bounds, not just the accepted grid size. Comfortably above the largest
 * grid any scenario or tutorial step ever orders (8×8 = 64 holes).
 */
export const MAX_DRILL_GRID_HOLES = 10_000;

/**
 * Longest ramp `build_ramp` will accept, in metres/voxels (#572, mirrors
 * MAX_DRILL_GRID_HOLES above). Checked before `rampFootprint`/`cellsInRect`
 * build the footprint, whether `length` comes from `--length` directly or
 * is derived from `--start`/`--end` — both console-supplied, both
 * unbounded before this. Comfortably above the longest ramp any scenario
 * orders (~12m) and above the furthest a single `claimForAction` bridge can
 * ever reach (MAX_CLAIM_BRIDGE_CHUNKS × CHUNK_SIZE ≈ 384 voxels) — nothing
 * longer could ever be built anyway.
 */
export const MAX_RAMP_LENGTH = 1_000;

/** Converts catalog `energyPerKg` into the energy units voxel absorption thresholds
 *  are written in. The catalog numbers were tuned against an inverse-square field
 *  whose epsilon amplified them at close range; propagation conserves energy instead,
 *  so the conversion is explicit. Calibrated so a well-stemmed pattern breaks a
 *  realistic volume per kilogram (powder factor ≈ 0.3 kg/m³). */
export const EXPLOSIVE_ENERGY_SCALE = 10.0;

/** Bulk purchase price relative to the per-order price of an explosive (#1678). */
export const EXPLOSIVE_BULK_PRICE_FACTOR = 0.7;

/**
 * Ticks a charge order's cash-bought explosives take to be delivered (#1895). Flat per order.
 * Stock drawn from a warehouse loads at once, so a site firing ~1 pattern per 500 ticks
 * waits ~400 ticks per unstocked pattern: the warehouse gains about that many ticks of
 * extra pattern time per pattern, which at the pattern value pays its $20k build and
 * $12/tick upkeep back within ~3,000 ticks.
 */
export const EXPLOSIVE_DELIVERY_TICKS = 400;

/** Kg added or removed per click of the stock purchase stepper (#1685). */
export const STOCK_BUY_STEP_KG = 50;

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

/** Metres from a side or lower free face within which rock still pulls overflow
 *  toward it. Farther out, only air above keeps its pull. A lateral void (an
 *  access ramp dug to a pattern's edge before the shot) otherwise drags energy
 *  away from the charges that are nowhere near it and leaves full-height
 *  pillars between holes that the same shot breaks cleanly without the void
 *  (#1793). Set to one hole spacing: a charge that sits at a face keeps its
 *  bench behaviour, rock a spacing further in is served by the sky as before. */
export const FREE_FACE_LATERAL_RANGE_M = 4;

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

/** Pre-fire estimate accuracy target (#1703): with a fresh seismic/core survey covering
 *  the pattern, an ordinary blast's EST. ORE VALUE lands within +-35% of the actual ore
 *  value. Working target, not a guarantee (seed 42: desert_badlands (32,22) boomite 8kg,
 *  green_foothills (32,32) krackle 8kg, alpine_granite (36,16) shatternite 4kg; 3x3
 *  pattern, spacing 4, depth 8). */
export const BLAST_ESTIMATE_TOLERANCE = 0.35;

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

/** How many voxel layers below a fragment's origin the search for the floor of its
 *  void goes before giving up (#1724). Voids a blast opens under a cap are a few
 *  metres deep; the bound only stops a scan down an unbounded empty column. */
export const PILE_VOID_SCAN_MAX_LAYERS = 64;

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

/** Share of fragments that may be oversized before the blast rating is capped. */
export const BLAST_OVERSIZE_SHARE_CAP = 0.30;

/** Share of charged holes that may fizzle (water-sensitive explosive in a wet hole) before the rating is capped to 'bad' (#1675). */
export const BLAST_FIZZLE_SHARE_FAILURE = 0.75;

/** Share of charged holes that may fizzle before the rating is capped to 'mediocre' (#1675). */
export const BLAST_FIZZLE_SHARE_PARTIAL = 0.25;

/** Minimum fragment render height (voxels) above the grid floor. */
export const FRAGMENT_MIN_RENDER_Y = 0.05;

// ─── Fragment Tumble and Settle (renderer playback, #485) ───────────────────

/** Fastest a fragment tumbles about its seeded axis while airborne (rad/s). */
export const TUMBLE_MAX_RATE_RAD_S = Math.PI * 2;

/** Flat multiplier on the (already impact-speed-scaled) tumble rate for a
 *  fragment that merely dropped rather than was thrown (0–1) — not itself a
 *  fall-speed term, since impact speed already drives the base rate for both
 *  thrown and dropped fragments. */
export const TUMBLE_DROP_FACTOR = 0.12;

/** A fragment that settles closer than this (squared, m^2) to where it started did not move: nothing to animate or sound. */
export const MIN_ANIMATED_DISPLACEMENT_SQ_M2 = 1e-6;

/** How long the squash-and-bounce settle plays after a fragment lands (s). */
export const SETTLE_DURATION_S = 0.35;

/** Peak scale deviation from 1.0 during the landing squash. */
export const SETTLE_SQUASH_MAGNITUDE = 0.15;

/** Number of decaying bounce oscillations in the settle animation. */
export const SETTLE_BOUNCE_OSCILLATIONS = 2;

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

/**
 * Metres a vehicle or employee must be moved beyond the zone boundary to
 * count as evacuated (Evacuation.ts findSafeEvacuationCell). Placeholder —
 * tuned by implementer/tests (#557).
 */
export const EVACUATION_CLEARANCE_M = 5;

/**
 * Tiles a tutorial building's footprint must clear from `tutorialHazards()`
 * (drill/boxcut/vehicle-spawn points) for its fixed-map REGION pin to be
 * legal. Distinct from `BLAST_DANGER_MARGIN_M`: that one gates in-blast
 * evacuation/damage geometry during a live blast; this one gates whether a
 * tutorial building's hardcoded pin is placed too close to a hazard at all.
 */
export const TUTORIAL_SITE_HAZARD_CLEARANCE_TILES = 5;

/**
 * Maximum Chebyshev span (tiles) allowed between the three tutorial building
 * pins (warehouse, driving_center, living_quarters), so the cluster reads as
 * one walkable site instead of scattering the player across the map.
 */
export const TUTORIAL_SITE_CLUSTER_MAX_SPAN_TILES = 6;

/**
 * Maximum real pathfinding route cost (tile-equivalent units, from
 * `findPath`'s total cost — not straight-line Chebyshev tile distance) from
 * the tutorial building cluster to the dig/drill area, keeping the round
 * trip an employee walks between site and workface short. Renamed from
 * `TUTORIAL_SITE_DIG_ROUND_TRIP_MAX_TILES` (#1170): the slope-gated navmesh
 * (#1151) makes a real walking route far longer than the straight-line tile
 * bound this used to measure, so the bound itself now has to be a route cost.
 */
export const TUTORIAL_SITE_DIG_ROUND_TRIP_MAX_ROUTE_COST = 24;

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
 * Most 16×16×16 voxel slabs a generated grid keeps materialized at once
 * (~76 KB each, so ~39 MB at the cap). A slab is only a cache of generator
 * output plus the edit record, so past this the least recently used ones are
 * dropped and rebuilt on their next read. Sized well above a campaign level's
 * working set — every surface band of a 160×160 site is ~300 slabs — so
 * eviction only engages for deep digging or a large expanded site.
 */
export const MAX_RESIDENT_VOXEL_SLABS = 512;

/** Resident slab count an eviction pass brings the cache down to — evicting in a batch keeps the sort off the per-slab allocation path. */
export const RESIDENT_VOXEL_SLABS_AFTER_EVICTION = 384;

/**
 * A* node-exploration budget formula (#458 T6.2/D14): actual cap is
 * `max(PATHFINDING_NODE_BUDGET_MIN, gridX * gridZ / PATHFINDING_NODE_BUDGET_AREA_DIVISOR)`,
 * computed by Pathfinding.ts where the grid's own dimensions are in scope — a
 * flat 500-node cap sized for the old ~64² levels falls back to direct-line
 * long before a legitimate cross-map route is found on D13's bigger levels
 * (up to 160×160).
 *
 * The divisor was 8 until #1166. That encoded "a legitimate route explores at
 * most an eighth of the map", which held under the old whole-voxel climb rule
 * (`NAV_MAX_CLIMB_HEIGHT = 3` admitted ~71° ground, so ordinary relief was
 * open terrain and routes ran close to straight). #1151's 30° slope gate makes
 * ordinary relief a maze of concave pockets instead, and the premise stops
 * holding: measured on tutorial_pit, a driller at (18,21) reaching drill hole
 * H3 at (21,15) — 6 cells away in a straight line — has only one legal route,
 * a 24-step detour north-west up the ridge and back, and a same-gate BFS needs
 * 1474 explored nodes to find it. Against a 64² grid's old cap of 512, A*
 * exhausted its budget, fell through to the direct-line fallback (which the
 * slope gate refuses), and reported `found: false` for a genuinely reachable
 * goal. `computeClimbReachableSet`'s unbudgeted flood fill disagreed, so
 * `selectBestActionForEmployee` admitted the candidate, spent a real pathfind
 * on it, got nothing back, and left the action `queued` with `holderId: null`
 * forever — one hole per drill grid that no one ever charges (#1166).
 *
 * 2 was chosen by measurement, not headroom: at 4 the H3 route resolves, and
 * the full scenario suite scores identically at 2 and at 1 (an unbounded
 * search over the whole grid), so half the grid is past the point where more
 * budget buys anything. A* is bounded by the cell count regardless — it never
 * expands a node twice — so the worst case this raises is O(area log area) on
 * a search that genuinely has no answer.
 */
export const PATHFINDING_NODE_BUDGET_MIN = 500;
export const PATHFINDING_NODE_BUDGET_AREA_DIVISOR = 2;
/** A* node-exploration budget for a grid of the given dimensions. */
export function pathfindingNodeBudget(gridWidth: number, gridHeight: number): number {
  return Math.max(
    PATHFINDING_NODE_BUDGET_MIN,
    Math.floor((gridWidth * gridHeight) / PATHFINDING_NODE_BUDGET_AREA_DIVISOR),
  );
}

/**
 * A* node budget for the one retry after the first budget is exhausted: the
 * whole grid area (A* never expands a node twice, so this is the unbounded
 * search's ceiling).
 */
export function pathfindingRetryNodeBudget(gridWidth: number, gridHeight: number): number {
  return Math.max(PATHFINDING_NODE_BUDGET_MIN, gridWidth * gridHeight);
}

/** Number of consecutive failed re-route attempts before the agent transitions to stuck state. */
export const STUCK_THRESHOLD = 3;

/**
 * Consecutive ticks any agent — foot or vehicle (#1206 generalizes this from
 * vehicle-only) — may sit blocked behind another occupying its next path cell
 * before the engine attempts an occupancy-avoiding reroute, and, if none
 * exists, flips isMoveStuck the same way a genuine pathfinding failure
 * already does. Deliberately larger than STUCK_THRESHOLD (3, tuned for the
 * rarer "no path at all" failure): ordinary transient contention between two
 * moving agents must not false-positive into a reroute/stuck flip. Matches
 * TRAFFIC_JAM_MIN_TICKS's order of magnitude for "no longer a transient wait"
 * as its own named constant (different concept: this is a single agent
 * blocked mid-route, not several converging on one cell).
 */
export const AGENT_OCCUPANCY_WAIT_TICKS = 10;

/**
 * Largest ring radius `findNearestFreeCell`'s ring-search loop (Locomotion.ts)
 * will expand to before giving up. Replaces that loop's previously-hardcoded
 * literal `2` — a flat cap of 2 rings (searching at most a 5x5 neighbourhood)
 * can never find a free cell in a saturated 1m-spacing, high-density hole grid
 * (issue #1278), since every cell within 2 rings of the blocker is itself
 * occupied by another hole/agent.
 *
 * Measured (#1278) against the worst case a saturated 8x8 (64-hole),
 * 1m-spacing grid can present: an occupant sitting at the grid's own most
 * interior cell needs exactly `ceil(gridWidth / 2)` = 4 ring-steps to reach
 * open, unoccupied ground outside the block in the single nearest direction
 * — confirmed both by this formula and by a direct simulation
 * (`relocateIdleDestinationBlocker` relocating a genuinely idle occupant
 * planted at that exact worst-case cell, every other cell of the 8x8 block
 * held by a non-relocatable "busy" occupant): radius 3 fails to find
 * anywhere to put it, radius 4 succeeds, and radius 5+ finds the identical
 * cell (the ring search returns the first radius with any free cell, so a
 * higher ceiling never changes the outcome once 4 already succeeds). 4 is
 * therefore sufficient for this constant's own job — freeing one cell for
 * one relocated idle occupant — and is kept at its already-measured value.
 *
 * This constant does not by itself resolve a fully saturated grid where
 * every one of many simultaneously-converging movers' own approach path
 * (not just its final destination) crosses other occupants that are busy
 * (not relocatable, by design) or idle-but-not-anyone's-own-destination
 * (never a `relocateIdleDestinationBlocker` candidate) — raising this radius
 * further does not change that outcome either (confirmed: radius 8 produces
 * the same result as radius 4 for that harder case). That is a different,
 * much larger problem than the one this constant governs, and out of this
 * issue's scope.
 */
export const AGENT_FREE_CELL_SEARCH_MAX_RADIUS = 4;

/**
 * Longest walkable route (NavGrid move cost) from a relocated mover's cell
 * back to its sidestep cell that still counts as "can get back" when the direct
 * step is a cliff (#1672). Measured: the sidesteps level 1 relies on cost <= ~8
 * (a short detour on a gentle slope); the level-2 strand that stalled the first
 * blast costs 77+ (a full loop round the bench). 3 ring radii sits between them.
 */
export const AGENT_FREE_CELL_MAX_RETURN_COST = 3 * AGENT_FREE_CELL_SEARCH_MAX_RADIUS;

/** Employee agent walking speed in grid cells per tick (1 tick = 1 game-hour). */
export const AGENT_WALK_SPEED = 2;

/**
 * Largest number of PendingAction ids an employee may hold in `taskQueue`
 * beyond the one currently claimed (#549 cost-based dispatch). Bounds how far
 * ahead dispatch commits an employee, so a burst of newly-issued actions
 * doesn't lock them onto a long queue that later-arriving cheaper work can
 * never displace.
 */
export const MAX_EMPLOYEE_TASK_QUEUE_DEPTH = 3;

/**
 * Upper bound on how many top-ranked candidates (by the cheap
 * `estimateActionCost` heuristic) `selectBestActionForEmployee` will spend a
 * real `findPath` call resolving before giving up. Caps per-employee
 * dispatch cost at a fixed number of pathfinds regardless of how many
 * pending actions exist.
 *
 * A crater's own nearby candidates can still dominate the cheap end of the
 * ranking pass by raw distance even when a climb-illegal step makes them
 * unreachable (#953) — `selectBestActionForEmployee` (ActionSelection.ts)
 * handles that with a climb-aware reachable-set pre-filter (computed once
 * per call, screening out any candidate the requesting employee cannot
 * climb-legally reach) rather than by widening this budget, so this stays
 * at its original, deliberately small value.
 */
export const ACTION_SELECTION_MAX_PATH_ATTEMPTS = 5;

/**
 * Debris orders past this many in one candidate pool are ranked by spatial bin
 * rather than one by one (#1603, DebrisCandidateBins.ts): a large blast queues
 * thousands, and costing each per idle employee per tick froze the frame.
 * Smaller pools — every ordinary blast's — rank exactly as before.
 */
export const DEBRIS_SELECTION_BINNING_MIN = 128;
/** Side, in cells, of the ground square debris orders are binned by. */
export const DEBRIS_SELECTION_BIN_CELLS = 4;
/** Members of a debris bin tried, nearest first, before giving the bin up for this pass. */
export const DEBRIS_SELECTION_BIN_PROBES = 3;
/** Debris bins, nearest first, whose representative is costed in one search; applies per destination class (ore, barren). */
export const DEBRIS_SELECTION_MAX_BINS = 16;
/**
 * Debris bins of one kind (order type × ore or barren) tried in one search
 * before the rest of that kind are left for a later one: bounds a search when
 * the nearest rock can't be taken (no storage room, no free vehicle), so it
 * costs the same however big the pile. Per kind, so ore the warehouse has no
 * room for never hides barren rock the spoil heap would take.
 */
export const DEBRIS_SELECTION_MAX_BINS_TRIED_PER_KIND = 16;
/**
 * Auto-debris orders re-judged per tick for reachability and warnings, rotating
 * through them (#1603, OrderReachability.ts `sliceDebris`); every other order
 * is judged every tick.
 */
export const DEBRIS_CLASSIFY_PER_TICK = 128;

/**
 * Auto-debris orders queued per tick (#1603, HaulDispatch.ts `syncHaulDispatch`).
 * A large blast lands thousands of fragments at once; queueing an order (and
 * its ghost) for every one in the first tick after it froze that tick, so the
 * pile is queued this many fragments a tick, in the order the blast left them.
 * Haulers take one load at a time, so they never wait on it.
 */
export const DEBRIS_DISPATCH_PER_TICK = 512;

/**
 * Work between two yields of the resumable blast pipeline (#1603, Steps.ts),
 * each a power of two: grid cells for the per-cell passes, fragments or
 * broken voxels for the per-item ones. Each slice is a fraction of a millisecond, so the browser
 * can stop within its frame budget; the console runs every slice at once.
 */
export const BLAST_SLICE_CELLS = 2048;
export const BLAST_SLICE_ITEMS = 32;
/** Columns of ground per terrain/nav update a blast announces at a time (`emitRegionInStrips`). */
export const BLAST_SLICE_STRIP_COLUMNS = 8;

/**
 * Upper bound on how many ranked, qualified candidates
 * `findBestEvacuationDriver` (VehicleDriverAssignment.ts) will spend a real
 * `findPath`-backed `canReach` call resolving before giving up on finding a
 * driver for a vehicle to evacuate. Same shape as
 * `ACTION_SELECTION_MAX_PATH_ATTEMPTS` above — caps per-vehicle evacuation
 * dispatch cost at a fixed number of pathfinds regardless of how many
 * employees are in the zone — kept as its own constant since the two caps
 * bound unrelated call sites and have no reason to move together.
 */
export const EVACUATION_DRIVER_MAX_PATH_ATTEMPTS = 5;

/**
 * Ranking-priority bonus (ticks) subtracted from a haul_debris/fragment_debris
 * candidate's estimated cost in `estimateActionCost` when its fragment
 * carries ore, so ore-bearing fragments get hauled before storage fills up
 * with plain spoil. Does not affect the real duration used for ETA/display —
 * ranking-only. To be derived from site scale / AGENT_WALK_SPEED.
 */
// Derived as half the tick-cost of crossing DEFAULT_GRID_SIZE (64 cells) at
// AGENT_WALK_SPEED (2 cells/tick) one-way — i.e. (64 / 2) / 2 = 16 ticks.
// That gives an ore-bearing candidate up to ~32 extra grid cells of
// travel-cost tolerance over a same-role non-ore candidate (tens of cells, as
// required), while staying well under the ~32-45 tick cost of crossing an
// entire default site, so a very distant ore fragment still loses to a truly
// nearby plain one rather than winning unconditionally regardless of distance.
export const ORE_HAUL_PRIORITY_BONUS_TICKS: number = 16;

// Extra haul-priority bonus for an ore-bearing fragment whose ore an open
// ore_sale offer is short of (#1817). Derived as the tick-cost of crossing
// DEFAULT_GRID_SIZE (64 cells) at AGENT_WALK_SPEED (2 cells/tick) one-way
// (32 ticks), doubled = 64 ticks: 4x the base ore bonus, scaled by urgency.
export const ORE_DEMAND_HAUL_PRIORITY_BONUS_TICKS: number = 64;

// Extra haul-priority bonus for an on-ground fragment lying on a planned
// drill hole, so rubble burying a hole is cleared before other rubble (#1937).
// Same magnitude as the ore-demand bonus: one grid crossing there and back.
export const BURIED_HOLE_HAUL_PRIORITY_BONUS_TICKS: number = 64;

// Ore density (share of the fragment's volume that is the demanded ore) at
// which a fragment earns the full demand bonus (#1828). Richer fragments are
// capped here; leaner ones scale down proportionally. A half-ore fragment is
// already a rich haul, so grade above it adds no extra urgency.
// Defined at ore grade scale 1; scaled by the site's oreGradeScale (#1932).
export const ORE_DEMAND_FULL_GRADE: number = 0.5;

// Below this ore share a fragment counts as trace and earns no demand bonus
// (#1828), so a speck of ore in plain spoil does not pull haulers off real
// work. 5% is lean enough to ignore, rich enough that genuine ore clears it.
// Defined at ore grade scale 1; scaled by the site's oreGradeScale (#1932).
export const ORE_DEMAND_MIN_GRADE: number = 0.05;

/**
 * Rank tier per action type: a HIGHER tier is considered before any lower one,
 * and cost only orders candidates within a tier (#1742). Without it a cheap
 * haul_debris trip chain starves a dearer charge_hole that gates the next
 * shot. Unlisted types are tier 0. A new time-critical order type is one
 * entry here; no ranking code changes.
 *
 * demolish_building shares the tier (#1840): demolition (and the upgrade that
 * starts with it) must not wait behind a never-ending haul stream when every
 * licensed driver is mounted on debris haulers. A driver on a loaded vehicle
 * still never abandons the haul (#1709; the planner refuses). Reverse by
 * deleting the entry.
 */
export const ACTION_RANK_TIER: Partial<Record<ActionType, number>> = { charge_hole: 1, demolish_building: 1 };

/** Rank tier of an action type (see ACTION_RANK_TIER). */
export function actionRankTier(type: ActionType): number {
  return ACTION_RANK_TIER[type] ?? 0;
}

/**
 * Ticks a queued, unclaimed action with requiredVehicleRole === null (any
 * on-foot action class open to whoever is free — place_building, survey,
 * general_work; demolish_building is not one of them since it requires a
 * building_destroyer, #1392; ACTION_RANK_TIER covers it, #1840) may sit waiting before it must win the
 * next vehicle-gated completion's dispatch decision, overriding
 * tryContinueVehicleGatedAction's same-role continuity fast path
 * (VehicleContinuity.ts) regardless of cost ranking (#1000).
 */
export const ACTION_STARVATION_TICK_THRESHOLD = 300;

/** Morale penalty applied per tick to an employee stuck with no walkable path (see NEED_MORALE_EFFECT_PENALTIES for the analogous need-driven table). */
export const STUCK_MORALE_PENALTY = 2;

/**
 * Consecutive ticks (moveConsecutiveFailures, which already grows unboundedly
 * once isMoveStuck flips true — see AgentMovement.recordStuckFailure) an
 * employee may stay isMoveStuck before its claimed action/vehicle-boarding
 * intent is released back to the pending-action pool via
 * TaskDispatch.interruptActiveAction, instead of staying parked forever
 * (#938). Generalizes ForceShiftRest.ts's own pendingTaskDuration/isMoveStuck
 * exemption — that one only rescues an employee who also happens to qualify
 * for a rest trigger at the moment they get stuck; this rescues every
 * position-dependent claim. Deliberately well above STUCK_THRESHOLD (3) and
 * AGENT_OCCUPANCY_WAIT_TICKS/TRAFFIC_JAM_MIN_TICKS's "no longer
 * transient" order of magnitude (10) — a genuine, sustained impasse only,
 * not a blast or reroute a few ticks from resolving itself.
 */
export const MOVE_STUCK_ABANDON_TICKS = 30;

/**
 * Ticks before a stuck-abandoned action becomes claimable again. 2x
 * MOVE_STUCK_ABANDON_TICKS — see issue #1130 Decisions taken.
 */
export const ACTION_STUCK_BACKOFF_TICKS = 60;

/** Height of one bench level, in metres (#1149). Affects benchLevel computation in NavGrid. */
export const NAV_BENCH_HEIGHT = 5;

/**
 * Max slope, in degrees, an agent can step between adjacent NavGrid cells —
 * replaces `NAV_MAX_CLIMB_HEIGHT` (#1151). The old rule admitted a step of up
 * to 3 metres over a 1-metre cardinal run — arctan(3/1) ≈ 71° — purely
 * because 3 voxels happened to be shorter than that; nothing about 71° was a
 * deliberate slope decision. 30° makes the rule legible on its own terms:
 * gentler than this and a worker walks it, steeper and it has to be cut into
 * a ramp. One constant, applied identically to every agent kind — workers
 * and vehicles alike, no per-agent-kind variant.
 *
 * Measured reachability cost of the 30° cutoff (#1147 flood fill,
 * NEIGHBOUR_OFFSETS_8, seed 42, 64m sites): desert_badlands 100%,
 * volcanic_flats 100%, red_canyon 98.7%, green_foothills 96.7%,
 * tropical_karst 66.1%, alpine_granite 48.2% — the last two accepted as
 * designed mountain-level difficulty, not a regression to chase.
 */
export const NAV_MAX_SLOPE_DEGREES = 30;

/**
 * Precomputed tan(NAV_MAX_SLOPE_DEGREES) ≈ 0.5774 — the max metres of rise
 * legal per metre of horizontal run. Multiplied by a step's own run distance
 * rather than calling `Math.tan` per step: 0.5774m of rise over a 1m
 * cardinal step, 0.8165m over a √2m diagonal step.
 */
export const NAV_MAX_SLOPE_RATIO = Math.tan(NAV_MAX_SLOPE_DEGREES * Math.PI / 180);

/** Steepest slope (degrees) each vehicle tier climbs on a progression site (#1938). Tier 1 keeps the global limit. */
export const VEHICLE_TIER_MAX_SLOPE_DEGREES: Record<VehicleTier, number> = {
  1: NAV_MAX_SLOPE_DEGREES,
  2: 24,
  3: 18,
};

/**
 * Anti-noise floor, in metres, below which a graded cardinal-neighbour
 * height delta reads as flat rather than a ramp. Ramp classification uses
 * the same slope measure step legality does; without a floor near the
 * climbable ceiling, almost every non-identical neighbour pair on
 * continuously-graded terrain (post-#1148) flags as a ramp — measured
 * directly against a fresh 32x32 site (desert, seeds 1/2/42): a flat 0.05m
 * floor still left 62-81% of every legally-climbable cardinal step
 * classified 'ramp' (moveCost 1.8x), because ordinary graded ground alone
 * commonly varies more than 5cm between adjacent cells — nowhere near "noise
 * ignored", closer to "ramp is the default terrain type" (#1151 fixer
 * finding). 95% of NAV_MAX_SLOPE_RATIO instead keeps only the steepest sliver
 * of the legally-climbable range — genuinely near-cliff ground, or an actual
 * built ramp's own grade, which is deliberately cut close to the ceiling
 * (`length >= depth * 1.8`) — as 'ramp'; the same measurement gives 0.7-2.9%
 * at this floor, in line with the pre-#1151 whole-voxel rule's ~0.15%.
 */
export const NAV_RAMP_MIN_SLOPE_DELTA = NAV_MAX_SLOPE_RATIO * 0.95;

/** Fraction of NAV_MAX_SLOPE_RATIO a freshly-cut ramp's floor is graded to — strictly
 * under 1 so the finished floor always tests as legally climbable with headroom for
 * float rounding across the ramp's full length (#1152). */
const RAMP_CUT_SLOPE_MARGIN = 0.98;

/** The actual rise-per-metre-of-run a ramp's floor is cut at (#1152). */
export const RAMP_CUT_SLOPE_RATIO = NAV_MAX_SLOPE_RATIO * RAMP_CUT_SLOPE_MARGIN;

/** Largest gap (m) between a ramp's planned foot and the end tile's floor that the depth snap bridges (#1852). */
export const RAMP_FLOOR_SNAP_REACH_M = 2;

/** An end tile counts as dug floor only when at least this far (m) below the start ground (#1852). */
export const RAMP_CRATER_MIN_DROP_M = 2;

/** Required clearance, in cells, for an employee on foot (#1154). */
export const NAV_CLEARANCE_EMPLOYEE_CELLS = 1;

/** Required clearance, in cells, for a vehicle (#1154). */
export const NAV_CLEARANCE_VEHICLE_CELLS = 2;

/** Cap on `NavCell.clearance` — the widest clearance any consumer needs to distinguish (#1154). */
export const NAV_CLEARANCE_MAX_CELLS = Math.max(NAV_CLEARANCE_EMPLOYEE_CELLS, NAV_CLEARANCE_VEHICLE_CELLS);

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
  /** 4000 kg cargo (T2 6400, T3 10000), several fragments per trip (#1370); cost scaled from real $1–5M dump trucks; diesel ~$150/hr scaled. */
  debris_hauler:      { workRate: 10, purchaseCost: 25_000, maintenanceCostPerTick: 3, fuelCostPerTick: 5, capacity: 4000, speed: 3, maxHp: 100 },
  /** ~8 m³/tick excavation; most expensive vehicle — the key production bottleneck. */
  rock_digger:        { workRate: 8,  purchaseCost: 50_000, maintenanceCostPerTick: 5, fuelCostPerTick: 8, capacity: 50,  speed: 1, maxHp: 150 },
  /** 5 progress units/tick per hole; capacity = 2 holes/tick. */
  drill_rig:          { workRate: 5,  purchaseCost: 35_000, maintenanceCostPerTick: 4, fuelCostPerTick: 6, capacity: 2,   speed: 1, maxHp: 120 },
  /** 12 damage units/tick; ~100 kg/tick clearing rate. */
  building_destroyer: { workRate: 12, purchaseCost: 30_000, maintenanceCostPerTick: 4, fuelCostPerTick: 7, capacity: 100, speed: 2, maxHp: 130 },
  /** 9 fragments/tick output; ~90 kg/tick fragmentation throughput. */
  rock_fragmenter:    { workRate: 9,  purchaseCost: 32_000, maintenanceCostPerTick: 4, fuelCostPerTick: 7, capacity: 90,  speed: 2, maxHp: 125 },
  /** capacity = kg of explosive carried per load; $28k sits between the hauler ($25k) and the fragmenter ($32k); slow, light chassis (115 hp). */
  charging_truck:     { workRate: 6,  purchaseCost: 28_000, maintenanceCostPerTick: 4, fuelCostPerTick: 6, capacity: 500, speed: 2, maxHp: 115 },
} as const;

/**
 * Fraction of purchaseCost paid back on `vehicle scrap`, further scaled by the
 * vehicle's current hp/maxHp — a wrecked vehicle is worth less for parts than
 * a pristine one. Unlike building demolition (which costs money, tearing a
 * structure down), scrapping a vehicle sells it for salvage.
 */
export const VEHICLE_SCRAP_RESIDUAL_FRACTION = 0.4;

/** Highest vehicle tier; `vehicle upgrade` is refused at this tier (#1401). */
export const VEHICLE_MAX_TIER: VehicleTier = 3;

/** Mine grade at which each vehicle tier becomes purchasable on progression sites (#1928). */
export const VEHICLE_TIER_UNLOCK_GRADE: Readonly<Record<VehicleTier, number>> = { 1: 0, 2: 2, 3: 4 };

/**
 * Base excavation voxels/tick for a tier-1 rock digger (#555 ramp
 * excavation — matches VEHICLE_BASE_STATS.rock_digger.workRate). Shared by
 * ramp excavation and ground levelling (#1009) — both are `rock_digger`
 * work carved by the same driver/vehicle role.
 */
export const RAMP_DIG_VOXELS_PER_TICK_TIER1 = 8;

/** Largest rectangle area (voxels) `level_ground` will accept in one order (#1009, mirrors MAX_RAMP_LENGTH above). */
export const MAX_LEVEL_GROUND_AREA = 400;

/** Ramp widths (voxels) the player may choose at construction or widen to (#1298). */
export const RAMP_WIDTH_OPTIONS = [3, 5, 7] as const;
export type RampWidth = typeof RAMP_WIDTH_OPTIONS[number];
/** True when `n` is one of the selectable ramp widths. */
export function isRampWidth(n: number): n is RampWidth {
  return (RAMP_WIDTH_OPTIONS as readonly number[]).includes(n);
}
/** Width of a ramp when none is chosen — the pre-#1298 fixed width. */
export const RAMP_DEFAULT_WIDTH: RampWidth = 3;
/** Ramp cost per meter of length per voxel of width; the default width costs the pre-#1298 flat $100/m. */
export const RAMP_COST_PER_METER_PER_WIDTH = 100 / 3;

/** Cost per voxel levelled, in game dollars (#1009, mirrors the ramp cost in balance above). */
export const LEVEL_GROUND_COST_PER_VOXEL = 12;

/** Base duration (ticks) of a `place_building` action before the per-tier multiplier (#556 construction sites). */
/**
 * Base work a tier-1 construction site takes before the building stands (#556).
 *
 * 15, not the 40 this landed on first: the figure is not just the site's own
 * duration, it is crew time. A builder walks to the site, works it in whatever
 * blocks the site policy's rest cycle leaves them, and is worn down for
 * everything that comes after. At 40 the tutorial's own two buildings cost the
 * crew ~350 ticks and left them at morale 0 by the box-cut stage, deep enough
 * into the rest cycle that they never completed a single one of its 12
 * dig_ramp_segment actions across 300 ticks — the tutorial could not be
 * finished, by a scenario or by a player. At 15 the same crew reaches that
 * stage at morale ~61 and digs the ramp. Still unmistakably real work: a
 * tier-1 building takes most of a day and a tier-3 one (x2.4) over three.
 */
export const BUILDING_CONSTRUCTION_BASE_DURATION_TICKS = 15;

/**
 * Share of the current tier's construction cost credited against an in-place
 * upgrade (#1905): upgrading tier N to N+1 costs tier N+1's construction cost
 * minus this share of tier N's. Owner rule on #1889: the player has already
 * paid for the current tier, so half of it counts toward the next. Set to 0 to
 * reverse the rule (the full next-tier price is charged, as in #1875).
 */
export const BUILDING_UPGRADE_CREDIT_SHARE = 0.5;

/** Per-tier multiplier applied to BUILDING_CONSTRUCTION_BASE_DURATION_TICKS (#556 construction sites) — a bigger tier takes longer to build. */
export const BUILDING_CONSTRUCTION_TIER_MULTIPLIER: Record<BuildingTier, number> = { 1: 1, 2: 1.6, 3: 2.4 };

/**
 * Largest surface-height spread (in voxel levels, `getSurfaceY`) a building
 * footprint may straddle and still be placeable (#1008 refinement).
 *
 * Zero — the rule as #1008 first shipped it — demanded a perfectly level
 * footprint, which on the hand-sculpted relief these levels generate is rare
 * enough to be tedious: seed 42's whole north-west quarter is a one-level-per-
 * tile gradient, so a player hunting a legal 4x4 warehouse site scans dozens
 * of tiles that differ by a single voxel. One level is the slight slope the
 * crew is allowed to absorb: construction ends by cutting the footprint down
 * to its lowest column (`levelGroundRect`, LevelGround.ts), so the building
 * still stands on genuinely flat ground — the tolerance buys the player a
 * forgiving placement, not a tilted building.
 *
 * Raising it past 1 is not free: the cut deepens with the spread, and on a
 * small (2x2) footprint a 2-level step is a ~45 degrees slope, which reads as
 * a building carved into a cliff rather than set on a gentle grade.
 */
export const BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD = 1;

/** Summed ore density of a fragment at or below which it counts as barren and goes to a spoil heap (#1530). Defined at ore grade scale 1; scaled by the site's oreGradeScale (#1932). */
export const SPOIL_BARREN_ORE_FRACTION_THRESHOLD = 0.02;

/**
 * Freight Warehouse storage capacity in kg, by tier (#1531). BuildingDefs reads it for `capacity`.
 *
 * Sized against a measured blast: the level-1 Dusty Hollow 1x2 boomite 2.2 kg reference shot (seed 1138)
 * yields 45,888 kg of ore-bearing rock (re-measured after the #1792 flush-breakout change; the
 * historic 2x2 shot read 57,061 kg). Tier 1 (25,000) holds ~54% of that blast; tier 2 (72,000) holds all
 * of it with ~57% margin; tier 3 (200,000) holds more than 4 such blasts. To re-measure, fire that shot
 * headlessly (console, seed 1138) and sum the mass of fragments with ore density above
 * SPOIL_BARREN_ORE_FRACTION_THRESHOLD.
 */
export const FREIGHT_WAREHOUSE_CAPACITY_KG: Record<1 | 2 | 3, number> = { 1: 25000, 2: 72000, 3: 200000 };

/** VehicleTask each role shows once its vehicle arrives at a reserved action's target and the work timer starts (#550). */
export const VEHICLE_ROLE_ARRIVAL_TASK: Record<VehicleRole, VehicleTask> = {
  drill_rig: 'drilling',
  debris_hauler: 'transport',
  charging_truck: 'loading',
  rock_digger: 'clearing',
  rock_fragmenter: 'clearing',
  building_destroyer: 'clearing',
};

/** Seats per vehicle role — how many employees a vehicle of that role may carry at once. */
export const VEHICLE_SEAT_COUNT: Record<VehicleRole, number> = {
  drill_rig: 1,
  debris_hauler: 1,
  charging_truck: 1,
  rock_digger: 1,
  rock_fragmenter: 1,
  building_destroyer: 1,
};

/**
 * When true, planItinerary compares walking the full distance on foot
 * against riding a free vehicle for goals that don't strictly require one,
 * and picks whichever is cheaper. The comparison itself lives in
 * PlanItinerary.ts (gameplay-vehicle-fleet phase 7, fast transport), scoped
 * to `'work'` goals only — a driller riding a hauler to their next dig
 * rather than walking, never a change to which vehicle an action requires.
 */
export const VEHICLE_TRANSPORT_PLANNING_ENABLED = true;

/**
 * Bounded estimate (grid cells) for the on-foot remainder after a transport
 * ride alights adjacent to its target rather than exactly on it. Mirrors
 * `buildBoardLeg`'s own convention of a fixed, deliberate approximation
 * rather than a real remaining-distance calculation.
 */
export const TRANSPORT_ALIGHT_FINISH_WALK_CELLS = 1;

// ─── Starting Site (staffed new_game / sandbox) ────────────────────────────────

export interface StartingSiteQualification {
  readonly category: SkillCategory;
  readonly proficiencyLevel: 1 | 2 | 3 | 4 | 5;
  /** Vehicle licence level held (defaults to 1): a tier-N vehicle needs level N. */
  readonly licenceLevel?: 1 | 2 | 3;
}

export interface StartingSiteEmployeeSlot {
  readonly role: EmployeeRole;
  readonly qualifications: readonly StartingSiteQualification[];
}

export interface StartingSiteVehicleSlot {
  readonly role: VehicleRole;
  readonly tier: VehicleTier;
}

export interface StartingBuildingSlot {
  readonly type: BuildingType;
  readonly tier: BuildingTier;
}

/**
 * Driller, blaster and truck driver: the crew every starting site opens with.
 * The blaster also holds the charging truck's licence (`driving.truck`), so
 * someone can both charge and drive the tier-1 charging truck (#1648).
 */
const BASE_STARTING_EMPLOYEES: readonly StartingSiteEmployeeSlot[] = [
  { role: 'driller', qualifications: [
    { category: 'blasting', proficiencyLevel: 1 },
    { category: 'driving.drill_rig', proficiencyLevel: 1 },
  ] },
  { role: 'blaster', qualifications: [
    { category: 'blasting', proficiencyLevel: 1 },
    { category: 'driving.truck', proficiencyLevel: 1 },
  ] },
  { role: 'driver', qualifications: [
    { category: 'driving.truck', proficiencyLevel: 1 },
  ] },
];

/** Drill rig, debris hauler and charging truck: the fleet every blasting opening carries (#1648). */
const BASE_STARTING_VEHICLES_BEFORE_CHARGING: readonly StartingSiteVehicleSlot[] = [
  { role: 'drill_rig', tier: 1 },
  { role: 'debris_hauler', tier: 1 },
];
const STARTING_CHARGING_TRUCK: StartingSiteVehicleSlot = { role: 'charging_truck', tier: 1 };
const BASE_STARTING_VEHICLES: readonly StartingSiteVehicleSlot[] = [
  ...BASE_STARTING_VEHICLES_BEFORE_CHARGING,
  STARTING_CHARGING_TRUCK,
];

/** A starting site's pre-hired roster, pre-purchased fleet and pre-placed buildings. */
export interface StartingSiteComposition {
  readonly employees: readonly StartingSiteEmployeeSlot[];
  readonly vehicles: readonly StartingSiteVehicleSlot[];
  readonly buildings: readonly StartingBuildingSlot[];
}

/**
 * Composition of the opt-in staffed starting site (`new_game staffed:true` /
 * `sandbox start staffed:true`). Covers the licences and vehicle roles the
 * queued-work pipeline (#552-#556) requires, so scenarios can boot a
 * ready-to-work site instead of hiring/purchasing through the UI in every
 * unrelated scenario. See issue #551.
 */
export const STARTING_SITE_STAFFED_COMPOSITION: StartingSiteComposition = {
  buildings: [],
  employees: [
    ...BASE_STARTING_EMPLOYEES,
    // Both excavator drivers also hold the rock fragmenter licence, so either
    // can crew the fragmenter (it has a licence of its own since #1339).
    { role: 'driver', qualifications: [
      { category: 'driving.excavator', proficiencyLevel: 1 },
      { category: 'driving.rock_fragmenter', proficiencyLevel: 1 },
    ] },
    { role: 'driver', qualifications: [
      { category: 'driving.excavator', proficiencyLevel: 1 },
      { category: 'driving.rock_fragmenter', proficiencyLevel: 1 },
    ] },
  ],
  // The charging truck sits in the last spawn slot: the authored row is what
  // the older fleet's positions (and every seed-pinned playthrough on them)
  // were tuned against, so a newcomer extends the row rather than shifting it.
  vehicles: [
    ...BASE_STARTING_VEHICLES_BEFORE_CHARGING,
    { role: 'rock_digger', tier: 1 },
    { role: 'rock_fragmenter', tier: 1 },
    STARTING_CHARGING_TRUCK,
  ],
} as const;

/**
 * Dusty Hollow's own opening crew, fleet, warehouse and spoil heap (#1363,
 * #1574). The heap is placed after the warehouse, so barren rock has a dump
 * from the first blast.
 */
export const DUSTY_HOLLOW_STARTING_SITE: StartingSiteComposition = {
  employees: BASE_STARTING_EMPLOYEES,
  vehicles: BASE_STARTING_VEHICLES,
  buildings: [{ type: 'freight_warehouse', tier: 1 }, { type: 'spoil_heap', tier: 1 }],
};

const DIGGER_KIT_DRIVER: StartingSiteEmployeeSlot = {
  role: 'driver',
  qualifications: [{ category: 'driving.excavator', proficiencyLevel: 1 }],
};

/**
 * The free kit shared by sandbox 'normal' and the Grumpstone Ridge and
 * Treranium Depths openings (#1672): the Dusty Hollow kit plus a rock digger
 * (a ramp into the crater) and its excavator-licensed driver. Each opens able
 * to drill, charge, fire, haul and fill an ore contract with no purchases.
 * The kit is free, but its payroll (~$230/tick) is not: each level's own
 * startingCash (Level.ts) is sized to carry it to the first sale.
 */
const DIGGER_STARTING_SITE: StartingSiteComposition = {
  employees: [...BASE_STARTING_EMPLOYEES, DIGGER_KIT_DRIVER],
  vehicles: [...BASE_STARTING_VEHICLES, { role: 'rock_digger', tier: 1 }],
  buildings: DUSTY_HOLLOW_STARTING_SITE.buildings,
};

export const GRUMPSTONE_RIDGE_STARTING_SITE: StartingSiteComposition = DIGGER_STARTING_SITE;

/**
 * Treranium ore sits 32 m down and the tier-1 rig reaches only 12 m
 * (DRILL_RIG_MAX_DEPTH_M, #1679), so this kit swaps in a tier-2 rig (24 m reach,
 * the 24 m holes the first sale needs) to stay a kit that reaches its own ore.
 */
export const TRERANIUM_DEPTHS_STARTING_SITE: StartingSiteComposition = {
  ...DIGGER_STARTING_SITE,
  // The driller also holds the tier-2 rig licence (licenceLevel 2) its rig requires.
  employees: DIGGER_STARTING_SITE.employees.map(e => (e.role === 'driller'
    ? { ...e, qualifications: e.qualifications.map(q => (q.category === 'driving.drill_rig' ? { ...q, licenceLevel: 2 as const } : q)) }
    : e)),
  vehicles: DIGGER_STARTING_SITE.vehicles.map(v => (v.role === 'drill_rig' ? { ...v, tier: 2 } : v)),
};

/**
 * tutorial_pit's opening site (#1574): one free spoil heap, no crew or fleet
 * (the tutorial hires its own). The heap is not a scripted step, so the first
 * blast's barren rock has a dump without a "place a spoil heap" notification.
 */
export const TUTORIAL_STARTING_SITE: StartingSiteComposition = {
  employees: [],
  vehicles: [],
  buildings: [{ type: 'spoil_heap', tier: 1 }],
};

/**
 * tutorial_pit's rally point, in tiles: on the flat plateau between the
 * building pins (living quarters, driving centre and warehouse to the west)
 * and the blast (box cut at x=10 and drill pattern from z=24, to the south),
 * clear of both by `TUTORIAL_SITE_HAZARD_CLEARANCE_TILES`. The old spawn, the
 * post-survey world centre, put every vehicle bought on the hillside east of
 * the pattern.
 */
export const TUTORIAL_RALLY_POINT = { x: 15, z: 17 } as const;

/**
 * Where tutorial_pit's free spoil heap is sought, in tiles: the flat ground
 * south of the building pins and west of the box cut, clear of the blast and
 * of every pin the tutorial and its scenarios build on. Its old anchor, east
 * of the site centre, put the heap on the hillside.
 */
export const TUTORIAL_STARTING_BUILDINGS_NEAR = { x: 4, z: 19 } as const;

/** Sandbox starting-kit ids (#1671, #1891): 'digger' = rock digger and driver, 'full' = adds a rock fragmenter and its driver. Starting kits are keyed by it. */
export type SandboxKitId = 'digger' | 'full';

const SANDBOX_KIT_FRAGMENTER_DRIVER: StartingSiteEmployeeSlot = {
  role: 'driver',
  qualifications: [{ category: 'driving.rock_fragmenter', proficiencyLevel: 1 }],
};

/**
 * Free starting kit per sandbox kit (#1671, #1891): every kit can drill,
 * charge, fire, haul and sell its first blast with no purchases. 'digger' is a
 * rock digger, a ramp into the crater, and its dedicated excavator-licensed
 * driver (#1874). 'full' adds a rock fragmenter and its licensed driver.
 */
export const SANDBOX_STARTING_SITES: Readonly<Record<SandboxKitId, StartingSiteComposition>> = {
  digger: DIGGER_STARTING_SITE,
  full: {
    employees: [...BASE_STARTING_EMPLOYEES, DIGGER_KIT_DRIVER, SANDBOX_KIT_FRAGMENTER_DRIVER],
    vehicles: [...BASE_STARTING_VEHICLES, { role: 'rock_digger', tier: 1 }, { role: 'rock_fragmenter', tier: 1 }],
    buildings: DIGGER_STARTING_SITE.buildings,
  },
};

/**
 * Opening cash per sandbox kit (#1747, #1891). The richer kit starts with more
 * cash. The retired 195k hard tier (same kit as digger, less cash) is gone.
 *
 * Bisected (#1747) on the standard opening (desert_badlands, seed 42, no cash
 * injection, contracts accepted once stock covers them): tier-1 living_quarters
 * at (30,48), then one 3x3 Krackle 8 kg pattern (spacing 4, depth 8, start
 * 36,32), charge, clear zone, blast (~t562), haul, sell. Payroll and upkeep
 * drain cash until the first sale, whose low point is linear in the start:
 * the digger kit (#1874) bottoms at (start - 181.5k), so the minimum
 * positive-cash start is ~181.6k (170k fails with a -11.5k low, 185k passes).
 * Digger keeps ~15% margin at 210k. Full keeps 250k (low $36.9k, cash 681,127
 * at t2000). The old 150k / 120k went bankrupt at ~t609 / ~t582.
 */
export const SANDBOX_STARTING_CASH: Readonly<Record<SandboxKitId, number>> = {
  digger: 210_000,
  full: 250_000,
};

/**
 * Contract price multiplier for Dusty Hollow (#1363). Payroll for the opening
 * crew is ~$200/tick all-in, so market-rate prices can never reach the $80k
 * operating-profit target before wellbeing collapses into a revolt (~tick
 * 450-630) or cash runs out. Bisected on headless console playthroughs of
 * `campaign start level:dusty_hollow` (seed 1138; tick, drill_plan, charge,
 * sequence, zone clear, blast, contract accept/deliver, event choose 0; five
 * play styles: 2x2/2x3 patterns, boomite/pop_rock, with and without a Living
 * Quarters): at 5.0 every style ends in revolt or bankruptcy, 7.0 wins the
 * fast styles only, 8.0 wins all but the slowest style, 9.0 wins all five in
 * ~220-300 ticks. Lower values hit the worker-revolt wall (payroll ~$200/tick,
 * morale capped at 70 without Living Quarters); above 10 the level is won
 * trivially. 9.5 sat near the top of that window (one 2x2 blast already
 * wins it, ~tick 200-300).
 *
 * Re-bisected to 10 for the opening spoil heap (#1574): it sits between the
 * rig and the first shot, so the rig arrives later, the first shot meets
 * drier holes and clears 240 voxels (~455 t) instead of 28, which overfills the
 * tier-1 warehouse and delays sales. 9.5 then ends the seed-1138 2x2 style in
 * a revolt (tick 435, $49k profit); 9.75 wins with a thin margin ($83k),
 * 10 wins both styles by ~$7k/$55k (tick 281/301).
 *
 * Re-bisected to 12 for the opening charging truck and the blaster's truck
 * licence (#1648): the licence lifts the blaster's salary and the truck adds
 * upkeep, so payroll-plus-upkeep rises and the seed-1138 2x3-east style ended
 * in a revolt (tick 410, $46k profit) at 10, 10.5 and 11. Same styles and
 * play: 11.5 wins with a $1k margin on the 2x3 (tick 341, $81k), 11.75
 * $4k, 12 wins both by ~$8k/$75k (tick 341/301, $88k/$155k), 12.5 trims the
 * 2x2 to ~$5k (tick 281). 12 keeps the thinnest margin at about the old ~$7k.
 */
export const DUSTY_HOLLOW_CONTRACT_PRICE_MULTIPLIER = 12;

// ─── Employee Skills ───────────────────────────────────────────────────────────

/**
 * Per-tick XP award formula: XP_PER_TICK_BASE + floor(proficiencyLevel * XP_PER_TICK_LEVEL_SCALE).
 * Read by computeXpPerTick() in src/core/entities/EmployeeXpRules.ts.
 * Level 1 → 1 XP/tick, Level 5 → 3 XP/tick, at current values.
 */
export const XP_PER_TICK_BASE = 1;
export const XP_PER_TICK_LEVEL_SCALE = 0.5;

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
 * A driving.* licence pays the level-1 entry at any proficiency (flat, #1843).
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
 * The Driving Center covers every vehicle licence. Roles arrive holding their own
 * (ROLE_STARTING_QUALIFICATIONS); the rock fragmenter licence is reachable only here.
 */
export const TRAINING_BUILDING_SKILLS = {
  driving_center: ['driving.truck', 'driving.excavator', 'driving.drill_rig', 'driving.rock_fragmenter', 'repair'],
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
 * Fee of a course by the level it brings the skill to ($). A course at a tier-N
 * school brings a skill to level N. Level 1 is the unchanged base fee; levels 2
 * and 3 reuse the scale #1524 priced driving-licence raises at (base times level).
 */
export const TRAINING_LEVEL_FEE: Record<1 | 2 | 3, number> = {
  1: TRAINING_BASE_FEE,
  2: TRAINING_BASE_FEE * 2,
  3: TRAINING_BASE_FEE * 3,
};

/**
 * Course duration multiplier by the level it brings the skill to. Level 1 is
 * unchanged; levels 2 and 3 reuse #1524's licence scale. The school's tier speed
 * (TRAINING_TIER_SPEED) still multiplies the duration on top.
 */
export const TRAINING_LEVEL_TICKS_MULT: Record<1 | 2 | 3, number> = { 1: 1, 2: 1.5, 3: 2 };

// ─── Research Center ───────────────────────────────────────────────────────────

/**
 * Duration and cost of a Research Center task by the tier it unlocks. Tier 3
 * research costs and takes more than tier 2 — a straight step up keeps
 * late-game tiers a real investment rather than a rubber-stamp.
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
  // Single-tier: never researched (isSingleTierType); entry only satisfies the exhaustive Record (#1530).
  spoil_heap: {
    2: { cost: 0, ticks: 0, conditions: [] },
    3: { cost: 0, ticks: 0, conditions: [] },
  },
  // Vanity projects (#1947): single-tier, never researched.
  ceo_statue: { 2: { cost: 0, ticks: 0, conditions: [] }, 3: { cost: 0, ticks: 0, conditions: [] } },
  golf_course: { 2: { cost: 0, ticks: 0, conditions: [] }, 3: { cost: 0, ticks: 0, conditions: [] } },
  executive_helipad: { 2: { cost: 0, ticks: 0, conditions: [] }, 3: { cost: 0, ticks: 0, conditions: [] } },
  gold_tower: { 2: { cost: 0, ticks: 0, conditions: [] }, 3: { cost: 0, ticks: 0, conditions: [] } },
};

/** Research ticks consumed per game tick by a Research Center of each tier (#1936). */
export const RESEARCH_CENTER_SPEED_BY_TIER: Record<1 | 2 | 3, number> = { 1: 1, 2: 1.5, 3: 2 };

/** Research tasks a Research Center of each tier works on in parallel (#1936). */
export const RESEARCH_CENTER_SLOTS_BY_TIER: Record<1 | 2 | 3, number> = { 1: 1, 2: 2, 3: 3 };

/** Look up the research task definition for a building type and tier. */
export function getResearchTaskDef(type: BuildingType, tier: 2 | 3): ResearchTaskDef {
  return RESEARCH_TASK_DEFS[type][tier];
}

// ─── Employee Needs ────────────────────────────────────────────────────────────
// Hunger and breakNeed were removed (#928) — fatigue is the sole gauge.

/**
 * Drain rates per tick for the fatigue gauge.
 *
 * `resting` tier (#680): drain rate while actively resting
 * (restTicksRemaining !== null). The gauge holds steady during the rest — it
 * doesn't keep draining — so the accrued drain can't outpace and undermine
 * the completion-time replenishment the rest itself delivers.
 *
 * `traveling` tier (#928): drain rate while walking toward a claimed task or
 * rest destination, not yet arrived (pendingTaskDuration/pendingRestDuration
 * !== null) — distinct from plain `idle` (nothing claimed at all).
 */
export const NEED_DRAIN_RATES = {
  fatigue: { working: 2, idle: 0.5, traveling: 1, resting: 0 },
} as const;

/** Threshold values for productivity/morale effects. */
export const NEED_THRESHOLDS = {
  fatigue: { low: 40, critical: 15 },
} as const;

/**
 * Productivity multipliers applied when the fatigue gauge falls below a
 * threshold. `low` = uncomfortable but functioning; `critical` = severe
 * impairment. Multipliers are applied to the base effectiveness value.
 */
export const NEED_PRODUCTIVITY_MULTIPLIERS = {
  fatigue: { low: 0.75, critical: 0.50 },
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
 * Per-tick morale penalties applied in needsMoraleEffect() — rescaled 3x
 * (#928) now that fatigue is the only gauge contributing, so the total
 * per-tick range stays comparable to the old three-gauge sum.
 */
export const NEED_MORALE_EFFECT_PENALTIES = {
  comfortable: 0,
  uncomfortable: -1.5,
  suffering: -4.5,
  critical: -9.0,
} as const;

/**
 * If fatigue is above this threshold, the employee receives a well-rested
 * morale bonus per tick.
 */
export const NEED_WELL_RESTED_THRESHOLD = 80;

/** The well-rested morale bonus applied per tick when fatigue is above the threshold. */
export const NEED_WELL_RESTED_BONUS = 1;

/**
 * Morale recovered per tick while fatigue sits in the comfortable band
 * (NEED_MORALE_EFFECT_THRESHOLDS.comfortable up to NEED_WELL_RESTED_THRESHOLD).
 * In-place rests end at 70 (NEED_REST_NO_BUILDING_CAP), so the well-rested
 * bonus above 80 is never reached by a crew on the default site policy and
 * morale latched at 0 (#1778). A tenth of the well-rested +1: just enough that
 * a crew held in the band recovers (0.05 still left a worker at 0), small enough
 * that a crew under `continuous` (rest threshold 0), which spends most of its
 * time below 50, still collapses to a worker revolt (level1-lose-revolt,
 * level1-playthrough-revolt; 0.2 and above kept playthrough-revolt solvent and
 * ended it in bankruptcy). Does not stack with the well-rested bonus.
 * A haul cycle that never reaches the band is covered by REST_COMPLETION_MORALE_CREDIT (#1801).
 */
export const NEED_COMFORT_MORALE_RECOVERY = 0.1;

/**
 * One-off morale credit when a policy-forced rest completes (#1801). A
 * debris-hauler cycle nets about -41 morale per ~44-tick cycle because fatigue
 * stays under the 50-80 comfort band; +50 rewards finishing a rest the policy
 * asked for. Gated on the policy rest threshold being at least
 * NEED_MORALE_EFFECT_THRESHOLDS.comfortable, so `continuous` and other
 * low-threshold policies get none.
 */
export const REST_COMPLETION_MORALE_CREDIT = 50;

/** Soft threshold per gauge: below this, proactive rest routing queues a rest action but does not yet force one. */
export const NEED_SOFT_THRESHOLDS: Record<NeedKey, number> = {
  fatigue: 25,
};

/** Fatigue a mounted worker must still hold on arrival at the rest building, beyond the trip's own drain. */
export const NEED_REST_ARRIVAL_FATIGUE_FLOOR = 5;

/** Extra fatigue headroom a mounted worker keeps before a vehicle job boundary forces rest. */
export const NEED_VEHICLE_JOB_FATIGUE_ALLOWANCE = 15;

/** Hard threshold per gauge: at or below this, the employee collapses and rest is forced immediately — always 0, the gauge's own floor, never a tunable balance value. */
export const NEED_HARD_THRESHOLDS: Record<NeedKey, number> = {
  fatigue: 0,
};

/** Rest duration in ticks for the fatigue gauge when an employee collapses. */
export const NEED_REST_DURATIONS = {
  fatigue: 8,
} as const;

/**
 * Building type that services the fatigue gauge during collapse rest. Maps
 * to 'living_quarters' until a dedicated bunkhouse building type is added
 * (future Chapter 1 expansion).
 */
export const NEED_REST_BUILDING_TYPES = {
  fatigue: 'living_quarters',
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
 * Per-tick replenishment rate for the fatigue gauge by building tier.
 * Keyed by need gauge (not building type) because the caller already knows
 * which need to replenish; the building-to-need mapping is handled upstream.
 * Tier 1 is the baseline; higher tiers improve replenishment rates.
 */
export const BUILDING_REPLENISH_RATES = {
  fatigue: { 1: 8, 2: 14, 3: 20 },
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

/** Per-visit cost deducted from cash for the fatigue gauge. No cost (0) — unlike the removed hunger/breakNeed gauges, fatigue rest was never charged. */
export const NEED_REST_COSTS = {
  fatigue: 0,
} as const;

// ─── General ───────────────────────────────────────────────────────────────────

/** Maximum value for all need gauges (0–100 range). */
export const MAX_NEED_GAUGE = 100;

// ─── Shift / Rest Scheduling ────────────────────────────────────────────────

/**
 * Shift duration in ticks of WORK for each policy mode (1 tick = 1 game-hour).
 *
 * "8h" and "12h" name the policy, not the tick count: working ticks are the
 * game's coarse unit, one drill_hole job alone runs ~8-13 of them. #1709
 * measured the old 8 / 12 against walk-to-rest: a shift shorter than one rig
 * job sent the driller to the quarters after EVERY hole, so a 3x3 plan with
 * quarters beside it took 208 ticks. A 20-tick shift (30 for the long one,
 * same 2:3 ratio) lets a rig cover about two holes per rest and measures 140
 * ticks beside the plan (target <= 150), with zero collapses at 12 m and 25 m
 * (needs.integration.test.ts, #1709). Shorter shifts (16 -> 154, 12 -> 187)
 * miss the target. The fatigue threshold (SITE_POLICY_DEFAULT_THRESHOLD) still
 * sends a tired worker home sooner.
 */
export const SHIFT_DURATIONS_TICKS = {
  shift_8h:  20,
  shift_12h: 30,
} as const;

/**
 * Default fatigue rest threshold used by createSitePolicy(). Gauge is 0–100.
 *
 * Collapsed from the old three-key SITE_POLICY_DEFAULT_THRESHOLDS record
 * (#928 — hunger and breakNeed removed) into a single number; value carried
 * over unchanged from fatigueRest's own prior default. Sits above
 * NEED_MORALE_EFFECT_THRESHOLDS.comfortable (50, see above) rather than below
 * it (#678 follow-up). shouldForceRest only fires once the gauge crosses its
 * threshold, so a threshold inside the 0-49 penalty band would guarantee the
 * gauge spends real time being penalized by needsMoraleEffect on every single
 * work/rest cycle. +10 above 50 gives enough margin that a gauge draining at
 * its normal per-tick rate (fatigue's 2/tick working) is caught before it can
 * fall back below the comfortable line most of the time.
 */
export const SITE_POLICY_DEFAULT_THRESHOLD = 60;

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

/**
 * Depth (voxels, i.e. metres) each survey method scans from a column's own
 * surface — a bounded window below wherever the surface actually sits (#1186:
 * column storage has no floor, so "the whole column" is unbounded).
 * - aerial: the top 2 levels (surfaceY, surfaceY - 1), a shallow horizon.
 * - seismic: 25 — deeper than the common ores, reaching into the uncommon ones.
 * - core_sample: 40 — matches the deepest hole the Drill step offers (its depth
 *   stepper tops out at 40 m), so a core sees everything a drill could reach.
 * The survey panel shows these numbers to the player.
 */
export const SURVEY_DEPTH_BELOW_SURFACE = {
  aerial:       2,
  seismic:     25,
  core_sample: 40,
} as const;

/** Voxels of partial-density rock that cap a column's top solid voxel (the survey anchor). */
export const SURVEY_CAP_VOXELS = 1;

/** Depth-band thickness in metres for depth-resolved survey results. Aerial surveys report none. */
export const SURVEY_DEPTH_BAND_METRES = {
  core_sample: 1,
  seismic:     5,
} as const;

/** Error reduction applied per skill level above 1 (e.g. skill 3 → 2 × 0.12 = 0.24 reduction). */
export const SURVEY_SKILL_BONUS_PER_LEVEL = 0.12;

/** Number of consecutive Y-levels averaged together in a single seismic reading. */
export const SURVEY_SEISMIC_GROUP_SIZE = 3;

/** Ore estimate quantisation step: estimates are rounded to the nearest 0.05 band. */
export const SURVEY_ESTIMATE_STEP = 0.05;

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

/**
 * Default volume (0–1) per audio channel, before any stored player setting applies.
 * Keys must match the audio layer's `VolumeChannel` exactly: userSettings.ts derives
 * its list of persistable channels from them.
 */
export const AUDIO_DEFAULT_VOLUMES: Record<'master' | 'effects' | 'ambient' | 'ui' | 'music', number> = {
  master: 1,
  effects: 1,
  ambient: 0.7,
  ui: 0.7,
  music: 0.6,
};

/**
 * Score gain per unit of village vibration (#1343). The PPV law falls off as
 * distance^-1.5, so a Grumpstone Ridge village 445 m away sees only ~4e-4 mm/s
 * from an ordinary 6 x 10 kg blast (~1.4e-3 from an oversized 9 x 60 kg one).
 * Scaled so recordVibration plus the windowed per-tick term (~0.27 neighbour-relations points lost per
 * scaled unit in total) cost an ordinary blast ~1-3 points and an
 * oversized one ~5.
 */
export const VILLAGE_VIBRATION_SCORE_GAIN = 15000;

/** Neighbour-relations points lost per projected fragment (#1343). */
export const BLAST_PROJECTION_NUISANCE_PER_PROJECTION = 0.5;

/** Ticks over which vibration score effects are applied (#1343). */
export const SCORE_VIBRATION_WINDOW_TICKS = 10;

/** Negotiation attempts allowed per contract offer (#1366). */
export const NEGOTIATION_MAX_ATTEMPTS_PER_OFFER = 1;

/** Early-delivery bonus as a fraction of quantity x price (#1366). */
export const NEGOTIATION_EARLY_BONUS_RATE = 0.15;

/** Missed-deadline penalty as a fraction of quantity x unmultiplied base price. */
export const CONTRACT_PENALTY_RATE = 0.3;

/** Success-rate bonus per manager management level above 1 (#1340). */
export const NEGOTIATION_MANAGEMENT_BONUS_PER_LEVEL = 0.08;

/** Cash fee for hiring a contractor to do an unqualified task (#1380). */
export const UNQUALIFIED_CONTRACTOR_FEE = 25000;

/** Extra cells around a ramp footprint kept clear of buildings (#1390). */
export const RAMP_RESERVATION_MARGIN = 0;

/** Cell radius around a drill hole kept clear of buildings (#1390). */
export const HOLE_RESERVATION_RADIUS = 0;

/** Secondary blast radius floor in metres (#1394). */
export const SECONDARY_BLAST_RADIUS_BASE_M = 5;

/** Secondary blast radius growth per sqrt(kg) of stored explosive (#1394). */
export const SECONDARY_BLAST_RADIUS_PER_SQRT_KG_M = 0.5;

/** Secondary blast radius cap in metres (#1394). */
export const SECONDARY_BLAST_RADIUS_MAX_M = 40;

/** Fraction of max HP a building or vehicle loses at the epicentre, falling off linearly to 0 at the radius (#1394). */
export const SECONDARY_BLAST_STRUCTURE_DAMAGE_FRACTION = 0.6;

/** Fraction of the radius within which people die (#1394). */
export const SECONDARY_BLAST_DEATH_RADIUS_FRACTION = 0.5;

/** Depth in metres of the single crater hole a secondary blast fires (#1896). */
export const SECONDARY_BLAST_CRATER_HOLE_DEPTH_M = 3;

/** Cap on blast passes carving one secondary crater (#1896). */
export const SECONDARY_BLAST_CRATER_MAX_PASSES = 4;

/** Offset added to the game seed to derive the weather cycle's PRNG seed (#1403). */
export const WEATHER_RNG_SEED_OFFSET = 1000;

/** Biome whose weather climate a missing or unknown biome id falls back to (#1688). */
export const WEATHER_FALLBACK_CLIMATE = 'temperate';

/** Cap on weather history entries kept in GameState (#1403). */
export const WEATHER_HISTORY_MAX = 32;

/** Minimum ticks between two crew toasts of the same kind for the same employee (#1387). */
export const CREW_TOAST_COOLDOWN_TICKS = 30;

/** Ecology score strictly below which environmental events have a cause (#1412). Initial score is 50, so this must stay below 50. */
export const ENV_CAUSE_ECOLOGY_MAX = 45;

/** Neighbour-relations (nuisance) score strictly below which environmental events have a cause (#1412). Initial score is 50, so this must stay below 50. */
export const ENV_CAUSE_NUISANCE_MAX = 45;

/**
 * Contract price multiplier for the tutorial level (#959, #1328, #1363). The
 * level's single scripted blast means market-rate prices can never out-earn
 * the mine's own payroll. The win counts operating profit (#1363: the ~$300k
 * of one-time equipment/construction no longer counts against it), bisected on
 * the full free-play playthrough (tests/integration/tutorial.integration.test.ts,
 * no fire/scrap hacks): 14.0 goes bankrupt, 16.0 is the lowest winning value
 * tried, 300.0 still wins only in free play, 500.0 is already won inside the
 * guided part. 80.0 sits mid-window (geometric) so one upstream change does
 * not make the tutorial unwinnable (or trivially won) again.
 */
export const TUTORIAL_CONTRACT_PRICE_MULTIPLIER = 80.0;

/** One fixed hire candidate of a scripted hiring pool (#1600). */
export interface ScriptedCandidate {
  id: number;
  role: EmployeeRole;
  name: string;
  unionized: boolean;
  skillBonus: 0 | 1;
  /** Extra qualifications granted on top of the role defaults (#1648). */
  extraQualifications?: readonly StartingSiteQualification[];
}

/** Tutorial hiring pool: one fixed candidate per hiring role, ids 1..5 (#1600). */
export const TUTORIAL_HIRING_SCRIPT: readonly ScriptedCandidate[] = [
  { id: 1, role: 'driller', name: 'Dale Drillson', unionized: false, skillBonus: 0,
    extraQualifications: [{ category: 'driving.truck', proficiencyLevel: 1 }] },
  { id: 2, role: 'blaster', name: 'Bea Boomer', unionized: false, skillBonus: 0 },
  { id: 3, role: 'driver', name: 'Dex Hauler', unionized: false, skillBonus: 0 },
  { id: 4, role: 'surveyor', name: 'Sue Seismic', unionized: false, skillBonus: 0 },
  { id: 5, role: 'manager', name: 'Max Manager', unionized: false, skillBonus: 0 },
];

/** A fixed ore-sale contract offer a level guarantees (#1600). */
export interface ScriptedOreSaleOffer {
  materialId: string;
  quantityKg: number;
  priceFactor: number;
  deadlineTicks: number;
}

/**
 * Tutorial ore-sale offer (#1600). quantityKg sits below the rustite the scripted
 * tutorial blast always hauls in: measured in command mode on tutorial-steps-visual
 * and tutorial-interactive, collectedOre.rustite is 334.375 after the first haul
 * batch and 687.5 once hauling finishes (tutorial-playthrough: 793.75). 300 kg is
 * fillable from the first batch and, at 12 * 80 = $960/kg, still ends the level.
 */
export const TUTORIAL_ORE_SALE_OFFER: ScriptedOreSaleOffer = {
  materialId: 'rustite',
  quantityKg: 300,
  priceFactor: 1.0,
  deadlineTicks: 200,
};

/** Trailing window (ticks) over which operating income per hour is averaged (#1375). */
export const OPERATING_INCOME_WINDOW_TICKS = 72;

/** Income categories that count as operating income (#1375). */
export const OPERATING_INCOME_CATEGORIES = ['sales', 'contracts'] as const;

/** Base demolition duration (ticks) per footprint cell, before tier scaling (#1392). */
export const DEMOLITION_BASE_TICKS_PER_FOOTPRINT_CELL = 3;

/** Demolition duration multiplier per building tier — sturdier buildings take longer (#1392). */
export const DEMOLITION_TIER_MULTIPLIER = { 1: 1, 2: 1.5, 3: 2 } as const;

/** Demolition speed factor per building_destroyer vehicle tier — bigger machines work faster (#1392). */
export const DEMOLITION_VEHICLE_TIER_SPEED = { 1: 1, 2: 1.5, 3: 2.25 } as const;

/**
 * Factor applied to a rock's breaking threshold per explosive tier it falls short of
 * (rock tier above the explosive's minRockTier): threshold x FACTOR ** shortfall (#1358).
 */
export const TIER_SHORTFALL_THRESHOLD_FACTOR = 4;

/** Recovery progress an injured employee must accumulate before returning to work (#1382). */
export const INJURY_RECOVERY_TICKS = 48;

/** Morale lost on injury (#1382). */
export const INJURY_MORALE_PENALTY = 20;

/** Recovery progress per tick when no living quarters are available (#1382). */
export const INJURY_ON_FOOT_RECOVERY_RATE = 1;

/** Recovery progress per tick by living-quarters tier (#1382). */
export const INJURY_RECOVERY_RATE_BY_LQ_TIER: Record<1 | 2 | 3, number> = { 1: 2, 2: 3, 3: 4 };

/** Fraction of the bribe cost levied as a fine when a bribe fails (#1411). */
export const BRIBERY_FAILURE_FINE_FRACTION = 0.5;

/** Neighbour-relations (nuisance) score hit on a failed bribe (#1411). */
export const BRIBERY_FAILURE_NUISANCE_HIT = 8;

/** Corruption level change on a failed bribe (#1411). */
export const BRIBERY_FAILURE_CORRUPTION_DELTA = 2;

/** Exposure risk added when a botched mafia action triggers an investigation (#1411). */
export const INVESTIGATION_EXPOSURE_JUMP = 0.2;

/** Event id queued as follow-up to a police investigation (#1411). */
export const INVESTIGATION_FOLLOWUP_EVENT_ID = 'mafia_police_investigation';

/** Ticks without mafia activity before exposure risk starts decaying (#1411). */
export const EXPOSURE_CLEAN_GRACE_TICKS = 30;

/** Exposure risk lost per tick once the clean grace period has passed (#1411). */
export const EXPOSURE_DECAY_PER_TICK = 0.004;

// ─── Hiring pool ────────────────────────────────────────────────────────────────

/** Candidates offered per role. */
export const HIRING_POOL_SIZE = 3;

/** Ticks between candidate pool refreshes. */
export const HIRING_POOL_REFRESH_INTERVAL = TICKS_PER_DAY;

/** Chance a candidate is unionized. */
export const CANDIDATE_UNION_CHANCE = 0.3;

/** Percent taken off a unionized employee's salary (#1873). */
export const UNION_MEMBER_SALARY_DISCOUNT_PCT = 15;
/** Event-timer stretch at zero union members, as a fraction of the all-members pace (#1873). */
export const UNION_TIMER_MIN_SHARE_FACTOR = 0.25;
/** Union members needed before a strike can fire (#1873). */
export const UNION_STRIKE_MIN_MEMBERS = 1;
/** Grievance added when the player refuses a union demand (#1890). */
export const UNION_GRIEVANCE_PER_REFUSAL = 20;
/** Grievance removed when the player meets a union demand (#1890). */
export const UNION_GRIEVANCE_EASE_PER_MET = 15;
/** Grievance at which a strike falls due (#1890). */
export const UNION_GRIEVANCE_STRIKE_THRESHOLD = 60;
/** Upper clamp on union grievance (#1890). */
export const UNION_GRIEVANCE_MAX = 100;
/** Grievance left after a strike fires (#1890). */
export const UNION_GRIEVANCE_AFTER_STRIKE = 20;
/** Extra selection weight for strike events while a strike is due (#1890). */
export const UNION_STRIKE_WEIGHT_BOOST = 50;

/** Chance a candidate has a bonus skill level over the role's starting qualifications. */
export const CANDIDATE_SKILL_BONUS_CHANCE = 0.35;

/** Maximum bonus levels a candidate may have. */
export const CANDIDATE_SKILL_BONUS_MAX = 1;

/** Radius (cells) around the primary fragment within which a haul batch gathers extras (#1370). */
export const HAUL_BATCH_RADIUS_CELLS = 8;

/** Most fragments one haul trip carries (#1370). */
export const HAUL_BATCH_MAX_ITEMS = 6;

/** Fewest stranded cells that make a placement report a cutoff (#1391). */
export const PLACEMENT_CUTOFF_MIN_CELLS = 1;

// ─── Hole water (#1350) ─────────────────────────────────────────────────────────

/** Water level (fraction of hole depth) above which a hole counts as wet. */
export const HOLE_WET_THRESHOLD = 0.3;

/**
 * Level fraction a bare hole gains per tick per unit of rain intensity. Storm (1.0) fills a bare
 * hole in 2 ticks, light rain (0.3) in ~7, so rain is felt within the first ticks of a downpour.
 */
export const HOLE_RAIN_FILL_RATE = 0.5;

/**
 * Level fraction per tick seeping in from wet ground, per unit of ground wetness and porosity.
 * Tight rock (0.03) seeps less than it fades and never refills; porous rock (0.35) on saturated
 * ground out-seeps its slowed fade (0.105 vs 0.03 per tick) and refills for the few ticks the ground stays wet.
 */
export const HOLE_SEEP_RATE = 0.3;

/** Level fraction lost per tick when it is not raining, in tight rock: ~17 ticks from full. */
export const HOLE_WATER_FADE_RATE = 0.06;

/** How strongly porosity slows fading (fade = rate * (1 - porosity * this)): 0.35 porosity fades ~2x slower than 0.03. */
export const HOLE_FADE_POROSITY_SLOWDOWN = 1.4;

/** Ground wetness gained per tick per unit of rain intensity (storm saturates in 4 ticks). */
export const GROUND_WETNESS_RISE_RATE = 0.25;

/** Ground wetness lost per tick when it is not raining: saturated ground lingers ~5 ticks. */
export const GROUND_WETNESS_DECAY_RATE = 0.2;

/** Cash to drain one wet hole. */
export const HOLE_DRAIN_COST_PER_HOLE = 20;

/** Porosity at or below which an untubed hole cannot be drained (water returns at once). */
export const HOLE_DRAIN_POROSITY_LIMIT = 0.15;

/** Ticks between re-issued evacuation orders while a detonation is armed (#1362). */
export const DETONATION_REEVACUATE_INTERVAL_TICKS = 10;

/** Base ticks to repair one hp of a damaged vehicle (before proficiency scaling). */
export const REPAIR_BASE_TICKS_PER_HP = 0.5;

/** Parts cost charged per hp restored by a repair order. */
export const REPAIR_PARTS_COST_PER_HP = 5;

// ── Event effect catalog (#1414) ──

/** Cap on simultaneously live event modifiers. */
export const MAX_ACTIVE_MODIFIERS = 32;

/** Lower bound a combined modifier factor may reach. */
export const MODIFIER_FACTOR_MIN = 0.1;

/** Upper bound a combined modifier factor may reach. */
export const MODIFIER_FACTOR_MAX = 5;

/** Default hp a closed building loses (building_closed effect). */
export const EVENT_EFFECT_BUILDING_HP_LOSS = 10;

/** Role an employee_joins effect hires when the spec names none. */
export const EVENT_EFFECT_JOIN_DEFAULT_ROLE = 'driller' as const;

/** Fatigue gauge value a fatigue_relief effect restores everyone to (100 = fully rested). */
export const EVENT_EFFECT_FATIGUE_RELIEF_LEVEL = 100;

/** Multiplier on contract price a special_contract offer pays above a regular one. */
export const EVENT_EFFECT_SPECIAL_CONTRACT_PRICE_BONUS = 1.5;

/** Hours the whole crew stops when the union's bluff is called (union_strike_threat). */
export const EVENT_STRIKE_HOURS = 24;

/** Per-day cost and length of the emotional hazard stipend (union_hazard_emotional). */
export const EVENT_HAZARD_STIPEND_PER_DAY = 400;
export const EVENT_HAZARD_STIPEND_DAYS = 7;

/** Hours operations stop while the site relocates (politics_mayor_wins). */
export const EVENT_RELOCATE_PAUSE_HOURS = 24;

/** Work-rate change (percent) and its length in hours under a partial mining ban (politics_mining_ban_vote). */
export const EVENT_PARTIAL_BAN_WORK_PCT = -40;
export const EVENT_PARTIAL_BAN_HOURS = 60;

// ── Event effect variety (#1538) ──

/** Hours all work stops in a brief stoppage (walkout, short shutdown). */
export const EVENT_BRIEF_STOP_HOURS = 12;

/** Hours all work stops in a long stoppage (lockdown, full cleanup). */
export const EVENT_LONG_STOP_HOURS = 48;

/** Hours an activity ban lasts when it is a short curfew. */
export const EVENT_CURFEW_BAN_HOURS = 12;

/** Hours an activity ban lasts while inspectors are on site. */
export const EVENT_INSPECTION_BAN_HOURS = 24;

/** Hours an activity ban lasts under an injunction or court order. */
export const EVENT_INJUNCTION_BAN_HOURS = 48;

/** Hours an activity ban lasts while a permit is held back. */
export const EVENT_PERMIT_BAN_HOURS = 72;

/** Work-rate change (percent) of a mild drag on output. */
export const EVENT_DRAG_WORK_PCT = -20;

/** Hours a mild drag on output lasts. */
export const EVENT_DRAG_HOURS = 48;

/** Work-rate change (percent) of a real slowdown. */
export const EVENT_SLOWDOWN_WORK_PCT = -30;

/** Hours a real slowdown lasts. */
export const EVENT_SLOWDOWN_HOURS = 36;

/** Work-rate change (percent) of a motivated surge in output. */
export const EVENT_SURGE_WORK_PCT = 20;

/** Hours a surge in output lasts. */
export const EVENT_SURGE_HOURS = 48;

/** Morale change per hour while the crew sulks. */
export const EVENT_SULK_MORALE_PER_HOUR = -1;

/** Hours the crew sulks. */
export const EVENT_SULK_HOURS = 24;

/** Morale change per hour under a sharp shock. */
export const EVENT_GLOOM_MORALE_PER_HOUR = -2;

/** Hours a sharp morale shock lasts. */
export const EVENT_GLOOM_HOURS = 12;

/** Morale change per hour while the crew is cheerful. */
export const EVENT_CHEER_MORALE_PER_HOUR = 1;

/** Hours the crew stays cheerful. */
export const EVENT_CHEER_HOURS = 24;

/** Salary change (percent) of a temporary raise. */
export const EVENT_RAISE_SALARY_PCT = 15;

/** Days a temporary raise or pay cut lasts. */
export const EVENT_RAISE_DAYS = 7;

/** Salary change (percent) of a temporary pay cut. */
export const EVENT_PAYCUT_SALARY_PCT = -15;

/** Salary change (percent) of a permanent raise. */
export const EVENT_PERMANENT_RAISE_SALARY_PCT = 10;

/** Dollars paid to every employee as a one-off bonus. */
export const EVENT_BONUS_AMOUNT = 500;

/** Dollars per day of a protection payment. */
export const EVENT_PROTECTION_PER_DAY = 300;

/** Days a protection payment runs. */
export const EVENT_PROTECTION_DAYS = 10;

/** Dollars per day of a retainer or extra payroll line. */
export const EVENT_RETAINER_PER_DAY = 250;

/** Days a retainer or extra payroll line runs. */
export const EVENT_RETAINER_DAYS = 14;

/** Dollars per day of a settlement instalment. */
export const EVENT_SETTLEMENT_PER_DAY = 600;

/** Days a settlement instalment runs. */
export const EVENT_SETTLEMENT_DAYS = 7;

/** Dollars per day of a heavy court-ordered penalty. */
export const EVENT_PENALTY_PER_DAY = 1000;

/** Days a heavy penalty runs. */
export const EVENT_PENALTY_DAYS = 5;

/** Explosive price change (percent) of a surcharge. */
export const EVENT_EXPLOSIVE_SURCHARGE_PCT = 25;

/** Days an explosive surcharge or discount lasts. */
export const EVENT_EXPLOSIVE_SURCHARGE_DAYS = 7;

/** Explosive price change (percent) of a discount. */
export const EVENT_EXPLOSIVE_DISCOUNT_PCT = -15;

/** Upkeep cost change (percent) of a surcharge. */
export const EVENT_UPKEEP_SURCHARGE_PCT = 20;

/** Days an upkeep surcharge lasts. */
export const EVENT_UPKEEP_SURCHARGE_DAYS = 10;

/** Upkeep cost change (percent) of a discount. */
export const EVENT_UPKEEP_DISCOUNT_PCT = -15;

/** Days an upkeep discount lasts. */
export const EVENT_UPKEEP_DISCOUNT_DAYS = 7;

/** Contract price change (percent) under a tariff or sagging market. */
export const EVENT_TARIFF_PRICE_PCT = -20;

/** Days a tariff or price boom lasts. */
export const EVENT_TARIFF_DAYS = 7;

/** Contract price change (percent) under a boycott. */
export const EVENT_BOYCOTT_PRICE_PCT = -30;

/** Days a boycott lasts. */
export const EVENT_BOYCOTT_DAYS = 10;

/** Contract price change (percent) in a price boom. */
export const EVENT_BOOM_PRICE_PCT = 15;

/** Frequency factor of an event category under scrutiny. */
export const EVENT_SCRUTINY_WEIGHT_FACTOR = 2;

/** Days a scrutiny frequency factor lasts. */
export const EVENT_SCRUTINY_DAYS = 7;

/** Frequency factor of an event category that has been quietened. */
export const EVENT_CALM_WEIGHT_FACTOR = 0.5;

/** Days a calmed frequency factor lasts. */
export const EVENT_CALM_DAYS = 7;

/** Hours a lingering weather front holds the sky. */
export const EVENT_FRONT_HOURS = 36;

/** Hit points a breakdown event takes off the affected vehicle (hp). */
export const EVENT_BREAKDOWN_HP_LOSS = 25;

/** Hours a broken-down vehicle stays out of service. */
export const EVENT_BREAKDOWN_HOURS = 24;

/** Hours an event-closed building stays shut. */
export const EVENT_CLOSURE_HOURS = 24;

/** Percent change applied to survey costs by an event discount (negative = cheaper). */
export const EVENT_SURVEY_DISCOUNT_PCT = -25;

/** Days a survey cost discount lasts. */
export const EVENT_SURVEY_DISCOUNT_DAYS = 7;

/** Percent change applied to research costs by an event discount (negative = cheaper). */
export const EVENT_RESEARCH_DISCOUNT_PCT = -25;

/** Days a research cost discount lasts. */
export const EVENT_RESEARCH_DISCOUNT_DAYS = 7;

// ── Smuggling vs tax audit (#1409) ──

/** Period the three audit chances refer to (90 days). */
export const TAX_AUDIT_TIME_BASE_TICKS = 2160;

/** Chance of an audit within one time base at 0 % smuggling share. */
export const TAX_AUDIT_CHANCE_AT_ZERO = 0.2;

/** Chance of an audit within one time base at the sweet-spot share. */
export const TAX_AUDIT_CHANCE_AT_SWEET_SPOT = 0.5;

/** Chance of an audit within one time base at the max-risk share or above. */
export const TAX_AUDIT_CHANCE_AT_MAX = 0.8;

/** Expected gain (fraction of honest income) at the sweet-spot share. */
export const TAX_AUDIT_GAIN_AT_SWEET_SPOT = 0.1;

/** Expected gain (fraction of honest income) at the max-risk share. */
export const TAX_AUDIT_GAIN_AT_MAX = -0.25;

/** Smuggling share of the sweet spot (s1). */
export const TAX_AUDIT_SWEET_SPOT_SHARE = 0.2;

/** Smuggling share from which the audit chance stops rising (s2). */
export const TAX_AUDIT_MAX_RISK_SHARE = 0.5;

/** Ticks without any audit after an audit. */
export const TAX_AUDIT_COOLDOWN_TICKS = 720;

/** Ticks over which the audit clock speeds back up after the cooldown. */
export const TAX_AUDIT_RAMP_TICKS = 720;

/** Added to the regularisation multiplier per earlier conviction this level. */
export const TAX_RECIDIVISM_SURCHARGE = 0.2;

/** Cap on counted convictions for the recidivism surcharge. */
export const TAX_RECIDIVISM_MAX_STEPS = 2;

/** Selectable smuggling volumes, as a fraction of operating income. */
export const SMUGGLING_VOLUME_LEVELS = [0.1, 0.25, 0.5, 1] as const;

/** Volume an old save's active smuggling operation migrates to (#1409). */
export const SMUGGLING_MIGRATED_VOLUME = 0.25;

/** Minimum rendered seconds of blast playback before the blast report may open (#1590). */
export const BLAST_REPORT_MIN_PLAYBACK_S = 3;

/** Rendered seconds after which the blast report opens even if some debris is still moving. */
export const BLAST_REPORT_MAX_PLAYBACK_S = 8;

/**
 * Value-overlay colour ramp floor ($ per m³ of rock column). Ore value per m³ =
 * density × ORE_DENSITY_KG_M3 × valuePerKg; ores span 2–2000 $/kg, so one m³ at
 * full density is worth 5 000 (dirtite) to 5 000 000 (treranium). Floor sits at
 * a lean dirtite column (~20% density).
 */
export const SURVEY_OVERLAY_VALUE_FLOOR = 1000;

/** Value-overlay colour ramp ceiling ($ per m³); log-scaled between floor and ceil. */
export const SURVEY_OVERLAY_VALUE_CEIL = 1_000_000;

/** Fresh survey-overlay quad opacity at confidence 0; rises linearly to 1 at confidence 1. */
export const SURVEY_OVERLAY_QUAD_OPACITY_BASE = 0.55;

// ─── Pit mask shape (#1680) ──────────────────────────────────────────────────

/** How the pit-suitability mask flattens relief inside a playable rect. */
export interface PitMaskShape {
  /** Metres of blend measured inward from the rect's edge. */
  margin: number;
  /** Fraction of relief that survives at full compression, deep inside the rect. */
  reliefKeep: number;
  /** Max landscape slope (m of height per m) outside the rect; absent = legacy blend only. */
  envelopeSlope?: number;
  /** Amplitude (m) of the outline wobble; the outline offset swings over [0, 2 * amplitude], so the peak is twice this value. Absent = straight outline. */
  outlineWobble?: number;
  /** Corner rounding radius (m) of the outline; absent = sharp corners. */
  cornerRadius?: number;
}

/** Mask used by campaign levels and standalone worlds. */
export const DEFAULT_PIT_MASK: PitMaskShape = { margin: 24, reliefKeep: 0.3 };

/** Outline wobble wavelengths (m) and unit-ish propagation directions (#1734); two incommensurate waves. */
export const OUTLINE_WOBBLE_WAVELENGTH_A = 27;
export const OUTLINE_WOBBLE_WAVELENGTH_B = 38;
export const OUTLINE_WOBBLE_WAVE_A_DIR: readonly [number, number] = [0.8, 0.6];
export const OUTLINE_WOBBLE_WAVE_B_DIR: readonly [number, number] = [-0.5, 0.866];

/**
 * Sandbox mask (#1680, #1734): a 14 m flat core inset that keeps only 5% of
 * relief, so the sandbox start has room for flat 9x9 m pads while mountains stay
 * dramatic beyond the pit. Beyond the core a slope-limited envelope joins the
 * flat area to the landscape without a cliff: terrain deviates from the flat
 * level by at most envelopeSlope m per metre of distance. 0.25 (43% of
 * NAV_MAX_SLOPE_RATIO tan30 = 0.577) was measured, not derived: 0.45 left a
 * side of tropical/alpine seeds with no reachable drill-hole ring cells, because
 * wobble gradient and residual relief on top of the cone push local slope past
 * the climb limit. At 0.25 every side of every biome/seed (1/7/42) has reachable
 * ring cells at 6/18/30 m, >= 73% of ring cells do at 6 m-30 m, flat 9x9 pads
 * are >= 68%, and the blend never makes a step steeper than the landscape's own
 * (on >= 80% of the perimeter lines), so drill holes just outside the grid stay
 * reachable. A natural wall inside the cone is flattened (clamped to the envelope)
 * but not erased: a pointwise mask cannot, so it stays a cliff. The outline wobbles
 * (peak offset 6 m = 2 x outlineWobble 3, flat side only) and corners round (8 m) so the edge is not a
 * visible rectangle.
 */
export const SANDBOX_PIT_MASK: PitMaskShape = {
  margin: 14,
  reliefKeep: 0.05,
  envelopeSlope: 0.25,
  outlineWobble: 3,
  cornerRadius: 8,
};

/** Target fraction of the sandbox start pad that must be flat. */
export const SANDBOX_FLAT_PAD_TARGET = 0.25;
/** Max height spread (voxels) across the flat pad. */
export const SANDBOX_FLAT_PAD_MAX_SPREAD = 2;
/** Side length (voxels) of the flat pad. */
export const SANDBOX_FLAT_PAD_SIZE = 9;

// ── Production market (#1681) ──
//
// The sandbox's market. Legacy offers (50-500 kg) absorb ~1 t of ore a day while
// one ordinary shot yields ~340 t, so income ignored production. These constants
// put a shot's ore on the scale of the crew that mined it.

/** Pre-#1681 offer size (kg) and rounding step: what every campaign level still sees. */
export const LEGACY_OFFER_QTY_KG = { min: 50, max: 500 } as const;
export const LEGACY_OFFER_QTY_STEP_KG = 10;
/** Pre-#1681 price factors on an ore's base price. */
export const LEGACY_ORE_SALE_PRICE_FACTOR = { min: 0.8, max: 1.3 } as const;
export const LEGACY_SUPPLY_PRICE_FACTOR = { min: 0.6, max: 0.9 } as const;

/**
 * Ore sale prices (dollars/kg) in the production market; also what the blast report,
 * survey estimates and panels value ore at there. Rarity-ordered like ORE_PRICES.
 * The ladder is flat (21 to 336, 16x) against the catalog's 1000x: measured on
 * desert/red canyon/alpine/green/tropical/volcanic sandboxes (seeds 42/7/123, 8 m blocks,
 * depth 0-55 m) the richest block pays 3.7x the richest desert surface block per m3,
 * inside SANDBOX_MAX_RICHNESS_RATIO. The absolute level is set by what the opening kit can
 * actually deliver (#1719): ~31 kg of ore a tick (47 t sold between ticks ~500 and 2,000),
 * so a crew costing ~SANDBOX_REFERENCE_CREW_COST_PER_TICK needs ~$20/kg just to break even
 * and the first contract (~$20-35k, filled around tick 600) must lift cash back over the
 * bankruptcy line before 150k of starting cash burns out. At this level the kit's steady
 * income is ~2-2.5x crew cost and the whole reference shot is worth ~2.3x the crew over
 * SANDBOX_REFERENCE_SHOT_CYCLE_TICKS (target 1.5-3x).
 */
export const PRODUCTION_ORE_PRICES: Record<string, number> = {
  dirtite: 21,
  rustite: 38.5,
  blingite: 59.5,
  gloomium: 84,
  sparkium: 119,
  craktonite: 168,
  absurdium: 234.5,
  treranium: 336,
};

/**
 * Ore-sale offer sizes (kg), sized to what the opening kit can fill, not to a shot's ~340 t:
 * the kit hauls ~31 kg of ore a tick into a 25 t tier-1 warehouse, and offers expire after
 * 30-100 ticks, so an offer above a few tonnes can never be filled and the crew would be
 * penalised for accepting it. The board still offers ~2 t of ore a day, about 2.5x what the
 * kit hauls, so income is limited by production, not by the market. A whole shot is
 * therefore absorbed over the ~11,000 ticks it takes to haul, not within 5 game days: the
 * 5-day target conflicts with fillable offers (balance: hauling, not demand, binds).
 */
export const PRODUCTION_ORE_SALE_QTY_KG = { min: 250, max: 2_000 } as const;
/**
 * Supply deals are the biggest ore offers, but still fillable. A supply offer asks for one ore,
 * and that ore is only a share of the kit's ~31 kg/tick haul into a 25 t tier-1 warehouse
 * (`FREIGHT_WAREHOUSE_CAPACITY_KG[1]`): the measured delivered rate of one supply ore in the
 * opening-kit scenario (#1789 sandbox-economy-balance) is ~9 kg/tick (8,353 kg in 919 ticks).
 * Invariant: qtyMax * 1.5 <= deliveredRate * deadlineMin (8,000 * 1.5 = 12,000 <= 9 * 1,500
 * = 13,500), so every supply offer is deliverable in full on time with a 1.5x margin.
 * Buyer tiers (#1929) keep the invariant per tier: qtyMax * BUYER_DEADLINE_MARGIN <= refRate *
 * deadlineMin, where refRate is `BUYER_REF_HAUL_KG_PER_TICK` and deadlineMin is derived from it.
 */
export const PRODUCTION_SUPPLY_QTY_KG = { min: 4_000, max: 8_000 } as const;
/** Supply quantity multiplier on `PRODUCTION_SUPPLY_QTY_KG` per buyer tier (#1929). */
export const BUYER_SUPPLY_QTY_FACTOR = { local: 0.5, regional: 1, national: 6, global: 25 } as const;
/** Mine grade at which each buyer tier starts offering contracts (#1929). */
export const BUYER_UNLOCK_GRADE = { local: 0, regional: 1, national: 3, global: 5 } as const;
/** Ore-sale lot size range (kg) per buyer tier (#1929); local lots are 100-1000 kg by design. */
export const BUYER_ORE_SALE_QTY_KG = {
  local: { min: 100, max: 1_000 },
  regional: { min: 1_000, max: 5_000 },
  national: { min: 10_000, max: 40_000 },
  global: { min: 50_000, max: 250_000 },
} as const;
/** Quantity rounding step (kg) per buyer tier (#1929). */
export const BUYER_QTY_STEP_KG = { local: 100, regional: 250, national: 1_000, global: 5_000 } as const;
/** Price factor range (against the ore's market base price) per buyer tier; richer for small local buyers (#1929). */
export const BUYER_PRICE_FACTOR = {
  local: { min: 1.15, max: 1.3 },
  regional: { min: 0.95, max: 1.1 },
  national: { min: 0.85, max: 1.0 },
  global: { min: 0.75, max: 0.95 },
} as const;
/** Relative chance of each buyer tier among the unlocked ones (#1929). */
export const BUYER_TIER_WEIGHT = { local: 0.35, regional: 0.35, national: 0.2, global: 0.1 } as const;
/**
 * Reference haul rate (kg/tick) a buyer tier's deadlines are sized for (#1929). Local and
 * regional: the measured ~9 kg/tick delivered rate of one ore from the opening kit. National and
 * global scale that by the reference fleet of the grade that unlocks them (grade 3: 3x, grade 5:
 * 10x the opening kit's haul), so a fleet of that grade can still fill the tier's biggest offer.
 */
export const BUYER_REF_HAUL_KG_PER_TICK = { local: 9, regional: 9, national: 27, global: 90 } as const;
/** A buyer offer's shortest deadline lets the reference rate haul its biggest quantity this many times over. */
export const BUYER_DEADLINE_MARGIN = 1.5;
/** Longest buyer deadline as a multiple of the shortest (2,500 / 1,500 of the #1789 supply range). */
export const BUYER_DEADLINE_SPAN_RATIO = 5 / 3;
/** Supply deals pay this share of the buyer tier's rolled price factor (volume discount). */
export const BUYER_SUPPLY_DISCOUNT = 0.75;
/**
 * Default deadline range (ticks) for every non-supply offer on any market, plus supply on the
 * legacy market. Production-market supply uses `PRODUCTION_SUPPLY_DEADLINE_TICKS` instead.
 */
export const LEGACY_OFFER_DEADLINE_TICKS = { min: 30, max: 100 } as const;
/** Deadline range (ticks) of production-market supply offers; see the fillability invariant above. */
export const PRODUCTION_SUPPLY_DEADLINE_TICKS = { min: 1_500, max: 2_500 } as const;
/** Rubble offers are sized down to the barren rock on site (#1892), so the range spans a small heap to a full one. */
export const PRODUCTION_RUBBLE_QTY_KG = { min: 2_500, max: 50_000 } as const;
/** Rounding step (kg) of production offer sizes. */
export const PRODUCTION_OFFER_QTY_STEP_KG = 250;
/** Ore sales pay close to base price; supply deals discount for volume. */
export const PRODUCTION_ORE_SALE_PRICE_FACTOR = { min: 0.9, max: 1.1 } as const;
export const PRODUCTION_SUPPLY_PRICE_FACTOR = { min: 0.6, max: 0.9 } as const;
/** Rubble disposal pay (dollars/kg): cents, since the volume is huge. */
export const PRODUCTION_RUBBLE_PRICE_PER_KG = { min: 0.01, max: 0.03 } as const;
/** Barren rock (kg) one spoil heap holds before it is full (#1892). */
export const SPOIL_HEAP_CAPACITY_KG = 50_000;
/** Largest share of the site's barren stock a cheap rubble clearance asks for (#1892). */
export const RUBBLE_CHEAP_STOCK_SHARE_MAX = 0.5;
/** Largest share of the site's barren stock a paid rubble clearance asks for (#1892). */
export const RUBBLE_PAID_STOCK_SHARE_MAX = 1.0;
/** Chance a rubble offer is a paid clearance, where the player pays the fee (#1892). */
export const RUBBLE_PAID_OFFER_CHANCE = 0.4;
/** Fee (dollars/kg) the player pays for a paid clearance on the production market (#1892). */
export const PRODUCTION_RUBBLE_FEE_PER_KG = { min: 0.02, max: 0.05 } as const;
/** Fee (dollars/kg) the player pays for a paid clearance on the legacy market (#1892). */
export const RUBBLE_FEE_PER_KG = { min: 0.5, max: 2.0 } as const;

/** Market the sandbox uses. */
export const SANDBOX_MARKET: 'legacy' | 'production' = 'production';
/** Reference sandbox crew cost per tick (driller + blaster + driver + upkeep, ~$250-300/h). */
export const SANDBOX_REFERENCE_CREW_COST_PER_TICK = 250;
/**
 * Ticks from first drill order to the whole shot's ore delivered for the ordinary 3x3 desert
 * seed 42 shot, opening kit (#1681, #1719): ~360 to drill, charge and fire plus ~340 t of ore
 * at the kit's measured ~31 kg/tick = ~11,300.
 */
export const SANDBOX_REFERENCE_SHOT_CYCLE_TICKS = 11_300;
/** Richest biome/depth may pay at most this multiple of desert surface rock per m3. */
export const SANDBOX_MAX_RICHNESS_RATIO = 10;

// Ore deposits on sandbox sites (#1682): each ore gets a low-frequency horizontal
// deposit field; vein density is zero below its rarity cutoff and ramps up to
// CORE_GAIN over EDGE_WIDTH above it, so ore clusters in discrete deposits.
/** Frequency of the low-frequency deposit field that gates where an ore may appear. */
export const ORE_DEPOSIT_FREQ = 0.03;
/** Deposit-field cutoff per OreCatalog rarity tier: higher = rarer (smaller coverage). */
export const ORE_DEPOSIT_RARITY_COVERAGE: Readonly<Record<string, number>> = {
  common: 0.44,
  uncommon: 0.52,
  rare: 0.58,
  very_rare: 0.65,
  legendary: 0.72,
};
/** Multiplier boosting vein density at a deposit core. */
export const ORE_DEPOSIT_CORE_GAIN = 3;
/** Width of the soft falloff at a deposit edge, in deposit-field units. */
export const ORE_DEPOSIT_EDGE_WIDTH = 0.4;

/** Offset in metres of the floored grade plane from the lowest charged-hole bottom; 0 = flush with it. */
export const BLAST_GRADE_FLOOR_OFFSET_M = 0;

/** Max depth in metres a blast may cut below its grade plane, so a deep outlier hole cannot gouge the pit floor. */
export const BLAST_GRADE_MAX_CUT_M = 4;

/**
 * Search radius (in nav cells) when an idle blocker looks for a free cell off
 * the mover's remaining route to yield to (#1696).
 */
export const IDLE_YIELD_SEARCH_RADIUS_CELLS = 10;

/**
 * Agent-occupancy block episodes on one leg before the mover abandons its
 * movement (#1696). Same order as MOVE_STUCK_ABANDON_TICKS.
 */
export const BLOCK_EPISODE_ABANDON_LIMIT = MOVE_STUCK_ABANDON_TICKS;

// ── Well-being score drivers (#1692) ──
// Housed sites taper gains near the cap so one cheap Living Quarters cannot pin well-being at 100
// (T1 < T2 < T3 equilibria, all below 98 for a busy crew of 8); unhoused sites climb undamped as
// before. Zero morale still falls 1/tick (49.05 after the first tick once the 0.05 decay is added).

/** Well-being gained per tick per unit of building effect (living quarters etc.); unchanged from the old 0.1 weight. */
export const WB_BUILDING_GAIN = 0.1;
/** Average morale at which well-being neither gains nor loses from morale; the midpoint of the 0-100 morale scale. */
export const WB_NEUTRAL_MORALE = 50;
/** Well-being gain per morale point above neutral, per tick; unchanged 0.02. The cap pin is prevented by headroom damping once housing exists, not by a weaker gain, so an unhoused crew builds the same early buffer. */
export const WB_MORALE_GAIN_PER_POINT = 0.02;
/** Well-being loss per morale point below neutral, per tick; unchanged 0.02, so zero morale falls 1/tick and the revolt path is intact. */
export const WB_MORALE_LOSS_PER_POINT = 0.02;
/** Score distance from the cap over which gains taper off (headroom damping), applied only while a Living Quarters gives a positive building effect; gives each housing tier its own equilibrium below 100. */
export const WB_HEADROOM_SPAN = 50;
/** Fatigue gauge level at or above which a worker feels no overwork strain; below it strain rises linearly to 1 at fatigue 0. Is NEED_MORALE_EFFECT_THRESHOLDS.comfortable (50): the default site policy (rest at 60, in-place rests end at 70) keeps a working crew oscillating 60-70 and above 50, so ordinary work no longer drags well-being (#1778); only a crew the morale model already calls uncomfortable does. */
export const WB_FATIGUE_COMFORT = NEED_MORALE_EFFECT_THRESHOLDS.comfortable;
/** Max well-being drag from a fully fatigued crew; a crew below the comfort line (strain ~0.1-0.3) costs 0.015-0.05/tick, a crew at the default policy none; kept gentle so the no-housing scenarios that run an exhausted crew still finish before the revolt lands. */
export const WB_OVERWORK_DRAG_MAX = 0.15;
/** Max well-being drag when the whole crew lacks beds; scaled by the unhoused share of the crew. */
export const WB_CROWDING_DRAG_MAX = 0.8;
/** Well-being drag per tick per accident of the last 10 ticks (about 1.5 points per accident in total); a blast that kills the crew must dent well-being, not zero it. */
export const WB_ACCIDENT_DRAG = 0.15;

// ── Safety score drivers (#1977) ──

/** Neutral safety equilibrium: the target the score settles at with no building safety effect and no equipment. */
export const SAFETY_TARGET_BASE = 50;
/** Safety equilibrium points each unit of building safety effect adds to the target the score is pulled towards. */
export const SAFETY_TARGET_PER_EFFECT = 12;
/** Extra safety target points while safety equipment investment exists. */
export const SAFETY_EQUIPMENT_TARGET_BONUS = 5;
/** Lowest safety target, however bare the site. */
export const SAFETY_TARGET_MIN = 10;
/** Highest safety target, however well equipped the site. */
export const SAFETY_TARGET_MAX = 90;
/** Fraction of the gap to the safety target closed per tick. */
export const SAFETY_PULL_RATE = 0.02;
/** Safety points lost per accident of the recent window. */
export const SAFETY_ACCIDENT_HIT = 5;

/** Morale every remaining crew member loses when a colleague is dismissed (not for cause). */
export const DISMISSAL_CREW_MORALE_DENT = 6;

// ── Event option balance (#1894) ──

/** Days a permanent effect is counted over when comparing event options for dominance. */
export const EVENT_BALANCE_PERMANENT_DAYS = 365;
/** Reference crew size used to turn per-employee event effects into totals when comparing options. */
export const EVENT_BALANCE_REFERENCE_CREW = 5;

// ── Mine grades (#1921) ──────────────────────────────────────────────────────
/** One target a grade asks for; `no_death` value is the look-back window in ticks. */
export interface MineGradeTargetConfig {
  kind: 'ore_kg' | 'blasts' | 'depth_m' | 'rock_m3' | 'safety' | 'ecology' | 'neighbours' | 'no_death';
  value: number;
}
/** One named grade of the permit ladder. */
export interface MineGradeConfig {
  nameKey: string;
  fee: number;
  processingTicks: number;
  targets: readonly MineGradeTargetConfig[];
}
/** Named grades 1-5, keyed by grade number (v1 defaults, re-tuned by calibration tasks). */
export const MINE_GRADES: Readonly<Record<number, MineGradeConfig>> = {
  1: { nameKey: 'permit.grade.1', fee: 20_000, processingTicks: 48, targets: [
    { kind: 'ore_kg', value: 5_000 }, { kind: 'blasts', value: 2 } ] },
  2: { nameKey: 'permit.grade.2', fee: 75_000, processingTicks: 72, targets: [
    { kind: 'ore_kg', value: 30_000 }, { kind: 'depth_m', value: 10 }, { kind: 'safety', value: 40 } ] },
  3: { nameKey: 'permit.grade.3', fee: 250_000, processingTicks: 96, targets: [
    { kind: 'ore_kg', value: 150_000 }, { kind: 'depth_m', value: 20 }, { kind: 'neighbours', value: 35 }, { kind: 'no_death', value: 1_000 } ] },
  4: { nameKey: 'permit.grade.4', fee: 800_000, processingTicks: 120, targets: [
    { kind: 'ore_kg', value: 600_000 }, { kind: 'depth_m', value: 30 }, { kind: 'safety', value: 50 }, { kind: 'ecology', value: 30 } ] },
  5: { nameKey: 'permit.grade.5', fee: 2_500_000, processingTicks: 144, targets: [
    { kind: 'ore_kg', value: 2_500_000 }, { kind: 'depth_m', value: 40 }, { kind: 'neighbours', value: 40 }, { kind: 'no_death', value: 2_000 } ] },
};
/** Ore target multiplier per endless class above the last named grade. */
export const MINE_GRADE_CLASS_ORE_FACTOR = 2.5;
/** Rock-broken target (m³) of endless class 1. */
export const MINE_GRADE_CLASS_ROCK_BASE_M3 = 60_000;
/** Rock-broken target multiplier per further class. */
export const MINE_GRADE_CLASS_ROCK_FACTOR = 2;
/** Fee multiplier per further class. */
export const MINE_GRADE_CLASS_FEE_FACTOR = 2;
/** Processing ticks of every endless class. */
export const MINE_GRADE_CLASS_PROCESSING_TICKS = 144;

/** Blast limits and filing fee of one permit grade. */
export interface PermitLimitConfig {
  maxChargeKg: number;
  maxHoles: number;
  fee: number;
}
/** Per-blast limits of grades 0-5, keyed by grade number. */
export const PERMIT_LIMITS: Readonly<Record<number, PermitLimitConfig>> = {
  0: { maxChargeKg: 80, maxHoles: 9, fee: 250 },
  1: { maxChargeKg: 250, maxHoles: 16, fee: 1_000 },
  2: { maxChargeKg: 800, maxHoles: 36, fee: 3_000 },
  3: { maxChargeKg: 2_500, maxHoles: 81, fee: 8_000 },
  4: { maxChargeKg: 8_000, maxHoles: 196, fee: 20_000 },
  5: { maxChargeKg: 25_000, maxHoles: 400, fee: 50_000 },
};
/** Charge-limit multiplier per endless class above the last named grade. */
export const PERMIT_CLASS_CHARGE_FACTOR = 1.6;
/** Hole-limit multiplier per endless class. */
export const PERMIT_CLASS_HOLES_FACTOR = 1.4;
/** Fee multiplier per endless class. */
export const PERMIT_CLASS_FEE_FACTOR = 1.5;
/** Inspection chance at full (100%) overshoot. */
export const PERMIT_INSPECTION_BASE_CHANCE = 0.25;
/** Fine = fee x this x overshoot. */
export const PERMIT_FINE_FEE_MULTIPLIER = 10;
/** Neighbour-relations penalty when caught. */
export const PERMIT_CAUGHT_NEIGHBOUR_PENALTY = 5;
/** Strikes inside the window that suspend the permit. */
export const PERMIT_STRIKES_TO_SUSPEND = 3;
/** Window (ticks) in which strikes count. */
export const PERMIT_STRIKE_WINDOW_TICKS = 2000;
/** Ticks a suspension lasts. */
export const PERMIT_SUSPENSION_TICKS = 72;

// ── Permit and petition events (#1927) ───────────────────────────────────────
export const EVENT_PERMIT_TOUR_STOP_HOURS = 8;
export const EVENT_PERMIT_TOUR_SAFETY_MIN = 50;
export const EVENT_PERMIT_TOUR_IMPRESSED_TICKS = -24;
export const EVENT_PERMIT_TOUR_TRIPPED_TICKS = 24;
export const EVENT_PERMIT_STAMP_FEE_PCT = 25;
export const EVENT_PERMIT_STAMP_CORRUPTION = 5;
export const EVENT_PERMIT_HIDE_DELAY_TICKS = 72;
export const EVENT_PETITION_MIN_BLAST_SHARE = 0.5;
export const EVENT_PETITION_MAX_NEIGHBOURS = 50;
export const EVENT_PETITION_BBQ_COST = 6000;
export const EVENT_PETITION_BBQ_NEIGHBOURS = 6;
export const EVENT_PETITION_BERM_COST = 20000;
export const EVENT_PETITION_BERM_NEIGHBOURS = 10;
export const EVENT_PETITION_BERM_ECOLOGY = 5;
export const EVENT_PETITION_IGNORE_NEIGHBOURS = -8;
export const EVENT_PETITION_IGNORE_DELAY_TICKS = 48;
export const EVENT_BALANCE_PERMIT_APPROVE_TICKS = 96;
export const EVENT_BALANCE_REFERENCE_PERMIT_FEE = 20000;

/** Ore grade scale lever (#1932): default and upper bound. */
export const ORE_GRADE_SCALE_DEFAULT = 1;
export const ORE_GRADE_SCALE_MAX = 1;

/**
 * Ore grade rises with depth below the natural surface (#1933). Each band
 * applies its multiplier from `fromDepth` metres down.
 */
export const ORE_DEPTH_MULTIPLIER_BANDS: readonly {
  readonly fromDepth: number;
  readonly multiplier: number;
}[] = [
  { fromDepth: 0, multiplier: 1.0 },
  { fromDepth: 10, multiplier: 1.4 },
  { fromDepth: 20, multiplier: 1.8 },
  { fromDepth: 35, multiplier: 2.2 },
];

/** Metres of smoothstep ramp from each band boundary to the next band (#1933). */
export const ORE_DEPTH_BLEND_M = 3;

/**
 * Sandbox-only deep ore content (#1933). With ore deposits on, a (rock, ore) pair here replaces the
 * RockCatalog host probability, so deeper rock pays more without touching campaign rocks or Level 1's
 * contract ores. A row only changes (rock, ore) pairs whose sandbox window starts at 15 m or deeper (sparkium 15, craktonite 28, absurdium 30), so ore at 0-10 m is identical to the catalog's.
 */
export const SANDBOX_DEEP_ORE_AFFINITY: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  cruite: { sparkium: 0.22 },
  sandite: { sparkium: 0.22 },
  molite: { craktonite: 0.20, absurdium: 0.38 },
  grumpite: { sparkium: 0.20 },
  clunkite: { sparkium: 0.12, craktonite: 0.10, absurdium: 0.50 },
  obstiite: { sparkium: 0, craktonite: 0.06, absurdium: 0.44 },
  gnarlite: { sparkium: 0.17 },
  absurdite: { sparkium: 0.15 },
  titanite: { sparkium: 0.08, absurdium: 0.75 },
};

/** Sandbox-only depth windows [min, max] metres replacing the OreCatalog window: deep ores start deeper so deep bands out-earn mid ones. */
export const SANDBOX_ORE_DEPTH_WINDOWS: Readonly<Record<string, readonly [number, number]>> = {
  craktonite: [28, 45],
  absurdium: [30, 55],
};

/** Board of directors (#1946). */
export const BOARD_QUARTER_TICKS = 720;
export const BOARD_TARGET_GROWTH = 1.25;
export const BOARD_CONFIDENCE_START = 60;
export const BOARD_CONFIDENCE_MAX = 100;
export const BOARD_CONFIDENCE_MET_GAIN = 15;
export const BOARD_CONFIDENCE_MISS_PENALTY = 25;
export const BOARD_BONUS_PROFIT_SHARE = 0.10;
export const BOARD_DIVIDEND_RATE = 0.20;
export const BOARD_DIVIDEND_CASH_FLOOR = 100000;
/** Targets of a board attached with the debug `board start` command when none are given. */
export const BOARD_DEBUG_ORE_TARGET_T = 50;
export const BOARD_DEBUG_PROFIT_TARGET = 20000;

// ── Vanity projects (#1947) ──
export const VANITY_MIN_GRADE = 4;
export const VANITY_CEO_STATUE_COST = 250000;
export const VANITY_GOLF_COURSE_COST = 600000;
export const VANITY_EXECUTIVE_HELIPAD_COST = 1200000;
export const VANITY_GOLD_TOWER_COST = 5000000;
export const VANITY_CEO_STATUE_CONFIDENCE = 10;
export const VANITY_GOLF_COURSE_CONFIDENCE = 20;
export const VANITY_EXECUTIVE_HELIPAD_CONFIDENCE = 30;
export const VANITY_GOLD_TOWER_CONFIDENCE = 50;
export const VANITY_MORALE_ONCE = -2;
export const VANITY_ECOLOGY_ONCE = 2;
export const VANITY_HELIPAD_NUISANCE_ONCE = -3;
export const VANITY_GOLD_TOWER_NUISANCE_ONCE = -5;
export const VANITY_WELL_BEING_ONCE = -2;
/** Golf course upkeep ($ per tick). */
export const VANITY_GOLF_UPKEEP_PER_TICK = 20;
/** Share of stored mass that must be barren, with every spoil heap full or absent, for a storage-full block to read as barren overflow. */
export const BARREN_OVERFLOW_STORED_SHARE = 0.5;
