import { describe, it, expect } from 'vitest';
import {
  LADDER_BENCH_FLOOR_M, LADDER_DETECTOR_READINGS, LADDER_DETECTOR_SPOT_SEPARATION_M,
  craterEstimate, decideExpedition, decideFrontierSurvey, decideShuttle, detectorSecondSpot,
  expeditionOrigin, frontierSurveyMethod, frontierSurveysWanted, nextIsland, secondBenchReached,
  type DetectorFix, type IslandPoint,
} from '../../../scripts/shared/probe-ladder-frontier.js';
import { TRAVEL_VEHICLE_UNLOCK_GRADE } from '../../../src/core/config/balance.js';

describe('constants', () => {
  it('pin the ladder frontier tuning', () => {
    expect(LADDER_BENCH_FLOOR_M).toBe(5);
    expect(LADDER_DETECTOR_READINGS).toBe(2);
    expect(LADDER_DETECTOR_SPOT_SEPARATION_M).toBe(120);
  });
});

describe('secondBenchReached', () => {
  it('holds from grade 1 with a pit deeper than the first bench', () => {
    expect(secondBenchReached({ grade: 1, deepestPitM: LADDER_BENCH_FLOOR_M + 0.5 })).toBe(true);
    expect(secondBenchReached({ grade: 3, deepestPitM: 40 })).toBe(true);
  });

  it('needs a depth strictly past the floor', () => {
    expect(secondBenchReached({ grade: 1, deepestPitM: LADDER_BENCH_FLOOR_M })).toBe(false);
    expect(secondBenchReached({ grade: 2, deepestPitM: 0 })).toBe(false);
  });

  it('does not hold at grade 0 however deep the pit', () => {
    expect(secondBenchReached({ grade: 0, deepestPitM: 50 })).toBe(false);
  });
});

describe('frontierSurveyMethod', () => {
  it('is null below grade 2', () => {
    expect(frontierSurveyMethod(0)).toBeNull();
    expect(frontierSurveyMethod(1)).toBeNull();
  });

  it('is prospection at grade 2', () => {
    expect(frontierSurveyMethod(2)).toBe('prospection');
  });

  it('is the meteorite detector from grade 3', () => {
    expect(frontierSurveyMethod(3)).toBe('meteorite_detector');
    expect(frontierSurveyMethod(5)).toBe('meteorite_detector');
  });
});

describe('frontierSurveysWanted', () => {
  it('wants one prospection and the detector readings count of detector readings', () => {
    expect(frontierSurveysWanted('prospection')).toBe(1);
    expect(frontierSurveysWanted('meteorite_detector')).toBe(LADDER_DETECTOR_READINGS);
  });
});

describe('decideFrontierSurvey', () => {
  const base = { method: 'prospection' as const, completed: 0, pending: false, cash: 10_000, cost: 1_000, reserve: 2_000 };

  it('orders when nothing is done or pending and cash covers cost plus reserve', () => {
    expect(decideFrontierSurvey(base)).toBe('order');
  });

  it('skips without a method', () => {
    expect(decideFrontierSurvey({ ...base, method: null })).toBe('skip');
  });

  it('skips while one of that method is pending', () => {
    expect(decideFrontierSurvey({ ...base, pending: true })).toBe('skip');
  });

  it('skips once the wanted surveys of the method are completed', () => {
    expect(decideFrontierSurvey({ ...base, completed: 1 })).toBe('skip');
    expect(decideFrontierSurvey({ ...base, completed: 4 })).toBe('skip');
  });

  it('orders the second detector reading, not a third', () => {
    const detector = { ...base, method: 'meteorite_detector' as const };
    expect(decideFrontierSurvey({ ...detector, completed: 0 })).toBe('order');
    expect(decideFrontierSurvey({ ...detector, completed: LADDER_DETECTOR_READINGS - 1 })).toBe('order');
    expect(decideFrontierSurvey({ ...detector, completed: LADDER_DETECTOR_READINGS })).toBe('skip');
  });

  it('keeps the reserve: orders at exactly cost plus reserve, skips one short', () => {
    expect(decideFrontierSurvey({ ...base, cash: 3_000 })).toBe('order');
    expect(decideFrontierSurvey({ ...base, cash: 2_999 })).toBe('skip');
  });
});

describe('detectorSecondSpot', () => {
  it('moves the base 120 m to the +90 degree side of the bearing', () => {
    expect(detectorSecondSpot({ x: 100, z: 100 }, 0)).toEqual({ x: 100, z: 220 });
    expect(detectorSecondSpot({ x: 500, z: 500 }, Math.PI)).toEqual({ x: 500, z: 380 });
  });

  it('rounds both coordinates to integers', () => {
    expect(detectorSecondSpot({ x: 500, z: 500 }, Math.PI / 4)).toEqual({ x: 415, z: 585 });
  });

  it('falls to the -90 degree side when the +90 side has a negative coordinate', () => {
    expect(detectorSecondSpot({ x: 100, z: 100 }, Math.PI / 2)).toEqual({ x: 220, z: 100 });
    expect(detectorSecondSpot({ x: 100, z: 100 }, Math.PI)).toEqual({ x: 100, z: 220 });
  });

  it('keeps the +90 side when it lands exactly on zero', () => {
    expect(detectorSecondSpot({ x: 120, z: 50 }, Math.PI / 2)).toEqual({ x: 0, z: 50 });
  });

  it('always lands LADDER_DETECTOR_SPOT_SEPARATION_M away', () => {
    for (const b of [0.3, 1.1, 2.5, -0.7]) {
      const s = detectorSecondSpot({ x: 800, z: 800 }, b);
      expect(Math.hypot(s.x - 800, s.z - 800)).toBeCloseTo(LADDER_DETECTOR_SPOT_SEPARATION_M, 0);
    }
  });
});

describe('craterEstimate', () => {
  const fix = (ox: number, oz: number, bearing: number, minDistance = 100, maxDistance = 200): DetectorFix =>
    ({ origin: { x: ox, z: oz }, bearing, halfAngle: 0.2, minDistance, maxDistance });

  it('is null without a reading', () => {
    expect(craterEstimate([])).toBeNull();
  });

  it('puts a single reading at the band mid distance along its bearing', () => {
    expect(craterEstimate([fix(0, 0, 0, 300, 350)])).toEqual({ x: 325, z: 0 });
  });

  it('intersects the bearing rays of two readings', () => {
    expect(craterEstimate([fix(0, 0, Math.PI / 4), fix(200, 0, (3 * Math.PI) / 4)])).toEqual({ x: 100, z: 100 });
    expect(craterEstimate([fix(50, 60, Math.PI / 4), fix(250, 60, (3 * Math.PI) / 4)])).toEqual({ x: 150, z: 160 });
  });

  it('uses only the first two readings', () => {
    const third = fix(900, 900, 0);
    expect(craterEstimate([fix(0, 0, Math.PI / 4), fix(200, 0, (3 * Math.PI) / 4), third])).toEqual({ x: 100, z: 100 });
  });

  it('falls back to the first reading when the two rays are parallel', () => {
    expect(craterEstimate([fix(0, 0, 0, 300, 350), fix(0, 100, 0, 100, 200)])).toEqual({ x: 325, z: 0 });
  });

  it('falls back to the first reading when the rays cross behind the first origin', () => {
    expect(craterEstimate([fix(0, 0, Math.PI / 4), fix(200, 0, Math.atan2(-1, -3))])).toEqual({ x: 106, z: 106 });
  });

  it('falls back to the first reading when the rays cross behind the second origin', () => {
    expect(craterEstimate([fix(200, 0, Math.atan2(-1, -3)), fix(0, 0, Math.PI / 4)])).toEqual({ x: 58, z: -47 });
  });
});

describe('nextIsland', () => {
  const isle = (x: number, z: number, radius = 10, oreId = 'craktonite'): IslandPoint => ({ x, z, oreId, radius });

  it('is null for no islands', () => {
    expect(nextIsland([], { x: 0, z: 0 }, [])).toBeNull();
  });

  it('picks the island nearest the origin point', () => {
    const near = isle(100, 0);
    expect(nextIsland([isle(500, 500), near, isle(0, 300)], { x: 0, z: 0 }, [])).toBe(near);
  });

  it('measures from the given point, not from the origin', () => {
    const far = isle(1000, 1000);
    expect(nextIsland([isle(10, 10), far], { x: 990, z: 990 }, [])).toBe(far);
  });

  it('skips an island some shot landed within its radius plus the prospection error of', () => {
    const shot = isle(100, 0, 10);
    const next = isle(300, 0, 10);
    // 10 + 24 = 34 m: a shot 30 m off counts, one 40 m off does not
    expect(nextIsland([shot, next], { x: 0, z: 0 }, [{ x: 130, z: 0 }])).toBe(next);
    expect(nextIsland([shot, next], { x: 0, z: 0 }, [{ x: 140, z: 0 }])).toBe(shot);
  });

  it('scales the shot window with the island radius', () => {
    const wide = isle(100, 0, 60);
    expect(nextIsland([wide], { x: 0, z: 0 }, [{ x: 180, z: 0 }])).toBeNull();
    expect(nextIsland([wide], { x: 0, z: 0 }, [{ x: 190, z: 0 }])).toBe(wide);
  });

  it('is null once every island was shot', () => {
    const a = isle(100, 0);
    const b = isle(300, 300);
    expect(nextIsland([a, b], { x: 0, z: 0 }, [{ x: 100, z: 0 }, { x: 300, z: 300 }])).toBeNull();
  });

  it('keeps the earlier island on equal distance', () => {
    const first = isle(100, 0, 10, 'craktonite');
    const second = isle(0, 100, 10, 'absurdium');
    expect(nextIsland([first, second], { x: 0, z: 0 }, [])).toBe(first);
    expect(nextIsland([second, first], { x: 0, z: 0 }, [])).toBe(second);
  });

  it('copes with negative coordinates', () => {
    const west = isle(-50, -50);
    expect(nextIsland([isle(400, 400), west], { x: -40, z: -40 }, [])).toBe(west);
  });
});

describe('expeditionOrigin', () => {
  it('centres the pattern span on the target', () => {
    expect(expeditionOrigin({ x: 100, z: 200 }, 20)).toEqual({ x: 90, z: 190 });
  });

  it('floors a half-metre offset', () => {
    expect(expeditionOrigin({ x: 100, z: 200 }, 15)).toEqual({ x: 92, z: 192 });
    expect(expeditionOrigin({ x: 100.7, z: 200.2 }, 10)).toEqual({ x: 95, z: 195 });
  });

  it('a zero span puts the origin on the target', () => {
    expect(expeditionOrigin({ x: 33, z: 44 }, 0)).toEqual({ x: 33, z: 44 });
  });

  it('floors toward minus infinity for a negative result', () => {
    expect(expeditionOrigin({ x: 2, z: 2 }, 5)).toEqual({ x: -1, z: -1 });
  });
});

describe('decideShuttle', () => {
  const base = { grade: TRAVEL_VEHICLE_UNLOCK_GRADE, shuttles: 0, cash: 100_000, cost: 20_000, reserve: 10_000 };

  it('buys at the unlock grade with none owned and cash past the reserve', () => {
    expect(TRAVEL_VEHICLE_UNLOCK_GRADE).toBe(2);
    expect(decideShuttle(base)).toBe('buy');
    expect(decideShuttle({ ...base, grade: 3 })).toBe('buy');
  });

  it('skips below the unlock grade', () => {
    expect(decideShuttle({ ...base, grade: 1 })).toBe('skip');
    expect(decideShuttle({ ...base, grade: 0 })).toBe('skip');
  });

  it('skips once a shuttle is owned', () => {
    expect(decideShuttle({ ...base, shuttles: 1 })).toBe('skip');
  });

  it('keeps the reserve: buys at exactly cost plus reserve, skips one short', () => {
    expect(decideShuttle({ ...base, cash: 30_000 })).toBe('buy');
    expect(decideShuttle({ ...base, cash: 29_999 })).toBe('skip');
  });
});

describe('decideExpedition', () => {
  const base = { hasTarget: true, shuttles: 1, cash: 100_000, cost: 20_000, reserve: 10_000, inFlight: false };

  it('goes with a target, a shuttle, nothing in flight and cash past the reserve', () => {
    expect(decideExpedition(base)).toBe('go');
    expect(decideExpedition({ ...base, shuttles: 2 })).toBe('go');
  });

  it('waits without a target', () => {
    expect(decideExpedition({ ...base, hasTarget: false })).toBe('wait');
  });

  it('waits without a shuttle', () => {
    expect(decideExpedition({ ...base, shuttles: 0 })).toBe('wait');
  });

  it('waits while a shot is in flight', () => {
    expect(decideExpedition({ ...base, inFlight: true })).toBe('wait');
  });

  it('keeps the reserve: goes at exactly cost plus reserve, waits one short', () => {
    expect(decideExpedition({ ...base, cash: 30_000 })).toBe('go');
    expect(decideExpedition({ ...base, cash: 29_999 })).toBe('wait');
  });
});
