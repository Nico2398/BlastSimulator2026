// BlastSimulator2026 — Pathfinding: A* route finding over the NavGrid
// Part of the navmesh system.

import { NavGrid } from './NavGrid.js';
import type { NavCell } from './NavGrid.js';
import { pathfindingNodeBudget } from '../config/balance.js';

/**
 * Describes a pathfinding request from one grid cell to another.
 * Coordinates are in NavGrid cell space (x = column, z = row).
 */
export interface PathRequest {
  agentId: number;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  avoidVehicles: boolean;
}

/**
 * The result of a pathfinding attempt.
 * If `found` is false the `waypoints` array will be empty.
 */
export interface PathResult {
  found: boolean;
  waypoints: Array<{ x: number; z: number }>;
  totalCost: number;
}

/**
 * Describes a ramp cell connecting two different bench levels in the NavGrid.
 * Each ramp has an upper-level neighbor and a lower-level neighbor that agents
 * can path through to transition between levels.
 */
export interface RampConnection {
  rampX: number;
  rampZ: number;
  upperLevel: number;
  lowerLevel: number;
  upperX: number;
  upperZ: number;
  lowerX: number;
  lowerZ: number;
}

/** 8-directional neighbour offsets as [dx, dz] pairs. */
const NEIGHBOUR_OFFSETS: readonly [number, number][] = [
  [0, -1], [0, 1], [-1, 0], [1, 0],   // cardinal
  [-1, -1], [1, -1], [-1, 1], [1, 1], // diagonal
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum move cost for a walkable cell (used for heuristic lower bound). */
const MIN_WALKABLE_COST = 1.0;

/**
 * Tolerance factor for the pre-A* direct-line check.
 * If the direct-line path cost is within this factor of the heuristic lower
 * bound, we consider it optimal enough to skip A* entirely.
 */
const DIRECT_LINE_TOLERANCE = 1.1;

/**
 * Heuristic inflation for the A* main loop (#458 T6.2/D14). Any obstacle
 * sitting directly on the optimal route between two far-apart points — a
 * blast crater, a cluster of 'void' cells, a cracked outcrop — puts many
 * detour cells within a hair of the true optimal f-score once the goal is
 * 100+ cells away, since a short lateral step barely changes an admissible
 * octile estimate to a distant goal. Plain A* then re-expands that whole
 * near-tied frontier before it can be sure it found the optimal path: a
 * 20-cell obstacle directly on a 160×160 cross-map route measured at 6100+
 * explored nodes with weight 1.0 — nearly double pathfindingNodeBudget's own
 * scaled cap — and grows worse with obstacle size, well past what any
 * plausible node budget for this grid size should have to absorb. Inflating
 * the heuristic (standard weighted-A*, trading a little optimality for a lot
 * less exploration) cuts that same case to a fraction of the budget; 1.3 was
 * the smallest weight that kept a 40-cell obstacle — bigger than any single
 * blast crater or drill-grid clearance produces — within budget in measurement.
 * Applied to the A* loop's own priority only, never to the direct-line
 * fast-path's lower-bound check above, which needs the true admissible
 * heuristic to stay a valid bound.
 */
const ASTAR_HEURISTIC_WEIGHT = 1.3;

// ---------------------------------------------------------------------------
// Internal binary min-heap (generic)
// ---------------------------------------------------------------------------

/**
 * A simple binary min-heap. Items are ordered by their `key` property.
 */
class MinHeap<T extends { key: number }> {
  private _heap: T[] = [];

  get size(): number {
    return this._heap.length;
  }

  push(item: T): void {
    this._heap.push(item);
    this._siftUp(this._heap.length - 1);
  }

  pop(): T | undefined {
    if (this._heap.length === 0) return undefined;
    const top = this._heap[0]!;
    const last = this._heap.pop()!;
    if (this._heap.length > 0) {
      this._heap[0] = last;
      this._siftDown(0);
    }
    return top;
  }

  // --- private helpers ---

  private _siftUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this._heap[idx]!.key >= this._heap[parent]!.key) break;
      [this._heap[idx], this._heap[parent]] = [this._heap[parent]!, this._heap[idx]!];
      idx = parent;
    }
  }

  private _siftDown(idx: number): void {
    const size = this._heap.length;
    while (true) {
      let smallest = idx;
      const left = (idx << 1) + 1;
      const right = left + 1;
      if (left < size && this._heap[left]!.key < this._heap[smallest]!.key) smallest = left;
      if (right < size && this._heap[right]!.key < this._heap[smallest]!.key) smallest = right;
      if (smallest === idx) break;
      [this._heap[idx], this._heap[smallest]] = [this._heap[smallest]!, this._heap[idx]!];
      idx = smallest;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check whether a cell blocks traversal. */
function isImpassable(cell: NavCell, avoidVehicles: boolean): boolean {
  if (cell.type === 'blocked' || cell.type === 'void') return true;
  if (avoidVehicles && cell.vehicleOccupied) return true;
  return false;
}

/** Octile distance heuristic. */
export function octileHeuristic(ax: number, az: number, bx: number, bz: number): number {
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
}

/**
 * Flat row-major index for a WORLD coordinate pair — also the A* scratch
 * arrays' index space. The grid's origin is subtracted here, so a site that
 * has grown west or north (#473) indexes from 0 all the same.
 */
function cellIndex(grid: NavGrid, x: number, z: number): number {
  return (z - grid.originZ) * grid.width + (x - grid.originX);
}

/** Inverse of `cellIndex`: the world coordinates a flat index refers to. */
function cellCoords(grid: NavGrid, index: number): { x: number; z: number } {
  return {
    x: grid.originX + (index % grid.width),
    z: grid.originZ + ((index / grid.width) | 0),
  };
}

// ---------------------------------------------------------------------------
// A* scratch arrays (#458 T6.2/D14)
// ---------------------------------------------------------------------------
//
// Per-search Map<number, number> allocation was the dominant A* cost once
// D13's bigger levels (up to 160×160, node budget scaled accordingly — see
// pathfindingNodeBudget) meant every search could touch thousands of nodes:
// each Map.set/get is a hash-table operation, and a fresh Map per call
// discards all of that work as garbage immediately after. Flat typed arrays
// indexed by cellIndex(x, z, width) replace both gScore and cameFrom with
// direct array access, and a generation-stamp counter (currentStamp) marks
// which entries belong to the search in progress — a cell is "touched" iff
// stampArr[i] === currentStamp — without needing to clear the arrays between
// searches. Arrays live on module-level scratch, grown (never shrunk) to fit
// the largest grid seen; small early-game searches reuse the same buffers a
// later 160×160 search grew.
let scratchCapacity = 0;
let gScoreArr = new Float64Array(0);
let cameFromArr = new Int32Array(0);
let stampArr = new Int32Array(0);
let currentStamp = 0;

/** Grow the A* scratch arrays to at least `size` cells. Never shrinks. */
function ensureScratchCapacity(size: number): void {
  if (size <= scratchCapacity) return;
  scratchCapacity = size;
  gScoreArr = new Float64Array(size);
  cameFromArr = new Int32Array(size);
  stampArr = new Int32Array(size); // zero-filled; currentStamp starts at 1 so this never falsely reads as "touched"
}

/** Clamp a world coordinate pair into the grid's covered box. */
function clampToGrid(grid: NavGrid, x: number, z: number): { x: number; z: number } {
  return {
    x: Math.max(grid.originX, Math.min(grid.maxX - 1, Math.floor(x))),
    z: Math.max(grid.originZ, Math.min(grid.maxZ - 1, Math.floor(z))),
  };
}

// ---------------------------------------------------------------------------
// Direct-line fallback
// ---------------------------------------------------------------------------

/**
 * Walk a straight line from (x0,z0) to (x1,z1) using a DDA approach.
 * Returns waypoints for every cell along the line if all are passable, else null.
 */
function directLineWalk(
  grid: NavGrid,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  avoidVehicles: boolean,
): PathResult | null {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const steps = Math.max(Math.abs(dx), Math.abs(dz));
  if (steps === 0) {
    // start == goal
    return { found: true, waypoints: [{ x: x0, z: z0 }], totalCost: 0 };
  }

  const waypoints: { x: number; z: number }[] = [];
  let totalCost = 0;
  let prevX = x0;
  let prevZ = z0;

  for (let i = 0; i <= steps; i++) {
    const t = steps > 0 ? i / steps : 0;
    const cx = Math.round(x0 + dx * t);
    const cz = Math.round(z0 + dz * t);

    // Clamp to grid bounds
    const { x: clampedX, z: clampedZ } = clampToGrid(grid, cx, cz);

    const cell = grid.cellAt(clampedX, clampedZ)!;
    if (isImpassable(cell, avoidVehicles)) return null;

    // Accumulate cost (use octile distance between consecutive steps for accuracy)
    if (i > 0) {
      const stepDx = clampedX - prevX;
      const stepDz = clampedZ - prevZ;
      const isDiagonal = stepDx !== 0 && stepDz !== 0;
      totalCost += isDiagonal ? cell.moveCost * Math.SQRT2 : cell.moveCost;
    }

    waypoints.push({ x: clampedX, z: clampedZ });
    prevX = clampedX;
    prevZ = clampedZ;
  }

  return { found: true, waypoints, totalCost };
}

// ---------------------------------------------------------------------------
// Multi-level routing
// ---------------------------------------------------------------------------

export function getBenchLevel(grid: NavGrid, x: number, z: number): number {
  const clamped = clampToGrid(grid, x, z);
  return grid.cellAt(clamped.x, clamped.z)!.benchLevel;
}

export function findRampConnections(grid: NavGrid): RampConnection[] {
  const connections: RampConnection[] = [];

  for (let z = grid.originZ; z < grid.maxZ; z++) {
    for (let x = grid.originX; x < grid.maxX; x++) {
      const cell = grid.cellAt(x, z)!;
      if (cell.type !== 'ramp') continue;

      // Collect distinct bench levels among walkable neighbours
      const levelToNeighbor = new Map<number, { x: number; z: number }>();

      for (const [dx, dz] of NEIGHBOUR_OFFSETS) {
        const nx = x + dx;
        const nz = z + dz;
        const neighbor = grid.cellAt(nx, nz);
        if (!neighbor || neighbor.type === 'blocked' || neighbor.type === 'void') continue;

        const level = neighbor.benchLevel;
        // Keep first neighbor per level for determinism
        if (!levelToNeighbor.has(level)) {
          levelToNeighbor.set(level, { x: nx, z: nz });
        }
      }

      if (levelToNeighbor.size >= 2) {
        const levels = Array.from(levelToNeighbor.keys());
        const upperLevel = Math.max(...levels);
        const lowerLevel = Math.min(...levels);
        const upperPos = levelToNeighbor.get(upperLevel)!;
        const lowerPos = levelToNeighbor.get(lowerLevel)!;

        connections.push({
          rampX: x,
          rampZ: z,
          upperLevel,
          lowerLevel,
          upperX: upperPos.x,
          upperZ: upperPos.z,
          lowerX: lowerPos.x,
          lowerZ: lowerPos.z,
        });
      }
    }
  }

  return connections;
}

// Filter ramp connections that directly connect the given start and goal levels (in either direction).
function filterRampsForLevels(ramps: RampConnection[], startLevel: number, goalLevel: number): RampConnection[] {
  return ramps.filter(r =>
    (r.upperLevel === startLevel && r.lowerLevel === goalLevel) ||
    (r.upperLevel === goalLevel && r.lowerLevel === startLevel),
  );
}

// Concatenate two A* route waypoints via a ramp cell, removing duplicate cells
// at the join points so the path is contiguous.
function concatPaths(
  route1: PathResult,
  rampCell: { x: number; z: number },
  route2: PathResult,
): Array<{ x: number; z: number }> {
  const waypoints: Array<{ x: number; z: number }> = [...route1.waypoints];

  // Add ramp cell if not a duplicate of last waypoint from route1
  const lastR1 = route1.waypoints[route1.waypoints.length - 1];
  if (!lastR1 || lastR1.x !== rampCell.x || lastR1.z !== rampCell.z) {
    waypoints.push({ x: rampCell.x, z: rampCell.z });
  }

  // Append route2 waypoints, skipping duplicate first
  for (const wp of route2.waypoints) {
    const lastWp = waypoints[waypoints.length - 1];
    if (!lastWp || lastWp.x !== wp.x || lastWp.z !== wp.z) {
      waypoints.push(wp);
    }
  }

  return waypoints;
}

function findMultiLevelPath(grid: NavGrid, request: PathRequest): PathResult {
  const start = clampToGrid(grid, request.fromX, request.fromZ);
  const goal = clampToGrid(grid, request.toX, request.toZ);
  const sx = start.x, sz = start.z, gx = goal.x, gz = goal.z;
  const { avoidVehicles, agentId } = request;

  const startLevel = getBenchLevel(grid, sx, sz);
  const goalLevel = getBenchLevel(grid, gx, gz);

  // If same level, delegate to normal pathfinding
  if (startLevel === goalLevel) {
    return findPath(grid, request);
  }

  const ramps = findRampConnections(grid);

  // Filter ramps connecting startLevel ↔ goalLevel
  const candidateRamps = filterRampsForLevels(ramps, startLevel, goalLevel);

  if (candidateRamps.length === 0) {
    return { found: false, waypoints: [], totalCost: 0 };
  }

  // Route-selection stability (#458 T6.1/D14): route1/route2's costs are A*
  // results from the agent's CURRENT (continuously-shifting, sub-cell)
  // position, recomputed fresh every tick. When two candidate ramps cost
  // nearly the same, whichever one is marginally cheaper can flip from tick
  // to tick as the agent's exact position shifts by fractions of a cell —
  // producing a stable walk-toward-ramp-A / walk-toward-ramp-B oscillation
  // that never actually arrives (confirmed via direct reproduction: an
  // agent frozen retrying between two points for 100+ ticks, this loop
  // returning a *different* best ramp on each call from the same physical
  // vicinity). Ties within RAMP_TIE_EPSILON break on the ramp's own grid
  // position — fixed regardless of the agent's position — so the same
  // choice keeps winning as the agent approaches, instead of flapping.
  // Bigger levels (#458 D13) carry far more natural relief than the old
  // ones, giving agents many more close-cost ramp choices to flap between.
  const RAMP_TIE_EPSILON = 1.0;
  let bestResult: PathResult | null = null;
  let bestRampKey = Infinity;

  for (const ramp of candidateRamps) {
    // Determine entrance (on start level) and exit (on goal level)
    let entrance: { x: number; z: number };
    let exit: { x: number; z: number };

    if (ramp.upperLevel === startLevel) {
      entrance = { x: ramp.upperX, z: ramp.upperZ };
      exit = { x: ramp.lowerX, z: ramp.lowerZ };
    } else {
      entrance = { x: ramp.lowerX, z: ramp.lowerZ };
      exit = { x: ramp.upperX, z: ramp.upperZ };
    }

    // A* from start → entrance
    const route1 = findPath(grid, {
      agentId,
      fromX: sx,
      fromZ: sz,
      toX: entrance.x,
      toZ: entrance.z,
      avoidVehicles,
    });
    if (!route1.found) continue;

    // A* from exit → goal
    const route2 = findPath(grid, {
      agentId,
      fromX: exit.x,
      fromZ: exit.z,
      toX: gx,
      toZ: gz,
      avoidVehicles,
    });
    if (!route2.found) continue;

    // Cost: route1 + entrance→ramp + ramp→exit + route2
    const entranceToRampCost = getStepCost(grid, entrance.x, entrance.z, ramp.rampX, ramp.rampZ);
    const rampToExitCost = getStepCost(grid, ramp.rampX, ramp.rampZ, exit.x, exit.z);
    const totalCost = route1.totalCost + entranceToRampCost + rampToExitCost + route2.totalCost;

    // Concatenate route1 → ramp → route2 waypoints with deduplication
    const waypoints = concatPaths(route1, { x: ramp.rampX, z: ramp.rampZ }, route2);
    const rampKey = ramp.rampX * 100000 + ramp.rampZ;

    const isClearlyBetter = bestResult === null || totalCost < bestResult.totalCost - RAMP_TIE_EPSILON;
    const isTiedButStablyPreferred =
      bestResult !== null &&
      Math.abs(totalCost - bestResult.totalCost) <= RAMP_TIE_EPSILON &&
      rampKey < bestRampKey;

    if (isClearlyBetter || isTiedButStablyPreferred) {
      bestResult = { found: true, waypoints, totalCost };
      bestRampKey = rampKey;
    }
  }

  return bestResult ?? { found: false, waypoints: [], totalCost: 0 };
}

// Cost of a single step from a to b (must be neighbours, otherwise Infinity).
function getStepCost(grid: NavGrid, ax: number, az: number, bx: number, bz: number): number {
  const dx = Math.abs(bx - ax);
  const dz = Math.abs(bz - az);
  if (dx > 1 || dz > 1) return Infinity;
  const clamped = clampToGrid(grid, bx, bz);
  const cell = grid.cellAt(clamped.x, clamped.z)!;
  if (dx !== 0 && dz !== 0) return cell.moveCost * Math.SQRT2;
  return cell.moveCost;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find the shortest path on a NavGrid using A* with 8-directional movement and octile heuristic.
 */
export function findPath(grid: NavGrid, request: PathRequest): PathResult {
  // 0. Validate grid dimensions
  if (grid.width <= 0 || grid.height <= 0) {
    return { found: false, waypoints: [], totalCost: 0 };
  }

  // 1. Clamp start and goal to grid bounds
  const start = clampToGrid(grid, request.fromX, request.fromZ);
  const goal = clampToGrid(grid, request.toX, request.toZ);
  const sx = start.x, sz = start.z, gx = goal.x, gz = goal.z;

  const { avoidVehicles } = request;

  // 2. Start impassable check (must precede start==goal check)
  const startCell = grid.cellAt(sx, sz)!;
  if (isImpassable(startCell, avoidVehicles)) {
    return { found: false, waypoints: [], totalCost: 0 };
  }

  // 3. Goal impassable check
  const goalCell = grid.cellAt(gx, gz)!;
  if (isImpassable(goalCell, avoidVehicles)) {
    return { found: false, waypoints: [], totalCost: 0 };
  }

  // 4. Trivial case: start == goal (both passable)
  if (sx === gx && sz === gz) {
    return { found: true, waypoints: [{ x: sx, z: sz }], totalCost: 0 };
  }

  // 5. Ordinary search (direct line + A*) first, regardless of bench level.
  //    isImpassable only excludes 'blocked'/'void' cells and, optionally,
  //    vehicle-occupied ones — it never looks at benchLevel, so ordinary A*
  //    already walks straight across a gentle one-level grade exactly like
  //    any other terrain. benchLevel bands natural relief far more finely
  //    than "genuinely blocked" (#458 T6.1/D14 found the bigger, hillier D13
  //    levels carrying near-constant one-level differences between adjacent
  //    cells), so gating every differing-level request behind ramp-only
  //    findMultiLevelPath — as this used to, unconditionally — forced almost
  //    every walk on those levels through the fragile ramp search, including
  //    ones ordinary A* could have solved directly. That produced the ramp
  //    tie-flip oscillation fixed above, and even with that fix, agents whose
  //    start/goal sat in bench-fragmented terrain (many candidate ramps, none
  //    close to the direct route) could walk in a stable loop that never
  //    converges — confirmed via direct reproduction: a surveyor's position
  //    cycling through the same handful of cells for 20+ ticks while
  //    findMultiLevelPath kept returning a *found* path every tick, just a
  //    detour nowhere near the goal.
  const ordinary = findOrdinaryPath(grid, sx, sz, gx, gz, avoidVehicles);
  if (ordinary.found) return ordinary;

  // 6. Ordinary search found no connection at all — if start and goal sit on
  //    different bench levels, a genuine wall (not just relief) may separate
  //    them, so fall back to ramp-based multi-level routing before giving up.
  if (getBenchLevel(grid, sx, sz) !== getBenchLevel(grid, gx, gz)) {
    return findMultiLevelPath(grid, request);
  }

  return ordinary;
}

function findOrdinaryPath(
  grid: NavGrid,
  sx: number,
  sz: number,
  gx: number,
  gz: number,
  avoidVehicles: boolean,
): PathResult {
  // Fast path — try direct line before A* only if it's clearly optimal.
  //    Compare direct-line cost to heuristic lower bound (octile * MIN_WALKABLE_COST).
  //    If directLine is more than 10% above heuristic, it's suboptimal — use A*.
  const directLine = directLineWalk(grid, sx, sz, gx, gz, avoidVehicles);
  if (directLine !== null) {
    const heuristicLowerBound = octileHeuristic(sx, sz, gx, gz) * MIN_WALKABLE_COST;
    if (directLine.totalCost <= heuristicLowerBound * DIRECT_LINE_TOLERANCE) return directLine;
  }

  // A* main loop — see the scratch-array block above for why gScore/cameFrom
  // are flat typed arrays keyed by cellIndex rather than per-call Maps.

  interface AStarNode {
    key: number; // f = g + h, used by the min-heap
    pos: number; // cellIndex(x, z, width)
    g: number;   // gScore at push time (for stale check)
  }

  ensureScratchCapacity(grid.width * grid.height);
  currentStamp++;

  const openHeap = new MinHeap<AStarNode>();
  let exploredCount = 0;

  const budget = pathfindingNodeBudget(grid.width, grid.height);
  const startPos = cellIndex(grid, sx, sz);
  gScoreArr[startPos] = 0;
  stampArr[startPos] = currentStamp;
  cameFromArr[startPos] = -1;
  const hStart = octileHeuristic(sx, sz, gx, gz) * ASTAR_HEURISTIC_WEIGHT;
  openHeap.push({ key: hStart, pos: startPos, g: 0 });

  while (openHeap.size > 0 && exploredCount < budget) {
    const current = openHeap.pop()!;
    const { x: cx, z: cz } = cellCoords(grid, current.pos);

    // Skip stale entries (re-expanded with outdated gScore)
    const bestG = gScoreArr[current.pos];
    if (bestG !== current.g) continue;

    exploredCount++;

    // Goal reached?
    if (cx === gx && cz === gz) {
      return reconstructPath(grid, gx, gz);
    }

    // Explore neighbours
    for (const [dx, dz] of NEIGHBOUR_OFFSETS) {
      const nx = cx + dx;
      const nz = cz + dz;

      const neighborCell = grid.cellAt(nx, nz);
      if (!neighborCell || isImpassable(neighborCell, avoidVehicles)) continue;

      // Move cost
      const isDiagonal = dx !== 0 && dz !== 0;
      const stepCost = isDiagonal ? neighborCell.moveCost * Math.SQRT2 : neighborCell.moveCost;
      const tentativeG = bestG + stepCost;

      const neighborPos = cellIndex(grid, nx, nz);
      const touched = stampArr[neighborPos] === currentStamp;
      const existingG = touched ? gScoreArr[neighborPos]! : Infinity;

      if (!touched || tentativeG < existingG) {
        gScoreArr[neighborPos] = tentativeG;
        stampArr[neighborPos] = currentStamp;
        cameFromArr[neighborPos] = current.pos;
        const h = octileHeuristic(nx, nz, gx, gz) * ASTAR_HEURISTIC_WEIGHT;
        openHeap.push({ key: tentativeG + h, pos: neighborPos, g: tentativeG });
      }
    }
  }

  // Budget exceeded or open set empty — try direct-line fallback
  const fallback = directLineWalk(grid, sx, sz, gx, gz, avoidVehicles);
  if (fallback !== null) return fallback;

  return { found: false, waypoints: [], totalCost: 0 };
}

/** Reconstruct path by walking the cameFromArr scratch array backwards from goal to start. */
function reconstructPath(grid: NavGrid, goalX: number, goalZ: number): PathResult {
  const waypoints: { x: number; z: number }[] = [];
  let idx = cellIndex(grid, goalX, goalZ);
  const totalCost = gScoreArr[idx]!;

  // Walk backwards (-1 marks the start node, which has no parent)
  while (idx !== -1) {
    waypoints.push(cellCoords(grid, idx));
    idx = cameFromArr[idx]!;
  }

  waypoints.reverse();

  return { found: true, waypoints, totalCost };
}
