// BlastSimulator2026 — Water fixes carried by the water warnings (#2267)
// Drain, tube and open-the-water-section controls shared by the Fire checklist and the
// preflight modal. Every action is a console command the Charge step already uses.

import type { GameState } from '../../core/state/GameState.js';

/** Which warning row the fixes belong to: holes already wet, or holes rain will fill. */
export type WaterFixTarget = 'wet' | 'rain';

export interface WaterFixOffer {
  readonly target: WaterFixTarget;
  /** Wet holes that can be drained now. */
  readonly drainableIds: readonly string[];
  /** Wet untubed holes in porous rock: tubing must come before draining. */
  readonly porousBlockedIds: readonly string[];
  /** Holes the tube action installs on. */
  readonly tubeIds: readonly string[];
  readonly wetCount: number;
  readonly drainCost: number;
  readonly cash: number;
  readonly stock: number;
}

export interface WaterFixIO {
  readonly run: (command: string) => void;
  readonly openWater?: () => void;
}

export function waterFixOffer(_state: GameState, _target: WaterFixTarget): WaterFixOffer {
  throw new Error('not implemented');
}

/** Cheap string that changes whenever what the fixes show changes (for render signatures). */
export function waterFixKey(_state: GameState): string {
  throw new Error('not implemented');
}

export function buildWaterFixes(_offer: WaterFixOffer, _io: WaterFixIO): HTMLElement {
  throw new Error('not implemented');
}
