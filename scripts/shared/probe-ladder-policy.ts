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
/** Rubble (kg) left in the pit at or above which the next shot is held. Placeholder, tuned in implementation. */
export const LADDER_GATE_RUBBLE_KG = 0;
/** Ticks of payroll cash the ladder keeps before it fires again. Placeholder, tuned in implementation. */
export const LADDER_GATE_RUNWAY_TICKS = 0;

export interface LadderShotGateInput {
  /** Current ladder grade. */
  grade: number;
  /** Rubble (kg) lying in the pit, not yet hauled out. */
  rubbleKg: number;
  cash: number;
  /** Payroll cost per tick. */
  payrollPerTick: number;
}

export type LadderShotGateDecision = 'fire' | 'hold';

/**
 * Whether the ladder fires its next shot or holds while haulers clear the pit. Applies from
 * LADDER_GATE_MIN_GRADE only: firing limit-sized shots faster than the fleet hauls buries the pit and
 * starves deliveries while payroll continues.
 */
export function decideLadderShotGate(_input: LadderShotGateInput): LadderShotGateDecision {
  throw new Error('not implemented');
}
