// BlastSimulator2026 — getOptionEffectHints: choose-phase consequence chips (P8)
//
// Derives the consequence-chip hints shown on an event option before the
// player picks it, from the option's parallel EventConsequence. No delta
// magnitude is promised — only kind/direction — since a probabilistic
// consequence's real outcome isn't decided until the option is chosen.

import { describe, it, expect } from 'vitest';
import {
  getOptionEffectHints,
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
    expect(hints).toEqual([{ kind: 'cash', key: 'cash', direction: 'positive' }]);
  });

  it('a negative cashDelta produces a cash hint with negative direction', () => {
    const hints = getOptionEffectHints(OPTION, { cashDelta: -500 });
    expect(hints).toEqual([{ kind: 'cash', key: 'cash', direction: 'negative' }]);
  });

  it('a zero cashDelta produces no cash hint', () => {
    const hints = getOptionEffectHints(OPTION, { cashDelta: 0 });
    expect(hints.some(h => h.kind === 'cash')).toBe(false);
  });

  it('scoreDelta produces one hint per non-zero key, direction from sign', () => {
    const hints = getOptionEffectHints(OPTION, {
      scoreDelta: { wellBeing: 10, safety: -5, ecology: 0 },
    });
    expect(hints).toContainEqual({ kind: 'score', key: 'wellBeing', direction: 'positive' });
    expect(hints).toContainEqual({ kind: 'score', key: 'safety', direction: 'negative' });
    expect(hints.some(h => h.key === 'ecology')).toBe(false);
  });

  it('corruptionDelta produces an "other" hint keyed corruption', () => {
    const hints = getOptionEffectHints(OPTION, { corruptionDelta: 2 });
    expect(hints).toEqual([{ kind: 'other', key: 'corruption', direction: 'positive' }]);
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
