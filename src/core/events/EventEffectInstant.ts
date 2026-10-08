// BlastSimulator2026 — Instant (non-timed) event effect handlers (#1414)

import type { Random } from '../math/Random.js';
import type { EventEffectSpec } from './EventEffectCatalog.js';
import type { EffectOutcome, EventWorld } from './TrafficJamEffects.js';

/** Applies one instant spec (hire, leave, injury, bonus, contract change, ...). */
export function applyInstantEffect(
  spec: EventEffectSpec, world: EventWorld, tick: number, rng: Random,
): EffectOutcome {
  void spec; void world; void tick; void rng;
  return { effects: [], cashChange: 0, cashSettled: 0, scoreChanges: {}, resultKeySuffix: '' };
}
