// BlastSimulator2026 — Draining water out of drill holes

import type { GameState } from '../state/GameState.js';
import type { HoleWater } from '../weather/WeatherEffects.js';

/** Why a hole cannot be drained. */
export type DrainBlock = 'dry' | 'porous_untubed' | 'unknown_hole' | 'insufficient_funds';

/** Reason a single hole cannot be drained now, or null when it can. */
export function drainBlockReason(
  _hw: HoleWater | undefined,
  _tubed: boolean,
  _cash: number,
): DrainBlock | null {
  // TODO: implement
  return undefined as unknown as DrainBlock | null;
}

/** Drain the given holes, charging HOLE_DRAIN_COST_PER_HOLE for each success. */
export function drainHoles(
  _state: GameState,
  _holeIds: readonly string[],
): { drained: string[]; refused: Record<string, DrainBlock>; cost: number } {
  // TODO: implement
  return undefined as unknown as { drained: string[]; refused: Record<string, DrainBlock>; cost: number };
}
