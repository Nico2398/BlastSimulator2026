// Issue #1847 — no event option may be strictly dominated by a sibling option.
// A dominated option is never a real choice. Options that carry extra payload
// (effects, follow-ups, corruption, exposure) are exempt: the payload is the trade-off.
// Helpers are local so the rule is self-contained; the catalog rule collects every offender.

import { describe, it, expect, beforeAll } from 'vitest';
import { setupEvents } from '../../../src/core/events/index.js';
import { getAllEvents } from '../../../src/core/events/EventPool.js';
import type { EventDef, EventConsequence } from '../../../src/core/events/EventPool.js';

/**
 * Events whose effectTags are resolver-handled behaviour (UnqualifiedTaskEffects: train / contractor /
 * cancel), not flavour. Their options differ in a dimension the vector cannot see, so they are incomparable.
 */
const BEHAVIOURAL_TAG_EVENTS: ReadonlySet<string> = new Set(['unqualified_task_error']);

const SCORE_DIMS = ['wellBeing', 'safety', 'ecology', 'nuisance'] as const;

type Vec = number[];

/** Main branch, plus the alt branch when the consequence is a gamble. */
const branches = (c: EventConsequence): EventConsequence[] =>
  c.altConsequence ? [c, c.altConsequence] : [c];

/** cash, then each score dimension; missing values count as 0. */
function vector(c: EventConsequence): Vec {
  const sd = c.scoreDelta ?? {};
  return [c.cashDelta ?? 0, ...SCORE_DIMS.map(k => sd[k] ?? 0)];
}

/** Payload beyond cash/score. effectTag alone is flavour, not payload. */
function carriesExtra(c: EventConsequence): boolean {
  return branches(c).some(b =>
    (b.effects?.length ?? 0) > 0
    || b.followUpEventId !== undefined
    || (b.corruptionDelta ?? 0) !== 0
    || (b.exposureDelta ?? 0) !== 0);
}

/** Pairs (by, d) of branch vectors that must all satisfy by >= d. */
function comparedPairs(d: EventConsequence, by: EventConsequence): Array<[Vec, Vec]> {
  const db = branches(d);
  const bb = branches(by);
  if (bb.length === 1) return db.map(x => [vector(bb[0]!), vector(x)] as [Vec, Vec]);
  if (db.length === 2) return [[vector(bb[0]!), vector(db[0]!)], [vector(bb[1]!), vector(db[1]!)]];
  return bb.map(x => [vector(x), vector(db[0]!)] as [Vec, Vec]);
}

/**
 * A dominator must be a clean, strictly-better trade: corruption and exposure are costs,
 * and effects / follow-ups are payload of unknown sign (bans, work-rate cuts, lawsuit weight)
 * that the vector does not see, so such an option may carry a hidden trade-off.
 */
const addsRisk = (c: EventConsequence): boolean =>
  branches(c).some(b => (b.corruptionDelta ?? 0) > 0 || (b.exposureDelta ?? 0) > 0)
  || branches(c).some(b => (b.effects?.length ?? 0) > 0 || b.followUpEventId !== undefined);

function isDominated(d: EventConsequence, by: EventConsequence): boolean {
  if (carriesExtra(d) || addsRisk(by)) return false;
  const pairs = comparedPairs(d, by);
  let strict = false;
  for (const [b, x] of pairs) {
    for (let k = 0; k < b.length; k++) {
      if (b[k]! < x[k]!) return false;
      if (b[k]! > x[k]!) strict = true;
    }
  }
  return strict;
}

function findDominatedOptions(event: Pick<EventDef, 'id' | 'options' | 'consequences'>): string[] {
  expect(event.consequences.length, `${event.id}: options/consequences length mismatch`).toBe(event.options.length);
  const out: string[] = [];
  if (BEHAVIOURAL_TAG_EVENTS.has(event.id)) return out;
  event.consequences.forEach((d, i) => {
    event.consequences.forEach((by, j) => {
      if (i !== j && isDominated(d, by)) out.push(`${event.id} option ${i} dominated by ${j}`);
    });
  });
  return out;
}

const synth = (consequences: EventConsequence[]): Pick<EventDef, 'id' | 'options' | 'consequences'> => ({
  id: 'synthetic',
  options: consequences.map((_, i) => ({ labelKey: `synthetic.opt${i}` })) as EventDef['options'],
  consequences,
});

let events: readonly EventDef[] = [];
beforeAll(() => {
  setupEvents();
  events = getAllEvents();
});

describe('event option dominance (#1847)', () => {
  it('no non-tutorial event has a dominated option', () => {
    expect(events.length).toBeGreaterThan(50);
    const bad = events.filter(e => e.category !== 'tutorial').flatMap(findDominatedOptions);
    expect(bad, `dominated options:\n${bad.join('\n')}`).toEqual([]);
  });

  it('flags a strictly worse option', () => {
    const r = findDominatedOptions(synth([
      { cashDelta: -100 },
      { cashDelta: -50, scoreDelta: { safety: 5 } },
    ]));
    expect(r).toEqual(['synthetic option 0 dominated by 1']);
  });

  it('does not flag a gamble with a better alt branch', () => {
    const r = findDominatedOptions(synth([
      { cashDelta: -200, probability: 0.5, altConsequence: { cashDelta: 100, scoreDelta: { safety: 10 } } },
      { cashDelta: -50 },
    ]));
    expect(r).toEqual([]);
  });

  it.each([
    ['effects', { effects: [{ type: 'work_stoppage', hours: 4 }] }],
    ['corruptionDelta', { corruptionDelta: 5 }],
    ['followUpEventId', { followUpEventId: 'some_follow_up' }],
    ['exposureDelta', { exposureDelta: 0.1 }],
  ] as Array<[string, Partial<EventConsequence>]>)('does not flag a worse option carrying %s', (_n, extra) => {
    const r = findDominatedOptions(synth([
      { cashDelta: -100, ...extra },
      { cashDelta: -50 },
    ]));
    expect(r).toEqual([]);
  });

  it.each([
    ['corruptionDelta', { corruptionDelta: 6 }],
    ['exposureDelta', { exposureDelta: 0.2 }],
    ['alt-branch corruptionDelta', { altConsequence: { corruptionDelta: 3 } }],
  ] as Array<[string, Partial<EventConsequence>]>)('a better option adding %s does not dominate', (_n, risk) => {
    const r = findDominatedOptions(synth([
      { cashDelta: -100 },
      { cashDelta: -50, ...risk },
    ]));
    expect(r).toEqual([]);
  });

  it('a better option carrying effects (possible penalty) does not dominate', () => {
    const r = findDominatedOptions(synth([
      { cashDelta: -100 },
      { cashDelta: -50, effects: [{ type: 'ban', what: 'blast', hours: 12 }] },
    ]));
    expect(r).toEqual([]);
  });

  it('does not flag identical consequences', () => {
    const r = findDominatedOptions(synth([
      { cashDelta: -50, scoreDelta: { safety: 2 } },
      { cashDelta: -50, scoreDelta: { safety: 2 } },
    ]));
    expect(r).toEqual([]);
  });
});
