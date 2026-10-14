import { describe, it, expect } from 'vitest';
import { WorldNoiseFields } from '../../../src/core/world/NoiseFields.js';
import {
  sampleBaseHeight,
  applyPitMask,
  computeGroundOffset,
  heightToVoxelY,
  heightToVoxelYContinuous,
  createWorldGenContext,
  sampleSurfaceVoxelY,
  DEFAULT_SHAPING,
  type Rect,
} from '../../../src/core/world/WorldGen.js';
import { DEFAULT_PIT_MASK } from '../../../src/core/config/balance.js';

describe('sampleBaseHeight', () => {
  it('is deterministic for the same fields, shaping, and coordinates', () => {
    const fields = new WorldNoiseFields(42);
    const a = sampleBaseHeight(fields, 100, 200, DEFAULT_SHAPING);
    const b = sampleBaseHeight(fields, 100, 200, DEFAULT_SHAPING);
    expect(a).toBe(b);
  });

  it('produces a finite height for a wide range of coordinates', () => {
    const fields = new WorldNoiseFields(7);
    for (let x = -500; x <= 500; x += 100) {
      const h = sampleBaseHeight(fields, x, x * 0.5, DEFAULT_SHAPING);
      expect(Number.isFinite(h)).toBe(true);
    }
  });

  it('feature wavelength is independent of grid size: same world (x, z) gives the same height', () => {
    // The whole point of absolute (non-normalized) coordinates. A 32-wide and
    // a 320-wide grid must agree on the height at world position (20, 20).
    const fieldsA = new WorldNoiseFields(42); // as if building a 32-wide grid
    const fieldsB = new WorldNoiseFields(42); // as if building a 320-wide grid
    expect(sampleBaseHeight(fieldsA, 20, 20)).toBe(sampleBaseHeight(fieldsB, 20, 20));
  });
});

describe('applyPitMask', () => {
  const rect: Rect = { minX: 0, minZ: 0, maxX: 200, maxZ: 200 };

  it('leaves height unchanged outside the rect', () => {
    expect(applyPitMask(100, 0, rect, -50, 50)).toBe(100);
    expect(applyPitMask(100, 0, rect, 250, 50)).toBe(100);
  });

  it('leaves height unchanged exactly at the rect edge (w=0)', () => {
    expect(applyPitMask(100, 0, rect, 0, 50)).toBeCloseTo(100, 10);
  });

  it('strongly compresses height toward centerHeight deep inside the rect', () => {
    const masked = applyPitMask(100, 0, rect, 100, 100); // rect centre, far from any edge
    // Deep inside: w=1, result = centerHeight + (h-centerHeight)*KEEP = 0 + 100*0.3 = 30
    expect(masked).toBeCloseTo(30, 5);
  });

  it('compression strength increases monotonically from the edge inward', () => {
    const atEdge = applyPitMask(100, 0, rect, 0, 100);
    const partway = applyPitMask(100, 0, rect, 12, 100);
    const deep = applyPitMask(100, 0, rect, 100, 100);
    expect(Math.abs(deep - 30)).toBeLessThan(Math.abs(partway - 30));
    expect(Math.abs(partway - 30)).toBeLessThan(Math.abs(atEdge - 30) + 1e-9);
  });

  it('does nothing when height already equals centerHeight', () => {
    expect(applyPitMask(50, 50, rect, 100, 100)).toBeCloseTo(50, 10);
  });
});

describe('heightToVoxelY / heightToVoxelYContinuous — drop the sizeY parameter (#1189)', () => {
  // The clamp these two used to apply (Math.max(1, Math.min(sizeY - 1, ...)))
  // is what `applyPlayableBand` and every previously-clamped column relied
  // on. #1189 deletes the clamp — and the parameter that drove it — from
  // both functions entirely, so storage-only concerns (VoxelGrid) are the
  // sole place any bound on height can come from now.

  it('heightToVoxelY takes exactly (height, groundOffset) — no sizeY parameter', () => {
    expect(heightToVoxelY.length).toBe(2);
  });

  it('heightToVoxelYContinuous takes exactly (height, groundOffset) — no sizeY parameter', () => {
    expect(heightToVoxelYContinuous.length).toBe(2);
  });
});

describe('computeGroundOffset — vertical datum shift (#1190)', () => {
  it('always equals datum - Math.round(centerHeight)', () => {
    // datum values below are the console-layer Math.floor(sizeY * 0.55)
    // conversion of the old sizeY concept, baked in as literals — datum is
    // now the sole input, computeGroundOffset itself no longer knows sizeY.
    for (const [centerHeight, datum] of [[10, 22], [0, 11], [-15.4, 35], [123.9, 110], [-0.5, 4], [1000, 13]] as const) {
      expect(computeGroundOffset(centerHeight, datum)).toBe(datum - Math.round(centerHeight));
    }
  });
});

describe('computeGroundOffset / heightToVoxelY', () => {
  it('places centerHeight exactly at the given datum after the shift', () => {
    const datum = 22; // console-layer Math.floor(40 * 0.55) of the old sizeY concept
    const offset = computeGroundOffset(10, datum);
    const y = heightToVoxelY(10, offset);
    expect(y).toBe(datum);
  });

  it('rounds a large positive height without bounding it to sizeY - 1 (#1189)', () => {
    // Pre-#1189 this clamped to sizeY - 1 = 19. The datum shift (groundOffset
    // 0 here) leaves the raw height untouched, so the only thing standing
    // between 10000 and this assertion is the clamp #1189 removes.
    expect(heightToVoxelY(10000, 0)).toBe(10000);
  });

  it('rounds a large negative height without bounding it to 1 (#1189)', () => {
    // Pre-#1189 this clamped to 1. Same removal, opposite side of the band.
    expect(heightToVoxelY(-10000, 0)).toBe(-10000);
  });

  it('rounds to the nearest integer voxel', () => {
    expect(heightToVoxelY(5.4, 0)).toBe(5);
    expect(heightToVoxelY(5.6, 0)).toBe(6);
  });
});

describe('heightToVoxelYContinuous — direct coverage (#1189)', () => {
  // heightToVoxelYContinuous had no direct unit tests before #1189 — only
  // indirect coverage through sampleSurfaceHeightY/haloSurfaceHeight.

  it('shifts height by groundOffset without rounding (happy path)', () => {
    expect(heightToVoxelYContinuous(10.25, 5)).toBeCloseTo(15.25, 10);
  });

  it('does not clamp a large positive magnitude (#1189)', () => {
    // Pre-#1189 this clamped to sizeY - 1 = 19.
    expect(heightToVoxelYContinuous(10000.5, 0)).toBeCloseTo(10000.5, 10);
  });

  it('does not clamp a large negative magnitude (#1189)', () => {
    // Pre-#1189 this clamped to 1.
    expect(heightToVoxelYContinuous(-10000.5, 0)).toBeCloseTo(-10000.5, 10);
  });

  it('passes NaN through, so "no ground here" stays distinguishable from "ground at the floor"', () => {
    expect(Number.isNaN(heightToVoxelYContinuous(NaN, 0))).toBe(true);
  });
});

describe('sampleBaseHeight — weighted shaping blend', () => {
  const fields = new WorldNoiseFields(42);
  const low: import('../../../src/core/world/WorldGen.js').HeightShapingParams = {
    baseSpline: [[-1, 0], [1, 0]],
    reliefSpline: [[-1, 0], [1, 0]],
    pvAmplitude: 0,
  };
  const high: import('../../../src/core/world/WorldGen.js').HeightShapingParams = {
    baseSpline: [[-1, 100], [1, 100]],
    reliefSpline: [[-1, 0], [1, 0]],
    pvAmplitude: 0,
  };

  it('a single-entry weighted array matches passing that shaping directly', () => {
    const direct = sampleBaseHeight(fields, 10, 10, high);
    const weighted = sampleBaseHeight(fields, 10, 10, [{ shaping: high, weight: 1 }]);
    expect(weighted).toBe(direct);
  });

  it('blends two shaping profiles by weight (evaluated outputs, not control points)', () => {
    const blended = sampleBaseHeight(fields, 10, 10, [
      { shaping: low, weight: 0.5 },
      { shaping: high, weight: 0.5 },
    ]);
    // detail() contributes the same +1.2*detail term either way — isolate the
    // spline-blend contribution by comparing against the two pure cases.
    const pureLow = sampleBaseHeight(fields, 10, 10, low);
    const pureHigh = sampleBaseHeight(fields, 10, 10, high);
    expect(blended).toBeCloseTo((pureLow + pureHigh) / 2, 10);
  });

  it('a 100%-weighted single profile in array form matches the unweighted profile', () => {
    const asArray = sampleBaseHeight(fields, 20, 30, [{ shaping: low, weight: 1 }, { shaping: high, weight: 0 }]);
    const direct = sampleBaseHeight(fields, 20, 30, low);
    expect(asArray).toBeCloseTo(direct, 10);
  });
});

describe('createWorldGenContext / sampleSurfaceVoxelY', () => {
  it('is deterministic for the same seed and dimensions', () => {
    const a = createWorldGenContext(42, 32, Math.floor(32 * 0.55), 32);
    const b = createWorldGenContext(42, 32, Math.floor(32 * 0.55), 32);
    expect(sampleSurfaceVoxelY(a, 10, 10)).toBe(sampleSurfaceVoxelY(b, 10, 10));
  });

  it('different seeds produce different surface heights somewhere in the grid', () => {
    const a = createWorldGenContext(1, 32, Math.floor(32 * 0.55), 32);
    const b = createWorldGenContext(2, 32, Math.floor(32 * 0.55), 32);
    let differences = 0;
    for (let x = 0; x < 32; x += 4) {
      for (let z = 0; z < 32; z += 4) {
        if (sampleSurfaceVoxelY(a, x, z) !== sampleSurfaceVoxelY(b, x, z)) differences++;
      }
    }
    expect(differences).toBeGreaterThan(0);
  });

  it('rounds without bounding to [1, sizeY - 1] — a grid deliberately too short for its own relief (#1189)', () => {
    // The old sizeY concept here was 24, far short of DEFAULT_SHAPING's own
    // relief range (base spline alone runs -10..90) — so the raw
    // (masked + groundOffset) value leaves the old [1, sizeY - 1] band at
    // some of these columns, proving this, or the assertion below is testing
    // nothing. datum is the console-layer Math.floor(24 * 0.55) conversion of
    // that old sizeY — WorldGenContext no longer carries sizeY at all, so the
    // old band is computed from the literal, not read off the context.
    const oldSizeY = 24;
    const datum = Math.floor(oldSizeY * 0.55);
    const ctx = createWorldGenContext(7, 40, datum, 40);
    let sawOutOfOldBand = false;
    for (let x = 0; x < 40; x += 5) {
      for (let z = 0; z < 40; z += 5) {
        const masked = applyPitMask(
          sampleBaseHeight(ctx.fields, x, z, ctx.shapingAt(x, z)), ctx.centerHeight, ctx.playableRect, x, z,
        );
        const expected = Math.round(masked + ctx.groundOffset);
        if (expected < 1 || expected > oldSizeY - 1) sawOutOfOldBand = true;
        expect(sampleSurfaceVoxelY(ctx, x, z)).toBe(expected);
      }
    }
    expect(sawOutOfOldBand, 'fixture never leaves the old band — this test proves nothing').toBe(true);
  });

  it('accepts a per-column shaping function built from the context\'s own fields', () => {
    const flatShaping = { baseSpline: [[-1, 5], [1, 5]] as const, reliefSpline: [[-1, 0], [1, 0]] as const, pvAmplitude: 0 };
    const ctx = createWorldGenContext(42, 20, Math.floor(20 * 0.55), 20, () => () => flatShaping);
    // With zero relief and a constant base spline, every column should land
    // on the same voxel Y (only the +1.2*detail term varies it, and that's
    // tiny relative to the datum rounding at this scale).
    const y1 = sampleSurfaceVoxelY(ctx, 2, 2);
    const y2 = sampleSurfaceVoxelY(ctx, 15, 15);
    expect(Math.abs(y1 - y2)).toBeLessThanOrEqual(1);
  });

  it('keeps relief compressed (small y-range) well inside a small grid, thanks to the pit mask', () => {
    const ctx = createWorldGenContext(42, 32, Math.floor(32 * 0.55), 32);
    const heights: number[] = [];
    for (let x = 10; x <= 22; x += 2) {
      for (let z = 10; z <= 22; z += 2) {
        heights.push(sampleSurfaceVoxelY(ctx, x, z));
      }
    }
    const range = Math.max(...heights) - Math.min(...heights);
    // Not a tight bound — just confirms the mask is doing real compression
    // work near the centre of a small grid rather than leaving raw relief
    // (this fixture's raw, unmasked range is ~30). #1189 removed the
    // [1, sizeY - 1] clamp that used to additionally flatten this figure by
    // flooring the low outliers, so the masked-only range is a bit wider
    // than before but still well short of raw.
    expect(range).toBeLessThan(25);
  });
});

describe('applyPitMask — mask shape parameter (#1680)', () => {
  const rect: Rect = { minX: 0, minZ: 0, maxX: 200, maxZ: 200 };
  const SANDBOX_LIKE = { margin: 14, reliefKeep: 0.05 };

  /** The pre-#1680 hard-coded 24 / 0.3 behaviour, spelled out. */
  const legacy = (height: number, centre: number, dIn: number): number => {
    const t = Math.min(1, Math.max(0, dIn / 24));
    const w = t * t * (3 - 2 * t);
    return height + w * (centre + (height - centre) * 0.3 - height);
  };

  it('DEFAULT_PIT_MASK is the legacy 24 / 0.3 shape', () => {
    expect(DEFAULT_PIT_MASK).toEqual({ margin: 24, reliefKeep: 0.3 });
  });

  it('with no mask argument is bit-identical to the legacy behaviour at the rim', () => {
    expect(applyPitMask(100, 0, rect, 0, 100)).toBe(legacy(100, 0, 0));
  });

  it('with no mask argument is bit-identical to the legacy behaviour mid-ramp', () => {
    expect(applyPitMask(100, 0, rect, 12, 100)).toBe(legacy(100, 0, 12));
    expect(applyPitMask(-40, 10, rect, 5, 100)).toBe(legacy(-40, 10, 5));
  });

  it('with no mask argument is bit-identical to the legacy behaviour at the centre', () => {
    expect(applyPitMask(100, 0, rect, 100, 100)).toBe(legacy(100, 0, 100));
  });

  it('passing DEFAULT_PIT_MASK explicitly equals passing nothing', () => {
    for (const x of [0, 3, 12, 24, 60, 100]) {
      expect(applyPitMask(80, 5, rect, x, 100, DEFAULT_PIT_MASK)).toBe(applyPitMask(80, 5, rect, x, 100));
    }
  });

  it('a custom mask leaves height untouched outside the rect', () => {
    expect(applyPitMask(100, 0, rect, -50, 50, SANDBOX_LIKE)).toBe(100);
    expect(applyPitMask(100, 0, rect, 250, 50, SANDBOX_LIKE)).toBe(100);
  });

  it('a custom mask leaves height untouched exactly at the rim', () => {
    expect(applyPitMask(100, 0, rect, 0, 100, SANDBOX_LIKE)).toBeCloseTo(100, 10);
  });

  it('a custom mask reaches its own reliefKeep deep inside the rect', () => {
    expect(applyPitMask(100, 0, rect, 100, 100, SANDBOX_LIKE)).toBeCloseTo(5, 5);
  });

  it('a custom mask finishes its ramp at its own margin, not the default one', () => {
    // 14 m in: the sandbox mask is already fully compressed, the default is not.
    expect(applyPitMask(100, 0, rect, 14, 100, SANDBOX_LIKE)).toBeCloseTo(5, 5);
    expect(applyPitMask(100, 0, rect, 14, 100)).toBeGreaterThan(40);
  });

  it('the sandbox-like mask compresses more than the default at the same inward distance', () => {
    for (const x of [3, 7, 12, 20, 40, 100]) {
      const strong = applyPitMask(100, 0, rect, x, 100, SANDBOX_LIKE);
      const weak = applyPitMask(100, 0, rect, x, 100);
      expect(strong, `x=${x}`).toBeLessThan(weak);
    }
  });

  it('compresses a depression toward the centre height too', () => {
    const strong = applyPitMask(-100, 0, rect, 100, 100, SANDBOX_LIKE);
    expect(strong).toBeCloseTo(-5, 5);
  });
});

describe('createWorldGenContext — pit mask (#1680)', () => {
  it('exposes DEFAULT_PIT_MASK when no mask is passed', () => {
    const ctx = createWorldGenContext(42, 64, 20, 64);
    expect(ctx.pitMask).toEqual(DEFAULT_PIT_MASK);
  });

  it('exposes the mask it was given', () => {
    const mask = { margin: 14, reliefKeep: 0.05 };
    const ctx = createWorldGenContext(42, 64, 20, 64, undefined, mask);
    expect(ctx.pitMask).toEqual(mask);
  });

  it('sampleSurfaceVoxelY uses the context mask: a stronger mask flattens the interior', () => {
    const def = createWorldGenContext(42, 64, 20, 64);
    const strong = createWorldGenContext(42, 64, 20, 64, undefined, { margin: 14, reliefKeep: 0.05 });
    const spread = (c: typeof def): number => {
      let lo = Infinity, hi = -Infinity;
      for (let x = 20; x < 44; x++) for (let z = 20; z < 44; z++) {
        const y = sampleSurfaceVoxelY(c, x, z);
        lo = Math.min(lo, y); hi = Math.max(hi, y);
      }
      return hi - lo;
    };
    expect(spread(strong)).toBeLessThan(spread(def));
  });
});
