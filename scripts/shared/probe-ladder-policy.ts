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

export type LadderRampDecision = 'order' | 'skip';

export interface LadderSafetyInput {
  safetyTargetOpen: boolean;
  neighboursBelowTarget: boolean;
  officeBuilt: boolean;
  canAfford: boolean;
}

export type LadderSafetyDecision = 'build_office' | 'upgrade_office' | 'neighbours' | 'none';

/** Whether the ladder should order a ramp into the cleared, deepened crater now. */
export function decideLadderRamp(_input: LadderRampInput): LadderRampDecision {
  // TODO: implement
  return 'skip';
}

/** Which safety/neighbour action, if any, the ladder takes this tick. */
export function decideLadderSafety(_input: LadderSafetyInput): LadderSafetyDecision {
  // TODO: implement
  return 'none';
}
