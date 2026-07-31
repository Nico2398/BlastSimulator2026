// BlastSimulator2026 — Event builder unit tests (#421)
// ev() derives labelKey/resultKey for every option from the event id and its
// index. This is a regression test for that derivation — the skeleton phase
// already added the one-line `resultKey: `event.${id}.res${i}`` mapping, so
// this suite is expected to pass, but it must keep passing as the builder
// evolves (e.g. once `_alt` handling is added elsewhere, this must NOT start
// encoding `_alt` itself — that's resolver-side only).

import { describe, it, expect } from 'vitest';
import { ev } from '../../../src/core/events/EventBuilder.js';

describe('EventBuilder.ev()', () => {
  it('derives resultKey as event.<id>.res<i> for every option index', () => {
    const def = ev('some_event', 'union', {
      weight: () => 1,
      options: [
        { cashDelta: -1000 },
        { cashDelta: 0 },
        { cashDelta: 500, effectTag: 'tag' },
      ],
    });

    expect(def.options).toHaveLength(3);
    expect(def.options[0]!.resultKey).toBe('event.some_event.res0');
    expect(def.options[1]!.resultKey).toBe('event.some_event.res1');
    expect(def.options[2]!.resultKey).toBe('event.some_event.res2');
  });

  it('derives resultKey correctly for a single-option event', () => {
    const def = ev('lone_option_event', 'weather', {
      weight: () => 1,
      options: [{ cashDelta: -100 }],
    });

    expect(def.options).toHaveLength(1);
    expect(def.options[0]!.resultKey).toBe('event.lone_option_event.res0');
  });

  it('does not itself encode an _alt suffix, even for a probabilistic option with altConsequence', () => {
    // Branch reporting (`_alt`) is resolver-side (EventResolver), not builder-side —
    // the builder only knows the option's static index, never which branch will
    // fire at runtime.
    const def = ev('probabilistic_event', 'mafia', {
      weight: () => 1,
      options: [
        {
          cashDelta: 1000,
          probability: 0.5,
          alt: { cashDelta: -1000 },
        },
      ],
    });

    expect(def.options[0]!.resultKey).toBe('event.probabilistic_event.res0');
    expect(def.options[0]!.resultKey.endsWith('_alt')).toBe(false);
  });

  it('labelKey and resultKey share the same event id + index scheme but differ in shape', () => {
    const def = ev('label_vs_result', 'politics', {
      weight: () => 1,
      options: [{ cashDelta: 0 }, { cashDelta: 0 }],
    });

    expect(def.options[0]!.labelKey).toBe('event.label_vs_result.opt0');
    expect(def.options[0]!.resultKey).toBe('event.label_vs_result.res0');
    expect(def.options[1]!.labelKey).toBe('event.label_vs_result.opt1');
    expect(def.options[1]!.resultKey).toBe('event.label_vs_result.res1');
  });
});
