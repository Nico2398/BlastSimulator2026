// BlastSimulator2026 — Repairing a built ramp (#2045)
// A shot that cuts into a ramp, or deepens the floor at its foot, leaves steps a vehicle cannot climb. Keeping a
// ramp out of a shot, or repairing it after one, is the player's job: core never repairs a ramp by itself. A repair
// re-cuts the built ramp to its line, landed again on the floor its end row shows now: what stands above the line
// is cut, what the blast threw out below it is filled. It is paid per cell of that work.

import { RAMP_REPAIR_COST_PER_CELL, RAMP_REPAIR_TOLERANCE_M } from '../config/balance.js';
import { formatMoney } from '../economy/formatMoney.js';
import type { BuiltRamp, GameState } from '../state/GameState.js';
import { computeVoxelColumnSurfaceHeight, type VoxelGrid } from '../world/VoxelGrid.js';
import { defineRampSegments, isRampCellPending, landRampOnGrid, validateRampOrder, type RampDef, type RampSegmentDef } from './Ramp.js';
import { queueRampOrder } from './RampOrder.js';
import { findRampAtTile, rampFootprint } from './RampWidening.js';

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

/** The line height of a floor-row cell: the fill it rises to, or the floor it is banded down to; undefined above the floor row. */
function lineOf(cell: RampSegmentDef['cells'][number]): number | undefined {
  if (cell.fillTarget !== undefined) return cell.fillTarget;
  return cell.floorAdjustment === undefined ? undefined : cell.y - 1 + cell.floorAdjustment;
}

/**
 * How far the ground strays from the line in shape: the spread of (ground - line) over every column of `segments`.
 * A line re-anchored on a ground another order nudged sits off by the same hair everywhere and spreads by none.
 */
function offLineSpread(grid: VoxelGrid, segments: readonly RampSegmentDef[]): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const segment of segments) {
    for (const cell of segment.cells) {
      const line = lineOf(cell);
      if (line === undefined) continue;
      const ground = computeVoxelColumnSurfaceHeight(grid, cell.x, cell.z);
      const off = Number.isFinite(ground) ? ground - line : -Infinity;
      lo = Math.min(lo, off);
      hi = Math.max(hi, off);
    }
  }
  return hi >= lo ? hi - lo : 0;
}

/** `segments` keeping only cells off the line, re-indexed from 0. */
function pendingSegments(grid: VoxelGrid, segments: readonly RampSegmentDef[]): RampSegmentDef[] {
  const out: RampSegmentDef[] = [];
  for (const segment of segments) {
    const cells = segment.cells.filter(cell => isRampCellPending(grid, cell));
    if (cells.length > 0) out.push({ ...segment, index: out.length, cells });
  }
  return out;
}

/**
 * `segments` without the cells another built ramp owns: a tile inside an older (lower-id) ramp's corridor is that
 * ramp's ground (`findRampAtTile`). Two ramps sharing a row at different heights each re-cut it to their own line
 * otherwise, and every repair damaged the other ramp again (#2091).
 */
function ownCells(segments: readonly RampSegmentDef[], ramp: BuiltRamp, builtRamps: readonly BuiltRamp[]): RampSegmentDef[] {
  return segments.map(segment => ({
    ...segment,
    cells: segment.cells.filter(cell => (findRampAtTile(builtRamps, cell.x, cell.z)?.id ?? ramp.id) >= ramp.id),
  }));
}

/**
 * What repairing `ramp` takes on `grid` now, without changing anything. Refused when the ramp is intact (its ground
 * strays from its line by no more than RAMP_REPAIR_TOLERANCE_M in shape) and when, landed on a floor a later shot
 * deepened, it no longer reaches that floor within the cut limit: the player then needs a longer ramp, not a repair.
 * A damaged ramp is re-cut whole: every cell off the line, however slightly, so the repaired floor is one line.
 * Cells an older ramp in `builtRamps` covers are left to that ramp (`ownCells`).
 */
export function quoteRampRepair(grid: VoxelGrid, ramp: BuiltRamp, builtRamps: readonly BuiltRamp[] = []): RepairResult<RampRepairQuote> {
  const def = landRampOnGrid(grid, { ...ramp.def, width: ramp.width });
  const geometry = validateRampOrder(def, Infinity);
  if (!geometry.success) {
    return failure(`Ramp #${ramp.id} no longer reaches its floor: build a longer ramp.`, 'mining.repair_ramp.out_of_reach', { id: ramp.id });
  }
  const line = ownCells(defineRampSegments(grid, def), ramp, builtRamps);
  const segments = offLineSpread(grid, line) > RAMP_REPAIR_TOLERANCE_M ? pendingSegments(grid, line) : [];
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
  const quote = quoteRampRepair(grid, ramp, state.builtRamps);
  if (!quote.success) return quote;
  const { def, segments, cost, cells } = quote.data;
  if (state.cash < cost) return failure(`Insufficient funds: need ${cost}`, 'mining.repair_ramp.short_funds', { id: rampId, cost: formatMoney(cost) });
  const plannedRampId = queueRampOrder(state, def, rampFootprint(def, ramp.width), segments, cost, 'Repair ramp', { repairOf: rampId });
  if (plannedRampId === null) return failure('Nothing to excavate for this ramp', 'mining.ramp.nothing_to_dig');
  return { success: true, data: { plannedRampId, cost, cells } };
}
