/** Pure decisions for the probe `ladder` strategy: narrow inputs, no session or game state. */

export interface LadderRampInput {
  /** Fragment mass still lying on the crater footprint. */
  rubbleKg: number;
  /** A haul is still pending. */
  pendingHaul: boolean;
  /** A depth target of the next grade is open. */
  deepenTargetOpen: boolean;
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

/** Whether the ladder should order a ramp into the cleared, deepened crater now. */
export function decideLadderRamp(input: LadderRampInput): LadderRampDecision {
  const clear = input.rubbleKg === 0 && !input.pendingHaul;
  const deeper = input.floorDepthM > input.rampedFloorM;
  const affordable = input.cash - input.rampCost >= input.reserve;
  return clear && input.deepenTargetOpen && deeper && affordable ? 'order' : 'skip';
}

/** Which safety/neighbour action, if any, the ladder takes this tick. */
export function decideLadderSafety(input: LadderSafetyInput): LadderSafetyDecision {
  if (!input.safetyTargetOpen && !input.neighboursBelowTarget) return 'none';
  if (input.safetyTargetOpen && input.canAfford) return input.officeBuilt ? 'upgrade_office' : 'build_office';
  return input.neighboursBelowTarget ? 'neighbours' : 'none';
}
