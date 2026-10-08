// Issue #1405 — the `nuisance` score is "Neighbour relations": high = good.
// Every event option that touches it must point the right way: pleasing the
// neighbours raises it, annoying them lowers it. Judged from a hand-authored
// table, never from the current delta sign.

import { describe, it, expect, beforeAll } from 'vitest';
import { setupEvents } from '../../../src/core/events/index.js';
import { getAllEvents, getEventById } from '../../../src/core/events/EventPool.js';
import type { EventDef, EventConsequence, EventContext } from '../../../src/core/events/EventPool.js';
import { createScoreState } from '../../../src/core/scores/ScoreManager.js';
import { NEIGHBOUR_POLARITY, type PolarityEntry } from './neighbourRelationsPolarity.fixture.js';

let events: readonly EventDef[] = [];
beforeAll(() => {
  setupEvents();
  events = getAllEvents();
});

const keyOf = (e: { eventId: string; option: number; alt?: boolean }): string =>
  `${e.eventId}#${e.option}${e.alt ? ' (alt)' : ''}`;

function consequenceOf(entry: PolarityEntry): EventConsequence | undefined {
  const c = getEventById(entry.eventId)?.consequences[entry.option];
  return entry.alt ? c?.altConsequence : c;
}

function deltaOf(entry: PolarityEntry): number | undefined {
  return consequenceOf(entry)?.scoreDelta?.nuisance;
}

describe('neighbour relations polarity (#1405)', () => {
  it('fixture keys are unique', () => {
    const keys = NEIGHBOUR_POLARITY.map(keyOf);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it('options that please the neighbours raise the score, ones that annoy them lower it', () => {
    const bad = NEIGHBOUR_POLARITY.flatMap(entry => {
      const d = deltaOf(entry);
      if (d === undefined) return [];
      const ok = entry.effect === 'pleases' ? d > 0 : d < 0;
      return ok ? [] : [`${keyOf(entry)} ${entry.effect} but nuisance delta is ${d}`];
    });
    expect(bad, `wrong-way nuisance deltas:\n${bad.join('\n')}`).toEqual([]);
  });

  it('completeness: every option carrying a nuisance delta is in the fixture', () => {
    const known = new Set(NEIGHBOUR_POLARITY.map(keyOf));
    const missing = events.flatMap(e => e.consequences.flatMap((c, i) => {
      const found: string[] = [];
      if (c.scoreDelta?.nuisance !== undefined && !known.has(keyOf({ eventId: e.id, option: i }))) {
        found.push(keyOf({ eventId: e.id, option: i }));
      }
      if (c.altConsequence?.scoreDelta?.nuisance !== undefined
        && !known.has(keyOf({ eventId: e.id, option: i, alt: true }))) {
        found.push(keyOf({ eventId: e.id, option: i, alt: true }));
      }
      return found;
    }));
    expect(missing, `options missing from the polarity fixture:\n${missing.join('\n')}`).toEqual([]);
  });

  it('staleness: every fixture entry maps to a real option with a nuisance delta', () => {
    const stale = NEIGHBOUR_POLARITY.flatMap(entry => {
      const ev = getEventById(entry.eventId);
      if (!ev) return [`${keyOf(entry)}: unknown event`];
      if (!ev.consequences[entry.option]) return [`${keyOf(entry)}: unknown option`];
      return deltaOf(entry) === undefined ? [`${keyOf(entry)}: no nuisance delta`] : [];
    });
    expect(stale, `stale fixture entries:\n${stale.join('\n')}`).toEqual([]);
  });

  it('weights never rise as neighbour relations improve (nuisance 10 >= nuisance 90)', () => {
    const bad = events.flatMap(e => {
      const low = { ...createScoreState(), nuisance: 10 };
      const high = { ...createScoreState(), nuisance: 90 };
      const wLow = e.weightCoeff(low);
      const wHigh = e.weightCoeff(high);
      return wLow >= wHigh ? [] : [`${e.id}: weight ${wLow} at nuisance 10 < ${wHigh} at nuisance 90`];
    });
    expect(bad, `weights that grow with good neighbour relations:\n${bad.join('\n')}`).toEqual([]);
  });

  describe('lawsuit_aesthetic_pollution gate', () => {
    const ctxWith = (nuisance: number): EventContext => ({
      scores: { ...createScoreState(), nuisance },
      employeeCount: 10,
      deathCount: 0,
      corruptionLevel: 0,
      hasBuilding: () => false,
      hasDrillPlan: false,
      tickCount: 100,
      lawsuitCount: 0,
      activeContractCount: 0,
      weatherId: 'sunny',
      hasBlasted: true,
    });

    it('can fire when neighbour relations are poor (30)', () => {
      expect(getEventById('lawsuit_aesthetic_pollution')!.canFire(ctxWith(30))).toBe(true);
    });

    it('cannot fire when neighbour relations are good (70)', () => {
      expect(getEventById('lawsuit_aesthetic_pollution')!.canFire(ctxWith(70))).toBe(false);
    });
  });
});
