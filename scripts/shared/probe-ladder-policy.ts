/** Pure decisions for the probe `ladder` strategy: narrow inputs, no session or game state. */

export interface LadderRampInput {
  /** Current pit floor depth in metres. */
  floorDepthM: number;
  /** Floor depth at which a ramp was last ordered. */
  rampedFloorM: number;
  cash: number;
  rampCost: number;
  /** Cash kept back after the ramp. */
  reserve: number;
}

type LadderRampDecision = 'order' | 'skip';

export interface LadderSafetyInput {
  safetyTargetOpen: boolean;
  neighboursBelowTarget: boolean;
  officeBuilt: boolean;
  canAfford: boolean;
}

type LadderSafetyDecision = 'build_office' | 'upgrade_office' | 'neighbours' | 'none';

/**
 * Whether the ladder should order a ramp into the latest crater now: once per new pit floor, cash reserve kept.
 * Rubble is deliberately not a condition: the ramp is how haulers reach it (a gate on a clear crater stalled the
 * Shareholder Summit competent run into a firing).
 */
export function decideLadderRamp(input: LadderRampInput): LadderRampDecision {
  const deeper = input.floorDepthM > input.rampedFloorM;
  const affordable = input.cash - input.rampCost >= input.reserve;
  return deeper && affordable ? 'order' : 'skip';
}

/** Which safety/neighbour action, if any, the ladder takes this tick. */
export function decideLadderSafety(input: LadderSafetyInput): LadderSafetyDecision {
  if (!input.safetyTargetOpen && !input.neighboursBelowTarget) return 'none';
  if (input.safetyTargetOpen && input.canAfford) return input.officeBuilt ? 'upgrade_office' : 'build_office';
  return input.neighboursBelowTarget ? 'neighbours' : 'none';
}

/** First grade at which the ladder gates its next shot on the rubble already in the pit. */
export const LADDER_GATE_MIN_GRADE = 2;
/** Rubble (kg) left in the pit strictly above which the next shot is held. Measured: a limit-sized shot buries the pit in millions of kg. */
export const LADDER_GATE_RUBBLE_KG = 500_000;
/** Ticks of payroll cash the ladder keeps before it fires again. Payroll runs roughly 700 a tick; a stalled income must outlast it. */
export const LADDER_GATE_RUNWAY_TICKS = 1_500;

export interface LadderShotGateInput {
  /** Current ladder grade. */
  grade: number;
  /** Rubble (kg) lying in the pit, not yet hauled out. */
  rubbleKg: number;
  cash: number;
  /** Payroll cost per tick. */
  payrollPerTick: number;
}

type LadderShotGateDecision = 'fire' | 'hold';

/**
 * Whether the ladder fires its next shot or holds while haulers clear the pit. Applies from
 * LADDER_GATE_MIN_GRADE only: firing limit-sized shots faster than the fleet hauls buries the pit and
 * starves deliveries while payroll continues.
 */
export function decideLadderShotGate(input: LadderShotGateInput): LadderShotGateDecision {
  if (input.grade < LADDER_GATE_MIN_GRADE) return 'fire';
  if (input.rubbleKg > LADDER_GATE_RUBBLE_KG) return 'hold';
  // Payroll 0 is an infinite runway.
  if (input.payrollPerTick > 0 && input.cash / input.payrollPerTick < LADDER_GATE_RUNWAY_TICKS) return 'hold';
  return 'fire';
}

/**
 * The event option the ladder answers with: the first one that does not put a new hire on the payroll, else
 * the first. An offered "manager" costs a salary for the rest of the run (~7% of a quarter's income each), which
 * the fixed headcount of a competent mine does not carry; whether the scripted run met the Shareholder Summit
 * profit target used to hang on how many of those offers the event stream happened to make (#2043).
 */
export function decideLadderEventOption(optionHires: readonly boolean[]): number {
  const free = optionHires.indexOf(false);
  return free === -1 ? 0 : free;
}

export interface LadderReachInput {
  /** Rise over run of the ordered ramp; Infinity when none is ordered. */
  rampSlopeRatio: number;
  /** Steepest slope ratio the fleet climbs. */
  fleetClimbRatio: number;
}

type LadderReachDecision = 'fire' | 'ramp_first' | 'shrink';

/**
 * Whether the ladder fires at full depth, orders a ramp first, or shrinks the shot to what haulers reach.
 * An ordered ramp the fleet climbs (slope ratio at most the fleet's) fires; no ramp asks for one; a ramp too steep for
 * the fleet shrinks the shot. Tier 2 haulers climb less steeply, so upgrading never helps and is not a branch.
 */
export function decideLadderReach(input: LadderReachInput): LadderReachDecision {
  if (!Number.isFinite(input.rampSlopeRatio)) return 'ramp_first';
  if (input.fleetClimbRatio >= input.rampSlopeRatio) return 'fire';
  return 'shrink';
}

/** Deepest shot (m) haulers can still reach by the ramp; monotonic in the ramp run, never above holeDepthM. */
export function reachableShotDepthM(
  rampRunM: number,
  fleetClimbRatio: number,
  holeDepthM: number,
): number {
  return Math.max(0, Math.min(holeDepthM, rampRunM * fleetClimbRatio));
}

export interface LadderDeepenInput {
  /** Rubble on the crater footprint that a haul order already covers. */
  orderedRubbleCount: number;
  /** Rubble with no haul order that a hauler can reach (sealed rubble excluded). */
  orderlessRubbleCount: number;
  /** Rubble no hauler can reach whatever is ordered. Informational: ignored by the decision, sealed rubble never blocks deepening. */
  sealedRubbleCount: number;
  haulPending: boolean;
}

/** Deepen when no ordered or reachable orderless rubble and no haul remains, whatever is sealed; else wait. */
export function decideLadderDeepen(input: LadderDeepenInput): 'deepen' | 'wait' {
  const clear = input.orderedRubbleCount === 0 && input.orderlessRubbleCount === 0;
  return clear && !input.haulPending ? 'deepen' : 'wait';
}

export interface FreshSiteInput {
  /** Ore under the site, as summed voxel ore densities (not kg). */
  oreKgUnderSite: number;
  /** Least `oreKgUnderSite` worth firing at. */
  siteOreKgFloor: number;
  /** Ore left across all free sites, same units. */
  groundOreKgRemaining: number;
}

/** Skip a fresh site holding less ore than the floor while ore remains elsewhere in the ground. */
export function decideFreshShotSite(input: FreshSiteInput): 'fire' | 'skip' {
  return input.oreKgUnderSite < input.siteOreKgFloor && input.groundOreKgRemaining > 0 ? 'skip' : 'fire';
}

/** Least ore under a fresh shot site worth firing at, in summed voxel ore densities, not kg (used-up ground holds exactly 0). */
export const LADDER_SITE_ORE_FLOOR = 1;

/** Margin (m) around a ramp footprint that a fresh shot keeps clear of. */
export const LADDER_RAMP_PROTECT_MARGIN_M = 2;

export interface RampFootprintInput {
  x: number;
  z: number;
  runM: number;
  dirX: number;
  dirZ: number;
}

export interface ProtectedZone {
  x: number;
  z: number;
  span: number;
  /** Extent along z when it differs from `span` (a rectangle); a square without it. */
  spanZ?: number;
}

/**
 * One corner-origin square per ramp, of side `run + 2 * margin`: not a narrow corridor. It spans the run plus the margin at
 * each end along the ramp's axis and is centred on the ramp across it. Ramps are axis-aligned lanes: `dirX !== 0` means
 * along x, otherwise along z. `x`,`z` is the ramp's start; `dirX`,`dirZ` its unit direction.
 */
export function rampProtectionZones(ramps: readonly RampFootprintInput[], marginM: number): ProtectedZone[] {
  return ramps.map(r => {
    const span = r.runM + 2 * marginM;
    const endX = r.x + r.dirX * r.runM;
    const endZ = r.z + r.dirZ * r.runM;
    const alongX = r.dirX !== 0;
    return alongX
      ? { x: Math.min(r.x, endX) - marginM, z: r.z - span / 2, span }
      : { x: r.x - span / 2, z: Math.min(r.z, endZ) - marginM, span };
  });
}

/** Whether a shot footprint overlaps any protected zone; boxes that merely touch do not. */
export function shotOverlapsProtectedRamp(site: ProtectedZone, zones: readonly ProtectedZone[]): boolean {
  return zones.some(z => site.x < z.x + z.span && z.x < site.x + site.span
    && site.z < z.z + (z.spanZ ?? z.span) && z.z < site.z + (site.spanZ ?? site.span));
}

/** Deepest hole (m) the ladder drills on a fresh site, where the floor is not yet open: deeper holes seal under the burden cap. */
export const LADDER_FRESH_HOLE_DEPTH_M = 8;
/** Metres the hole depth cap drops after a failed shot (no pit gain, no new ore). */
export const LADDER_HOLE_STEP_DOWN_M = 2;
/** Shallowest hole (m) the step-down ever reaches. */
export const LADDER_HOLE_MIN_DEPTH_M = 4;
/** Consecutive dud shots after which the crater is barred from further shots. */
export const LADDER_DUD_SHOT_LIMIT = 2;

/** Pit depth gain (m) at or under which a shot counts as having gained none. */
const LADDER_PIT_GAIN_EPSILON_M = 0.01;

export interface LadderHoleDepthInput {
  /** Deepest hole the fleet's best drill rig can drill, in metres. */
  rigMaxDepthM: number;
  /** Depth (m) still to dig below the current floor, down to the target. */
  remainingDepthM: number;
  /** Whether the pit floor is already open (a cleared crater exists). */
  floorOpen: boolean;
  /** Whether the previous shot gained no pit depth and no new ore. */
  lastShotFailed: boolean;
  /** Hole depth cap (m) in force for the previous shot. */
  currentCapM: number;
  /** Fresh-site hole depth (m); defaults to LADDER_FRESH_HOLE_DEPTH_M. */
  freshHoleDepthM?: number;
}

/** Hole depth (m) for the next ladder shot, within [min(LADDER_HOLE_MIN_DEPTH_M, rigMaxDepthM), rigMaxDepthM]; the minimum-depth floor lives here. */
export function decideLadderHoleDepth(input: LadderHoleDepthInput): number {
  const fresh = input.freshHoleDepthM ?? LADDER_FRESH_HOLE_DEPTH_M;
  let base = input.floorOpen ? Math.min(fresh, input.remainingDepthM + 1) : fresh;
  if (input.lastShotFailed) base = Math.min(base, Math.max(LADDER_HOLE_MIN_DEPTH_M, input.currentCapM - LADDER_HOLE_STEP_DOWN_M));
  return Math.min(input.rigMaxDepthM, Math.max(LADDER_HOLE_MIN_DEPTH_M, base));
}

interface LadderShotOutcomeInput {
  /** Columns the shot cleared. */
  columnsCleared: number;
  /** Rock volume (m3) the shot broke. */
  volumeM3: number;
}

/** Whether a fired shot did nothing useful: no columns cleared or no volume broken. */
export function isDudShot(input: LadderShotOutcomeInput): boolean {
  return input.columnsCleared === 0 || input.volumeM3 === 0;
}

/** Whether a crater with this many consecutive dud shots is barred from further shots. */
export function shouldBarCrater(consecutiveDuds: number): boolean {
  return consecutiveDuds >= LADDER_DUD_SHOT_LIMIT;
}

export interface LadderShotJudgeInput {
  /** Shots fired so far. */
  shotsFired: number;
  /** Shots already judged. */
  shotsJudged: number;
  /** Whether the latest shot's ore yield is still resolving. */
  yieldPending: boolean;
  /** Deepest pit (m) now. */
  pitM: number;
  /** Deepest pit (m) before the latest shot. */
  baselinePitM: number;
  /** Haulable ore (kg) now (the last resolved yield). */
  oreKg: number;
  /** Haulable ore (kg) before the latest shot. */
  baselineOreKg: number;
  /** Latest blast report outcome, or null when none exists. */
  report: LadderShotOutcomeInput | null;
  /** Consecutive duds so far at the current site. */
  dudStreak: number;
}

interface LadderShotJudgment {
  /** Whether a new shot was judged this call; when false only dudStreak is carried unchanged; lastShotFailed is false and callers ignore it. */
  judged: boolean;
  /** Whether the judged shot gained no pit depth and no new ore. */
  lastShotFailed: boolean;
  /** Consecutive duds after this judgment (reset to 0 when barring). */
  dudStreak: number;
  /** Whether the site should now be barred. */
  bar: boolean;
}

/** Judge the latest fired shot once its yield resolved: failure when no pit gain and no new ore; duds accumulate toward barring. */
export function judgeLadderShot(input: LadderShotJudgeInput): LadderShotJudgment {
  if (input.shotsFired === input.shotsJudged || input.yieldPending) {
    return { judged: false, lastShotFailed: false, dudStreak: input.dudStreak, bar: false };
  }
  const lastShotFailed = input.pitM <= input.baselinePitM + LADDER_PIT_GAIN_EPSILON_M && input.oreKg <= input.baselineOreKg;
  const streak = input.report !== null && isDudShot(input.report) ? input.dudStreak + 1 : 0;
  const bar = shouldBarCrater(streak);
  return { judged: true, lastShotFailed, dudStreak: bar ? 0 : streak, bar };
}

/** Ticks a pattern may stay buried under rubble before the ladder drops it. */
export const LADDER_BURIED_DROP_TICKS = 500;

interface BuriedPatternInput {
  buriedHoleCount: number;
  buriedSinceTick: number | null;
  tick: number;
}

interface BuriedPatternDecision {
  action: 'wait' | 'drop';
  buriedSinceTick: number | null;
}

/**
 * Contract: no buried holes -> wait, buriedSinceTick null; first buried call -> wait,
 * buriedSinceTick = tick; buried for >= LADDER_BURIED_DROP_TICKS -> drop, null; a count back to 0
 * resets buriedSinceTick to null.
 */
export function decideBuriedPattern(input: BuriedPatternInput): BuriedPatternDecision {
  if (input.buriedHoleCount === 0) return { action: 'wait', buriedSinceTick: null };
  const since = input.buriedSinceTick ?? input.tick;
  if (input.tick - since >= LADDER_BURIED_DROP_TICKS) return { action: 'drop', buriedSinceTick: null };
  return { action: 'wait', buriedSinceTick: since };
}

interface LadderShotSideInput {
  limitSide: number;
  grade: number;
  lastShotFailed: boolean;
  sealedRubbleCount: number;
}

/**
 * Contract: a clean state returns limitSide at every grade; lastShotFailed gives a side strictly
 * smaller, floor 1. Result is in [1, limitSide]. No grade cap (caps of 3-6 starved ladder yield and
 * ended the Shareholder Summit competent run in game_over:worker_revolt) and no sealed-rubble shrink
 * (it alone reproduced that revolt, #2080): sealedRubbleCount is accepted but does not move the side.
 */
export function decideLadderShotSide(input: LadderShotSideInput): number {
  return Math.max(1, input.lastShotFailed ? input.limitSide - 1 : input.limitSide);
}

/** Share of the best site's ore a site must hold to be worth a shot. */
export const LADDER_SITE_ORE_SHARE = 0.25;

interface SiteOreInput {
  oreKgUnderSite: number;
  bestSiteOre: number;
}

/**
 * Contract: bestSiteOre 0 -> true; otherwise oreKgUnderSite >= LADDER_SITE_ORE_SHARE * bestSiteOre
 * and >= LADDER_SITE_ORE_FLOOR.
 */
export function siteHoldsOre(input: SiteOreInput): boolean {
  if (input.bestSiteOre <= 0) return true;
  return input.oreKgUnderSite >= LADDER_SITE_ORE_SHARE * input.bestSiteOre && input.oreKgUnderSite >= LADDER_SITE_ORE_FLOOR;
}
