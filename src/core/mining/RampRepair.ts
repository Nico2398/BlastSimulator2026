// BlastSimulator2026 — Repairing a built ramp (#2045)
// A shot that cuts into a ramp, or deepens the floor at its foot, leaves steps a vehicle cannot climb. Keeping a
// ramp out of a shot, or repairing it after one, is the player's job: core never repairs a ramp by itself. A repair
// re-cuts the built ramp to its line, landed again on the floor its end row shows now: what stands above the line
// is cut, what the blast threw out below it is filled. It is paid per cell of that work.

import { RAMP_REPAIR_COST_PER_CELL } from '../config/balance.js';
import { formatMoney } from '../economy/formatMoney.js';
import type { BuiltRamp, GameState } from '../state/GameState.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import { defineRampSegments, isRampCellPending, landRampOnGrid, validateRampOrder, type RampDef, type RampSegmentDef } from './Ramp.js';
import { queueRampOrder } from './RampOrder.js';
import { rampFootprint } from './RampWidening.js';

/** A refused repair: a plain-English fallback plus the key the console and UI translate. */
interface RepairFailure {
  success: false;
  error: string;
  errorKey: string;
  errorParams?: Record<string, string | number>;
}

/** What a repair of one built ramp would cut and fill, and what it costs. */
interface RampRepairQuote {
  /** The built ramp's def landed on its end floor as it stands now. */
  def: RampDef;
  /** Only the cells still off the line; a segment with none is dropped. */
  segments: RampSegmentDef[];
  cells: number;
  cost: number;
}

type RepairResult<T> = { success: true; data: T } | RepairFailure;

function failure(error: string, errorKey: string, errorParams?: Record<string, string | number>): RepairFailure {
  return { success: false, error, errorKey, ...(errorParams ? { errorParams } : {}) };
}

/** The segments of `def` keeping only cells off the line, re-indexed from 0. */
function pendingSegments(grid: VoxelGrid, def: RampDef): RampSegmentDef[] {
  const out: RampSegmentDef[] = [];
  for (const segment of defineRampSegments(grid, def)) {
    const cells = segment.cells.filter(cell => isRampCellPending(grid, cell));
    if (cells.length > 0) out.push({ ...segment, index: out.length, cells });
  }
  return out;
}

/**
 * What repairing `ramp` takes on `grid` now, without changing anything. Refused when the ramp is intact (nothing
 * off its line) and when, landed on a floor a later shot deepened, it no longer reaches that floor within the cut
 * limit: the player then needs a longer ramp, not a repair.
 */
export function quoteRampRepair(grid: VoxelGrid, ramp: BuiltRamp): RepairResult<RampRepairQuote> {
  const def = landRampOnGrid(grid, { ...ramp.def, width: ramp.width });
  const geometry = validateRampOrder(def, Infinity);
  if (!geometry.success) {
    return failure(`Ramp #${ramp.id} no longer reaches its floor: build a longer ramp.`, 'mining.repair_ramp.out_of_reach', { id: ramp.id });
  }
  const segments = pendingSegments(grid, def);
  const cells = segments.reduce((n, s) => n + s.cells.length, 0);
  if (cells === 0) return failure(`Ramp #${ramp.id} is intact: nothing to repair.`, 'mining.repair_ramp.intact', { id: ramp.id });
  return { success: true, data: { def, segments, cells, cost: cells * RAMP_REPAIR_COST_PER_CELL } };
}

/** Orders `rampId` repaired: charges the quote and queues its cut and fill as a planned ramp that updates the built one. */
export function orderRampRepair(state: GameState, grid: VoxelGrid, rampId: number): RepairResult<{ plannedRampId: number; cost: number; cells: number }> {
  const ramp = state.builtRamps.find(r => r.id === rampId);
  if (!ramp) return failure(`Ramp #${rampId} not found`, 'mining.widen_ramp.not_found', { id: rampId });
  if (state.plannedRamps.some(p => p.repairOf === rampId || p.widenOf === rampId)) {
    return failure(`Ramp #${rampId} already has work under way`, 'mining.repair_ramp.in_progress', { id: rampId });
  }
  const quote = quoteRampRepair(grid, ramp);
  if (!quote.success) return quote;
  const { def, segments, cost, cells } = quote.data;
  if (state.cash < cost) return failure(`Insufficient funds: need ${cost}`, 'mining.repair_ramp.short_funds', { id: rampId, cost: formatMoney(cost) });
  const plannedRampId = queueRampOrder(state, def, rampFootprint(def, ramp.width), segments, cost, 'Repair ramp', { repairOf: rampId });
  if (plannedRampId === null) return failure('Nothing to excavate for this ramp', 'mining.ramp.nothing_to_dig');
  return { success: true, data: { plannedRampId, cost, cells } };
}
