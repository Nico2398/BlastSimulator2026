// BlastSimulator2026 — Widening a built ramp (#1298)
// A built ramp is a terrain feature that can be selected and ordered wider.
// Reusable core operation: #1208's traffic-jam event issues the same order.

import { computeRampCost, defineRampSegments, rampWidthOf, type RampDef } from './Ramp.js';
import { formatMoney } from '../economy/formatMoney.js';
import { queueRampOrder } from './RampOrder.js';
import { RAMP_WIDTH_OPTIONS, isRampWidth, type RampWidth } from '../config/balance.js';
import type { BuiltRamp, GameState, PlannedRamp, RampFootprint } from '../state/GameState.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';

/** Failure carries a plain-English `error` fallback plus the translation key the console/UI resolves with `t()` (mirrors validateRampOrder's messageKey). */
export interface WidenFailure {
  success: false;
  error: string;
  errorKey: string;
  errorParams?: Record<string, string | number>;
}
type WidenResult<T> = { success: true; data: T } | WidenFailure;

/** Inclusive tile rectangle of the cells a ramp of `def`'s placement carves at `width`. */
export function rampFootprint(def: Pick<RampDef, 'originX' | 'originZ' | 'direction' | 'length'>, width: RampWidth): RampFootprint {
  const half = Math.floor(width / 2);
  const ox = Math.floor(def.originX);
  const oz = Math.floor(def.originZ);
  const run = def.length - 1;
  switch (def.direction) {
    case 'south': return { minX: ox - half, maxX: ox + half, minZ: oz, maxZ: oz + run };
    case 'north': return { minX: ox - half, maxX: ox + half, minZ: oz - run, maxZ: oz };
    case 'east': return { minX: ox, maxX: ox + run, minZ: oz - half, maxZ: oz + half };
    case 'west': return { minX: ox - run, maxX: ox, minZ: oz - half, maxZ: oz + half };
  }
}

/** The lowest-id built ramp whose footprint contains tile (x, z), or null. */
export function findRampAtTile(ramps: readonly BuiltRamp[], x: number, z: number): BuiltRamp | null {
  let found: BuiltRamp | null = null;
  for (const r of ramps) {
    const f = r.footprint;
    if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ) continue;
    if (!found || r.id < found.id) found = r;
  }
  return found;
}

/** The next wider option after `current`, or null when already at the widest. */
export function nextRampWidth(current: RampWidth): RampWidth | null {
  return RAMP_WIDTH_OPTIONS.find(w => w > current) ?? null;
}

/** Checks a widen order (wider than current, known option, affordable) without mutating anything. */
export function validateWidenRamp(ramp: BuiltRamp, toWidth: number, cash: number): WidenResult<{ cost: number; width: RampWidth }> {
  if (!isRampWidth(toWidth)) {
    const options = RAMP_WIDTH_OPTIONS.join(', ');
    return {
      success: false, error: `Invalid ramp width: choose one of ${options}.`,
      errorKey: 'mining.build_ramp.invalid_width', errorParams: { options },
    };
  }
  if (toWidth <= ramp.width) {
    return {
      success: false, error: `Ramp #${ramp.id} is already ${ramp.width} wide; widen to more than that.`,
      errorKey: 'mining.widen_ramp.already_width', errorParams: { id: ramp.id, width: ramp.width },
    };
  }
  const cost = computeRampCost(ramp.def.length, toWidth - ramp.width);
  if (cash < cost) {
    const need = formatMoney(cost), have = formatMoney(cash);
    return {
      success: false, error: `Insufficient funds: need $${need}, have $${have}`,
      errorKey: 'console.insufficient_funds', errorParams: { need, have },
    };
  }
  return { success: true, data: { cost, width: toWidth } };
}

/** Orders `rampId` widened to `toWidth`: charges the cost and queues the extra excavation as a planned ramp. */
export function orderRampWiden(
  state: GameState, grid: VoxelGrid, rampId: number, toWidth: number,
): WidenResult<{ plannedRampId: number; cost: number }> {
  const ramp = state.builtRamps.find(r => r.id === rampId);
  if (!ramp) {
    return { success: false, error: `Ramp #${rampId} not found`, errorKey: 'mining.widen_ramp.not_found', errorParams: { id: rampId } };
  }
  if (state.plannedRamps.some(p => p.widenOf === rampId)) {
    return {
      success: false, error: `Ramp #${rampId} is already being widened`,
      errorKey: 'mining.widen_ramp.in_progress', errorParams: { id: rampId },
    };
  }
  const validation = validateWidenRamp(ramp, toWidth, state.cash);
  if (!validation.success) return validation;

  const { cost, width } = validation.data;
  const def: RampDef = { ...ramp.def, width };
  const segments = defineRampSegments(grid, def, ramp.width);
  const plannedRampId = queueRampOrder(
    state, def, rampFootprint(def, width), segments, cost, 'Widen ramp', rampId,
  );
  if (plannedRampId === null) {
    return { success: false, error: 'Nothing to excavate for this ramp', errorKey: 'mining.ramp.nothing_to_dig' };
  }
  return { success: true, data: { plannedRampId, cost } };
}

/**
 * Records a fully dug order: a widen order updates the ramp it widened, any
 * other order becomes a new built ramp (#1298).
 */
export function recordBuiltRamp(state: GameState, done: PlannedRamp): void {
  const width = rampWidthOf(done.def);
  const widened = done.widenOf === undefined ? undefined : state.builtRamps.find(r => r.id === done.widenOf);
  if (widened) {
    widened.width = width;
    widened.def = { ...widened.def, width };
    widened.footprint = rampFootprint(done.def, width);
    return;
  }
  state.builtRamps.push({
    id: state.nextBuiltRampId++, def: done.def, width, footprint: rampFootprint(done.def, width),
  });
}
