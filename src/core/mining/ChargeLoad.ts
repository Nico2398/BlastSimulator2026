// BlastSimulator2026 — Charge loading: explosives are bought as each hole is loaded, at list price (#2153)

import type { GameState, PendingAction } from '../state/GameState.js';

/** Price factor the live event modifiers put on explosives (#1414); 1 when none. */
export function explosivePriceFactor(_state: Pick<GameState, 'events' | 'tickCount'>): number {
  throw new Error('not implemented');
}

/** Cash cost of loading `amountKg` into a hole now: list price x event factor; pure. */
export function quoteChargeLoad(
  _state: Pick<GameState, 'events' | 'tickCount'>,
  _explosiveId: string,
  _amountKg: number,
): { cost: number } {
  throw new Error('not implemented');
}

/** True when current cash covers the load. */
export function canAffordChargeLoad(
  _state: Pick<GameState, 'events' | 'tickCount' | 'cash'>,
  _explosiveId: string,
  _amountKg: number,
): boolean {
  throw new Error('not implemented');
}

/** Load time: pay list price from cash and book the 'explosives' expense. */
export function loadChargeExplosive(_state: GameState, _explosiveId: string, _amountKg: number): { cost: number } {
  throw new Error('not implemented');
}

/** True for a `charge_hole` order whose cost cash cannot cover at fill time. */
export function isChargeUnaffordable(
  _state: Pick<GameState, 'events' | 'tickCount' | 'cash'>,
  _action: Pick<PendingAction, 'type' | 'payload'>,
): boolean {
  throw new Error('not implemented');
}
