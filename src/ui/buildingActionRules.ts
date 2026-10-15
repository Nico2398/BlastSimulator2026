// Which building actions the inspector offers, and why one is not (#1758).

import type { Building, BuildingTier, BuildingType } from '../core/entities/Building.js';
import type { GameState } from '../core/state/GameState.js';

export interface BuildingActionRules {
  upgrade: {
    kind: 'available' | 'locked' | 'refused';
    cost: number | null;
    reasonKey: string | null;
    reasonParams?: Record<string, string | number>;
    nextTier: BuildingTier | null;
    cutoff: number | null;
  };
  research: {
    type: BuildingType;
    tier: BuildingTier;
    cost: number;
    duration: number;
    queued: { fraction: number; remaining: number } | null;
  } | null;
  move: { cost: number; disabledReasonKey: string | null };
  demolish: { cost: number; disabledReasonKey: string | null };
}

export function buildingActionRules(
  _state: GameState,
  _b: Building,
  _reservations?: ReadonlySet<number>,
): BuildingActionRules {
  throw new Error('not implemented'); // TODO: implement
}
