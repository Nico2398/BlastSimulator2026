// BlastSimulator2026 — NavGrid reachability queries
//
// Flood-fill based reachability: nearest traversable cell, nearest cell
// actually path-connected to an anchor, and full reachable-set queries.
// Split out of NavGrid.ts to keep it under the 300-line file-size convention
// (dev-coding-conventions) — NavGrid keeps thin static wrappers around these
// so `NavGrid.findNearestReachableCell` etc. remain the public entry points.

import type { NavGrid, NavCell } from './NavGrid.js';
import { isStepClimbable, isCellOccupied, hasClearance } from './NavGrid.js';
import { NEIGHBOUR_OFFSETS_8 } from './NeighbourOffsets.js';
import { NAV_CLEARANCE_EMPLOYEE_CELLS } from '../config/balance.js';
import { isDiagonalCornerClear } from './Pathfinding.js';

/** True when a cell exists, is in bounds, and has finite moveCost (walkable/ramp/drill_hole). */
export function isTraversableCell(navGrid: NavGrid, x: number, z: number): boolean {
  const cell = navGrid.cellAt(x, z);
  return !!cell && cell.type !== 'blocked' && cell.type !== 'void';
}

/**
 * True when a cell is currently vehicle- or fragment-occupied (#954). Mirrors
 * EntityMovementTick.ts's own isDestinationOccupied, but works from a bare
 * NavGrid rather than GameState — this module never imports GameState
 * (dev-architecture layering: NavGridReachability sits below the engine
 * tier), and every call site here already holds a NavGrid reference.
 *
 * Used by findNearestTraversableCell/findNearestReachableCell's optional
 * avoidOccupancy mode (#954 follow-up fix) — see that parameter's own doc
 * comment for why entity-spawn placement needs it.
 */
function isOccupiedCell(navGrid: NavGrid, x: number, z: number): boolean {
  return isCellOccupied(navGrid.cellAt(x, z));
}

/**
 * Find the nearest traversable cell (walkable/ramp/drill_hole — anything
 * with finite moveCost) to (x, z), searching outward in expanding square
 * rings. Returns (x, z) unchanged when it is already traversable, or when
 * nothing traversable turns up within maxRadius.
 *
 * Distance-only: does not check that the cell found is actually path-
 * connected to anywhere else. A blast crater can carve isolated traversable
 * pockets walled off by 'void' on every side — nearest-by-distance can land
 * on one of those. Callers that need an actually reachable point should use
 * findNearestReachableCell instead.
 *
 * avoidOccupancy (#954 follow-up fix, default false — every pre-existing
 * caller's behaviour is unchanged): when true, a vehicle- or fragment-
 * occupied cell (isOccupiedCell) is treated the same as 'blocked'/'void' —
 * present but unusable — even though its NavCell `type` still reads
 * 'walkable'. Entity-spawn placement (hire, vehicle purchase) needs this: a
 * spawn point whose raw target sits inside a dense post-blast fragment field
 * is still "traversable" by cell type, so without this flag it is accepted
 * unmoved even when every one of its neighbours is also occupied — an
 * employee spawned there can never take a single step (isImpassable blocks
 * fragment-occupied neighbours for foot travel, #954), and monopolizes any
 * pool action targeting that area via ActionSelection.ts's own reachability
 * check forever, since nothing ever relocates them. Confirmed live:
 * tutorial-playthrough.json's own manager and driver both hired at the
 * world-centre spawn point, which landed squarely inside the fresh blast
 * crater's fragment field — both permanently boxed in, both re-claiming (and
 * re-failing) the same freight_warehouse order for 400+ ticks.
 */
export function findNearestTraversableCell(
  navGrid: NavGrid,
  x: number,
  z: number,
  maxRadius: number = Math.max(navGrid.width, navGrid.height),
  avoidOccupancy: boolean = false,
): { x: number; z: number } {
  const usable = (cx: number, cz: number): boolean =>
    isTraversableCell(navGrid, cx, cz) && (!avoidOccupancy || !isOccupiedCell(navGrid, cx, cz));

  if (usable(x, z)) return { x, z };

  for (let r = 1; r <= maxRadius; r++) {
    let best: { x: number; z: number } | null = null;
    let bestDistSq = Infinity;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // ring only
        const cx = x + dx;
        const cz = z + dz;
        if (!usable(cx, cz)) continue;
        const distSq = dx * dx + dz * dz;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          best = { x: cx, z: cz };
        }
      }
    }
    if (best) return best;
  }

  return { x, z };
}

/**
 * Find the nearest cell to (targetX, targetZ) that is actually 8-directionally
 * path-connected to (anchorX, anchorZ) — same adjacency Pathfinding.findPath
 * walks, so a cell this returns is guaranteed reachable from the anchor,
 * unlike findNearestTraversableCell's plain distance search.
 *
 * Exists because a spawn/destination point picked without checking the
 * NavGrid — e.g. a vehicle purchase or employee hire landing at the world's
 * geometric centre — can resolve to a blast-cleared 'void' column, or to an
 * isolated traversable pocket a blast crater walled off from the rest of the
 * map with no floor at all, which arrival-gated actions (#437) can never
 * actually path to even after nudging to the "nearest" traversable cell.
 *
 * anchorX/anchorZ should be a point known to sit in the map's main
 * connected region (callers typically use a world corner). Falls back to
 * (targetX, targetZ) unchanged if the anchor itself resolves to no
 * traversable cell, or if the connected component containing it is empty.
 *
 * Same-bench-level preference (#458 T6.1/D13): the flood fill is climb-aware
 * (#1166 — see the fill call's own doc comment below) but still has no
 * notion of bench level as such, so it can still call a cell "reachable"
 * that sits across a bench-level boundary from the anchor — connected by a
 * chain of individually climb-legal steps, but only actually walkable via
 * Pathfinding.findMultiLevelPath's ramp-entrance/exit routing, which
 * re-picks the cheapest candidate ramp fresh every tick
 * from the agent's current (sub-cell, continuously moving) position. When
 * two ramps have close-enough cost, that fresh-every-tick re-pick flips
 * between them as the agent moves, producing a stable walk-forward/
 * walk-back loop that never arrives (confirmed via direct reproduction: a
 * driver stuck oscillating between two points for 150+ ticks trying to
 * reach a vehicle across exactly this kind of boundary). Bigger levels
 * (#458 D13) carry far more natural relief than the old ones, so this
 * boundary comes up constantly rather than rarely. Preferring a
 * same-bench-level candidate whenever one exists sidesteps multi-level
 * routing for this call entirely, rather than attempting to stabilize its
 * ramp selection (a larger, riskier change to Pathfinding.ts's stateless,
 * recomputed-fresh-every-tick design).
 *
 * avoidOccupancy (#954 follow-up fix, default false — every pre-existing
 * caller's behaviour is unchanged): threaded straight through to
 * findNearestTraversableCell (the anchor snap) and floodFillReachable (the
 * reachable-set walk) — see findNearestTraversableCell's own doc comment for
 * why entity-spawn placement needs it.
 */
export function findNearestReachableCell(
  navGrid: NavGrid,
  anchorX: number,
  anchorZ: number,
  targetX: number,
  targetZ: number,
  avoidOccupancy: boolean = false,
): { x: number; z: number } {
  return reachableAnswer(navGrid, anchorX, anchorZ, targetX, targetZ, avoidOccupancy).cell;
}

/**
 * `findNearestReachableCell`'s whole body, plus the size of the anchor's own
 * connected region. `findNearestSpawnCell` needs that size to tell — exactly,
 * not heuristically — whether the anchor sits in the grid's largest region,
 * and getting it from this fill keeps that check free rather than paying for
 * a second one (the hire benchmark's 200ms budget, #458 T6.2/D14).
 */
function reachableAnswer(
  navGrid: NavGrid,
  anchorX: number,
  anchorZ: number,
  targetX: number,
  targetZ: number,
  avoidOccupancy: boolean,
): { cell: { x: number; z: number }; count: number } {
  const anchor = findNearestTraversableCell(navGrid, anchorX, anchorZ, undefined, avoidOccupancy);
  if (!isTraversableCell(navGrid, anchor.x, anchor.z) || (avoidOccupancy && isOccupiedCell(navGrid, anchor.x, anchor.z))) {
    return { cell: { x: targetX, z: targetZ }, count: 0 };
  }

  // 8-directional, climb-aware flood fill from the anchor — same adjacency
  // AND climb gate findPath's own neighbour expansion uses (#1166; was
  // climb-UNaware — see this function's own doc comment above, "same
  // adjacency A* uses", which stopped being true once a step steeper than
  // NAV_MAX_SLOPE_RATIO became illegal, #1151). A flat fill could call a
  // cell "reachable" that a real climb-gated findPath from the same anchor
  // can never actually walk to — confirmed live: tutorial_pit's own driver
  // hire landing on a climb-disconnected island this way, "No route to
  // vehicle" on the very next driver-assign command.
  const { width, count } = floodFillReachable(navGrid, anchor.x, anchor.z, true, avoidOccupancy);
  const anchorLevel = navGrid.cellAt(anchor.x, anchor.z)?.benchLevel;

  let best = anchor;
  let bestDistSq = (anchor.x - targetX) ** 2 + (anchor.z - targetZ) ** 2;
  let bestSameLevel: { x: number; z: number } | null = null;
  let bestSameLevelDistSq = Infinity;

  // Consumed synchronously, immediately after the fill above — safe to read
  // queueArr directly (see the scratch-buffer note on floodFillReachable).
  for (let i = 0; i < count; i++) {
    const idx = queueArr[i]!;
    const x = navGrid.originX + (idx % width);
    const z = navGrid.originZ + ((idx / width) | 0);
    const distSq = (x - targetX) ** 2 + (z - targetZ) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = { x, z };
    }
    if (anchorLevel !== undefined && navGrid.cellAt(x, z)?.benchLevel === anchorLevel && distSq < bestSameLevelDistSq) {
      bestSameLevelDistSq = distSq;
      bestSameLevel = { x, z };
    }
  }

  return { cell: bestSameLevel ?? best, count };
}

/**
 * A reachable-set query result. `has`/`size` mirror the `Set<string>` API
 * callers used to get back, without the per-cell string-key hashing —
 * `has(x, z)` takes coordinates directly rather than a `"x,z"` key.
 */
export interface ReachableSet {
  has(x: number, z: number): boolean;
  readonly size: number;
}

const EMPTY_REACHABLE_SET: ReachableSet = { has: () => false, size: 0 };

/**
 * Compute the set of all cells 8-directionally path-connected to
 * (anchorX, anchorZ) — same adjacency Pathfinding.findPath and
 * findNearestReachableCell walk.
 *
 * Returns an empty set only when the anchor is out of the grid's bounds
 * entirely. An in-bounds anchor is always included in the returned set
 * regardless of its own NavCell `type` (#1025) — mirrors `isImpassable`'s
 * `isAgentCell` exemption (Pathfinding.ts): an agent's own current cell can
 * never itself be impassable to it, even once a building footprint or a
 * blast has since flipped that cell's type to 'blocked'/'void'. A fully
 * enclosed anchor (no passable neighbour) returns a set of exactly
 * `{anchor}` — every other cell reached by the flood fill still passes the
 * ordinary per-neighbour traversability/occupancy checks unchanged.
 */
export function computeReachableSet(
  navGrid: NavGrid,
  anchorX: number,
  anchorZ: number,
  requiredClearance: number = NAV_CLEARANCE_EMPLOYEE_CELLS,
): ReachableSet {
  return reachableSetFrom(navGrid, anchorX, anchorZ, false, requiredClearance);
}

/**
 * `computeReachableSet` with `findPath`'s own per-step climb gate applied
 * (#953): a cell this set contains is one a real `findPath` from the same
 * anchor can actually resolve against, where the plain set only proves grid
 * adjacency and so still includes a bench floor no agent can climb down to.
 *
 * Use it wherever a candidate destination is about to be ranked or filtered
 * without paying for a real pathfind — `selectBestActionForEmployee`
 * (ActionSelection.ts) screens every ranked candidate through one of these,
 * computed once per call, so a fresh crater's own walled-off interior can
 * never spend the bounded real-pathfind attempts meant for candidates that
 * can actually resolve.
 */
export function computeClimbReachableSet(
  navGrid: NavGrid,
  anchorX: number,
  anchorZ: number,
  requiredClearance: number = NAV_CLEARANCE_EMPLOYEE_CELLS,
): ReachableSet {
  // Clamped, unlike computeReachableSet's raw anchor: callers pass a live
  // agent position, and an agent standing on the site's outer border rounds
  // to a coordinate one past the last cell. Left unclamped that reads as
  // "anchor not traversable" and returns the empty set — which, for the one
  // caller this exists for, silently filters out every candidate action and
  // leaves the agent idle for the rest of the game.
  return reachableSetFrom(navGrid, navGrid.clampX(anchorX), navGrid.clampZ(anchorZ), true, requiredClearance);
}

function reachableSetFrom(
  navGrid: NavGrid,
  anchorX: number,
  anchorZ: number,
  climbAware: boolean,
  requiredClearance: number = NAV_CLEARANCE_EMPLOYEE_CELLS,
): ReachableSet {
  const ax = Math.round(anchorX);
  const az = Math.round(anchorZ);
  if (!navGrid.cellAt(ax, az)) return EMPTY_REACHABLE_SET;
  return snapshotFill(navGrid, [{ x: ax, z: az }], climbAware, requiredClearance);
}

function snapshotFill(
  navGrid: NavGrid,
  sources: ReadonlyArray<{ x: number; z: number }>,
  climbAware: boolean,
  requiredClearance: number,
): ReachableSet {
  const { width, height, count } = floodFillFromSources(navGrid, sources, climbAware, false, requiredClearance);
  const { originX, originZ } = navGrid;
  // Independent snapshot: floodFillReachable's next call reuses the shared
  // scratch buffer, so a wrapper aliasing it directly would go stale (or
  // wrong) the moment another reachability query runs before this one is
  // done being read. A typed-array copy is still far cheaper — both to build
  // and to query — than the Set<string> this replaced.
  const visited = visitedArr.slice(0, width * height);

  return {
    has(x: number, z: number): boolean {
      const lx = x - originX;
      const lz = z - originZ;
      if (lx < 0 || lz < 0 || lx >= width || lz >= height) return false;
      return visited[lz * width + lx] === 1;
    },
    size: count,
  };
}

/**
 * Nearest cell to (targetX, targetZ) inside the grid's **largest
 * climb-connected region** — the main body of ground an agent standing
 * anywhere in it can walk across without scaling a face steeper than
 * `NAV_MAX_SLOPE_RATIO` (#953, slope-based since #1151).
 *
 * Unlike `findNearestReachableCell`, it takes no anchor. That helper's
 * contract — "pass a world corner, it sits in the map's main connected
 * region" — only held while every traversable cell was connected to every
 * other one by flat 8-directional adjacency. Once a step taller than the
 * climb limit stopped being a legal move, a corner (or any other fixed
 * coordinate) can itself be a one-cell island on top of a terrain peak,
 * which is exactly how a staffed site spawned its driller and drill rig onto
 * an alpine summit they could never walk off. Asking for the largest region
 * instead of a region containing some assumed-good anchor removes that
 * assumption: the answer is a cell the site's workforce, its vehicles and
 * its work area can all actually reach each other from.
 *
 * avoidOccupancy (#1151, default false — every pre-existing caller's
 * behaviour is unchanged): when true, a vehicle- or fragment-occupied cell is
 * treated as unusable, exactly as in `findNearestTraversableCell`/
 * `findNearestReachableCell`'s flag of the same name (#954 — see its doc
 * comment for why entity-spawn placement needs it). Occupancy is applied to
 * the *answer* only, not to the component scan: a parked vehicle does not
 * split the ground it stands on into two regions, so letting it do so here
 * would shrink the main region for no reason and could hand back a cell on a
 * genuine island. Spawn placement is the caller that needs both properties at
 * once — the main landmass and a free cell — and before this flag the only
 * helper offering the occupancy guard was `findNearestReachableCell`, whose
 * fixed-anchor contract is the very assumption this function exists to drop.
 *
 * Returns (targetX, targetZ) unchanged when the grid holds no traversable
 * cell at all, or no usable one under `avoidOccupancy`.
 */
export function findNearestNavigableCell(
  navGrid: NavGrid,
  targetX: number,
  targetZ: number,
  avoidOccupancy = false,
): { x: number; z: number } {
  const { width, height, originX, originZ } = navGrid;
  const componentOf = new Int32Array(width * height).fill(UNVISITED);
  const queue = new Int32Array(width * height);

  let bestComponentSize = 0;
  let best: { x: number; z: number } | null = null;
  let bestDistSq = Infinity;
  const usable = (x: number, z: number): boolean =>
    !avoidOccupancy || !isOccupiedCell(navGrid, x, z);

  for (let startIdx = 0; startIdx < componentOf.length; startIdx++) {
    if (componentOf[startIdx] !== UNVISITED) continue;
    const sx = originX + (startIdx % width);
    const sz = originZ + ((startIdx / width) | 0);
    if (!isTraversableCell(navGrid, sx, sz)) continue;

    // Flood one component, tracking its size and its cell nearest the target
    // in the same pass — a second scan over it would need the labels kept.
    let count = 0;
    componentOf[startIdx] = startIdx;
    queue[count++] = startIdx;
    let nearest: { x: number; z: number } | null = usable(sx, sz) ? { x: sx, z: sz } : null;
    let nearestDistSq = nearest ? (sx - targetX) ** 2 + (sz - targetZ) ** 2 : Infinity;

    for (let head = 0; head < count; head++) {
      const idx = queue[head]!;
      const x = originX + (idx % width);
      const z = originZ + ((idx / width) | 0);
      const cell = navGrid.cellAt(x, z);
      for (const [dx, dz] of NEIGHBOUR_OFFSETS_8) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < originX || nx >= originX + width || nz < originZ || nz >= originZ + height) continue;
        // Label check first: in a dense region each cell is offered by up to
        // eight neighbours but labelled once, so testing it before the cell
        // lookups and the slope maths below skips that work on roughly seven
        // of every eight edges. Behaviour is identical — everything past this
        // point only ever ran for a newly-labelled cell anyway.
        const neighbourIdx = (nz - originZ) * width + (nx - originX);
        if (componentOf[neighbourIdx] !== UNVISITED) continue;
        const neighbourCell = navGrid.cellAt(nx, nz);
        if (!neighbourCell || neighbourCell.type === 'blocked' || neighbourCell.type === 'void') continue;
        if (!isStepClimbable(cell?.surfaceY, neighbourCell.surfaceY, Math.hypot(dx, dz))) continue;
        componentOf[neighbourIdx] = startIdx;
        queue[count++] = neighbourIdx;
        const distSq = (nx - targetX) ** 2 + (nz - targetZ) ** 2;
        if (distSq < nearestDistSq && usable(nx, nz)) {
          nearestDistSq = distSq;
          nearest = { x: nx, z: nz };
        }
      }
    }

    // A region every cell of which is occupied offers no answer, so it never
    // displaces one — otherwise the largest region could win the comparison
    // and then hand back nothing, dropping the caller onto a genuine island.
    if (nearest === null) continue;
    const answer = nearest;
    const answerDistSq = nearestDistSq;

    // Strictly-greater keeps the scan deterministic: on a tie the region
    // whose first cell comes first in row-major order wins.
    if (count > bestComponentSize) {
      bestComponentSize = count;
      best = answer;
      bestDistSq = answerDistSq;
    } else if (count === bestComponentSize && answerDistSq < bestDistSq) {
      best = answer;
      bestDistSq = answerDistSq;
    }
  }

  return best ?? { x: targetX, z: targetZ };
}

/**
 * Where a mid-game entity spawn (an `employee hire`, a `vehicle buy`) may
 * actually be placed: the cell nearest (targetX, targetZ) that is on the
 * site's main body of ground, free of vehicles and fragments, and genuinely
 * walkable to from it.
 *
 * Both call sites used to ask `findNearestReachableCell` with a literal
 * `(0, 0)` anchor, on the reasoning that "blast sites are never placed on
 * the map edge" so a corner always sits in the main region. The slope gate
 * (#1151) broke that: a corner can be walled off into a small island by
 * nothing more than the craters the player's own blasts leave around it, and
 * `findNearestReachableCell` then faithfully snaps every later spawn *into*
 * that island. Measured on blast-execution-visual's 64x64 site, five blast
 * cycles in: the corner region had shrunk to 24 of 4096 cells, and the hire
 * and the drill rig bought for it both landed inside, unable to reach any
 * work for the rest of the run.
 *
 * The corner is still tried first, exactly as before: the same anchor, the
 * same fill, the same tie-breaks, so on a healthy site this returns the cell
 * the two spawn paths always got. What is new is that the answer is checked
 * rather than assumed. The fill reports how many cells the corner's own
 * region holds; if that is more than half of the grid's usable cells, no
 * other region can be bigger, so the corner IS the main region and the answer
 * stands. Only when it is not does this pay for `findNearestNavigableCell`'s
 * all-regions scan — the case where the old code was simply wrong, and where
 * there is therefore no earlier answer worth reproducing.
 *
 * That case is not hypothetical: on treranium_depths, the campaign's biggest
 * level, the corner's region is 16 cells of 25,600, so every hire and every
 * vehicle bought there used to land on a 16-cell rock. It is also why the
 * hire/buy benchmarks got faster as they got wronger — filling a 16-cell
 * island costs nothing.
 *
 * The check is exact, not a heuristic, and costs one cell count rather than a
 * second flood fill: two fills measured 277ms on treranium_depths' 160x160
 * grid against the hire benchmark's 200ms budget (#458 T6.2/D14).
 */
export function findNearestSpawnCell(
  navGrid: NavGrid,
  targetX: number,
  targetZ: number,
): { x: number; z: number } {
  const fromCorner = reachableAnswer(navGrid, 0, 0, targetX, targetZ, true);
  // Usable cells can only ever be a subset of all cells, so clearing half of
  // the whole grid clears half of the usable ones without counting them. That
  // is the case on any ordinary site, and it keeps the common path free of
  // even the sweep below.
  if (fromCorner.count * 2 > navGrid.width * navGrid.height) return fromCorner.cell;
  if (fromCorner.count * 2 > countUsableCells(navGrid)) return fromCorner.cell;
  // The corner is on an island, so there is no prior behaviour worth
  // reproducing here — answer from the largest region directly. One scan,
  // not a scan plus a second fill: treranium_depths reaches this path on
  // every spawn (its corner region is 16 cells of 25,600), so this is the
  // path the hire and buy benchmarks actually measure.
  return findNearestNavigableCell(navGrid, targetX, targetZ, true);
}

/**
 * How many cells a spawn could stand on at all — traversable and unoccupied,
 * the same predicate `reachableAnswer`'s fill counts under. A plain sweep, no
 * BFS: this exists so the majority test above stays cheap.
 */
function countUsableCells(navGrid: NavGrid): number {
  const { width, height, originX, originZ } = navGrid;
  let n = 0;
  for (let z = originZ; z < originZ + height; z++) {
    for (let x = originX; x < originX + width; x++) {
      // One cell lookup, not the two that `isTraversableCell` plus
      // `isOccupiedCell` would each make separately — this sweep runs over
      // every cell of the grid on every mid-game spawn.
      const cell = navGrid.cellAt(x, z);
      if (!cell || cell.type === 'blocked' || cell.type === 'void') continue;
      if (isCellOccupied(cell)) continue;
      n++;
    }
  }
  return n;
}

/** Component label for a cell no component scan has claimed yet. */
const UNVISITED = -1;

// ---------------------------------------------------------------------------
// Flood-fill scratch (#458 T6.2/D14)
// ---------------------------------------------------------------------------
//
// Same rationale as Pathfinding.ts's A* scratch arrays: a Set<string> per
// call means a string-keyed hash-table entry (allocation + hashing) for
// every one of potentially thousands of reachable cells on D13's bigger
// levels, discarded as garbage on return. A flat Uint8Array visited flag
// plus an Int32Array queue (packed row-major indices) replace it. Grown
// (never shrunk) to fit the largest grid seen; only the cells touched by the
// PREVIOUS call are cleared before reuse (via the queue itself), not the
// whole buffer, so a small flood fill on a big level stays cheap regardless
// of how large the level is.
let scratchCapacity = 0;
let visitedArr = new Uint8Array(0);
let queueArr = new Int32Array(0);
let lastFillCount = 0;

function ensureReachabilityScratch(size: number): void {
  if (size <= scratchCapacity) return;
  scratchCapacity = size;
  visitedArr = new Uint8Array(size);
  queueArr = new Int32Array(size);
  lastFillCount = 0; // fresh arrays are already all-zero; nothing to clear
}

/**
 * 8-directional flood fill from (anchorX, anchorZ). The anchor itself is
 * always added to the visited set regardless of its own traversability (#1025)
 * — findNearestReachableCell's caller already nudged it onto a traversable
 * cell first, but computeReachableSet/computeClimbReachableSet's anchor is the
 * agent's live position exactly as-is, traversable or not. Only NEIGHBOURS
 * discovered from the anchor outward are gated by isTraversableCell (and,
 * when applicable, occupancy/climb) below. Shared by findNearestReachableCell
 * and computeReachableSet so both agree on every fixture. Result is only
 * valid until the next call —
 * callers must either consume it synchronously (findNearestReachableCell) or
 * copy what they need out of it (computeReachableSet).
 *
 * `climbAware` additionally applies `isStepClimbable`/`NAV_MAX_SLOPE_RATIO`
 * per step (#953, slope-based since #1151), which is what makes the fill match `findPath`'s own
 * neighbour expansion exactly rather than only its impassability check.
 *
 * `avoidOccupancy` (#954 follow-up fix, default false — every pre-existing
 * caller unchanged) additionally refuses a vehicle- or fragment-occupied
 * neighbour, mirroring `Pathfinding.isImpassable`'s own `avoidVehicles: true`
 * rule for foot travel — see `findNearestTraversableCell`'s own doc comment
 * for why entity-spawn placement (the only caller that passes true) needs it.
 *
 * Every diagonal step is also refused when it clips a blocked/void corner
 * (#1197's `isDiagonalCornerClear`, imported from `Pathfinding.ts` rather
 * than reimplemented — one predicate, shared) — unconditionally, regardless
 * of `climbAware`, since real `findPath` routing refuses a corner-cut on
 * every diagonal step it considers, climb-gated or not (#1231). Before this,
 * this fill was strictly MORE permissive than `findPath`: it could report a
 * cell reachable that no real route — climb-gated or plain — could actually
 * resolve, which is exactly how a debris pocket whose only access requires an
 * illegal corner-cut went un-flagged as `target_unreachable` and stranded a
 * dispatched employee against it forever.
 */
function floodFillReachable(
  navGrid: NavGrid,
  anchorX: number,
  anchorZ: number,
  climbAware: boolean = false,
  avoidOccupancy: boolean = false,
  requiredClearance: number = NAV_CLEARANCE_EMPLOYEE_CELLS,
): { width: number; height: number; count: number } {
  return floodFillFromSources(navGrid, [{ x: anchorX, z: anchorZ }], climbAware, avoidOccupancy, requiredClearance);
}

/**
 * The per-step gates every fill shares once the destination is known to be a
 * passable, in-grid cell: the #1231 corner-cut refusal (the same one
 * findPath's neighbour expansion applies, #1197 — O(1), two extra cellAt
 * lookups), the optional climb gate, and the destination's clearance.
 */
function isLegalStep(
  navGrid: NavGrid,
  x: number,
  z: number,
  from: NavCell | null | undefined,
  nx: number,
  nz: number,
  to: NavCell,
  climbAware: boolean,
  requiredClearance: number,
): boolean {
  const dx = nx - x;
  const dz = nz - z;
  if (dx !== 0 && dz !== 0 && !isDiagonalCornerClear(navGrid, x, z, nx, nz)) return false;
  if (climbAware && !isStepClimbable(from?.surfaceY, to.surfaceY, Math.hypot(dx, dz))) return false;
  return hasClearance(to, requiredClearance);
}

/**
 * `floodFillReachable`'s body, seeded from several in-grid source cells at once
 * (#1306): one fill answers "reachable from ANY source" at a cost bounded by the
 * grid, never by the number of sources. A single source is exactly the old
 * single-anchor fill.
 */
function floodFillFromSources(
  navGrid: NavGrid,
  sources: ReadonlyArray<{ x: number; z: number }>,
  climbAware: boolean,
  avoidOccupancy: boolean,
  requiredClearance: number,
): { width: number; height: number; count: number } {
  const width = navGrid.width;
  const height = navGrid.height;
  ensureReachabilityScratch(width * height);

  // Clear only what the previous call actually touched, not the whole grid.
  for (let i = 0; i < lastFillCount; i++) visitedArr[queueArr[i]!] = 0;

  let count = 0;
  for (const source of sources) {
    const startIdx = (source.z - navGrid.originZ) * width + (source.x - navGrid.originX);
    if (visitedArr[startIdx]) continue;
    visitedArr[startIdx] = 1;
    queueArr[count++] = startIdx;
  }

  for (let head = 0; head < count; head++) {
    const idx = queueArr[head]!;
    const x = navGrid.originX + (idx % width);
    const z = navGrid.originZ + ((idx / width) | 0);
    const cell = climbAware ? navGrid.cellAt(x, z) : null;
    for (const [dx, dz] of NEIGHBOUR_OFFSETS_8) {
      const nx = x + dx;
      const nz = z + dz;
      if (!navGrid.containsCell(nx, nz)) continue;
      // Visited check first — see the identical note in
      // findNearestNavigableCell's own fill. Behaviour is unchanged; the
      // checks below only ever mattered for a cell about to be enqueued.
      const neighborIdx = (nz - navGrid.originZ) * width + (nx - navGrid.originX);
      if (visitedArr[neighborIdx]) continue;
      const neighbourCell = navGrid.cellAt(nx, nz);
      if (!neighbourCell || neighbourCell.type === 'blocked' || neighbourCell.type === 'void') continue;
      if (avoidOccupancy && isCellOccupied(neighbourCell)) continue;
      if (!isLegalStep(navGrid, x, z, cell, nx, nz, neighbourCell, climbAware, requiredClearance)) continue;
      visitedArr[neighborIdx] = 1;
      queueArr[count++] = neighborIdx;
    }
  }

  lastFillCount = count;
  return { width, height, count };
}

function reachSourceCellX(navGrid: NavGrid, x: number): number {
  return Math.round(navGrid.clampX(x));
}

function reachSourceCellZ(navGrid: NavGrid, z: number): number {
  return Math.round(navGrid.clampZ(z));
}

/**
 * Row-major index of the cell `computeClimbReachableSetFromSources` floods from
 * for a source at (x, z): same clamp and rounding, so two sources with the same
 * index seed identical fills.
 */
export function reachSourceCellIndex(navGrid: NavGrid, x: number, z: number): number {
  return (reachSourceCellZ(navGrid, z) - navGrid.originZ) * navGrid.width
    + (reachSourceCellX(navGrid, x) - navGrid.originX);
}

/**
 * `computeClimbReachableSet` flooded from several sources at once (#1306): a cell
 * is in the set when it is climb-reachable from at least one source. Each source
 * is clamped into the grid like `computeClimbReachableSet`'s anchor, and a
 * stranded source reaches at least its own cell. No sources: the empty set.
 */
export function computeClimbReachableSetFromSources(
  navGrid: NavGrid,
  sources: ReadonlyArray<{ x: number; z: number }>,
  requiredClearance: number = NAV_CLEARANCE_EMPLOYEE_CELLS,
): ReachableSet {
  if (sources.length === 0) return EMPTY_REACHABLE_SET;
  const cells = sources.map(s => ({
    x: reachSourceCellX(navGrid, s.x),
    z: reachSourceCellZ(navGrid, s.z),
  }));
  return snapshotFill(navGrid, cells, true, requiredClearance);
}

/** Climb-aware connected components of a nav grid for one clearance. */
export interface ClimbComponents {
  /**
   * Whether (tx, tz) is climb-reachable from the source (sx, sz) — exactly what
   * `computeClimbReachableSet(navGrid, sx, sz, clearance).has(tx, tz)` answers,
   * in O(1) after the one labelling pass. Passable cells with clearance are
   * symmetric under `isLegalStep`, so reachability between them is "same
   * component"; a source that is itself impassable (stranded by a blast) reaches
   * its own cell plus the components of the legal neighbours it can step onto.
   */
  canReach(sx: number, sz: number, tx: number, tz: number): boolean;
}

/**
 * One O(grid) labelling pass that answers any number of per-source reachability
 * queries (#1306) — the cost of judging N orders targeted at N different
 * employees is one labelling, not N fills.
 */
export function computeClimbComponents(
  navGrid: NavGrid,
  requiredClearance: number = NAV_CLEARANCE_EMPLOYEE_CELLS,
): ClimbComponents {
  const { width, height, originX, originZ } = navGrid;
  const label = new Int32Array(width * height);
  const stack = new Int32Array(width * height);
  const isGood = (cell: NavCell | null | undefined): cell is NavCell =>
    cell != null && cell.type !== 'blocked' && cell.type !== 'void' && hasClearance(cell, requiredClearance);

  let next = 0;
  for (let start = 0; start < label.length; start++) {
    if (label[start] !== 0) continue;
    const startX = originX + (start % width);
    const startZ = originZ + ((start / width) | 0);
    if (!isGood(navGrid.cellAt(startX, startZ))) continue;
    next++;
    label[start] = next;
    let top = 0;
    stack[top++] = start;
    while (top > 0) {
      const idx = stack[--top]!;
      const x = originX + (idx % width);
      const z = originZ + ((idx / width) | 0);
      const cell = navGrid.cellAt(x, z);
      for (const [dx, dz] of NEIGHBOUR_OFFSETS_8) {
        const nx = x + dx;
        const nz = z + dz;
        if (!navGrid.containsCell(nx, nz)) continue;
        const nIdx = (nz - originZ) * width + (nx - originX);
        if (label[nIdx] !== 0) continue;
        const to = navGrid.cellAt(nx, nz);
        if (!isGood(to) || !isLegalStep(navGrid, x, z, cell, nx, nz, to, true, requiredClearance)) continue;
        label[nIdx] = next;
        stack[top++] = nIdx;
      }
    }
  }

  const labelAt = (x: number, z: number): number =>
    navGrid.containsCell(x, z) ? label[(z - originZ) * width + (x - originX)]! : 0;

  return {
    canReach(sx, sz, tx, tz): boolean {
      const fromX = Math.round(navGrid.clampX(sx));
      const fromZ = Math.round(navGrid.clampZ(sz));
      if (!navGrid.containsCell(fromX, fromZ)) return false;
      if (fromX === tx && fromZ === tz) return true;
      const targetLabel = labelAt(tx, tz);
      if (targetLabel === 0) return false;
      const sourceLabel = labelAt(fromX, fromZ);
      if (sourceLabel !== 0) return sourceLabel === targetLabel;
      const from = navGrid.cellAt(fromX, fromZ);
      for (const [dx, dz] of NEIGHBOUR_OFFSETS_8) {
        const nx = fromX + dx;
        const nz = fromZ + dz;
        if (labelAt(nx, nz) !== targetLabel) continue;
        const to = navGrid.cellAt(nx, nz);
        if (to !== undefined && isLegalStep(navGrid, fromX, fromZ, from, nx, nz, to, true, requiredClearance)) return true;
      }
      return false;
    },
  };
}
