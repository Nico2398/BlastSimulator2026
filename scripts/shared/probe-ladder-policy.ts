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
