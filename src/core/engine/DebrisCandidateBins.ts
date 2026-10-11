// BlastSimulator2026 — Debris candidates thinned to one per spatial bin (#1603)
//
// A large blast queues one haul or breaker order per fragment — thousands of
// them. Ranking an idle employee's candidates plans an itinerary per candidate
// (walk to the vehicle, drive, deliver), so after such a blast every idle
// employee spent tens of milliseconds per tick costing rock they will never
// pick. Debris lies in heaps, and two pieces a few metres apart cost the same
// trip to within a few ticks, so the open debris orders are binned spatially
// and a search weighs one member per bin — the piece nearest the employee —
// and only the bins nearest the employee. The employee still goes for the
// cheapest of those, and the hauler's own pickup sweep (findNearbyHaulableFragments)
// collects that piece's neighbours into the same load — hauling stays orderly
// and works the pile from the near side, it just stops weighing every pebble.
//
// The bins are kept per game state and rebuilt only when an order is added or
// removed: a claim changes an order's status, not its bin, and every member is
// checked against the caller's candidates and gates as it is tried.

import type { GameState, PendingAction } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import { octileHeuristic } from '../nav/Pathfinding.js';
import {
  DEBRIS_SELECTION_BIN_CELLS,
  DEBRIS_SELECTION_BIN_PROBES,
  DEBRIS_SELECTION_BINNING_MIN,
  DEBRIS_SELECTION_MAX_BINS,
  DEBRIS_SELECTION_MAX_BINS_TRIED_PER_KIND,
} from '../config/balance.js';

type DebrisPool = Pick<GameState, 'pendingActions' | 'nextPendingActionId'>;

/** One bin of debris orders: one type, one destination class, one square of ground. */
interface DebrisBin {
  key: number;
  /** Centre of the bin's ground square, for ranking bins by distance. */
  x: number;
  z: number;
  /** Every debris order in the bin. */
  members: PendingAction[];
}

interface DebrisIndex {
  actions: readonly PendingAction[];
  length: number;
  nextId: number;
  bins: DebrisBin[];
  /** Id range of the debris orders binned (every debris candidate is one of them). */
  minId: number;
  maxId: number;
}

/**
 * The candidates worth costing: every non-debris candidate `allowed` lets
 * through, plus up to `DEBRIS_SELECTION_MAX_BINS` debris representatives —
 * bins tried nearest `employee` first, at most
 * `DEBRIS_SELECTION_MAX_BINS_TRIED_PER_KIND` of each kind, each represented by
 * its member nearest `employee` (lowest id on a tie) that is among
 * `candidates` and that `allowed` accepts. At most
 * `DEBRIS_SELECTION_BIN_PROBES` candidate members of a bin are tried, since
 * `allowed` holds the costly claim gates (vehicle, storage room) and a bin of
 * rock nobody can take right now is given up on quickly rather than checked
 * piece by piece. A bin groups orders of one type, one destination class
 * (`carriesOre`: ore to a warehouse, barren rock to a spoil heap) and one
 * `DEBRIS_SELECTION_BIN_CELLS`-square of ground. A pool with at most
 * `DEBRIS_SELECTION_BINNING_MIN` debris candidates is simply filtered by
 * `allowed`, so ordinary play ranks exactly as before. Order is not preserved
 * — callers sort.
 */
export function thinDebrisCandidates(
  pool: DebrisPool,
  employee: Pick<Employee, 'x' | 'z'>,
  candidates: readonly PendingAction[],
  isDebris: (action: PendingAction) => boolean,
  carriesOre: (action: PendingAction) => boolean,
  allowed: (action: PendingAction) => boolean,
): PendingAction[] {
  let debris = 0;
  for (const action of candidates) if (isDebris(action)) debris++;
  if (debris <= DEBRIS_SELECTION_BINNING_MIN) return candidates.filter(allowed);

  const index = indexOf(pool, isDebris, carriesOre);
  const bins = index.bins;
  // One pass: stamp the debris candidates, keep the other candidates allowed.
  const span = index.maxId - index.minId + 1;
  if (stamps.length < span) stamps = new Uint32Array(span);
  if (++stamp === 0xffffffff) { stamps.fill(0); stamp = 1; }
  const mark = stamp;
  const base = index.minId;
  const marks = stamps;
  const out: PendingAction[] = [];
  for (const action of candidates) {
    if (isDebris(action)) marks[action.id - base] = mark;
    else if (allowed(action)) out.push(action);
  }
  const isCandidate = (action: PendingAction): boolean => marks[action.id - base] === mark;

  const distance = bins.map(bin => octileHeuristic(employee.x, employee.z, bin.x, bin.z));
  const order = bins.map((_, i) => i).sort((a, b) => distance[a]! - distance[b]! || bins[a]!.key - bins[b]!.key);

  let kept = 0;
  const tried = [0, 0, 0, 0]; // per bin kind: the low two bits of its key
  for (const i of order) {
    if (kept >= DEBRIS_SELECTION_MAX_BINS) break;
    const kind = bins[i]!.key & 3;
    if (tried[kind]! >= DEBRIS_SELECTION_MAX_BINS_TRIED_PER_KIND) continue;
    const members = bins[i]!.members.filter(isCandidate);
    if (members.length === 0) continue;
    tried[kind]!++;
    const near = members.map(member => ({ member, d: octileHeuristic(employee.x, employee.z, member.targetX, member.targetZ) }));
    near.sort((a, b) => a.d - b.d || a.member.id - b.member.id);
    const probes = Math.min(near.length, DEBRIS_SELECTION_BIN_PROBES);
    for (let k = 0; k < probes; k++) {
      if (allowed(near[k]!.member)) { out.push(near[k]!.member); kept++; break; }
    }
  }
  return out;
}

/**
 * Membership of a search's debris candidates, as a stamp per action id over
 * the pool's id range: a Set of thousands of ids built per search was most of
 * a search's own cost. The buffer is reused; each search writes a fresh stamp.
 */
let stamps = new Uint32Array(0);
let stamp = 0;

const indexes = new WeakMap<DebrisPool, DebrisIndex>();

/** The pool's debris bins, rebuilt only when an order was added (`nextPendingActionId`) or removed. */
function indexOf(
  pool: DebrisPool,
  isDebris: (action: PendingAction) => boolean,
  carriesOre: (action: PendingAction) => boolean,
): DebrisIndex {
  const actions = pool.pendingActions;
  const cached = indexes.get(pool);
  if (cached !== undefined && cached.actions === actions && cached.length === actions.length
    && cached.nextId === pool.nextPendingActionId) return cached;

  const byKey = new Map<number, DebrisBin>();
  let minId = Infinity;
  let maxId = -Infinity;
  for (const action of actions) {
    if (!isDebris(action)) continue;
    if (action.id < minId) minId = action.id;
    if (action.id > maxId) maxId = action.id;
    const key = binKeyOf(action, carriesOre);
    const bin = byKey.get(key);
    if (bin !== undefined) {
      bin.members.push(action);
      continue;
    }
    const half = DEBRIS_SELECTION_BIN_CELLS / 2;
    byKey.set(key, {
      key,
      x: Math.floor(action.targetX / DEBRIS_SELECTION_BIN_CELLS) * DEBRIS_SELECTION_BIN_CELLS + half,
      z: Math.floor(action.targetZ / DEBRIS_SELECTION_BIN_CELLS) * DEBRIS_SELECTION_BIN_CELLS + half,
      members: [action],
    });
  }
  const index = { actions, length: actions.length, nextId: pool.nextPendingActionId, bins: [...byKey.values()], minId, maxId };
  indexes.set(pool, index);
  return index;
}

/**
 * Bin key per order, computed once: an order's type, destination class and
 * target never change, and resolving its fragment's ore again on every
 * rebuild was most of a rebuild's cost.
 */
const binKeys = new WeakMap<PendingAction, number>();

/** Bin coordinates are offset so a negative tile still packs to a non-negative integer. */
const BIN_COORD_OFFSET = 1 << 16;

function binKeyOf(action: PendingAction, carriesOre: (action: PendingAction) => boolean): number {
  let key = binKeys.get(action);
  if (key === undefined) {
    const bx = Math.floor(action.targetX / DEBRIS_SELECTION_BIN_CELLS) + BIN_COORD_OFFSET;
    const bz = Math.floor(action.targetZ / DEBRIS_SELECTION_BIN_CELLS) + BIN_COORD_OFFSET;
    const kind = (action.type === 'fragment_debris' ? 2 : 0) + (carriesOre(action) ? 1 : 0);
    key = (bx * (2 * BIN_COORD_OFFSET) + bz) * 4 + kind;
    binKeys.set(action, key);
  }
  return key;
}
