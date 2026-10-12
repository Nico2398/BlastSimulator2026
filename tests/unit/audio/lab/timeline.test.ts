// BlastSimulator2026 — Mix timeline tools

import { describe, expect, it } from 'vitest';
import type { MixEvent } from '../../../../src/audio/lab/mixTypes.js';
import { planDispatch, TimelineBuilder, TimelineCursor } from '../../../../src/audio/lab/timeline.js';

describe('TimelineBuilder', () => {
  it('sorts by time and keeps insertion order for equal times', () => {
    const events = new TimelineBuilder()
      .play(2, 'ui_click')
      .loop(1, 'amb_wind', 0.5, 2)
      .duck(1, 'ambient', -6, 1, 1)
      .play(1, 'ui_open', { gainDb: -3 })
      .build();
    expect(events.map(e => [e.t, e.kind])).toEqual([[1, 'loop'], [1, 'duck'], [1, 'play'], [2, 'play']]);
  });

  it('carries options and ramps only when given', () => {
    const [play, loop, bare] = new TimelineBuilder().play(0, 'ui_click', { gainDb: -2 }).loop(1, 'amb_wind', 1, 3).loop(2, 'amb_wind', 0).build();
    expect(play).toEqual({ kind: 'play', t: 0, id: 'ui_click', opts: { gainDb: -2 } });
    expect(loop).toEqual({ kind: 'loop', t: 1, id: 'amb_wind', level: 1, rampS: 3 });
    expect(bare).toEqual({ kind: 'loop', t: 2, id: 'amb_wind', level: 0 });
  });
});

describe('TimelineCursor', () => {
  const events = new TimelineBuilder().play(0, 'ui_click').play(0.5, 'ui_open').play(1.5, 'ui_close').build();

  it('hands out each event once, as time advances', () => {
    const cursor = new TimelineCursor(events);
    expect(cursor.take(0.1).map(e => e.t)).toEqual([0]);
    expect(cursor.take(0.1)).toEqual([]);
    expect(cursor.take(1).map(e => e.t)).toEqual([0.5]);
    expect(cursor.done).toBe(false);
    expect(cursor.take(10).map(e => e.t)).toEqual([1.5]);
    expect(cursor.done).toBe(true);
  });

  it('excludes an event exactly at the limit', () => {
    expect(new TimelineCursor(events).take(0.5).map(e => e.t)).toEqual([0]);
  });
});

describe('planDispatch', () => {
  const plan = { stepS: 0.1, quantumS: 128 / 48000, durationS: 10 };
  const play = (t: number): MixEvent => ({ kind: 'play', t, id: 'ui_click' });

  it('books a one-shot at the last grid pause at or before its start', () => {
    const [batch] = planDispatch([play(0.37)], plan);
    expect(batch).toBeDefined();
    expect(batch!.atS).toBeLessThanOrEqual(0.3 + 1e-9);
    expect(batch!.atS).toBeGreaterThan(0.3 - plan.quantumS);
    expect(0.37 - batch!.atS).toBeLessThan(0.1 + plan.quantumS);
  });

  it('never books a one-shot after it starts', () => {
    for (let t = 0; t < 5; t += 0.0137) {
      const [batch] = planDispatch([play(t)], plan);
      expect(batch!.atS).toBeLessThanOrEqual(t + 1e-9);
    }
  });

  it('groups one-shots of the same step into one pause, in order', () => {
    const batches = planDispatch([play(0.31), play(0.35), play(0.52)], plan);
    expect(batches).toHaveLength(2);
    expect(batches[0]!.events.map(e => e.t)).toEqual([0.31, 0.35]);
    expect(batches[1]!.events.map(e => e.t)).toEqual([0.52]);
    expect(batches[0]!.atS).toBeLessThan(batches[1]!.atS);
  });

  it('gives loop and duck events a pause at their own moment, never before it', () => {
    const events: MixEvent[] = [
      { kind: 'loop', t: 4.321, id: 'amb_wind', level: 1 },
      { kind: 'duck', t: 7.777, bus: 'ambient', amountDb: -6, holdS: 1, releaseS: 1 },
    ];
    const batches = planDispatch(events, plan);
    expect(batches).toHaveLength(2);
    expect(batches[0]!.atS).toBeGreaterThanOrEqual(4.321 - 1e-9);
    expect(batches[0]!.atS - 4.321).toBeLessThan(plan.quantumS);
    expect(batches[1]!.atS - 7.777).toBeLessThan(plan.quantumS);
  });

  it('starts at zero for events at the very start', () => {
    expect(planDispatch([play(0)], plan)[0]!.atS).toBe(0);
  });

  it('drops events outside the render', () => {
    expect(planDispatch([play(-1), play(10), play(11)], plan)).toEqual([]);
  });

  it('puts pauses on whole render quanta', () => {
    for (const batch of planDispatch([play(1.234), { kind: 'loop', t: 2.345, id: 'amb_wind', level: 1 }], plan)) {
      const quanta = batch.atS / plan.quantumS;
      expect(Math.abs(quanta - Math.round(quanta))).toBeLessThan(1e-6);
    }
  });
});
