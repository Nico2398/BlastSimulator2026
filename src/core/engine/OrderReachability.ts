// BlastSimulator2026 — queued-order reachability classification (#1306)
//
// Skeleton: signatures only, implementation lands in the green phase.

import type { GameState, PendingAction } from '../state/GameState.js';

/** Identity of the actor pool able to serve an order (skill + vehicle role, or one named employee). */
export type OrderActorKey = string;

export type OrderReachabilityVerdict = 'reachable' | 'unreachable';

/** Per-actor-pool reachability query over the current nav grid. */
export interface OrderReachability {
  canReach(key: OrderActorKey, x: number, z: number): boolean;
  hasActor(key: OrderActorKey): boolean;
}

export function orderActorKey(
  _action: Pick<PendingAction, 'requiredSkill' | 'requiredVehicleRole' | 'targetEmployeeId'>,
): OrderActorKey {
  throw new Error('not implemented');
}

export function buildOrderReachability(
  _state: GameState,
  _actions: ReadonlyArray<PendingAction>,
): OrderReachability {
  throw new Error('not implemented');
}

export function judgeQueuedOrders(_state: GameState): Map<number, OrderReachabilityVerdict> {
  throw new Error('not implemented');
}

export function classifyQueuedOrders(_state: GameState): { unqualifiedIds: Set<number> } {
  throw new Error('not implemented');
}

export function classifyNewOrder(_state: GameState, _actionId: number): void {
  throw new Error('not implemented');
}

export function refreshOrderReachability(_state: GameState): void {
  throw new Error('not implemented');
}
