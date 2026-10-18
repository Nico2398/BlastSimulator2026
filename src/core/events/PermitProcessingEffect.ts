// BlastSimulator2026 — Effect handler for events that act on a pending permit application (#1927)

import type { PermitProcessingSpec } from './EventEffectCatalog.js';
import type { EffectOutcome, EventWorld } from './TrafficJamEffects.js';
import { pushModifier } from './ActiveModifiers.js';
import { approvePendingApplication, gradeDef, shiftPendingApplication } from '../economy/MineGrade.js';
import { deductExpense } from '../economy/Finance.js';
import { EventEmitter } from '../state/EventEmitter.js';

const ALT: EffectOutcome = { effects: [], cashChange: 0, cashSettled: 0, scoreChanges: {}, resultKeySuffix: '_alt' };

/** Shifts or approves the pending permit application; '_alt' outcome when none is pending. */
export function applyPermitProcessing(spec: PermitProcessingSpec, world: EventWorld, tick: number): EffectOutcome {
  const { state } = world;
  const g = state.grade;
  const done = (cashSettled = 0): EffectOutcome => ({ effects: [], cashChange: 0, cashSettled, scoreChanges: {}, resultKeySuffix: '' });

  if (spec.action === 'approve') {
    if (!g?.pending) return { ...ALT };
    const fee = Math.round(gradeDef(g.pending.toGrade).fee * spec.feePct / 100);
    deductExpense(state, fee, 'permits', `Expediting stamp: grade ${g.pending.toGrade}`);
    approvePendingApplication(g, world.emitter ?? new EventEmitter());
    return done(-fee);
  }

  if (!g || (!g.pending && !spec.next)) return { ...ALT };
  const below = spec.safetyMin !== undefined && state.scores.safety < spec.safetyMin;
  const ticks = below ? spec.ticksBelow ?? spec.ticks : spec.ticks;
  if (g.pending && !spec.next) {
    shiftPendingApplication(g, ticks);
  } else {
    pushModifier(state.events, {
      kind: 'permit_delay', sourceEventId: state.events.pendingEvent?.eventId ?? '', role: null, targetId: null,
      category: null, magnitude: ticks, startTick: tick, endTick: null,
    });
  }
  return done();
}
