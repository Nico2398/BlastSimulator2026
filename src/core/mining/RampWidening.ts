// BlastSimulator2026 — Widening a built ramp (#1298)
// A built ramp is a terrain feature that can be selected and ordered wider.
// Reusable core operation: #1208's traffic-jam event issues the same order.

import { computeRampCost, defineRampSegments, rampWidthOf, type RampDef } from './Ramp.js';
import { formatMoney } from '../economy/formatMoney.js';
import { queueRampOrder } from './RampOrder.js';
import { RAMP_WIDTH_OPTIONS, type RampWidth } from '../config/balance.js';
import type { GameState, PlannedRamp } from '../state/GameState.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';

interface RampFootprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** A finished ramp, recorded when its last segment is dug. */
export interface BuiltRamp {
  id: number;
  def: RampDef;
  width: RampWidth;
  footprint: RampFootprint;
}

type WidenResult<T> = { success: true; data: T } | { success: false; error: string };

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
export function validateWidenRamp(ramp: BuiltRamp, toWidth: RampWidth, cash: number): WidenResult<{ cost: number }> {
  if (!(RAMP_WIDTH_OPTIONS as readonly number[]).includes(toWidth)) {
    return { success: false, error: `Invalid ramp width: choose one of ${RAMP_WIDTH_OPTIONS.join(', ')}.` };
  }
  if (toWidth <= ramp.width) {
    return { success: false, error: `Ramp #${ramp.id} is already ${ramp.width} wide; widen to more than that.` };
  }
  const cost = computeRampCost(ramp.def.length, toWidth - ramp.width);
  if (cash < cost) return { success: false, error: `Insufficient funds: need $${formatMoney(cost)}, have $${formatMoney(cash)}` };
  return { success: true, data: { cost } };
}

/** Orders `rampId` widened to `toWidth`: charges the cost and queues the extra excavation as a planned ramp. */
export function orderRampWiden(
  state: GameState, grid: VoxelGrid, rampId: number, toWidth: RampWidth,
): WidenResult<{ plannedRampId: number; cost: number }> {
  const ramp = state.builtRamps.find(r => r.id === rampId);
  if (!ramp) return { success: false, error: `Ramp #${rampId} not found` };
  if (state.plannedRamps.some(p => p.widenOf === rampId)) {
    return { success: false, error: `Ramp #${rampId} is already being widened` };
  }
  const validation = validateWidenRamp(ramp, toWidth, state.cash);
  if (!validation.success) return validation;

  const def: RampDef = { ...ramp.def, width: toWidth };
  const segments = defineRampSegments(grid, def, ramp.width);
  const plannedRampId = queueRampOrder(
    state, def, rampFootprint(def, toWidth), segments, validation.data.cost, 'Widen ramp', rampId,
  );
  return { success: true, data: { plannedRampId, cost: validation.data.cost } };
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
