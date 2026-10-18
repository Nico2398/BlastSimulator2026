/** Pure grouping model for the Operations work queue (#1972): auto-debris orders collapse into one row per type. */
import type { ActionType, PendingAction } from '../../core/state/GameState.js';
import { isAutoDebrisAction } from '../../core/economy/HaulDispatch.js';
import { isFailureBlock, isInTransitBlock } from '../notify/blockedOrders.js';

export const DEBRIS_GROUP_PAGE_SIZE = 25;

export interface DebrisGroup {
  type: 'haul_debris' | 'fragment_debris';
  ids: number[];
  total: number;
  queued: number;
  assigned: number;
  inProgress: number;
  blocked: number;
  stranded: number;
  inTransit: number;
}

export interface WorkQueueModel {
  player: PendingAction[];
  debris: DebrisGroup[];
}

/** One pass: splits player orders from auto-debris groups, dropping 'rest'. */
export function partitionWorkQueue(actions: readonly PendingAction[]): WorkQueueModel {
  const player: PendingAction[] = [];
  const groups = new Map<DebrisGroup['type'], DebrisGroup>();
  for (const a of actions) {
    if (!isAutoDebrisAction(a.type)) {
      if (a.type !== 'rest') player.push(a);
      continue;
    }
    const type = a.type as DebrisGroup['type'];
    let g = groups.get(type);
    if (!g) {
      g = { type, ids: [], total: 0, queued: 0, assigned: 0, inProgress: 0, blocked: 0, stranded: 0, inTransit: 0 };
      groups.set(type, g);
    }
    g.ids.push(a.id);
    g.total++;
    if (a.status === 'assigned') g.assigned++;
    else if (a.status === 'in_progress') g.inProgress++;
    else {
      g.queued++;
      if (a.blockedReason != null) {
        if (isInTransitBlock(a)) g.inTransit++;
        else if (isFailureBlock(a)) g.blocked++;
        else g.stranded++;
      }
    }
  }
  const debris = [...groups.values()];
  for (const g of debris) g.ids.sort((x, y) => x - y);
  return { player, debris };
}

/** Counts-only signature of a group (no ids). */
export function debrisGroupSignature(group: DebrisGroup): string {
  return `${group.type}:${group.total}:${group.queued}:${group.assigned}:${group.inProgress}:${group.blocked}:${group.stranded}:${group.inTransit}`;
}

/** Signature of the player rows; `tick` included for time-dependent display. */
export function playerRowsSignature(player: readonly PendingAction[], tick: number): string {
  let sig = '';
  let inTransit = false;
  for (const a of player) {
    sig += `${a.id}:${a.status}:${a.holderId}:${a.blockedReason ?? ''};`;
    if (a.status === 'queued' && isInTransitBlock(a)) inTransit = true;
  }
  return inTransit ? `${sig}@${tick}` : sig;
}

/** One page (0-based, clamped) of a debris type's orders for the expanded group. */
export function debrisPage(
  actions: readonly PendingAction[],
  type: ActionType,
  page: number,
): { rows: PendingAction[]; pageCount: number } {
  const all = actions.filter(a => a.type === type).sort((x, y) => x.id - y.id);
  const pageCount = Math.ceil(all.length / DEBRIS_GROUP_PAGE_SIZE);
  const clamped = Math.min(Math.max(0, Math.trunc(page) || 0), Math.max(0, pageCount - 1));
  const from = clamped * DEBRIS_GROUP_PAGE_SIZE;
  return { rows: all.slice(from, from + DEBRIS_GROUP_PAGE_SIZE), pageCount };
}
