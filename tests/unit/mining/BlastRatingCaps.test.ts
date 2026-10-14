import { describe, it, expect } from 'vitest';
import { applyRatingCaps, fizzleShare, oversizeShare, type RatingCapFacts } from '../../../src/core/mining/BlastRatingCaps.js';
import { buildBlastReport, type BlastResult, type BlastRating } from '../../../src/core/mining/BlastExecution.js';
import type { AccidentRecord } from '../../../src/core/entities/Damage.js';
import { BLAST_FIZZLE_SHARE_FAILURE, BLAST_FIZZLE_SHARE_PARTIAL, BLAST_OVERSIZE_SHARE_CAP } from '../../../src/core/config/balance.js';

const NONE: RatingCapFacts = {
  deaths: 0, injuries: 0, destroyedBuildings: 0, wetHoleCount: 0, fizzledHoleCount: 0, chargedHoleCount: 0,
  oversizedFragments: 0, fragmentCount: 100, noBreakout: false,
};
const facts = (o: Partial<RatingCapFacts> = {}): RatingCapFacts => ({ ...NONE, ...o });

describe('oversizeShare', () => {
  it('is the oversized fraction of all fragments', () => {
    expect(oversizeShare(30, 100)).toBeCloseTo(0.3, 10);
    expect(oversizeShare(1, 4)).toBe(0.25);
  });
  it('is 0 with no fragments, never NaN', () => {
    expect(oversizeShare(0, 0)).toBe(0);
    expect(Number.isNaN(oversizeShare(5, 0))).toBe(false);
  });
  it('is 1 when every fragment is oversized', () => {
    expect(oversizeShare(7, 7)).toBe(1);
  });
});

describe('fizzleShare (#1675)', () => {
  it('is the fizzled fraction of charged holes', () => {
    expect(fizzleShare(1, 4)).toBe(0.25);
    expect(fizzleShare(9, 9)).toBe(1);
  });
  it('is 0 with no charged holes, never NaN', () => {
    expect(fizzleShare(0, 0)).toBe(0);
    expect(Number.isNaN(fizzleShare(3, 0))).toBe(false);
  });
  it('is 0 when nothing fizzled', () => {
    expect(fizzleShare(0, 6)).toBe(0);
  });
});

describe('applyRatingCaps fizzle share (#1675)', () => {
  const fz = (fizzled: number, charged: number, o: Partial<RatingCapFacts> = {}) =>
    facts({ wetHoleCount: fizzled, fizzledHoleCount: fizzled, chargedHoleCount: charged, ...o });

  it('thresholds are 0.75 and 0.25', () => {
    expect(BLAST_FIZZLE_SHARE_FAILURE).toBe(0.75);
    expect(BLAST_FIZZLE_SHARE_PARTIAL).toBe(0.25);
  });
  it('all charges fizzled caps a perfect blast at bad', () => {
    expect(applyRatingCaps('perfect', fz(9, 9))).toEqual({ rating: 'bad', cap: 'fizzled_failure' });
  });
  it('share exactly at the failure threshold caps at bad', () => {
    expect(applyRatingCaps('perfect', fz(3, 4))).toEqual({ rating: 'bad', cap: 'fizzled_failure' });
  });
  it('half fizzled caps at mediocre', () => {
    expect(applyRatingCaps('perfect', fz(2, 4))).toEqual({ rating: 'mediocre', cap: 'fizzled_partial' });
  });
  it('share exactly at the partial threshold caps at mediocre', () => {
    expect(applyRatingCaps('perfect', fz(1, 4))).toEqual({ rating: 'mediocre', cap: 'fizzled_partial' });
  });
  it('below the partial threshold falls back to the wet_holes good cap', () => {
    expect(applyRatingCaps('perfect', fz(1, 5))).toEqual({ rating: 'good', cap: 'wet_holes' });
  });
  it('failure share on a good base is capped at bad', () => {
    expect(applyRatingCaps('good', fz(4, 4))).toEqual({ rating: 'bad', cap: 'fizzled_failure' });
  });
  it('partial cap leaves a bad base alone', () => {
    expect(applyRatingCaps('bad', fz(2, 4))).toEqual({ rating: 'bad', cap: null });
  });
  it('caps only lower: bad and catastrophic bases stay with a total fizzle', () => {
    expect(applyRatingCaps('bad', fz(9, 9))).toEqual({ rating: 'bad', cap: null });
    expect(applyRatingCaps('catastrophic', fz(9, 9))).toEqual({ rating: 'catastrophic', cap: null });
  });
  it('death still wins over a total fizzle', () => {
    expect(applyRatingCaps('perfect', fz(9, 9, { deaths: 1 }))).toEqual({ rating: 'catastrophic', cap: 'death' });
  });
  it('injuries are reported before a partial fizzle', () => {
    expect(applyRatingCaps('perfect', fz(2, 4, { injuries: 1 }))).toEqual({ rating: 'bad', cap: 'casualty_or_destruction' });
  });
  it('a total fizzle is reported before wet holes and oversize', () => {
    expect(applyRatingCaps('perfect', fz(4, 4, { oversizedFragments: 90 }))).toEqual({ rating: 'bad', cap: 'fizzled_failure' });
  });
  it('zero charged holes never trigger a fizzle cap', () => {
    expect(applyRatingCaps('perfect', facts({ fizzledHoleCount: 0, chargedHoleCount: 0 }))).toEqual({ rating: 'perfect', cap: null });
  });
});

describe('applyRatingCaps', () => {
  it('passes the base through with no cap when nothing applies', () => {
    for (const r of ['perfect', 'good', 'mediocre', 'bad', 'catastrophic'] as BlastRating[]) {
      expect(applyRatingCaps(r, facts())).toEqual({ rating: r, cap: null });
    }
  });

  it('death forces catastrophic', () => {
    expect(applyRatingCaps('perfect', facts({ deaths: 1 }))).toEqual({ rating: 'catastrophic', cap: 'death' });
    expect(applyRatingCaps('bad', facts({ deaths: 3 }))).toEqual({ rating: 'catastrophic', cap: 'death' });
  });

  it('death on an already catastrophic base reports no cap', () => {
    expect(applyRatingCaps('catastrophic', facts({ deaths: 1 }))).toEqual({ rating: 'catastrophic', cap: null });
  });

  it('injury caps at bad', () => {
    expect(applyRatingCaps('perfect', facts({ injuries: 1 }))).toEqual({ rating: 'bad', cap: 'casualty_or_destruction' });
    expect(applyRatingCaps('good', facts({ injuries: 2 }))).toEqual({ rating: 'bad', cap: 'casualty_or_destruction' });
  });

  it('destroyed building caps at bad', () => {
    expect(applyRatingCaps('good', facts({ destroyedBuildings: 1 }))).toEqual({ rating: 'bad', cap: 'casualty_or_destruction' });
  });

  it('catastrophic base with injury stays catastrophic, no cap', () => {
    expect(applyRatingCaps('catastrophic', facts({ injuries: 1 }))).toEqual({ rating: 'catastrophic', cap: null });
  });

  it('bad base with injury stays bad, no cap', () => {
    expect(applyRatingCaps('bad', facts({ injuries: 1 }))).toEqual({ rating: 'bad', cap: null });
  });

  it('wet holes with a fizzled charge cap at good', () => {
    expect(applyRatingCaps('perfect', facts({ wetHoleCount: 2, fizzledHoleCount: 1, chargedHoleCount: 10 })))
      .toEqual({ rating: 'good', cap: 'wet_holes' });
  });

  it('wet holes with a fizzled charge leave good and worse untouched, cap null', () => {
    const f = { wetHoleCount: 1, fizzledHoleCount: 1, chargedHoleCount: 10 };
    expect(applyRatingCaps('good', facts(f))).toEqual({ rating: 'good', cap: null });
    expect(applyRatingCaps('mediocre', facts(f))).toEqual({ rating: 'mediocre', cap: null });
  });

  it('wet holes with nothing fizzled do not cap (#1675)', () => {
    expect(applyRatingCaps('perfect', facts({ wetHoleCount: 9, fizzledHoleCount: 0, chargedHoleCount: 9 })))
      .toEqual({ rating: 'perfect', cap: null });
  });

  it('oversize share above the limit caps at good', () => {
    expect(applyRatingCaps('perfect', facts({ oversizedFragments: 31, fragmentCount: 100 }))).toEqual({ rating: 'good', cap: 'oversize' });
  });

  it('oversize share exactly at the limit does not cap', () => {
    expect(BLAST_OVERSIZE_SHARE_CAP).toBe(0.30);
    expect(applyRatingCaps('perfect', facts({ oversizedFragments: 30, fragmentCount: 100 }))).toEqual({ rating: 'perfect', cap: null });
  });

  it('oversize caps leave a mediocre base alone', () => {
    expect(applyRatingCaps('mediocre', facts({ oversizedFragments: 90, fragmentCount: 100 }))).toEqual({ rating: 'mediocre', cap: null });
  });

  it('zero fragments never trigger the oversize cap', () => {
    expect(applyRatingCaps('perfect', facts({ oversizedFragments: 0, fragmentCount: 0 }))).toEqual({ rating: 'perfect', cap: null });
  });

  it('death outranks wet holes, injuries and oversize', () => {
    expect(applyRatingCaps('perfect', facts({ deaths: 1, wetHoleCount: 2, fizzledHoleCount: 2, chargedHoleCount: 2, injuries: 1, oversizedFragments: 90 })))
      .toEqual({ rating: 'catastrophic', cap: 'death' });
  });

  it('casualty cap is reported before wet holes when both apply', () => {
    expect(applyRatingCaps('perfect', facts({ injuries: 1, wetHoleCount: 1, fizzledHoleCount: 1, chargedHoleCount: 4 })))
      .toEqual({ rating: 'bad', cap: 'casualty_or_destruction' });
  });

  it('bad base with injury and wet holes stays bad, no cap', () => {
    expect(applyRatingCaps('bad', facts({ injuries: 1, wetHoleCount: 1, fizzledHoleCount: 1, chargedHoleCount: 4 }))).toEqual({ rating: 'bad', cap: null });
  });

  it('wet holes reported before oversize when both lower the rating', () => {
    expect(applyRatingCaps('perfect', facts({ wetHoleCount: 1, fizzledHoleCount: 1, chargedHoleCount: 5, oversizedFragments: 50, fragmentCount: 100 })))
      .toEqual({ rating: 'good', cap: 'wet_holes' });
  });
});

function emptyResult(over: Partial<BlastResult> = {}): BlastResult {
  return {
    fragments: [], fragmentCount: 0, averageFragmentSize: 0, oversizedFragments: 0,
    projectionCount: 0, maxProjectionSpeed: 0, vibrationAtVillages: [], totalRockVolume: 0,
    totalOreValue: 0, rating: 'perfect', crackedVoxels: 0, clearedVoxels: 0,
    clearedRegion: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, destroyedBuildings: [],
    secondaryBlastEvents: [], maxThrowDistance: 0, projectileCount: 0, flights: [], clearedColumns: [], brokeOut: true,
    ...over,
  };
}
const acc = (o: Partial<AccidentRecord>): AccidentRecord =>
  ({ tick: 0, type: 'injury', entityId: 1, fragmentId: 1, kineticEnergy: 1, ...o });

describe('buildBlastReport rating caps (#1349)', () => {
  it('a death accident makes the report catastrophic with ratingCap death', () => {
    const r = buildBlastReport(emptyResult(), 0, 0, [acc({ type: 'death' })]);
    expect(r.rating).toBe('catastrophic');
    expect(r.ratingCap).toBe('death');
    expect(r.baseRating).toBe('perfect');
  });

  it('an injury caps a perfect blast at bad', () => {
    const r = buildBlastReport(emptyResult(), 0, 0, [acc({ type: 'injury' })]);
    expect(r.rating).toBe('bad');
    expect(r.ratingCap).toBe('casualty_or_destruction');
  });

  it('a destroyed building in the result caps at bad', () => {
    const r = buildBlastReport(
      emptyResult({ destroyedBuildings: [{ buildingId: 3, type: 'living_quarters' as never, x: 0, z: 0 }] }), 0, 0);
    expect(r.rating).toBe('bad');
    expect(r.ratingCap).toBe('casualty_or_destruction');
  });

  it('a building_destroyed accident alone caps at bad', () => {
    const r = buildBlastReport(emptyResult(), 0, 0, [acc({ type: 'building_destroyed', entityId: 3 })]);
    expect(r.rating).toBe('bad');
    expect(r.ratingCap).toBe('casualty_or_destruction');
  });

  it('the same building in result and accident is counted once (still one cap, bad)', () => {
    const r = buildBlastReport(
      emptyResult({ destroyedBuildings: [{ buildingId: 3, type: 'living_quarters' as never, x: 0, z: 0 }] }), 0, 0,
      [acc({ type: 'building_destroyed', entityId: 3 })]);
    expect(r.rating).toBe('bad');
  });

  it('a vehicle-only loss does not cap', () => {
    const r = buildBlastReport(emptyResult(), 0, 0, [acc({ type: 'vehicle_destroyed' }), acc({ type: 'vehicle_damage' })]);
    expect(r.rating).toBe('perfect');
    expect(r.ratingCap).toBeUndefined();
  });

  it('wet holes with a minority fizzled cap a perfect blast at good', () => {
    const r = buildBlastReport(emptyResult(), 0, 0, [], { wet: ['H1'], fizzled: ['H1'], chargedCount: 5 });
    expect(r.rating).toBe('good');
    expect(r.ratingCap).toBe('wet_holes');
  });

  it('wet holes with nothing fizzled do not cap (#1675)', () => {
    const r = buildBlastReport(emptyResult(), 0, 0, [], { wet: ['H1', 'H2'], fizzled: [], chargedCount: 2 });
    expect(r.rating).toBe('perfect');
    expect(r.ratingCap).toBeUndefined();
  });

  it('every charge fizzled rates bad with ratingCap fizzled_failure (#1675)', () => {
    const r = buildBlastReport(emptyResult(), 0, 0, [], { wet: ['H1', 'H2'], fizzled: ['H1', 'H2'], chargedCount: 2 });
    expect(r.rating).toBe('bad');
    expect(r.baseRating).toBe('perfect');
    expect(r.ratingCap).toBe('fizzled_failure');
  });

  it('half the charges fizzled rates mediocre with ratingCap fizzled_partial (#1675)', () => {
    const r = buildBlastReport(emptyResult(), 0, 0, [], { wet: ['H1'], fizzled: ['H1'], chargedCount: 2 });
    expect(r.rating).toBe('mediocre');
    expect(r.ratingCap).toBe('fizzled_partial');
  });

  it('too many oversized fragments cap at good', () => {
    const r = buildBlastReport(emptyResult({ fragmentCount: 10, oversizedFragments: 4 }), 0, 0);
    expect(r.rating).toBe('good');
    expect(r.ratingCap).toBe('oversize');
  });

  it('no caps leaves rating and ratingCap undefined', () => {
    const r = buildBlastReport(emptyResult(), 0, 0);
    expect(r.rating).toBe('perfect');
    expect(r.ratingCap).toBeUndefined();
  });

  it('a mediocre base is not raised or capped by wet holes', () => {
    const r = buildBlastReport(emptyResult({ rating: 'mediocre' }), 0, 0, [], { wet: ['H1'], fizzled: [], chargedCount: 1 });
    expect(r.rating).toBe('mediocre');
    expect(r.ratingCap).toBeUndefined();
  });
});

describe('applyRatingCaps no breakout (#1724)', () => {
  it('a blast that never broke out caps a perfect base at bad', () => {
    expect(applyRatingCaps('perfect', facts({ noBreakout: true }))).toEqual({ rating: 'bad', cap: 'no_breakout' });
  });
  it('caps good and mediocre bases at bad too', () => {
    expect(applyRatingCaps('good', facts({ noBreakout: true }))).toEqual({ rating: 'bad', cap: 'no_breakout' });
    expect(applyRatingCaps('mediocre', facts({ noBreakout: true }))).toEqual({ rating: 'bad', cap: 'no_breakout' });
  });
  it('leaves a bad base alone, no cap reported', () => {
    expect(applyRatingCaps('bad', facts({ noBreakout: true }))).toEqual({ rating: 'bad', cap: null });
  });
  it('leaves a catastrophic base alone, no cap reported', () => {
    expect(applyRatingCaps('catastrophic', facts({ noBreakout: true }))).toEqual({ rating: 'catastrophic', cap: null });
  });
  it('death wins over no breakout', () => {
    expect(applyRatingCaps('perfect', facts({ noBreakout: true, deaths: 1 }))).toEqual({ rating: 'catastrophic', cap: 'death' });
  });
  it('a casualty is reported before no breakout', () => {
    expect(applyRatingCaps('perfect', facts({ noBreakout: true, injuries: 1 }))).toEqual({ rating: 'bad', cap: 'casualty_or_destruction' });
    expect(applyRatingCaps('good', facts({ noBreakout: true, destroyedBuildings: 1 }))).toEqual({ rating: 'bad', cap: 'casualty_or_destruction' });
  });
  it('is reported ahead of the milder caps it subsumes', () => {
    expect(applyRatingCaps('perfect', facts({ noBreakout: true, oversizedFragments: 90 }))).toEqual({ rating: 'bad', cap: 'no_breakout' });
    expect(applyRatingCaps('perfect', facts({ noBreakout: true, wetHoleCount: 1, fizzledHoleCount: 1, chargedHoleCount: 10 })))
      .toEqual({ rating: 'bad', cap: 'no_breakout' });
  });
  it('noBreakout false or omitted changes nothing', () => {
    expect(applyRatingCaps('perfect', facts({ noBreakout: false }))).toEqual({ rating: 'perfect', cap: null });
    expect(applyRatingCaps('perfect', facts())).toEqual({ rating: 'perfect', cap: null });
  });
});

describe('buildBlastReport no breakout (#1724)', () => {
  const sealed = (o: Partial<BlastResult> = {}): BlastResult => ({ ...emptyResult(), clearedVoxels: 300, brokeOut: false, ...o });

  it('a cleared blast that did not break out is rated no better than bad with cap no_breakout', () => {
    const r = buildBlastReport(sealed(), 0, 0);
    expect(r.rating).toBe('bad');
    expect(r.baseRating).toBe('perfect');
    expect(r.ratingCap).toBe('no_breakout');
    expect(r.brokeOut).toBe(false);
  });
  it('a blast that broke out is not capped', () => {
    const r = buildBlastReport(sealed({ brokeOut: true }), 0, 0);
    expect(r.rating).toBe('perfect');
    expect(r.ratingCap).toBeUndefined();
  });
  it('a blast that cleared nothing is not blamed for failing to break out', () => {
    const r = buildBlastReport(sealed({ clearedVoxels: 0 }), 0, 0);
    expect(r.ratingCap).toBeUndefined();
  });
  it('a result without brokeOut (old saves) reads as broke out', () => {
    const { brokeOut: _omit, ...rest } = sealed();
    const r = buildBlastReport(rest as BlastResult, 0, 0);
    expect(r.ratingCap).toBeUndefined();
  });
});
