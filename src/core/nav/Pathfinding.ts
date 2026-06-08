// BlastSimulator2026 — Pathfinding: A* route finding over the NavGrid
// Part of the navmesh system.

import { NavGrid } from './NavGrid.js';
import type { NavCell } from './NavGrid.js';
import { PATHFINDING_NODE_BUDGET_CAP } from '../config/balance.js';

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

/** Build the key string for a coordinate pair. */
function cellKey(x: number, z: number): string {
  return `${x},${z}`;
}

/** Clamp a coordinate to the grid bounds. */
function clampCoord(value: number, max: number): number {
  return Math.max(0, Math.min(max - 1, Math.floor(value)));
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
    const clampedX = clampCoord(cx, grid.width);
    const clampedZ = clampCoord(cz, grid.height);

    const cell = grid.cells[clampedZ]![clampedX]!;
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
  const cx = clampCoord(x, grid.width);
  const cz = clampCoord(z, grid.height);
  return grid.cells[cz]![cx]!.benchLevel;
}

export function findRampConnections(grid: NavGrid): RampConnection[] {
  const connections: RampConnection[] = [];

  for (let z = 0; z < grid.height; z++) {
    for (let x = 0; x < grid.width; x++) {
      const cell = grid.cells[z]![x]!;
      if (cell.type !== 'ramp') continue;

      // Collect distinct bench levels among walkable neighbours
      const levelToNeighbor = new Map<number, { x: number; z: number }>();

      for (const [dx, dz] of NEIGHBOUR_OFFSETS) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nx >= grid.width || nz < 0 || nz >= grid.height) continue;
        const neighbor = grid.cells[nz]![nx]!;
        if (neighbor.type === 'blocked' || neighbor.type === 'void') continue;

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

function findMultiLevelPath(grid: NavGrid, request: PathRequest): PathResult {
  const sx = clampCoord(request.fromX, grid.width);
  const sz = clampCoord(request.fromZ, grid.height);
  const gx = clampCoord(request.toX, grid.width);
  const gz = clampCoord(request.toZ, grid.height);
  const { avoidVehicles, agentId } = request;

  const startLevel = getBenchLevel(grid, sx, sz);
  const goalLevel = getBenchLevel(grid, gx, gz);

  // If same level, delegate to normal pathfinding
  if (startLevel === goalLevel) {
    return findPath(grid, request);
  }

  const ramps = findRampConnections(grid);

  // Filter ramps connecting startLevel ↔ goalLevel
  const candidateRamps = ramps.filter(r =>
    (r.upperLevel === startLevel && r.lowerLevel === goalLevel) ||
    (r.upperLevel === goalLevel && r.lowerLevel === startLevel),
  );

  if (candidateRamps.length === 0) {
    return { found: false, waypoints: [], totalCost: 0 };
  }

  let bestResult: PathResult | null = null;

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

    // Build waypoints
    const waypoints: Array<{ x: number; z: number }> = [...route1.waypoints];

    // Add ramp cell if not a duplicate of last waypoint from route1
    const lastR1 = route1.waypoints[route1.waypoints.length - 1];
    if (!lastR1 || lastR1.x !== ramp.rampX || lastR1.z !== ramp.rampZ) {
      waypoints.push({ x: ramp.rampX, z: ramp.rampZ });
    }

    // Append route2 waypoints, skipping duplicate first
    for (const wp of route2.waypoints) {
      const lastWp = waypoints[waypoints.length - 1];
      if (!lastWp || lastWp.x !== wp.x || lastWp.z !== wp.z) {
        waypoints.push(wp);
      }
    }

    if (bestResult === null || totalCost < bestResult.totalCost) {
      bestResult = { found: true, waypoints, totalCost };
    }
  }

  return bestResult ?? { found: false, waypoints: [], totalCost: 0 };
}

function getStepCost(grid: NavGrid, ax: number, az: number, bx: number, bz: number): number {
  const dx = Math.abs(bx - ax);
  const dz = Math.abs(bz - az);
  if (dx > 1 || dz > 1) return Infinity;
  const cx = clampCoord(bx, grid.width);
  const cz = clampCoord(bz, grid.height);
  const cell = grid.cells[cz]![cx]!;
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
  const sx = clampCoord(request.fromX, grid.width);
  const sz = clampCoord(request.fromZ, grid.height);
  const gx = clampCoord(request.toX, grid.width);
  const gz = clampCoord(request.toZ, grid.height);

  const { avoidVehicles } = request;

  // 2. Start impassable check (must precede start==goal check)
  const startCell = grid.cells[sz]![sx]!;
  if (isImpassable(startCell, avoidVehicles)) {
    return { found: false, waypoints: [], totalCost: 0 };
  }

  // 3. Goal impassable check
  const goalCell = grid.cells[gz]![gx]!;
  if (isImpassable(goalCell, avoidVehicles)) {
    return { found: false, waypoints: [], totalCost: 0 };
  }

  // 4. Trivial case: start == goal (both passable)
  if (sx === gx && sz === gz) {
    return { found: true, waypoints: [{ x: sx, z: sz }], totalCost: 0 };
  }

  // 4b. Multi-level check: delegate to multi-level routing when levels differ
  if (getBenchLevel(grid, sx, sz) !== getBenchLevel(grid, gx, gz)) {
    return findMultiLevelPath(grid, request);
  }

  // 5. A* main loop

  interface AStarNode {
    key: number; // f = g + h, used by the min-heap
    x: number;
    z: number;
  }

  const openHeap = new MinHeap<AStarNode>();
  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, { x: number; z: number }>();
  let exploredCount = 0;

  const startKey = cellKey(sx, sz);
  gScore.set(startKey, 0);
  const hStart = octileHeuristic(sx, sz, gx, gz);
  openHeap.push({ key: hStart, x: sx, z: sz });

  while (openHeap.size > 0 && exploredCount < PATHFINDING_NODE_BUDGET_CAP) {
    const current = openHeap.pop()!;
    const { x: cx, z: cz } = current;
    const currentKey = cellKey(cx, cz);

    // Skip stale entries (we don't update keys in-place)
    const currentG = gScore.get(currentKey);
    if (currentG === undefined) continue;

    exploredCount++;

    // Goal reached?
    if (cx === gx && cz === gz) {
      return reconstructPath(cameFrom, cx, cz, gScore);
    }

    // Explore neighbours
    for (const [dx, dz] of NEIGHBOUR_OFFSETS) {
      const nx = cx + dx;
      const nz = cz + dz;

      // Bounds check
      if (nx < 0 || nx >= grid.width || nz < 0 || nz >= grid.height) continue;

      const neighborCell = grid.cells[nz]![nx]!;
      if (isImpassable(neighborCell, avoidVehicles)) continue;

      // Move cost
      const isDiagonal = dx !== 0 && dz !== 0;
      const stepCost = isDiagonal ? neighborCell.moveCost * Math.SQRT2 : neighborCell.moveCost;
      const tentativeG = currentG + stepCost;

      const neighborKey = cellKey(nx, nz);
      const existingG = gScore.get(neighborKey);

      if (existingG === undefined || tentativeG < existingG) {
        gScore.set(neighborKey, tentativeG);
        cameFrom.set(neighborKey, { x: cx, z: cz });
        const h = octileHeuristic(nx, nz, gx, gz);
        openHeap.push({ key: tentativeG + h, x: nx, z: nz });
      }
    }
  }

  // Budget exceeded or open set empty — try direct-line fallback
  const fallback = directLineWalk(grid, sx, sz, gx, gz, avoidVehicles);
  if (fallback !== null) return fallback;

  return { found: false, waypoints: [], totalCost: 0 };
}

/** Reconstruct path by walking cameFrom map backwards from goal to start. */
function reconstructPath(
  cameFrom: Map<string, { x: number; z: number }>,
  goalX: number,
  goalZ: number,
  gScore: Map<string, number>,
): PathResult {
  const waypoints: { x: number; z: number }[] = [];
  let cx = goalX;
  let cz = goalZ;

  // Walk backwards
  while (true) {
    waypoints.push({ x: cx, z: cz });
    const key = cellKey(cx, cz);
    const parent = cameFrom.get(key);
    if (parent === undefined) break;
    cx = parent.x;
    cz = parent.z;
  }

  waypoints.reverse();

  const totalCost = gScore.get(cellKey(goalX, goalZ)) ?? 0;

  return { found: true, waypoints, totalCost };
}
