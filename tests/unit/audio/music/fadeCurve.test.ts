// BlastSimulator2026 — fadeCurve unit tests

import { describe, it, expect } from 'vitest';
import { buildFadeCurve, fadeLevelAt, scheduleFade, type Fade } from '../../../../src/audio/music/fadeCurve.js';
import { FakeGainParam } from './fakes.js';

const rise: Fade = { from: 0, to: 1, startS: 10, durationS: 2 };
const fall: Fade = { from: 1, to: 0, startS: 10, durationS: 2 };

describe('fadeLevelAt', () => {
  it('holds the start level before and the end level after', () => {
    expect(fadeLevelAt(rise, 0)).toBe(0);
    expect(fadeLevelAt(rise, 99)).toBe(1);
    expect(fadeLevelAt(fall, 0)).toBe(1);
    expect(fadeLevelAt(fall, 99)).toBe(0);
  });

  it('is equal-power: a fade out and a fade in over the same span sum to constant power', () => {
    for (let t = 10; t <= 12; t += 0.25) {
      const power = fadeLevelAt(rise, t) ** 2 + fadeLevelAt(fall, t) ** 2;
      expect(power).toBeCloseTo(1, 10);
    }
  });

  it('is monotonic', () => {
    let last = -1;
    for (let t = 10; t <= 12; t += 0.1) {
      const v = fadeLevelAt(rise, t);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });

  it('fades from a partial level to a quieter target', () => {
    const fade: Fade = { from: 0.5, to: 0.2, startS: 0, durationS: 1 };
    expect(fadeLevelAt(fade, 0)).toBeCloseTo(0.5, 10);
    expect(fadeLevelAt(fade, 1)).toBeCloseTo(0.2, 10);
    expect(fadeLevelAt(fade, 0.5)).toBeGreaterThan(0.2);
    expect(fadeLevelAt(fade, 0.5)).toBeLessThan(0.5);
  });
});

describe('buildFadeCurve', () => {
  it('samples the fade end to end', () => {
    const curve = buildFadeCurve(rise, 64);
    expect(curve).toHaveLength(64);
    expect(curve[0]).toBeCloseTo(0, 6);
    expect(curve[63]).toBeCloseTo(1, 6);
    expect(curve[32]).toBeCloseTo(fadeLevelAt(rise, 10 + 2 * 32 / 63), 6);
  });
});

describe('scheduleFade', () => {
  it('clears the param, pins the start value and queues the curve', () => {
    const param = new FakeGainParam();
    scheduleFade(param as unknown as AudioParam, rise, 8);
    expect(param.cancels).toEqual([10]);
    expect(param.sets).toEqual([{ value: 0, time: 10 }]);
    expect(param.curves).toHaveLength(1);
    expect(param.curves[0]).toMatchObject({ start: 10, duration: 2 });
    expect(param.ramps).toHaveLength(0);
  });

  it('falls back to a linear ramp when the curve is refused', () => {
    const param = new FakeGainParam();
    param.throwOnCurve = true;
    scheduleFade(param as unknown as AudioParam, fall, 8);
    expect(param.ramps).toEqual([{ value: 0, time: 12 }]);
  });
});
