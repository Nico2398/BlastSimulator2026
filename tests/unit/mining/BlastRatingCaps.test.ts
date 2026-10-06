import { describe, it, expect } from 'vitest';
import { applyRatingCaps, oversizeShare, type RatingCapFacts } from '../../../src/core/mining/BlastRatingCaps.js';
import { buildBlastReport, type BlastResult, type BlastRating } from '../../../src/core/mining/BlastExecution.js';
import type { AccidentRecord } from '../../../src/core/entities/Damage.js';
import { BLAST_OVERSIZE_SHARE_CAP } from '../../../src/core/config/balance.js';

const NONE: RatingCapFacts = {
  deaths: 0, injuries: 0, destroyedBuildings: 0, wetHoleCount: 0, oversizedFragments: 0, fragmentCount: 100,
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

  it('wet holes cap at good', () => {
    expect(applyRatingCaps('perfect', facts({ wetHoleCount: 2 }))).toEqual({ rating: 'good', cap: 'wet_holes' });
  });

  it('wet holes leave good and worse untouched, cap null', () => {
    expect(applyRatingCaps('good', facts({ wetHoleCount: 1 }))).toEqual({ rating: 'good', cap: null });
    expect(applyRatingCaps('mediocre', facts({ wetHoleCount: 1 }))).toEqual({ rating: 'mediocre', cap: null });
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
    expect(applyRatingCaps('perfect', facts({ deaths: 1, wetHoleCount: 2, injuries: 1, oversizedFragments: 90 })))
      .toEqual({ rating: 'catastrophic', cap: 'death' });
  });

  it('casualty cap is reported before wet holes when both apply', () => {
    expect(applyRatingCaps('perfect', facts({ injuries: 1, wetHoleCount: 1 })))
      .toEqual({ rating: 'bad', cap: 'casualty_or_destruction' });
  });

  it('bad base with injury and wet holes stays bad, no cap', () => {
    expect(applyRatingCaps('bad', facts({ injuries: 1, wetHoleCount: 1 }))).toEqual({ rating: 'bad', cap: null });
  });

  it('wet holes reported before oversize when both lower the rating', () => {
    expect(applyRatingCaps('perfect', facts({ wetHoleCount: 1, oversizedFragments: 50, fragmentCount: 100 })))
      .toEqual({ rating: 'good', cap: 'wet_holes' });
  });
});

function emptyResult(over: Partial<BlastResult> = {}): BlastResult {
  return {
    fragments: [], fragmentCount: 0, averageFragmentSize: 0, oversizedFragments: 0,
    projectionCount: 0, maxProjectionSpeed: 0, vibrationAtVillages: [], totalRockVolume: 0,
    totalOreValue: 0, rating: 'perfect', crackedVoxels: 0, clearedVoxels: 0,
    clearedRegion: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, destroyedBuildings: [],
    secondaryBlastEvents: [], maxThrowDistance: 0, projectileCount: 0, flights: [], clearedColumns: [],
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

  it('wet holes cap a perfect blast at good', () => {
    const r = buildBlastReport(emptyResult(), 0, 0, [], { wet: ['H1'], fizzled: [] });
    expect(r.rating).toBe('good');
    expect(r.ratingCap).toBe('wet_holes');
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
    const r = buildBlastReport(emptyResult({ rating: 'mediocre' }), 0, 0, [], { wet: ['H1'], fizzled: [] });
    expect(r.rating).toBe('mediocre');
    expect(r.ratingCap).toBeUndefined();
  });
});
