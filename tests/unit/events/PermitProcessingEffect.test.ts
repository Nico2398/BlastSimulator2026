// BlastSimulator2026 — permit_processing effect: handler, MineGrade entry points, delay modifier, chips (#1927)

import { describe, it, expect, beforeAll } from 'vitest';
import { applyPermitProcessing } from '../../../src/core/events/PermitProcessingEffect.js';
import { applyEventEffects, type PermitProcessingSpec } from '../../../src/core/events/EventEffectCatalog.js';
import { effectChips, effectChipText } from '../../../src/core/events/EventEffectText.js';
import { modifierSummary } from '../../../src/core/events/ModifierText.js';
import { isActive, takePermitDelay, type ActiveModifier } from '../../../src/core/events/ActiveModifiers.js';
import {
  createGradeState, sanitizeGradeState, applyForGrade, gradeDef,
  shiftPendingApplication, approvePendingApplication, recordBlastChargeShare,
  type GradeState,
} from '../../../src/core/economy/MineGrade.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import { makeEffectWorld, mod } from '../../helpers/eventEffectWorld.js';

function pendingGrade(ticksLeft: number, toGrade = 1): GradeState {
  return { ...createGradeState(), grade: toGrade - 1, pending: { toGrade, ticksLeft } };
}

function siteWith(g: GradeState | undefined, safety = 70) {
  const fx = makeEffectWorld();
  if (g) fx.state.grade = g;
  fx.state.scores.safety = safety;
  return fx;
}

const shift = (ticks: number, extra: Partial<Extract<PermitProcessingSpec, { action: 'shift' }>> = {}): PermitProcessingSpec =>
  ({ type: 'permit_processing', action: 'shift', ticks, ...extra });
const approve = (feePct = 25): PermitProcessingSpec => ({ type: 'permit_processing', action: 'approve', feePct });

describe('shiftPendingApplication', () => {
  it('moves ticksLeft by the given amount and returns true', () => {
    const g = pendingGrade(40);
    expect(shiftPendingApplication(g, 72)).toBe(true);
    expect(g.pending!.ticksLeft).toBe(112);
    expect(shiftPendingApplication(g, -12)).toBe(true);
    expect(g.pending!.ticksLeft).toBe(100);
  });

  it('never drops below 1 tick', () => {
    const g = pendingGrade(10);
    expect(shiftPendingApplication(g, -24)).toBe(true);
    expect(g.pending!.ticksLeft).toBe(1);
  });

  it('a shift of exactly ticksLeft-1 leaves 1', () => {
    const g = pendingGrade(25);
    shiftPendingApplication(g, -24);
    expect(g.pending!.ticksLeft).toBe(1);
  });

  it('returns false and changes nothing without a pending application', () => {
    const g = createGradeState();
    expect(shiftPendingApplication(g, 24)).toBe(false);
    expect(g.pending).toBeNull();
  });
});

describe('approvePendingApplication', () => {
  it('raises the grade, clears pending, emits grade_approved, returns true', () => {
    const g = pendingGrade(30, 1);
    const emitter = new EventEmitter();
    const seen: number[] = [];
    emitter.on('progression:grade_approved', p => seen.push(p.grade));
    expect(approvePendingApplication(g, emitter)).toBe(true);
    expect(g.grade).toBe(1);
    expect(g.pending).toBeNull();
    expect(seen).toEqual([1]);
  });

  it('returns false and emits nothing without a pending application', () => {
    const g = createGradeState();
    const emitter = new EventEmitter();
    let calls = 0;
    emitter.on('progression:grade_approved', () => { calls++; });
    expect(approvePendingApplication(g, emitter)).toBe(false);
    expect(g.grade).toBe(0);
    expect(calls).toBe(0);
  });
});

describe('recordBlastChargeShare', () => {
  it('stores planKg / maxChargeKg', () => {
    const g = createGradeState();
    recordBlastChargeShare(g, 72, 80);
    expect(g.lastBlastChargeShare).toBeCloseTo(0.9);
  });

  it('keeps shares above 1 for an over-limit blast', () => {
    const g = createGradeState();
    recordBlastChargeShare(g, 100, 80);
    expect(g.lastBlastChargeShare).toBeCloseTo(1.25);
  });

  it('overwrites the previous share', () => {
    const g = createGradeState();
    recordBlastChargeShare(g, 80, 80);
    recordBlastChargeShare(g, 8, 80);
    expect(g.lastBlastChargeShare).toBeCloseTo(0.1);
  });

  it('is a no-op for undefined grade state', () => {
    expect(() => recordBlastChargeShare(undefined, 10, 80)).not.toThrow();
  });
});

describe('lastBlastChargeShare persistence', () => {
  it('createGradeState starts at 0', () => {
    expect(createGradeState().lastBlastChargeShare).toBe(0);
  });

  it('sanitizeGradeState keeps a valid value', () => {
    const raw = { ...createGradeState(), lastBlastChargeShare: 0.75 };
    expect(sanitizeGradeState(raw)!.lastBlastChargeShare).toBe(0.75);
  });

  it('sanitizeGradeState falls back to 0 for a missing or malformed value', () => {
    const base = createGradeState() as unknown as Record<string, unknown>;
    delete base['lastBlastChargeShare'];
    expect(sanitizeGradeState(base)!.lastBlastChargeShare).toBe(0);
    expect(sanitizeGradeState({ ...base, lastBlastChargeShare: 'x' })!.lastBlastChargeShare).toBe(0);
    expect(sanitizeGradeState({ ...base, lastBlastChargeShare: -1 })!.lastBlastChargeShare).toBe(0);
  });
});

describe('takePermitDelay', () => {
  const delay = (magnitude: number, id: number): ActiveModifier => ({ ...mod({ kind: 'permit_delay', magnitude, endTick: null }), id });

  it('is 0 for an empty list', () => {
    expect(takePermitDelay([])).toBe(0);
  });

  it('is 0 and leaves other modifiers alone when no permit_delay exists', () => {
    const list: ActiveModifier[] = [{ ...mod({ kind: 'work_rate' }), id: 1 }];
    expect(takePermitDelay(list)).toBe(0);
    expect(list).toHaveLength(1);
  });

  it('sums every permit_delay and removes them', () => {
    const list: ActiveModifier[] = [delay(48, 1), { ...mod({ kind: 'work_rate' }), id: 2 }, delay(24, 3)];
    expect(takePermitDelay(list)).toBe(72);
    expect(list.map(m => m.kind)).toEqual(['work_rate']);
  });

  it('consumes once: a second call yields 0', () => {
    const list = [delay(48, 1)];
    expect(takePermitDelay(list)).toBe(48);
    expect(takePermitDelay(list)).toBe(0);
  });
});

describe('applyPermitProcessing — shift', () => {
  it('adds ticks to the pending application', () => {
    const { world, state } = siteWith(pendingGrade(40));
    const out = applyPermitProcessing(shift(72), world, 100);
    expect(state.grade!.pending!.ticksLeft).toBe(112);
    expect(out.resultKeySuffix).toBe('');
    expect(out.cashChange + out.cashSettled).toBe(0);
  });

  it('clamps at 1 tick', () => {
    const { world, state } = siteWith(pendingGrade(5));
    applyPermitProcessing(shift(-24), world, 100);
    expect(state.grade!.pending!.ticksLeft).toBe(1);
  });

  it('safety >= safetyMin takes the speed-up, below it takes ticksBelow', () => {
    const spec = shift(-24, { safetyMin: 50, ticksBelow: 24 });
    const high = siteWith(pendingGrade(60), 50);
    applyPermitProcessing(spec, high.world, 100);
    expect(high.state.grade!.pending!.ticksLeft).toBe(36);
    const low = siteWith(pendingGrade(60), 49);
    applyPermitProcessing(spec, low.world, 100);
    expect(low.state.grade!.pending!.ticksLeft).toBe(84);
  });

  it('answers with the alt text when nothing is pending', () => {
    const { world, state } = siteWith(createGradeState());
    const out = applyPermitProcessing(shift(72), world, 100);
    expect(out.resultKeySuffix).toBe('_alt');
    expect(state.grade!.pending).toBeNull();
  });

  it('answers with the alt text on a site without a ladder', () => {
    const { world } = siteWith(undefined);
    expect(applyPermitProcessing(shift(72), world, 100).resultKeySuffix).toBe('_alt');
  });
});

describe('applyPermitProcessing — next application', () => {
  it('leaves a pending application untouched and queues a lasting permit_delay modifier', () => {
    const { world, state } = siteWith(pendingGrade(40));
    applyPermitProcessing(shift(48, { next: true }), world, 100);
    expect(state.grade!.pending!.ticksLeft).toBe(40);
    expect(isActive(state.events.activeModifiers, 'permit_delay', 101)).toBe(true);
    expect(isActive(state.events.activeModifiers, 'permit_delay', 100_000)).toBe(true);
    expect(state.events.activeModifiers.find(m => m.kind === 'permit_delay')!.magnitude).toBe(48);
  });

  it('queues the delay with nothing pending too', () => {
    const { world, state } = siteWith(createGradeState());
    const out = applyPermitProcessing(shift(48, { next: true }), world, 100);
    expect(out.resultKeySuffix).toBe('');
    expect(takePermitDelay(state.events.activeModifiers)).toBe(48);
  });

  it('the next applyForGrade adds the delay once', () => {
    const { state } = siteWith({ ...createGradeState(), oreDeliveredKg: 5_000, blastsFired: 2 });
    state.cash = 1_000_000;
    applyPermitProcessing(shift(48, { next: true }), { state, grid: null }, 100);
    const r = applyForGrade(state);
    expect(r.ok).toBe(true);
    expect(state.grade!.pending!.ticksLeft).toBe(gradeDef(1).processingTicks + 48);
    expect(takePermitDelay(state.events.activeModifiers)).toBe(0);
  });

  it('a second application is no longer delayed', () => {
    const { state } = siteWith({ ...createGradeState(), oreDeliveredKg: 5_000, blastsFired: 2 });
    state.cash = 1_000_000;
    applyPermitProcessing(shift(48, { next: true }), { state, grid: null }, 100);
    applyForGrade(state);
    state.grade!.pending = null;
    state.grade!.grade = 1;
    Object.assign(state.grade!, { oreDeliveredKg: 30_000, deepestPitM: 10 });
    state.scores.safety = 60;
    const r = applyForGrade(state);
    expect(r.ok).toBe(true);
    expect(state.grade!.pending!.ticksLeft).toBe(gradeDef(2).processingTicks);
  });
});

describe('applyPermitProcessing — approve', () => {
  function approved(feePct: number, g: GradeState | undefined = pendingGrade(60)) {
    const fx = siteWith(g);
    fx.state.cash = 100_000;
    const emitter = new EventEmitter();
    const grades: number[] = [];
    emitter.on('progression:grade_approved', p => grades.push(p.grade));
    fx.world.emitter = emitter;
    const out = applyPermitProcessing(approve(feePct), fx.world, 100);
    return { ...fx, out, grades };
  }

  it('books 25% of the pending grade fee under permits (grade 1: 5000)', () => {
    const { state } = approved(25);
    expect(state.cash).toBe(95_000);
    const tx = state.finances.transactions.filter(x => x.category === 'permits');
    expect(tx).toHaveLength(1);
    expect(tx[0]!.amount).toBe(5_000);
  });

  it('raises the grade at once, clears pending and emits grade_approved', () => {
    const { state, grades, out } = approved(25);
    expect(state.grade!.grade).toBe(1);
    expect(state.grade!.pending).toBeNull();
    expect(grades).toEqual([1]);
    expect(out.resultKeySuffix).toBe('');
  });

  it('scales with feePct', () => {
    const { state } = approved(50);
    expect(state.cash).toBe(90_000);
  });

  it('uses the pending grade fee, not the current one', () => {
    const { state } = approved(25, pendingGrade(60, 2));
    expect(state.cash).toBe(100_000 - Math.round(gradeDef(2).fee * 0.25));
    expect(state.grade!.grade).toBe(2);
  });

  it('with nothing pending books nothing and answers with the alt text', () => {
    const { state, out, grades } = approved(25, createGradeState());
    expect(state.cash).toBe(100_000);
    expect(state.finances.transactions.filter(x => x.category === 'permits')).toHaveLength(0);
    expect(out.resultKeySuffix).toBe('_alt');
    expect(grades).toEqual([]);
    expect(state.grade!.grade).toBe(0);
  });
});

describe('applyEventEffects dispatches permit_processing', () => {
  it('a shift spec changes the pending application', () => {
    const { world, state, rng } = siteWith(pendingGrade(40));
    applyEventEffects([shift(24)], world, 10, rng);
    expect(state.grade!.pending!.ticksLeft).toBe(64);
  });

  it('an approve spec grants the grade', () => {
    const { world, state, rng } = siteWith(pendingGrade(40));
    applyEventEffects([approve()], world, 10, rng);
    expect(state.grade!.grade).toBe(1);
  });

  it('a next-shift spec registers a permit_delay modifier', () => {
    const { world, state, rng } = siteWith(pendingGrade(40));
    applyEventEffects([shift(48, { next: true })], world, 10, rng);
    expect(isActive(state.events.activeModifiers, 'permit_delay', 11)).toBe(true);
  });

  it('with nothing pending the outcome carries the alt suffix', () => {
    const { world, rng } = siteWith(createGradeState());
    expect(applyEventEffects([approve()], world, 10, rng).resultKeySuffix).toBe('_alt');
  });
});

describe('permit_processing chips and modifier text', () => {
  beforeAll(() => setLocale('en'));

  it.each([
    [shift(72), 'ui.event.effect.permit_processing'],
    [shift(48, { next: true }), 'ui.event.effect.permit_processing_next'],
    [shift(-24, { safetyMin: 50, ticksBelow: 24 }), 'ui.event.effect.permit_processing_by_safety'],
    [approve(), 'ui.event.effect.permit_processing_approve'],
  ] as const)('spec %# uses chip key %s', (spec, key) => {
    const [chip] = effectChips([spec]);
    expect(chip!.textKey).toBe(key);
  });

  it.each(['en', 'fr'] as const)('every chip key renders real text in %s', loc => {
    setLocale(loc);
    for (const spec of [shift(72), shift(-24), shift(48, { next: true }), shift(-24, { safetyMin: 50, ticksBelow: 24 }), approve()]) {
      const [chip] = effectChips([spec]);
      const text = effectChipText(chip!);
      expect(text, chip!.textKey).toBeTruthy();
      expect(text).not.toBe(chip!.textKey);
      expect(text).not.toMatch(/\{\w+\}/);
    }
    setLocale('en');
  });

  it('signed ticks render in the chip text', () => {
    const faster = effectChipText(effectChips([shift(-24)])[0]!)!;
    const slower = effectChipText(effectChips([shift(72)])[0]!)!;
    expect(faster).toContain('24');
    expect(slower).toContain('72');
    expect(faster).not.toBe(slower);
  });

  it('approve chip shows the fee percentage', () => {
    expect(effectChipText(effectChips([approve()])[0]!)).toContain('25');
  });

  it('a permit_delay modifier renders in modifierSummary in both locales', () => {
    const m: ActiveModifier = { ...mod({ kind: 'permit_delay', magnitude: 48, endTick: null }), id: 1 };
    for (const loc of ['en', 'fr'] as const) {
      setLocale(loc);
      const s = modifierSummary(m, 0);
      expect(s).not.toContain('ui.modifier.permit_delay');
      expect(s.length).toBeGreaterThan(3);
    }
    setLocale('en');
  });
});

