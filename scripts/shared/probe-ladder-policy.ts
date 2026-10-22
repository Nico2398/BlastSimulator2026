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
 * Whether the ladder fires at full depth, builds a ramp or upgrades the fleet first, or shrinks the shot to what haulers reach.
 * An ordered ramp the fleet climbs (equal counts) fires; no ramp asks for one; a ramp too steep for the fleet asks for the
 * tier-2 upgrade only when it is affordable, else the shot shrinks: an unaffordable upgrade never fires.
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
  /** Rubble no hauler can reach whatever is ordered. */
  sealedRubbleCount: number;
  haulPending: boolean;
}

/** Deepen when no ordered or reachable orderless rubble and no haul remains, whatever is sealed; else wait. */
export function decideLadderDeepen(_input: LadderDeepenInput): 'deepen' | 'wait' {
  return undefined as unknown as 'deepen' | 'wait'; // TODO: implement
}

export interface FreshSiteInput {
  oreKgUnderSite: number;
  siteOreKgFloor: number;
  groundOreKgRemaining: number;
}

/** Skip a fresh site holding less ore than the floor while ore remains elsewhere in the ground. */
export function decideFreshShotSite(_input: FreshSiteInput): 'fire' | 'skip' {
  return undefined as unknown as 'fire' | 'skip'; // TODO: implement
}

/** Least ore (kg) under a fresh shot site worth firing at. */
export const LADDER_SITE_ORE_KG_FLOOR = 0;

/** Margin (m) around a ramp footprint that a fresh shot keeps clear of. */
export const LADDER_RAMP_PROTECT_MARGIN_M = 0;

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
}

/** Square zones covering each ramp's run plus the margin. */
export function rampProtectionZones(_ramps: readonly RampFootprintInput[], _marginM: number): ProtectedZone[] {
  return []; // TODO: implement
}

/** Whether a shot footprint overlaps any protected zone. */
export function shotOverlapsProtectedRamp(_site: ProtectedZone, _zones: readonly ProtectedZone[]): boolean {
  return false; // TODO: implement
}
