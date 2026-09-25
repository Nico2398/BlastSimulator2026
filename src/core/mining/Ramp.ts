// BlastSimulator2026 — Ramp building system
// Ramps provide vehicle access to lower pit levels by carving sloped passages.
// Each ramp clears a diagonal column of voxels from surface to target depth.

import { formatMoney } from '../economy/formatMoney.js';
import {
  computeVoxelColumnSurfaceHeight, computeVoxelColumnSurfaceY, captureColumnTopsForCarve,
  renormaliseCarvedColumns, resolveExposedCompId, setVoxelColumnSurfaceHeight, type VoxelGrid,
} from '../world/VoxelGrid.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { VehicleTier } from '../entities/Vehicle.js';
import { computeTaskDuration } from '../entities/EmployeeTaskDuration.js';
import {
  MAX_RAMP_LENGTH, NAV_MAX_SLOPE_DEGREES, RAMP_CUT_SLOPE_RATIO,
  RAMP_DIG_VOXELS_PER_TICK_TIER1, VEHICLE_TIER_MULTIPLIERS,
} from '../config/balance.js';

// ── Config ──

/** Cost per meter of ramp length in game dollars. */
// Real haul road construction: ~$50-200/m. Scaled for gameplay.
const RAMP_COST_PER_METER = 100;
/** Ramp width in voxels. */
const RAMP_WIDTH = 3;

// ── Types ──

export type RampDirection = 'north' | 'south' | 'east' | 'west';

export interface RampDef {
  originX: number;
  originZ: number;
  direction: RampDirection;
  length: number;
  /** Target depth (y level to reach). */
  targetDepth: number;
}

export interface RampResult {
  success: boolean;
  message: string;
  cost: number;
  voxelsCleared: number;
  /** Voxels raised (filled) to reach the straight floor line — see `RampSegmentDef.cells[i].fillTarget` (#1172). */
  voxelsFilled: number;
}

// ── Direction offsets ──

const DIR_OFFSETS: Record<RampDirection, { dx: number; dz: number }> = {
  north: { dx: 0, dz: -1 },
  south: { dx: 0, dz: 1 },
  east: { dx: 1, dz: 0 },
  west: { dx: -1, dz: 0 },
};

// ── Core function ──

/**
 * Build a ramp by clearing voxels to create a sloped passage.
 * The ramp starts at (originX, surface, originZ) and descends to targetDepth
 * over the given length. Width is fixed at RAMP_WIDTH.
 *
 * Mutates the VoxelGrid.
 * Returns the result including cost and voxels cleared.
 */
export function buildRamp(
  grid: VoxelGrid,
  ramp: RampDef,
  cash: number,
  emitter?: EventEmitter,
): RampResult {
  const validation = validateRampOrder(ramp, cash);
  if (!validation.success) {
    return { success: false, message: validation.message, cost: 0, voxelsCleared: 0, voxelsFilled: 0 };
  }

  const segments = defineRampSegments(grid, ramp);

  let voxelsCleared = 0;
  let voxelsFilled = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;

  for (const segment of segments) {
    const result = carveRampSegment(grid, segment);
    voxelsCleared += result.voxelsCleared;
    voxelsFilled += result.voxelsFilled;
    if (segment.region && (result.voxelsCleared > 0 || result.voxelsFilled > 0)) {
      minX = Math.min(minX, segment.region.minX); maxX = Math.max(maxX, segment.region.maxX);
      minY = Math.min(minY, segment.region.minY); maxY = Math.max(maxY, segment.region.maxY);
      minZ = Math.min(minZ, segment.region.minZ); maxZ = Math.max(maxZ, segment.region.maxZ);
    }
  }

  if (voxelsCleared > 0 || voxelsFilled > 0) {
    emitter?.emit('terrain:updated', { region: { minX, maxX, minY, maxY, minZ, maxZ } });
  }

  const message = voxelsFilled > 0
    ? `Ramp built: ${ramp.length}m ${ramp.direction}, ${voxelsCleared} voxels cleared, ${voxelsFilled} voxels filled`
    : `Ramp built: ${ramp.length}m ${ramp.direction}, ${voxelsCleared} voxels cleared`;

  return {
    success: true,
    message,
    cost: validation.cost,
    voxelsCleared,
    voxelsFilled,
  };
}

// ── Local column surface resolution ──

/**
 * Resolve the local surface Y for column (x, z) — the highest voxel with
 * density >= 0.5, for this module's own voxel-indexed excavation math.
 * Deliberately the integer voxel index, independent of
 * `NavGrid.computeSurfaceY`'s contract, which returns continuous
 * marching-cubes metres (#1149) — ramp carving here stays voxel-indexed.
 * Delegates to VoxelGrid.computeVoxelColumnSurfaceY (a leaf-module free
 * function) so core/mining doesn't need to import from core/nav (core/nav
 * already depends on core/mining — DrillPlan, BlastExecution — so the
 * reverse edge would cycle). Returns -1 if the column is entirely void.
 */
function computeColumnSurfaceY(grid: VoxelGrid, x: number, z: number): number {
  // TODO(#1184): computeVoxelColumnSurfaceY can return null (no-ground
  // column) once its real body lands — this `?? -1` is the placeholder
  // shim, not the final "no ground" handling.
  return computeVoxelColumnSurfaceY(grid, x, z) ?? -1;
}

export { RAMP_COST_PER_METER, RAMP_WIDTH };

// ── Ordered ramp excavation (#555 — order-then-work, mirrors #554) ──

/** Result of {@link validateRampOrder}. */
export interface RampOrderValidation {
  success: boolean;
  /** Plain-English fallback message for a caller that doesn't translate. */
  message: string;
  cost: number;
  /**
   * Translation key for `message`, present only on the length-bound
   * failures — mirrors BlastPlan.ts's `ValidationError.issue` (#633): core
   * carries the key, the console/UI layer resolves it with `t()`. Absent
   * (falls back to `message`) for the cash/depth checks below, matching
   * their pre-existing untranslated behavior.
   */
  messageKey?: string;
  messageParams?: Record<string, string | number>;
}

/**
 * Validate a ramp order against `cash` without carving anything — the
 * order-time check `buildRampCommand` runs before queuing excavation work.
 * Same length/depth/cash checks and messages `buildRamp` has always run,
 * extracted so order-time validation and progressive excavation share one
 * source of truth (#555).
 *
 * The finite/positive and MAX_RAMP_LENGTH checks run first, ahead of the
 * cost/depth checks, and ahead of any footprint or claim work a caller does
 * with `ramp.length` — this is the sole bound on ramp length, not a mirror
 * of one in the console command, so every caller of `buildRamp` gets it for
 * free (#788 point 3).
 */
export function validateRampOrder(ramp: RampDef, cash: number): RampOrderValidation {
  if (!Number.isFinite(ramp.length) || ramp.length < 1) {
    return {
      success: false,
      message: 'Invalid ramp length: length must be a finite positive number.',
      cost: 0,
      messageKey: 'mining.build_ramp.invalid_length',
    };
  }

  if (ramp.length > MAX_RAMP_LENGTH) {
    return {
      success: false,
      message: `Ramp too long: ${ramp.length}m exceeds the ${MAX_RAMP_LENGTH}m limit per ramp.`,
      cost: 0,
      messageKey: 'mining.build_ramp.too_long',
      messageParams: { length: ramp.length, limit: MAX_RAMP_LENGTH },
    };
  }

  if (ramp.targetDepth <= 0) {
    return { success: false, message: 'Target depth must be positive', cost: 0 };
  }

  const minLength = computeMinimumRampLength(ramp.targetDepth);
  if (ramp.length < minLength - RAMP_MIN_LENGTH_EPSILON) {
    const displayMinLength = Math.ceil(minLength);
    return {
      success: false,
      message: `Ramp too short: ${ramp.targetDepth}m of depth needs at least ${displayMinLength}m of length to stay within the ${NAV_MAX_SLOPE_DEGREES}° slope limit (got ${ramp.length}m).`,
      cost: 0,
      messageKey: 'mining.build_ramp.slope_too_steep',
      messageParams: {
        depth: ramp.targetDepth, minLength: displayMinLength, length: ramp.length, maxDegrees: NAV_MAX_SLOPE_DEGREES,
      },
    };
  }

  const totalCost = ramp.length * RAMP_COST_PER_METER;

  if (cash < totalCost) {
    return { success: false, message: `Insufficient funds: need $${formatMoney(totalCost)}, have $${formatMoney(cash)}`, cost: 0 };
  }

  return { success: true, message: '', cost: totalCost };
}

/**
 * Float tolerance for the minimum-ramp-length check above — same scale and
 * purpose as `FLOOR_TARGET_EPSILON` below: a requested `length` landing
 * within this of the computed minimum is float rounding, not a genuine
 * shortfall, and still validates (#1152).
 */
const RAMP_MIN_LENGTH_EPSILON = 1e-6;

/**
 * Float tolerance for the fill-column decision in `defineRampSegments`'s
 * Pass 1 (#1172) — same scale and purpose as `RAMP_MIN_LENGTH_EPSILON`
 * above and `FLOOR_TARGET_EPSILON` below: a column whose surface sits within
 * this of the straight `floorY` line is a cut column reading fractionally
 * low from float noise, not a genuine dip needing a fill.
 */
const RAMP_FILL_EPSILON = 1e-6;

/** One excavation segment of an ordered ramp — the unit a `dig_ramp_segment` PendingAction carves. */
export interface RampSegmentDef {
  /** Layer index, 0 = topmost/shallowest, increasing = deeper (#925). */
  index: number;
  /**
   * `floorAdjustment`, present only on a cell that is its column's own last
   * (lowest) contributing row — i.e. the row `carveRampSegment`/
   * `carveRampSegmentSlice` leave as that column's final exposed top once
   * cleared — carries the metres to raise that hard, full-voxel top by to
   * reach the ramp's true continuous per-column depth (#1151). Computed
   * once, in `defineRampSegments`'s Pass 1/2, against the pristine pre-dig
   * grid, because it depends on that column's original surface height,
   * which later carve calls (running against an already-partially-dug grid)
   * can no longer recover.
   */
  cells: {
    x: number; y: number; z: number; floorAdjustment?: number;
    /**
     * Present only on a fill column's floor-row cell (#1172) — the absolute
     * continuous height that column's floor-row band must be raised to, to
     * reach the ramp's straight `floorY` line where existing terrain dips
     * below it. Mutually exclusive with `floorAdjustment`: a cell either
     * carves down to the line (`floorAdjustment`) or fills up to it
     * (`fillTarget`), never both.
     */
    fillTarget?: number;
  }[];
  region: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null;
  /** Anchor X for ghost/dispatch, valid even when `region` is null. */
  targetX: number;
  /** Anchor Z for ghost/dispatch, valid even when `region` is null. */
  targetZ: number;
  /** Anchor Y — the layer's absolute world Y — valid even when `region` is null. */
  targetY: number;
}

/** One column's per-step floor/ceiling geometry — Pass 1 of {@link defineRampSegments}. */
interface RampColumn {
  cx: number;
  cz: number;
  floorY: number;
  ceilingY: number;
  /** Integer row of this column's own last (lowest) contributing cell — `Math.ceil(floorY)`. */
  floorRowY: number;
  /** `RampSegmentDef.cells[i].floorAdjustment` for this column's floor-row cell — see that field's doc. */
  floorAdjustment: number;
  /** True when this column's existing terrain dips below the ramp's straight `floorY` line, requiring a fill rather than a cut (#1172). */
  isFillColumn: boolean;
}

/**
 * Split `ramp` into per-layer (bench) excavation work, one segment per
 * `dig_ramp_segment` PendingAction (#925 — reworked from one segment per
 * column/step to one segment per horizontal layer, so a half-dug ramp is a
 * flat surface at some intermediate depth across the whole footprint,
 * instead of a full-depth notch at the entrance).
 *
 * Two passes, using the exact same per-column floor/ceiling/width math the
 * original column-grouped version used (so the final voxel set carved is
 * identical — only the grouping/order changes):
 *
 * Pass 1 computes, for every column `step` along the ramp's length, the same
 * `cx`/`cz`/`surfaceY`/`floorY`/`ceilingY` the old per-step loop computed.
 *
 * Pass 2 walks `y` from the highest ceiling down to the lowest floor across
 * all columns, one segment per `y`. A column contributes at `y` when
 * `floorY <= y < ceilingY`; every contributing column's width band
 * (`-halfWidth..halfWidth` perpendicular to the ramp direction, same as
 * before) is checked for solid cells at that `y`. `region` is the bounding
 * box of actual solid cells (null if none); `targetX`/`targetZ` are the
 * center of the *band* of contributing column positions (regardless of
 * solidity), so they're finite for every EMITTED segment — but on uneven
 * terrain (e.g. a footprint crossing a plateau/canyon/plateau) different
 * columns can have disjoint `[floorY, ceilingY)` ranges, so a `y` in
 * `[globalMinY, globalMaxY]` is not guaranteed to have any contributing
 * column. A `y` with zero contributors has nothing carve-able anywhere in
 * the footprint and is skipped — not emitted with a null/invalid band —
 * so `index` still increases 0..N-1 with no gaps across emitted segments,
 * and `targetY` still strictly decreases across them.
 */
/**
 * Continuous dig depth at column `step` of `length` toward `targetDepth` —
 * no longer floored to a whole voxel (#1151), so `defineRampSegments`'s
 * Pass 1 can derive each column's exact continuous `floorY` and, from it,
 * the `floorAdjustment` its floor-row cell carries.
 */
function computeRampColumnDepth(step: number, length: number, targetDepth: number): number {
  return (step / length) * targetDepth;
}

/**
 * Shortest ramp length that reaches `targetDepth` without the floor's
 * rise-per-metre-of-run exceeding `RAMP_CUT_SLOPE_RATIO` (#1152).
 */
export function computeMinimumRampLength(targetDepth: number): number {
  if (targetDepth <= 0) return 0;
  return targetDepth / RAMP_CUT_SLOPE_RATIO;
}

export function defineRampSegments(grid: VoxelGrid, ramp: RampDef): RampSegmentDef[] {
  const offset = DIR_OFFSETS[ramp.direction];
  const perpDx = offset.dz !== 0 ? 1 : 0;
  const perpDz = offset.dx !== 0 ? 1 : 0;
  const halfWidth = Math.floor(RAMP_WIDTH / 2);
  const clearanceHeight = 3;

  // Pass 1 — per-column floor/ceiling geometry, plus (#1151) each column's
  // `floorRowY`/`floorAdjustment`: `currentDepth` is no longer floored to a
  // whole voxel, so `floorY` is the ramp's true continuous target for this
  // column, computed here against the still-pristine pre-dig grid — the one
  // point in this whole excavation where that original surface height is
  // still readable. `floorAdjustment` (gap between the carve's hard integer
  // floor and this continuous target) rides along on the one cell
  // (`floorRowY`) that carve time can identify as "this column is now done".
  //
  // (#1152) `floorY` descends at a constant, continuous rise-per-metre-of-run
  // from the ramp's own origin surface elevation (`rawSurfaceY[0]`), not from
  // each column's own local surface — a per-column floor read follows local
  // terrain noise into a non-monotonic, jagged line, steeper than
  // NAV_MAX_SLOPE_RATIO between two adjacent columns even though the ramp's
  // own overall grade is gentle, stranding an employee at the ramp's own
  // deepest carved column with no legal step back to the surface.
  // `validateRampOrder`'s slope check (`computeMinimumRampLength`) is what
  // keeps this straight line's own grade within `RAMP_CUT_SLOPE_RATIO`, so no
  // per-column smoothing is needed here anymore. `ceilingY` (headroom) keeps
  // reading each column's own raw local surface height — clearance above the
  // floor must track actual local terrain, only the floor is a straight line.
  const columns: RampColumn[] = [];
  let globalMinY = Infinity;
  let globalMaxY = -Infinity;

  const rawSurfaceY: number[] = [];
  for (let step = 0; step < ramp.length; step++) {
    const cx = ramp.originX + offset.dx * step;
    const cz = ramp.originZ + offset.dz * step;
    rawSurfaceY.push(computeColumnSurfaceY(grid, cx, cz));
  }
  const originSurfaceY = rawSurfaceY[0]!;

  for (let step = 0; step < ramp.length; step++) {
    const currentDepth = computeRampColumnDepth(step, ramp.length, ramp.targetDepth);
    const cx = ramp.originX + offset.dx * step;
    const cz = ramp.originZ + offset.dz * step;

    const surfaceY = rawSurfaceY[step]!;

    const floorY = originSurfaceY - currentDepth;
    // Math.max(surfaceY, floorY): a column whose terrain dips below the
    // straight floor line still needs ceilingY above floorY, or the dip's
    // fill row (at/above floorY) falls outside [floorY, ceilingY) and Pass 2
    // silently skips it (#1172). Existing (non-dip) columns always have
    // surfaceY >= floorY, so this is a no-op there.
    const ceilingY = Math.max(surfaceY, floorY) + clearanceHeight;
    // Always in (0, 1] — see RampSegmentDef.cells' floorAdjustment doc.
    const floorAdjustment = 1 - (currentDepth - Math.floor(currentDepth));
    const isFillColumn = surfaceY < floorY - RAMP_FILL_EPSILON;

    columns.push({ cx, cz, floorY, ceilingY, floorRowY: Math.ceil(floorY), floorAdjustment, isFillColumn });
    globalMinY = Math.min(globalMinY, floorY);
    globalMaxY = Math.max(globalMaxY, ceilingY - 1);
  }

  // Pass 2 — one segment per y, top (globalMaxY) to bottom (globalMinY).
  const segments: RampSegmentDef[] = [];

  for (let y = globalMaxY; y >= globalMinY; y--) {
    const cells: RampSegmentDef['cells'] = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let bandMinX = Infinity, bandMaxX = -Infinity, bandMinZ = Infinity, bandMaxZ = -Infinity;

    for (const col of columns) {
      if (y < col.floorY || y >= col.ceilingY) continue;

      bandMinX = Math.min(bandMinX, col.cx); bandMaxX = Math.max(bandMaxX, col.cx);
      bandMinZ = Math.min(bandMinZ, col.cz); bandMaxZ = Math.max(bandMaxZ, col.cz);
      const isFloorRow = y === col.floorRowY;

      for (let w = -halfWidth; w <= halfWidth; w++) {
        const wx = col.cx + perpDx * w;
        const wz = col.cz + perpDz * w;

        let cell: RampSegmentDef['cells'][number] | undefined;
        if (col.isFillColumn && isFloorRow) {
          // Fill column, floor row: nothing solid to gate on by definition
          // (this column's terrain dips below the straight floor line), so
          // bypass the density gate entirely and push a fillTarget cell
          // instead of the cut/floorAdjustment cell below (#1172).
          if (grid.containsColumn(wx, wz)) cell = { x: wx, y, z: wz, fillTarget: col.floorY };
        } else if (grid.densityAt(wx, y, wz) > 0) {
          cell = isFloorRow ? { x: wx, y, z: wz, floorAdjustment: col.floorAdjustment } : { x: wx, y, z: wz };
        }

        if (!cell) continue;
        cells.push(cell);
        minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
      }
    }

    // No column contributes at this y — a true gap between disjoint
    // per-column [floorY, ceilingY) ranges (possible on uneven terrain,
    // e.g. a footprint crossing a plateau/canyon/plateau). bandMinX etc.
    // are still at their Infinity/-Infinity sentinels, so there is no
    // finite band to derive targetX/targetZ from. Nothing carve-able
    // exists at this y for any column, so skip emitting a segment for it
    // entirely rather than pushing one with NaN target coordinates.
    if (bandMinX === Infinity) continue;

    segments.push({
      index: segments.length,
      cells,
      region: cells.length > 0 ? { minX, maxX, minY, maxY, minZ, maxZ } : null,
      // bandMinX/bandMaxX/bandMinZ/bandMaxZ are finite here — this y was
      // skipped above unless at least one column contributed.
      targetX: Math.round((bandMinX + bandMaxX) / 2),
      targetZ: Math.round((bandMinZ + bandMaxZ) / 2),
      targetY: y,
    });
  }

  return segments;
}

/** The subset of {@link RampSegmentDef} {@link carveRampSegment} actually reads — it never touches `index`/`targetX`/`targetZ`/`targetY`, so callers that only have cells/region (e.g. a completed segment's own tracker) don't need to fabricate the rest. */
type RampSegmentCarveInput = Pick<RampSegmentDef, 'cells' | 'region'>;

/**
 * Clear one cell into `grid` if still solid, counting it. Shared per-cell
 * step for {@link carveRampSegment} (which clears every cell of a segment
 * and already has a precomputed `region`) and {@link carveRampSegmentSlice}
 * (which clears a sub-range and derives `region` from the cells it actually
 * cleared) — the only two carve loops in this file, and the only thing they
 * duplicated (#946 review finding 1). Module-private: LevelGround.ts used to
 * reuse this for its own per-cell carve (#1009 review finding 2), but #1144's
 * continuous-height rewrite replaced that with column-based
 * setVoxelColumnSurfaceHeight writes (VoxelGrid.ts), so this cell-clearing
 * step no longer has a consumer outside Ramp.ts's own two carve loops.
 */
function carveCellIfSolid(grid: VoxelGrid, cell: { x: number; y: number; z: number }): boolean {
  if (grid.densityAt(cell.x, cell.y, cell.z) > 0) {
    grid.clearVoxel(cell.x, cell.y, cell.z);
    return true;
  }
  return false;
}

/**
 * Float round-trip tolerance for the floor-row idempotency check below —
 * mirrors `NavGrid.isStepClimbable`'s own `NAV_SLOPE_EPSILON` pattern: far
 * smaller than any real depth difference this check cares about, just
 * enough to keep a value that round-tripped through `setVoxelColumnSurfaceHeight`
 * and back from reading as fractionally *above* its own just-written target.
 */
const FLOOR_TARGET_EPSILON = 1e-6;

/**
 * Whether `cell` (a cut or fill cell of a ramp segment) still has work
 * outstanding against `grid` — a cut cell pending while still solid, a fill
 * cell pending while its column's floor is still below `fillTarget`. Direction-
 * agnostic replacement for `ActionSelection.ts`'s inline `densityAt(...) > 0`
 * filter, which only recognised the cut case (#1172).
 */
export function isRampCellPending(grid: VoxelGrid, cell: RampSegmentDef['cells'][number]): boolean {
  if (cell.fillTarget !== undefined) {
    const currentHeight = computeVoxelColumnSurfaceHeight(grid, cell.x, cell.z);
    return Number.isFinite(currentHeight) && currentHeight < cell.fillTarget - FLOOR_TARGET_EPSILON;
  }
  return grid.densityAt(cell.x, cell.y, cell.z) > 0;
}

/**
 * Carve one ramp cell, additionally banding its column's floor immediately
 * when this cell is that column's own final (lowest) row — carries a
 * `floorAdjustment` — to the ramp's true continuous depth (#1151), instead
 * of leaving the hard, full-voxel step a plain clear produces.
 *
 * Idempotent for a floor-row cell specifically, which a plain density>0
 * check is not here: banding deliberately leaves that exact cell at a small
 * *nonzero* residual density (the crossing band's own far side —
 * `setVoxelColumnSurfaceHeight`'s round-trip guarantee needs it, not an
 * accident), so a naive re-check would see it as "still solid" and clear it
 * right back to zero, silently erasing the band. This used to gate on
 * `densityAt(...) !== 1` ("untouched rock, never a banded value") — wrong
 * (#1166): natural terrain's own marching-cubes surface crossing is
 * fractional exactly like a banded target is, so a shallow-depth column
 * whose floor row landed inside that same never-touched crossing band read
 * as "already banded" and was silently skipped, staying at its full natural
 * height while neighbouring columns carved down on schedule — the resulting
 * cliff between them is what stranded an employee with no legal step back to
 * the surface. Gating instead on "this column's own continuous surface
 * height is already at or below the ramp's intended floor for it" is
 * idempotent the same way (a repeat carve of an already-banded column reads
 * back at its own target, so it's skipped) without that false positive —
 * pristine natural terrain always reads *above* the ramp's intended floor
 * the first time a column is carved, whatever its density's exact value.
 */
function carveRampCell(
  grid: VoxelGrid,
  cell: { x: number; y: number; z: number; floorAdjustment?: number; fillTarget?: number },
): { cleared: boolean; bandedMaxY: number | null; filled: boolean } {
  if (cell.fillTarget !== undefined) {
    // Fill column's floor row (#1172): nothing to clear, this column's
    // terrain dips below the ramp's straight floor line — raise it to the
    // line instead. Idempotent via isRampCellPending's own currentHeight
    // check, so a re-armed slice doesn't re-fill an already-filled column.
    if (!isRampCellPending(grid, cell)) return { cleared: false, bandedMaxY: -1, filled: false };
    const compId = resolveExposedCompId(grid, cell.x, cell.z, cell.fillTarget);
    const touchedMaxY = setVoxelColumnSurfaceHeight(grid, cell.x, cell.z, cell.fillTarget, compId);
    return { cleared: false, bandedMaxY: touchedMaxY, filled: true };
  }

  if (cell.floorAdjustment === undefined) {
    if (!isRampCellPending(grid, cell)) return { cleared: false, bandedMaxY: -1, filled: false };
    grid.clearVoxel(cell.x, cell.y, cell.z);
    return { cleared: true, bandedMaxY: -1, filled: false };
  }

  // The absolute continuous target this floor-row cell bands to once
  // cleared: `cell.y` is the floor row itself, so the row exposed directly
  // below it (`cell.y - 1`) is this column's carved top once `cell.y` is
  // cleared, banded up by `floorAdjustment` — the same arithmetic
  // `bandRampFloorColumn` used to redo from a post-clear rescan, computed
  // up front here instead so the idempotency check below can run *before*
  // clearing anything.
  const intendedTarget = (cell.y - 1) + cell.floorAdjustment;
  const currentHeight = computeVoxelColumnSurfaceHeight(grid, cell.x, cell.z);
  if (Number.isFinite(currentHeight) && currentHeight <= intendedTarget + FLOOR_TARGET_EPSILON) {
    return { cleared: false, bandedMaxY: -1, filled: false };
  }

  if (!carveCellIfSolid(grid, cell)) return { cleared: false, bandedMaxY: -1, filled: false };
  return { cleared: true, bandedMaxY: bandRampFloorColumn(grid, cell.x, cell.z, intendedTarget), filled: false };
}

/**
 * Carve one ramp segment's cells into `grid`, emitting `terrain:updated` for
 * the affected region. Density is re-checked per cell at carve time — a cell
 * already cleared by something else (a blast, another ramp) since
 * `defineRampSegments` ran is silently skipped, not double-counted, not an
 * error.
 */
export function carveRampSegment(grid: VoxelGrid, segment: RampSegmentCarveInput, emitter?: EventEmitter): { voxelsCleared: number; voxelsFilled: number } {
  let voxelsCleared = 0;
  let voxelsFilled = 0;
  let bandedMaxY = -1;
  // Fill cells excluded: captureColumnTopsForCarve/renormaliseCarvedColumns'
  // sweep assumes a column's top only ever drops after a carve; a freshly
  // filled column's top rises, and the sweep would clip it back down (#1172).
  const carvedColumns = captureColumnTopsForCarve(grid, segment.cells.filter(c => c.fillTarget === undefined));

  for (const cell of segment.cells) {
    const result = carveRampCell(grid, cell);
    if (result.cleared) voxelsCleared++;
    if (result.filled) voxelsFilled++;
    // TODO(#1184): result.bandedMaxY can be null (no-ground column) once
    // the real bodies land — this `?? -1` is the placeholder shim.
    bandedMaxY = Math.max(bandedMaxY, result.bandedMaxY ?? -1);
  }

  if ((voxelsCleared > 0 || bandedMaxY >= 0) && segment.region) {
    const renormalisedMaxY = renormaliseCarvedColumns(grid, carvedColumns);
    const region = {
      ...segment.region,
      maxY: Math.max(segment.region.maxY, renormalisedMaxY ?? -Infinity, bandedMaxY),
    };
    emitter?.emit('terrain:updated', { region });
  }

  return { voxelsCleared, voxelsFilled };
}

/**
 * Re-band column (x, z)'s floor from the hard, full-voxel step a ramp's
 * per-cell carve necessarily leaves it at, to the exact continuous `target`
 * depth (#1151). Without this, NavGrid's slope gate (`isStepClimbable`,
 * `NAV_MAX_SLOPE_RATIO`) sees a staircase of full-metre risers between
 * adjacent 1m-spaced ramp columns — a 45-degree step at every place the
 * integer voxel depth increments, however gently graded the ramp is
 * overall, since a per-column depth only ever *selects* whole voxels to
 * clear; nothing about that selection changes which voxel the per-cell
 * carve leaves solid.
 *
 * Called from {@link carveRampCell} immediately after it clears a column's
 * own final row — the moment (and only the moment) that column is done, its
 * floor can be banded, whether that carve came from one whole-segment call
 * or the last of many progressive slices. This is also what keeps an
 * in-progress ramp's already-finished prefix walkable while the rest is
 * still being dug, rather than only banding once the entire ramp completes.
 * `target` is computed by the caller up front (#1166 — `cell.y - 1 +
 * floorAdjustment`), not re-derived here from a post-clear rescan, so
 * `carveRampCell`'s own idempotency check can compare against the identical
 * value before ever touching the grid.
 *
 * Returns the highest Y touched (for the caller's own `terrain:updated`
 * region), or -1 when the column carved to nothing.
 */
function bandRampFloorColumn(grid: VoxelGrid, x: number, z: number, target: number): number | null {
  // TODO(#1184): computeVoxelColumnSurfaceY can return null (no-ground
  // column) once its real body lands — this `?? -1` is the placeholder
  // shim, not the final "no ground" handling.
  if ((computeVoxelColumnSurfaceY(grid, x, z) ?? -1) < 0) return -1;

  const compId = resolveExposedCompId(grid, x, z, target);
  return setVoxelColumnSurfaceHeight(grid, x, z, target, compId);
}

/**
 * Progressive carve target (#946) — how many of a segment's `totalCells`
 * should be carved given `ticksElapsed` of `totalTicks` work. 0 at 0%
 * progress, `totalCells` at 100%, clamped in between. `totalTicks <= 0`
 * guards against a zero-duration segment by returning `totalCells` (fully
 * carved immediately) rather than dividing by zero.
 */
export function computeRampSegmentCarveTarget(totalCells: number, ticksElapsed: number, totalTicks: number): number {
  if (totalTicks <= 0) return totalCells;
  const progress = Math.min(1, Math.max(0, ticksElapsed / totalTicks));
  return Math.floor(progress * totalCells);
}

/**
 * Carve only `cells[fromIndex, toIndex)` of a ramp segment into `grid`
 * (#946 — progressive carving in step with the action's own tick progress,
 * instead of all at once on completion via {@link carveRampSegment}).
 * Mirrors `carveRampSegment`'s density re-check and `terrain:updated` emit,
 * scoped to only the region of cells actually cleared by this slice.
 */
export function carveRampSegmentSlice(
  grid: VoxelGrid,
  cells: RampSegmentDef['cells'],
  fromIndex: number,
  toIndex: number,
  emitter?: EventEmitter,
): { voxelsCleared: number; voxelsFilled: number; region: RampSegmentDef['region'] } {
  let voxelsCleared = 0;
  let voxelsFilled = 0;
  let bandedMaxY = -1;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;

  // Fill cells excluded — see carveRampSegment's identical exclusion (#1172).
  const carvedColumns = captureColumnTopsForCarve(grid, cells.slice(fromIndex, toIndex).filter(c => c.fillTarget === undefined));

  for (let i = fromIndex; i < toIndex; i++) {
    const cell = cells[i];
    if (!cell) continue;
    const result = carveRampCell(grid, cell);
    // TODO(#1184): result.bandedMaxY can be null (no-ground column) once
    // the real bodies land — this `?? -1` is the placeholder shim.
    bandedMaxY = Math.max(bandedMaxY, result.bandedMaxY ?? -1);
    if (result.cleared) voxelsCleared++;
    if (result.filled) voxelsFilled++;
    if (result.cleared || (result.bandedMaxY ?? -1) >= 0) {
      minX = Math.min(minX, cell.x); maxX = Math.max(maxX, cell.x);
      minY = Math.min(minY, cell.y); maxY = Math.max(maxY, cell.y);
      minZ = Math.min(minZ, cell.z); maxZ = Math.max(maxZ, cell.z);
    }
  }

  if (voxelsCleared > 0 || bandedMaxY >= 0) {
    const renormalisedMaxY = renormaliseCarvedColumns(grid, carvedColumns);
    maxY = Math.max(maxY, renormalisedMaxY ?? -Infinity, bandedMaxY);
  }

  const region = (voxelsCleared > 0 || bandedMaxY >= 0) ? { minX, maxX, minY, maxY, minZ, maxZ } : null;

  if (region) {
    emitter?.emit('terrain:updated', { region });
  }

  return { voxelsCleared, voxelsFilled, region };
}

/**
 * Work-duration ticks for a `rock_digger` of `tier` to carve `voxelCount`
 * voxels — a ramp segment's or a level-ground order's, both the same
 * "clear this many solid cells" shape, so the two `dig_ramp_segment`/
 * `level_ground` PendingAction types share this one formula rather than each
 * defining an identical copy (#1009 review finding 1; ActionSelection.ts's
 * `computeActionWorkTicks` calls this for both). Scales inversely with the
 * tier's workRate multiplier (VEHICLE_TIER_MULTIPLIERS) against the tier-1
 * baseline rate (RAMP_DIG_VOXELS_PER_TICK_TIER1), always at least 1 tick — a
 * zero-voxel segment (row already flat) still takes a tick to "dig".
 *
 * `proficiencyLevel`/`needMultiplier`/`lqMultiplier` feed the same
 * `computeTaskDuration` formula every other skill-gated task duration uses
 * (#924) — defaults of `1, 1, 1` reproduce the pre-#924 baseline
 * (`Math.max(1, Math.ceil(voxelCount/(rate*tierMult)))`) exactly for any
 * caller that doesn't pass them.
 */
export function computeRampSegmentDurationTicks(
  voxelCount: number,
  tier: VehicleTier,
  proficiencyLevel: 1 | 2 | 3 | 4 | 5 = 1,
  needMultiplier: number = 1,
  lqMultiplier: number = 1,
): number {
  const tierWorkRateMultiplier = VEHICLE_TIER_MULTIPLIERS[tier].workRate;
  const baseTicks = voxelCount / (RAMP_DIG_VOXELS_PER_TICK_TIER1 * tierWorkRateMultiplier);
  return computeTaskDuration(baseTicks, proficiencyLevel, needMultiplier, lqMultiplier, 1);
}
