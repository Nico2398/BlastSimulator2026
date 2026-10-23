// BlastSimulator2026 — Stranded access bookkeeping (#2085)
// Helpers for syncCraterAccess: which ramp work is genuinely live, which stranded debris orders to drop,
// and which planned ramps are stuck so planners route around them.

import { CRATER_ACCESS_CLUSTER_GAP_CELLS } from '../config/balance.js';
import type { GameState, PendingAction, RampFootprint } from '../state/GameState.js';
import type { StrandedFloor } from '../mining/CraterAccess.js';
import { abandonDebrisFragments, isAutoDebrisAction } from '../economy/HaulDispatch.js';
import { cancelAction } from './TaskCancellation.js';

/** Chebyshev reach (cells) from a floor's representative cell within which its debris orders belong to it. */
const FLOOR_REACH_CELLS = CRATER_ACCESS_CLUSTER_GAP_CELLS * 2;

/**
 * True for a dig_ramp_segment order that is queued, unheld and stamped blocked (target_unreachable etc.).
 * Only queued orders are reclassified, so a held order can carry a stale stamp from before its claim: it is live.
 */
function isStuckRampSegment(a: PendingAction): boolean {
  return a.type === 'dig_ramp_segment' && a.holderId === null && a.status === 'queued' && (a.blockedReason ?? null) !== null;
}

/** True when some dig_ramp_segment order is pending and not stuck (see `isStuckRampSegment`). */
export function hasLiveRampWork(pending: ReadonlyArray<PendingAction>): boolean {
  return pending.some(a => a.type === 'dig_ramp_segment' && !isStuckRampSegment(a));
}

/** First tick each unplannable floor was seen, per state; a floor that leaves the list loses its clock. */
const firstSeen = new WeakMap<object, Map<string, number>>();

const floorKey = (f: StrandedFloor): string => `${Math.round(f.x)},${Math.round(f.z)}`;

/**
 * Cancels auto-debris orders stamped debris_out_of_reach inside floors planCraterAccess reported unplannable
 * for >= abandonTicks. Returns removed ids. Never touches holes, patterns or non-debris orders.
 * Their fragments are marked so the haul dispatcher does not re-queue them until a ramp is ordered.
 */
export function pruneAbandonedDebris(
  state: GameState,
  unplannable: ReadonlyArray<StrandedFloor>,
  nowTick: number,
  abandonTicks: number,
): number[] {
  const clocks = firstSeen.get(state) ?? new Map<string, number>();
  firstSeen.set(state, clocks);
  const current = new Set(unplannable.map(floorKey));
  for (const key of [...clocks.keys()]) if (!current.has(key)) clocks.delete(key);
  const expired: StrandedFloor[] = [];
  for (const floor of unplannable) {
    const key = floorKey(floor);
    const since = clocks.get(key) ?? nowTick;
    clocks.set(key, since);
    if (nowTick - since >= abandonTicks) expired.push(floor);
  }
  if (expired.length === 0) return [];

  const doomed = state.pendingActions.filter(a =>
    isAutoDebrisAction(a.type) && a.status === 'queued' && a.holderId === null && a.blockedReason === 'debris_out_of_reach'
    && expired.some(f => Math.abs(a.targetX - f.x) <= FLOOR_REACH_CELLS && Math.abs(a.targetZ - f.z) <= FLOOR_REACH_CELLS));
  const removed: number[] = [];
  const fragmentIds: number[] = [];
  for (const a of doomed) {
    const fragmentId = a.payload['fragmentId'];
    if (!cancelAction(state, a.id).success) continue;
    removed.push(a.id);
    if (typeof fragmentId === 'number') fragmentIds.push(fragmentId);
  }
  abandonDebrisFragments(state, fragmentIds);
  return removed;
}

/** Footprints of planned ramps whose every remaining segment is stuck (blocked and unheld); planners avoid these. */
export function blockedRampFootprints(state: Pick<GameState, 'plannedRamps' | 'pendingActions'>): RampFootprint[] {
  const blockedActions = new Set<number>();
  for (const a of state.pendingActions) {
    if (isStuckRampSegment(a)) blockedActions.add(a.id);
  }
  if (blockedActions.size === 0) return [];
  const out: RampFootprint[] = [];
  for (const ramp of state.plannedRamps) {
    const remaining = ramp.segments.filter(s => !s.done);
    if (remaining.length > 0 && remaining.every(s => blockedActions.has(s.actionId))) out.push(ramp.footprint);
  }
  return out;
}
