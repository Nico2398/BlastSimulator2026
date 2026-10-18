// BlastSimulator2026 — getOptionEffectHints: choose-phase consequence chips (P8)
//
// Derives the consequence-chip hints shown on an event option before the
// player picks it, from the option's parallel EventConsequence. No delta
// magnitude is promised — only kind/direction — since a probabilistic
// consequence's real outcome isn't decided until the option is chosen.

import { describe, it, expect } from 'vitest';
import {
  getOptionEffectHints,
  consequenceAmount,
  clearEvents,
  getAllEvents,
  type EventOption,
  type EventConsequence,
} from '../../../src/core/events/EventPool.js';
import { setupEvents } from '../../../src/core/events/index.js';

const OPTION: EventOption = { labelKey: 'event.test.opt', resultKey: 'event.test.res' };

describe('getOptionEffectHints', () => {
  it('a positive cashDelta produces a cash hint with positive direction', () => {
    const hints = getOptionEffectHints(OPTION, { cashDelta: 500 });
    expect(hints).toEqual([{ kind: 'cash', key: 'cash', direction: 'positive', amount: 500 }]);
  });

  it('a negative cashDelta produces a cash hint with negative direction', () => {
    const hints = getOptionEffectHints(OPTION, { cashDelta: -500 });
    expect(hints).toEqual([{ kind: 'cash', key: 'cash', direction: 'negative', amount: -500 }]);
  });

  it('a zero cashDelta produces no cash hint', () => {
    const hints = getOptionEffectHints(OPTION, { cashDelta: 0 });
    expect(hints.some(h => h.kind === 'cash')).toBe(false);
  });

  it('scoreDelta produces one hint per non-zero key, direction from sign', () => {
    const hints = getOptionEffectHints(OPTION, {
      scoreDelta: { wellBeing: 10, safety: -5, ecology: 0 },
    });
    expect(hints).toContainEqual({ kind: 'score', key: 'wellBeing', direction: 'positive', amount: 10 });
    expect(hints).toContainEqual({ kind: 'score', key: 'safety', direction: 'negative', amount: -5 });
    expect(hints.some(h => h.key === 'ecology')).toBe(false);
  });

  it('corruptionDelta produces an "other" hint keyed corruption', () => {
    const hints = getOptionEffectHints(OPTION, { corruptionDelta: 2 });
    expect(hints).toEqual([{ kind: 'other', key: 'corruption', direction: 'positive', amount: 2 }]);
  });

  it('followUpEventId produces a neutral "other" hint keyed followUp', () => {
    const hints = getOptionEffectHints(OPTION, { followUpEventId: 'some_event' });
    expect(hints).toEqual([{ kind: 'other', key: 'followUp', direction: 'neutral' }]);
  });

  it('effectTag alone produces no hint — free-form tags are not chip-worthy', () => {
    const hints = getOptionEffectHints(OPTION, { effectTag: 'custom_tag' });
    expect(hints).toEqual([]);
  });

  it('an empty consequence produces no hints — the row renders label-only', () => {
    const hints = getOptionEffectHints(OPTION, {});
    expect(hints).toEqual([]);
  });

  it('an undefined consequence produces no hints', () => {
    const hints = getOptionEffectHints(OPTION, undefined);
    expect(hints).toEqual([]);
  });

  it('a probabilistic consequence (probability < 1) marks every derived hint risky', () => {
    const hints = getOptionEffectHints(OPTION, {
      cashDelta: 100,
      scoreDelta: { safety: -1 },
      probability: 0.5,
    });
    expect(hints.every(h => h.risky === true)).toBe(true);
    expect(hints).toHaveLength(2);
  });

  it('probability === 1 (certain) does not mark hints risky', () => {
    const hints = getOptionEffectHints(OPTION, { cashDelta: 100, probability: 1 });
    expect(hints[0]!.risky).toBeUndefined();
  });

  it('no probability field at all does not mark hints risky', () => {
    const hints = getOptionEffectHints(OPTION, { cashDelta: 100 });
    expect(hints[0]!.risky).toBeUndefined();
  });

  it('multiple consequence fields combine into multiple hints in field order', () => {
    const hints = getOptionEffectHints(OPTION, {
      cashDelta: -200,
      scoreDelta: { wellBeing: 5 },
      corruptionDelta: 1,
      followUpEventId: 'chain_event',
    });
    expect(hints.map(h => h.key)).toEqual(['cash', 'wellBeing', 'corruption', 'followUp']);
  });

  it('an explicit option.effects wins over derivation from consequence', () => {
    const handAuthored: EventOption = {
      labelKey: 'event.test.opt',
      resultKey: 'event.test.res',
      effects: [{ kind: 'other', key: 'custom', direction: 'neutral' }],
    };
    const consequence: EventConsequence = { cashDelta: 999 };

    const hints = getOptionEffectHints(handAuthored, consequence);

    expect(hints).toEqual([{ kind: 'other', key: 'custom', direction: 'neutral' }]);
  });

  // ── setupEvents idempotency (#597) ──
  //
  // Every createRunner() call — one per scenario engine in a batch run like
  // run-all-scenarios.ts — calls setupEvents() again. registerEvents used to
  // push unconditionally, so the shared pool doubled, tripled, ... on every
  // subsequent call in the same process, and selectEvent's weighted pick
  // indexes into that pool — corrupting which event fired based on how many
  // *other* engines had already been created earlier in the same process,
  // nothing to do with the scenario's own seed or pacing.

  it('calling setupEvents twice leaves the pool the same size as calling it once', () => {
    clearEvents();
    setupEvents();
    const first = getAllEvents().length;
    setupEvents();
    const second = getAllEvents().length;
    expect(second).toBe(first);
  });

  it('calling setupEvents three times still leaves the pool the same size', () => {
    clearEvents();
    setupEvents();
    const first = getAllEvents().length;
    setupEvents();
    setupEvents();
    expect(getAllEvents().length).toBe(first);
  });

  it('the pool contains no duplicate event ids after repeated setupEvents calls', () => {
    clearEvents();
    setupEvents();
    setupEvents();
    const ids = getAllEvents().map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // ── Completeness guard: every real registered event's options resolve without throwing ──

  it('every registered event resolves getOptionEffectHints for all its options without throwing', () => {
    clearEvents();
    setupEvents();
    const events = getAllEvents();
    expect(events.length).toBeGreaterThan(0);

    for (const def of events) {
      for (let i = 0; i < def.options.length; i++) {
        const hints = getOptionEffectHints(def.options[i]!, def.consequences[i]);
        expect(Array.isArray(hints)).toBe(true);
      }
    }
  });
});

// ── Amounts of certain outcomes (#1893) ──

describe('getOptionEffectHints amounts (#1893)', () => {
  it('a certain consequence carries signed amounts on cash, score and corruption hints', () => {
    const hints = getOptionEffectHints(OPTION, {
      cashDelta: -8000, scoreDelta: { wellBeing: 12, safety: -4 }, corruptionDelta: 3,
    });
    expect(hints.find(h => h.key === 'cash')!.amount).toBe(-8000);
    expect(hints.find(h => h.key === 'wellBeing')!.amount).toBe(12);
    expect(hints.find(h => h.key === 'safety')!.amount).toBe(-4);
    expect(hints.find(h => h.key === 'corruption')!.amount).toBe(3);
  });

  it('probability === 1 still counts as certain and carries amounts', () => {
    const hints = getOptionEffectHints(OPTION, { cashDelta: 100, probability: 1 });
    expect(hints[0]!.amount).toBe(100);
  });

  it('a probabilistic consequence carries no amount and no spec, and stays risky', () => {
    const hints = getOptionEffectHints(OPTION, {
      cashDelta: 100, scoreDelta: { safety: -1 }, corruptionDelta: 1, probability: 0.5,
      effects: [{ type: 'work_stoppage', hours: 4 }],
    });
    expect(hints.length).toBeGreaterThan(0);
    for (const h of hints) {
      expect(h.risky).toBe(true);
      expect(h.amount).toBeUndefined();
      expect(h.spec).toBeUndefined();
    }
  });

  it('a followUp hint carries no amount', () => {
    const hints = getOptionEffectHints(OPTION, { followUpEventId: 'x' });
    expect(hints[0]!.amount).toBeUndefined();
  });

  it('a certain lasting effect yields an "other" hint keyed by spec.type with the spec attached', () => {
    const spec = { type: 'work_stoppage', hours: 6 } as const;
    const hints = getOptionEffectHints(OPTION, { effects: [spec] });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ kind: 'other', key: 'work_stoppage', direction: 'negative', spec });
    expect(hints[0]!.risky).toBeUndefined();
  });

  it('a risky lasting effect yields a risky hint without spec', () => {
    const hints = getOptionEffectHints(OPTION, {
      effects: [{ type: 'work_stoppage', hours: 6 }], probability: 0.4,
    });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ kind: 'other', key: 'work_stoppage', risky: true });
    expect(hints[0]!.spec).toBeUndefined();
    expect(hints[0]!.amount).toBeUndefined();
  });

  it('an event_weight effect is hinted as neutral', () => {
    const hints = getOptionEffectHints(OPTION, {
      effects: [{ type: 'event_weight', category: 'union', factor: 0.5, days: 5 }],
    });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ kind: 'other', key: 'event_weight', direction: 'neutral' });
  });

  it('a forced_weather effect is not hinted', () => {
    const hints = getOptionEffectHints(OPTION, {
      effects: [{ type: 'forced_weather', weather: 'storm', hours: 3 }],
    });
    expect(hints).toEqual([]);
  });

  it('hand-authored hints without an amount get it filled from the certain consequence', () => {
    const opt: EventOption = {
      ...OPTION, effects: [{ kind: 'cash', key: 'cash', direction: 'negative' }],
    };
    const hints = getOptionEffectHints(opt, { cashDelta: -500 });
    expect(hints[0]!.amount).toBe(-500);
  });

  it('a hand-authored explicit amount wins over the consequence', () => {
    const opt: EventOption = {
      ...OPTION, effects: [{ kind: 'cash', key: 'cash', direction: 'negative', amount: -1 }],
    };
    expect(getOptionEffectHints(opt, { cashDelta: -500 })[0]!.amount).toBe(-1);
  });

  it('filling hand-authored amounts does not mutate the option', () => {
    const opt: EventOption = {
      ...OPTION, effects: [{ kind: 'cash', key: 'cash', direction: 'negative' }],
    };
    getOptionEffectHints(opt, { cashDelta: -500 });
    expect(opt.effects![0]!.amount).toBeUndefined();
  });

  it('hand-authored hints get no amount from a risky consequence', () => {
    const opt: EventOption = {
      ...OPTION, effects: [{ kind: 'cash', key: 'cash', direction: 'negative' }],
    };
    const hints = getOptionEffectHints(opt, { cashDelta: -500, probability: 0.5 });
    expect(hints[0]!.amount).toBeUndefined();
  });

  it('a hand-authored hint with no matching consequence field gets no amount', () => {
    const opt: EventOption = {
      ...OPTION, effects: [{ kind: 'other', key: 'custom', direction: 'neutral' }],
    };
    expect(getOptionEffectHints(opt, { cashDelta: -500 })[0]!.amount).toBeUndefined();
  });

  it('Coffee Uprising options carry their real amounts', () => {
    clearEvents();
    setupEvents();
    const def = getAllEvents().find(e => e.id === 'union_coffee_uprising')!;
    const h0 = getOptionEffectHints(def.options[0]!, def.consequences[0]);
    const h2 = getOptionEffectHints(def.options[2]!, def.consequences[2]);
    expect(h0.find(h => h.key === 'cash')!.amount).toBe(-8000);
    expect(h0.find(h => h.key === 'wellBeing')!.amount).toBe(12);
    expect(h2.find(h => h.key === 'cash')!.amount).toBe(-2000);
    expect(h2.find(h => h.key === 'wellBeing')!.amount).toBe(3);
  });
});

describe('consequenceAmount (#1893)', () => {
  it('reads cash, score and corruption amounts', () => {
    const c: EventConsequence = { cashDelta: -7, scoreDelta: { ecology: 2 }, corruptionDelta: 4 };
    expect(consequenceAmount(c, 'cash', 'cash')).toBe(-7);
    expect(consequenceAmount(c, 'score', 'ecology')).toBe(2);
    expect(consequenceAmount(c, 'other', 'corruption')).toBe(4);
  });

  it('is undefined for absent fields and for a risky consequence', () => {
    expect(consequenceAmount({}, 'cash', 'cash')).toBeUndefined();
    expect(consequenceAmount({ scoreDelta: { ecology: 2 } }, 'score', 'safety')).toBeUndefined();
    expect(consequenceAmount({ cashDelta: -7, probability: 0.5 }, 'cash', 'cash')).toBeUndefined();
  });
});
