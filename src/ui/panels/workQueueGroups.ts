/** Pure grouping model for the Operations work queue (#1972): auto-debris orders collapse into one row per type. */
import type { PendingAction, BlockedOrderReason } from '../../core/state/GameState.js';
import { isAutoDebrisAction, type AutoDebrisActionType } from '../../core/economy/HaulDispatch.js';
import { classifyQueuedBlock, isInTransitBlock, rankBlockedKinds } from '../notify/blockedOrders.js';

export const DEBRIS_GROUP_PAGE_SIZE = 25;

export interface DebrisGroup {
  type: AutoDebrisActionType;
  ids: number[];
  total: number;
  /** Every queued order, including the blocked, stranded and in-transit ones counted below. */
  queued: number;
  /** Queued orders with no block. */
  open: number;
  assigned: number;
  inProgress: number;
  blocked: number;
  stranded: number;
  inTransit: number;
  /** Queued orders per blocked reason (failure reasons drive the cause line). */
  blockedReasons: Partial<Record<BlockedOrderReason, number>>;
}

export interface WorkQueueModel {
  player: PendingAction[];
  debris: DebrisGroup[];
}

/** One pass: splits player orders from auto-debris groups, dropping 'rest'. */
export function partitionWorkQueue(actions: readonly PendingAction[]): WorkQueueModel {
  const player: PendingAction[] = [];
  const groups = new Map<AutoDebrisActionType, DebrisGroup>();
  for (const a of actions) {
    if (!isAutoDebrisAction(a.type)) {
      if (a.type !== 'rest') player.push(a);
      continue;
    }
    let g = groups.get(a.type);
    if (!g) {
      g = { type: a.type, ids: [], total: 0, queued: 0, open: 0, assigned: 0, inProgress: 0, blocked: 0, stranded: 0, inTransit: 0, blockedReasons: {} };
      groups.set(a.type, g);
    }
    g.ids.push(a.id);
    g.total++;
    if (a.status === 'assigned') g.assigned++;
    else if (a.status === 'in_progress') g.inProgress++;
    else {
      g.queued++;
      const block = classifyQueuedBlock(a);
      g[block]++;
      if (block === 'blocked' && a.blockedReason != null) g.blockedReasons[a.blockedReason] = (g.blockedReasons[a.blockedReason] ?? 0) + 1;
    }
  }
  const debris = [...groups.values()];
  // pendingActions is normally id-ordered (already sorted: linear); the sort guarantees ascending ids for paging.
  for (const g of debris) g.ids.sort((x, y) => x - y);
  return { player, debris };
}

/** Counts-only signature of a group (no ids). */
export function debrisGroupSignature(group: DebrisGroup): string {
  return `${group.type}:${group.total}:${group.queued}:${group.open}:${group.assigned}:${group.inProgress}:${group.blocked}:${group.stranded}:${group.inTransit}:${rankBlockedKinds(group.blockedReasons).map(e => `${e.kind}=${e.count}`).join(',')}`;
}

/** Signature of a list of order rows (player orders, or one expanded debris page); `tick` included for time-dependent display. */
export function orderRowsSignature(rows: readonly PendingAction[], tick: number): string {
  let sig = '';
  let inTransit = false;
  for (const a of rows) {
    sig += `${a.id}:${a.status}:${a.holderId}:${a.blockedReason ?? ''};`;
    if (a.status === 'queued' && isInTransitBlock(a)) inTransit = true;
  }
  return inTransit ? `${sig}@${tick}` : sig;
}

/** Number of pages a group of `total` orders spans. */
export function debrisPageCount(total: number): number {
  return Math.ceil(total / DEBRIS_GROUP_PAGE_SIZE);
}

/** Clamps a 0-based page into [0, last page] of a group of `total` orders. */
export function clampDebrisPage(page: number, total: number): number {
  return Math.min(Math.max(0, Math.trunc(page) || 0), Math.max(0, debrisPageCount(total) - 1));
}

/** The orders of one (already clamped) page of a group, in ascending id order: one pass over `actions`, ids come from the group. */
export function debrisPageRows(actions: readonly PendingAction[], group: DebrisGroup, page: number): PendingAction[] {
  const from = page * DEBRIS_GROUP_PAGE_SIZE;
  const wanted = new Set(group.ids.slice(from, from + DEBRIS_GROUP_PAGE_SIZE));
  const found = new Map<number, PendingAction>();
  for (const a of actions) {
    if (wanted.has(a.id)) {
      found.set(a.id, a);
      if (found.size === wanted.size) break;
    }
  }
  const rows: PendingAction[] = [];
  for (const id of wanted) {
    const a = found.get(id);
    if (a) rows.push(a);
  }
  return rows;
}
