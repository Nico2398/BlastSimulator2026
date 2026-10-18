/** Pure grouping model for the Operations work queue (#1972): auto-debris orders collapse into one row per type. */
import type { ActionType, PendingAction } from '../../core/state/GameState.js';

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
export function partitionWorkQueue(_actions: readonly PendingAction[]): WorkQueueModel {
  // TODO: implement
  return { player: [], debris: [] };
}

/** Counts-only signature of a group (no ids). */
export function debrisGroupSignature(_group: DebrisGroup): string {
  // TODO: implement
  return '';
}

/** Signature of the player rows; `tick` included for time-dependent display. */
export function playerRowsSignature(_player: readonly PendingAction[], _tick: number): string {
  // TODO: implement
  return '';
}

/** One page of a debris type's orders for the expanded group. */
export function debrisPage(
  _actions: readonly PendingAction[],
  _type: ActionType,
  _page: number,
): { rows: PendingAction[]; pageCount: number } {
  // TODO: implement
  return { rows: [], pageCount: 0 };
}
