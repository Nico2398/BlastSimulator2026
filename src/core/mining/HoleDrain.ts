// BlastSimulator2026 — Draining water out of drill holes

import type { GameState } from '../state/GameState.js';
import { isHoleFlooded, type HoleWater } from '../weather/WeatherEffects.js';
import { HOLE_DRAIN_COST_PER_HOLE, HOLE_DRAIN_POROSITY_LIMIT } from '../config/balance.js';
import { addExpense } from '../economy/Finance.js';
import { hasTubing } from './Tubing.js';

/** Why a hole cannot be drained. */
export type DrainBlock = 'dry' | 'porous_untubed' | 'unknown_hole' | 'insufficient_funds';

/** Reason a single hole cannot be drained now, or null when it can. */
export function drainBlockReason(
  hw: HoleWater | undefined,
  tubed: boolean,
  cash: number,
): DrainBlock | null {
  if (!hw || !isHoleFlooded(hw.level)) return 'dry';
  if (!tubed && hw.porosity >= HOLE_DRAIN_POROSITY_LIMIT) return 'porous_untubed';
  if (cash < HOLE_DRAIN_COST_PER_HOLE) return 'insufficient_funds';
  return null;
}

/** Drain the given holes, charging HOLE_DRAIN_COST_PER_HOLE for each success. */
export function drainHoles(
  state: GameState,
  holeIds: readonly string[],
): { drained: string[]; refused: Record<string, DrainBlock>; cost: number } {
  const known = new Set(state.drillHoles.map(h => h.id));
  const drained: string[] = [];
  const refused: Record<string, DrainBlock> = {};
  let cost = 0;
  for (const id of holeIds) {
    if (!known.has(id)) {
      refused[id] = 'unknown_hole';
      continue;
    }
    const hw = state.holeWater[id];
    const block = drainBlockReason(hw, hasTubing(state.tubingState, id), state.cash);
    if (block) {
      refused[id] = block;
      continue;
    }
    state.holeWater[id] = { ...hw!, level: 0 };
    state.cash -= HOLE_DRAIN_COST_PER_HOLE;
    cost += HOLE_DRAIN_COST_PER_HOLE;
    drained.push(id);
  }
  if (cost > 0) addExpense(state.finances, cost, 'equipment', `Drained ${drained.length} hole(s)`, state.tickCount);
  return { drained, refused, cost };
}
