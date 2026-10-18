// BlastSimulator2026 — Effect handler for events that act on a pending permit application (#1927)

import type { PermitProcessingSpec } from './EventEffectCatalog.js';
import type { EffectOutcome, EventWorld } from './TrafficJamEffects.js';

/** Shifts or approves the pending permit application; '_alt' outcome when none is pending. */
export function applyPermitProcessing(spec: PermitProcessingSpec, world: EventWorld, tick: number): EffectOutcome {
  void spec; void world; void tick; // TODO: implement
  return { effects: [], cashChange: 0, cashSettled: 0, scoreChanges: {}, resultKeySuffix: '_alt' };
}
