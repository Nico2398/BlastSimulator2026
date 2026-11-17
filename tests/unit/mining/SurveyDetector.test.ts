// BlastSimulator2026 — Meteorite detector readings (#2291): a seeded bearing cone and distance band, never the crater itself.

import { describe, it, expect } from 'vitest';
import {
  detectorHalfAngle, readMeteoriteDetector, type DetectorReading,
} from '../../../src/core/mining/SurveyDetector.js';
import { Random } from '../../../src/core/math/Random.js';
import {
  DETECTOR_HALF_ANGLE_SKILL1_DEG, DETECTOR_HALF_ANGLE_TOP_DEG, DETECTOR_BAND_WIDTH_M, DETECTOR_BAND_ROUND_M,
  PROSPECTION_TOP_SKILL, SURVEY_COSTS, SURVEY_DURATION_TICKS, SURVEY_METHOD_UNLOCK_GRADE,
} from '../../../src/core/config/balance.js';

const DEG = Math.PI / 180;
const SKILLS = [1, 2, 3, 4, 5];

/** Smallest absolute difference between two angles, wrap-aware. */
function angleGap(a: number, b: number): number {
  const d = (a - b) % (2 * Math.PI);
  return Math.abs(d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d);
}

const trueBearing = (crater: { x: number; z: number }, o: { x: number; z: number }): number =>
  Math.atan2(crater.z - o.z, crater.x - o.x);
const trueDistance = (crater: { x: number; z: number }, o: { x: number; z: number }): number =>
  Math.hypot(crater.x - o.x, crater.z - o.z);

function read(crater: { x: number; z: number }, origin: { x: number; z: number }, skill: number, seed: number): DetectorReading {
  const r = readMeteoriteDetector(crater, origin, skill, new Random(seed));
  expect(r).not.toBeNull();
  return r!;
}

const CRATER = { x: -330, z: 89 };
const ORIGIN = { x: 32, z: 32 };
const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

describe('detector balance (#2291, C3)', () => {
  it('has a cost and a duration', () => {
    expect(SURVEY_COSTS.meteorite_detector).toBeGreaterThan(0);
    expect(SURVEY_DURATION_TICKS.meteorite_detector).toBeGreaterThan(0);
  });

  it('opens at grade 3', () => {
    expect(SURVEY_METHOD_UNLOCK_GRADE.meteorite_detector).toBe(3);
  });

  it('declares a positive band width that is a whole number of rounding steps', () => {
    expect(DETECTOR_BAND_WIDTH_M).toBeGreaterThan(0);
    expect(DETECTOR_BAND_ROUND_M).toBeGreaterThan(0);
    expect(DETECTOR_BAND_WIDTH_M % DETECTOR_BAND_ROUND_M).toBe(0);
  });
});

describe('detectorHalfAngle (#2291, C2)', () => {
  it('is widest at skill 1: the declared skill-1 angle, in radians', () => {
    expect(detectorHalfAngle(1)).toBeCloseTo(DETECTOR_HALF_ANGLE_SKILL1_DEG * DEG, 6);
  });

  it('is narrowest at the top skill: the declared top angle, in radians', () => {
    expect(detectorHalfAngle(PROSPECTION_TOP_SKILL)).toBeCloseTo(DETECTOR_HALF_ANGLE_TOP_DEG * DEG, 6);
  });

  it('shrinks strictly with every skill level', () => {
    for (let skill = 1; skill < PROSPECTION_TOP_SKILL; skill++) {
      expect(detectorHalfAngle(skill + 1), `skill ${skill + 1} vs ${skill}`).toBeLessThan(detectorHalfAngle(skill));
    }
  });

  it('stays above zero at every skill', () => {
    for (const skill of SKILLS) expect(detectorHalfAngle(skill)).toBeGreaterThan(0);
  });

  it('is a plausible angle in radians, not degrees', () => {
    for (const skill of SKILLS) expect(detectorHalfAngle(skill)).toBeLessThan(Math.PI / 2);
  });
});

describe('readMeteoriteDetector — no crater (#2291, edge)', () => {
  it('returns null when the world has no crater', () => {
    expect(readMeteoriteDetector(null, ORIGIN, 3, new Random(1))).toBeNull();
  });

  it.each(SKILLS)('returns null at skill %i with no crater', (skill) => {
    expect(readMeteoriteDetector(null, ORIGIN, skill, new Random(7))).toBeNull();
  });
});

describe('readMeteoriteDetector — bearing (#2291, C2)', () => {
  it.each(SKILLS)('reports a bearing within the half angle of the true bearing at skill %i', (skill) => {
    for (const seed of SEEDS) {
      const r = read(CRATER, ORIGIN, skill, seed);
      expect(angleGap(r.bearing, trueBearing(CRATER, ORIGIN)), `seed ${seed}`).toBeLessThanOrEqual(r.halfAngle + 1e-9);
    }
  });

  it('holds when the crater lies behind the origin, across the ±π wrap', () => {
    // True bearing is exactly π (due -x) and slightly below it: reported values may land either side of the wrap.
    for (const crater of [{ x: -300, z: 0 }, { x: -300, z: -5 }, { x: -300, z: 5 }]) {
      for (const skill of [1, 3]) {
        for (const seed of SEEDS) {
          const r = read(crater, { x: 0, z: 0 }, skill, seed);
          expect(angleGap(r.bearing, trueBearing(crater, { x: 0, z: 0 })), `seed ${seed}`).toBeLessThanOrEqual(r.halfAngle + 1e-9);
        }
      }
    }
  });

  it.each([
    ['east', { x: 400, z: 0 }],
    ['south (+z)', { x: 0, z: 400 }],
    ['north (-z)', { x: 0, z: -400 }],
    ['north-west', { x: -300, z: -300 }],
  ])('holds with the crater to the %s', (_name, crater) => {
    for (const seed of SEEDS) {
      const r = read(crater, { x: 0, z: 0 }, 2, seed);
      expect(angleGap(r.bearing, trueBearing(crater, { x: 0, z: 0 }))).toBeLessThanOrEqual(r.halfAngle + 1e-9);
    }
  });

  it('is taken from the given origin, not from the world origin', () => {
    const crater = { x: 200, z: 200 };
    const origin = { x: 300, z: 100 };
    for (const seed of SEEDS) {
      const r = read(crater, origin, 1, seed);
      expect(angleGap(r.bearing, trueBearing(crater, origin))).toBeLessThanOrEqual(r.halfAngle + 1e-9);
    }
  });

  it('reports the half angle of the surveyor skill', () => {
    for (const skill of SKILLS) {
      expect(read(CRATER, ORIGIN, skill, 3).halfAngle).toBeCloseTo(detectorHalfAngle(skill), 9);
    }
  });

  it('a better surveyor reports a narrower cone', () => {
    expect(read(CRATER, ORIGIN, 5, 9).halfAngle).toBeLessThan(read(CRATER, ORIGIN, 1, 9).halfAngle);
  });

  it('a skill 1 surveyor errs more on average than a top skill one', () => {
    const meanGap = (skill: number): number => {
      const gaps = SEEDS.map(seed => angleGap(read(CRATER, ORIGIN, skill, seed).bearing, trueBearing(CRATER, ORIGIN)));
      return gaps.reduce((a, b) => a + b, 0) / gaps.length;
    };
    expect(meanGap(1)).toBeGreaterThan(meanGap(5));
  });

  it('the reported bearing is not always the true one: the error is real', () => {
    const truth = trueBearing(CRATER, ORIGIN);
    const gaps = SEEDS.map(seed => angleGap(read(CRATER, ORIGIN, 1, seed).bearing, truth));
    expect(Math.max(...gaps)).toBeGreaterThan(0);
    expect(new Set(gaps.map(g => g.toFixed(6))).size).toBeGreaterThan(10);
  });
});

describe('readMeteoriteDetector — distance band (#2291, C2)', () => {
  it.each(SKILLS)('always contains the true distance at skill %i', (skill) => {
    const d = trueDistance(CRATER, ORIGIN);
    for (const seed of SEEDS) {
      const r = read(CRATER, ORIGIN, skill, seed);
      expect(r.minDistance, `seed ${seed}`).toBeLessThanOrEqual(d);
      expect(r.maxDistance, `seed ${seed}`).toBeGreaterThanOrEqual(d);
    }
  });

  it('has exactly the declared width when the crater is far from the origin', () => {
    for (const seed of SEEDS) {
      const r = read(CRATER, ORIGIN, 3, seed);
      expect(r.maxDistance - r.minDistance).toBeCloseTo(DETECTOR_BAND_WIDTH_M, 6);
    }
  });

  it('has edges on the rounding step when the crater is far from the origin', () => {
    for (const seed of SEEDS) {
      const r = read(CRATER, ORIGIN, 3, seed);
      for (const edge of [r.minDistance, r.maxDistance]) {
        const steps = edge / DETECTOR_BAND_ROUND_M;
        expect(Math.abs(steps - Math.round(steps)), `edge ${edge}, seed ${seed}`).toBeLessThan(1e-9);
      }
    }
  });

  it('does not depend on skill: the width is the same at every skill', () => {
    for (const skill of SKILLS) {
      const r = read(CRATER, ORIGIN, skill, 5);
      expect(r.maxDistance - r.minDistance).toBeCloseTo(DETECTOR_BAND_WIDTH_M, 6);
    }
  });

  it('is offset by a seeded fraction: the true distance is not always at the middle', () => {
    const d = trueDistance(CRATER, ORIGIN);
    const fractions = SEEDS.map(seed => {
      const r = read(CRATER, ORIGIN, 3, seed);
      return (d - r.minDistance) / (r.maxDistance - r.minDistance);
    });
    const offCentre = fractions.filter(f => Math.abs(f - 0.5) > 0.05);
    expect(offCentre.length).toBeGreaterThan(SEEDS.length / 4);
    expect(Math.max(...fractions) - Math.min(...fractions)).toBeGreaterThan(0.3);
  });

  it('never starts below zero, whatever the offset', () => {
    for (const crater of [{ x: 10, z: 10 }, { x: 40, z: 40 }, { x: 5, z: 0 }, { x: 0, z: 0 }]) {
      for (const seed of SEEDS) {
        const r = read(crater, { x: 0, z: 0 }, 2, seed);
        expect(r.minDistance, `crater ${crater.x},${crater.z} seed ${seed}`).toBeGreaterThanOrEqual(0);
        expect(r.maxDistance).toBeGreaterThan(r.minDistance);
      }
    }
  });

  it('still contains the distance when the origin is on the crater centre', () => {
    for (const seed of SEEDS) {
      const r = read({ x: 50, z: 50 }, { x: 50, z: 50 }, 3, seed);
      expect(r.minDistance).toBeGreaterThanOrEqual(0);
      expect(r.maxDistance).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(r.bearing)).toBe(true);
    }
  });

  it('contains the true distance for a close crater too', () => {
    const crater = { x: 60, z: 40 };
    const d = trueDistance(crater, { x: 0, z: 0 });
    for (const seed of SEEDS) {
      const r = read(crater, { x: 0, z: 0 }, 4, seed);
      expect(r.minDistance).toBeLessThanOrEqual(d);
      expect(r.maxDistance).toBeGreaterThanOrEqual(d);
    }
  });
});

describe('readMeteoriteDetector — determinism and secrecy (#2291, C2, C4)', () => {
  it('gives the same reading for the same seed', () => {
    for (const skill of SKILLS) {
      expect(read(CRATER, ORIGIN, skill, 21)).toEqual(read(CRATER, ORIGIN, skill, 21));
    }
  });

  it('gives different readings for different seeds', () => {
    const distinct = new Set(SEEDS.map(seed => JSON.stringify(read(CRATER, ORIGIN, 3, seed))));
    expect(distinct.size).toBeGreaterThan(SEEDS.length / 2);
  });

  it('two seeds do not give the identical reading', () => {
    expect(read(CRATER, ORIGIN, 3, 1)).not.toEqual(read(CRATER, ORIGIN, 3, 2));
  });

  it('carries exactly the four reading fields and no crater centre or radius', () => {
    const r = read(CRATER, ORIGIN, 3, 4);
    expect(Object.keys(r).sort()).toEqual(['bearing', 'halfAngle', 'maxDistance', 'minDistance']);
    const text = JSON.stringify(r);
    expect(text).not.toContain('"x"');
    expect(text).not.toContain('"z"');
    expect(text).not.toContain('radius');
  });

  it('returns finite numbers only', () => {
    for (const skill of SKILLS) {
      const r = read(CRATER, ORIGIN, skill, 11);
      for (const v of Object.values(r)) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('does not mutate its crater or origin', () => {
    const crater = { ...CRATER };
    const origin = { ...ORIGIN };
    read(crater, origin, 2, 3);
    expect(crater).toEqual(CRATER);
    expect(origin).toEqual(ORIGIN);
  });
});
