import { describe, it, expect } from 'vitest';
import {
  classifyFragmentationBand,
  bandMassRetention,
  heatmapBandColor,
  finesShare,
  FRAGMENTATION_BAND_COLORS,
  FRAGMENTATION_BANDS,
  type FragmentationBand,
} from '../../../src/core/mining/FragmentationBand.js';
import {
  CRACKED_VOXEL_ENERGY_RATIO,
  FRAGMENTATION_MULTIPLIER,
  FRAGMENTATION_BAND_FINES_MIN,
  FRAGMENTATION_BAND_DUST_MIN,
  DUST_LOSS_SHARE,
  BLAST_REPORT_MAX_HOLE_REASONS,
  OVERCHARGE_NOTE_MIN_FINES_SHARE,
} from '../../../src/core/config/balance.js';

/** A hair below a bound, small enough to stay in the lower band at any plausible bound. */
const EPS = 1e-9;

// ── Balance constants the bands are built from ───────────────────────────────

describe('FragmentationBand — band bounds are ordered balance constants', () => {
  it('the bounds ascend: cracked < good < fines < dust', () => {
    expect(CRACKED_VOXEL_ENERGY_RATIO).toBeGreaterThan(0);
    expect(FRAGMENTATION_MULTIPLIER).toBeGreaterThan(CRACKED_VOXEL_ENERGY_RATIO);
    expect(FRAGMENTATION_BAND_FINES_MIN).toBeGreaterThan(FRAGMENTATION_MULTIPLIER);
    expect(FRAGMENTATION_BAND_DUST_MIN).toBeGreaterThan(FRAGMENTATION_BAND_FINES_MIN);
  });

  it('lists every band once, coarsest first and dust last', () => {
    expect([...FRAGMENTATION_BANDS]).toEqual(['intact', 'cracked', 'good', 'fines', 'dust']);
  });
});

// ── classifyFragmentationBand ────────────────────────────────────────────────

describe('FragmentationBand — classifyFragmentationBand', () => {
  it('zero intensity is intact', () => {
    expect(classifyFragmentationBand(0)).toBe('intact');
  });

  it('just below the cracked bound is still intact', () => {
    expect(classifyFragmentationBand(CRACKED_VOXEL_ENERGY_RATIO - EPS)).toBe('intact');
  });

  it('the cracked bound itself belongs to cracked', () => {
    expect(classifyFragmentationBand(CRACKED_VOXEL_ENERGY_RATIO)).toBe('cracked');
  });

  it('just below the good bound is still cracked', () => {
    expect(classifyFragmentationBand(FRAGMENTATION_MULTIPLIER - EPS)).toBe('cracked');
  });

  it('the good bound (FRAGMENTATION_MULTIPLIER) belongs to good', () => {
    expect(classifyFragmentationBand(FRAGMENTATION_MULTIPLIER)).toBe('good');
  });

  it('just below the fines bound is still good', () => {
    expect(classifyFragmentationBand(FRAGMENTATION_BAND_FINES_MIN - EPS)).toBe('good');
  });

  it('the fines bound belongs to fines', () => {
    expect(classifyFragmentationBand(FRAGMENTATION_BAND_FINES_MIN)).toBe('fines');
  });

  it('just below the dust bound is still fines', () => {
    expect(classifyFragmentationBand(FRAGMENTATION_BAND_DUST_MIN - EPS)).toBe('fines');
  });

  it('the dust bound belongs to dust', () => {
    expect(classifyFragmentationBand(FRAGMENTATION_BAND_DUST_MIN)).toBe('dust');
  });

  it('a mid-band value falls in each band', () => {
    const mid = (lo: number, hi: number): number => (lo + hi) / 2;
    expect(classifyFragmentationBand(mid(0, CRACKED_VOXEL_ENERGY_RATIO))).toBe('intact');
    expect(classifyFragmentationBand(mid(CRACKED_VOXEL_ENERGY_RATIO, FRAGMENTATION_MULTIPLIER))).toBe('cracked');
    expect(classifyFragmentationBand(mid(FRAGMENTATION_MULTIPLIER, FRAGMENTATION_BAND_FINES_MIN))).toBe('good');
    expect(classifyFragmentationBand(mid(FRAGMENTATION_BAND_FINES_MIN, FRAGMENTATION_BAND_DUST_MIN))).toBe('fines');
    expect(classifyFragmentationBand(FRAGMENTATION_BAND_DUST_MIN * 2)).toBe('dust');
  });

  it('an enormous or infinite intensity is dust, with no upper bound', () => {
    expect(classifyFragmentationBand(1e9)).toBe('dust');
    expect(classifyFragmentationBand(Infinity)).toBe('dust');
  });

  it('a negative intensity is rejected into the lowest band', () => {
    expect(classifyFragmentationBand(-1)).toBe('intact');
    expect(classifyFragmentationBand(-Infinity)).toBe('intact');
  });

  it('never moves to a finer band as intensity falls (monotone over a sweep)', () => {
    const order = new Map<FragmentationBand, number>(FRAGMENTATION_BANDS.map((b, i) => [b, i]));
    let previous = -1;
    for (let i = 0; i <= 1200; i++) {
      const rank = order.get(classifyFragmentationBand(i / 100))!;
      expect(rank).toBeGreaterThanOrEqual(previous);
      previous = rank;
    }
  });

  it('a sweep reaches every band', () => {
    const seen = new Set<FragmentationBand>();
    for (let i = 0; i <= 1200; i++) seen.add(classifyFragmentationBand(i / 100));
    expect([...seen].sort()).toEqual([...FRAGMENTATION_BANDS].sort());
  });
});

// ── bandMassRetention ────────────────────────────────────────────────────────

describe('FragmentationBand — bandMassRetention', () => {
  it('dust keeps all but the configured loss share', () => {
    expect(bandMassRetention('dust')).toBeCloseTo(1 - DUST_LOSS_SHARE, 12);
  });

  it('every other band loses nothing', () => {
    for (const band of ['intact', 'cracked', 'good', 'fines'] as const) {
      expect(bandMassRetention(band), band).toBe(1);
    }
  });

  it('dust loses something, but never the whole voxel', () => {
    expect(DUST_LOSS_SHARE).toBeGreaterThan(0);
    expect(DUST_LOSS_SHARE).toBeLessThan(1);
    expect(bandMassRetention('dust')).toBeLessThan(1);
    expect(bandMassRetention('dust')).toBeGreaterThan(0);
  });

  it('retention at a classified intensity follows the band the intensity falls in', () => {
    expect(bandMassRetention(classifyFragmentationBand(FRAGMENTATION_BAND_DUST_MIN))).toBeLessThan(1);
    expect(bandMassRetention(classifyFragmentationBand(FRAGMENTATION_BAND_DUST_MIN - EPS))).toBe(1);
  });
});

// ── Heatmap colour tokens (#2200) ────────────────────────────────────────────

describe('FragmentationBand — FRAGMENTATION_BAND_COLORS', () => {
  it('has one colour token per band', () => {
    expect(Object.keys(FRAGMENTATION_BAND_COLORS).sort()).toEqual([...FRAGMENTATION_BANDS].sort());
    for (const band of FRAGMENTATION_BANDS) {
      expect(Number.isInteger(FRAGMENTATION_BAND_COLORS[band]), band).toBe(true);
      expect(FRAGMENTATION_BAND_COLORS[band], band).toBeGreaterThanOrEqual(0);
      expect(FRAGMENTATION_BAND_COLORS[band], band).toBeLessThanOrEqual(0xffffff);
    }
  });

  it('gives every band a colour of its own', () => {
    const colours = FRAGMENTATION_BANDS.map(b => FRAGMENTATION_BAND_COLORS[b]);
    expect(new Set(colours).size).toBe(FRAGMENTATION_BANDS.length);
  });

  const channels = (c: number) => ({ r: (c >> 16) & 0xff, g: (c >> 8) & 0xff, b: c & 0xff });

  it('intact is blue, cracked a paler blue, good green, fines orange, dust red', () => {
    const intact = channels(FRAGMENTATION_BAND_COLORS.intact);
    const cracked = channels(FRAGMENTATION_BAND_COLORS.cracked);
    const good = channels(FRAGMENTATION_BAND_COLORS.good);
    const fines = channels(FRAGMENTATION_BAND_COLORS.fines);
    const dust = channels(FRAGMENTATION_BAND_COLORS.dust);

    expect(intact.b).toBeGreaterThan(intact.r);
    expect(intact.b).toBeGreaterThan(intact.g);
    expect(cracked.b).toBeGreaterThan(cracked.r);
    expect(cracked.r + cracked.g + cracked.b).toBeGreaterThan(intact.r + intact.g + intact.b);
    expect(good.g).toBeGreaterThan(good.r);
    expect(good.g).toBeGreaterThan(good.b);
    expect(fines.r).toBeGreaterThan(fines.g);
    expect(fines.g).toBeGreaterThan(fines.b);
    expect(dust.r).toBeGreaterThan(dust.g * 2);
    expect(dust.r).toBeGreaterThan(dust.b * 2);
  });
});

describe('FragmentationBand — heatmapBandColor', () => {
  it('returns the token of the band the classifier picks, across the whole range', () => {
    for (const intensity of [0, 0.2, CRACKED_VOXEL_ENERGY_RATIO, 0.9, FRAGMENTATION_MULTIPLIER, 1.5, FRAGMENTATION_BAND_FINES_MIN, 3, FRAGMENTATION_BAND_DUST_MIN, 55]) {
      expect(heatmapBandColor(intensity), String(intensity)).toBe(FRAGMENTATION_BAND_COLORS[classifyFragmentationBand(intensity)]);
    }
  });

  it('switches colour exactly at each band bound', () => {
    expect(heatmapBandColor(CRACKED_VOXEL_ENERGY_RATIO - EPS)).toBe(FRAGMENTATION_BAND_COLORS.intact);
    expect(heatmapBandColor(CRACKED_VOXEL_ENERGY_RATIO)).toBe(FRAGMENTATION_BAND_COLORS.cracked);
    expect(heatmapBandColor(FRAGMENTATION_MULTIPLIER - EPS)).toBe(FRAGMENTATION_BAND_COLORS.cracked);
    expect(heatmapBandColor(FRAGMENTATION_MULTIPLIER)).toBe(FRAGMENTATION_BAND_COLORS.good);
    expect(heatmapBandColor(FRAGMENTATION_BAND_FINES_MIN - EPS)).toBe(FRAGMENTATION_BAND_COLORS.good);
    expect(heatmapBandColor(FRAGMENTATION_BAND_FINES_MIN)).toBe(FRAGMENTATION_BAND_COLORS.fines);
    expect(heatmapBandColor(FRAGMENTATION_BAND_DUST_MIN - EPS)).toBe(FRAGMENTATION_BAND_COLORS.fines);
    expect(heatmapBandColor(FRAGMENTATION_BAND_DUST_MIN)).toBe(FRAGMENTATION_BAND_COLORS.dust);
  });

  it('zero intensity is the intact colour', () => {
    expect(heatmapBandColor(0)).toBe(FRAGMENTATION_BAND_COLORS.intact);
  });
});

// ── finesShare (#2202) ───────────────────────────────────────────────────────

describe('FragmentationBand — finesShare (#2202)', () => {
  const volumes = (v: Partial<Record<FragmentationBand, number>>): Record<FragmentationBand, number> =>
    ({ intact: 0, cracked: 0, good: 0, fines: 0, dust: 0, ...v });

  it('is the fines plus dust volume over the good plus fines plus dust volume', () => {
    expect(finesShare(volumes({ good: 60, fines: 30, dust: 10 }))).toBeCloseTo(0.4, 10);
  });

  it('is 0 when nothing broke', () => {
    expect(finesShare(volumes({}))).toBe(0);
  });

  it('is 0 when the only rock is intact or cracked, never NaN', () => {
    const share = finesShare(volumes({ intact: 900, cracked: 120 }));
    expect(Number.isNaN(share)).toBe(false);
    expect(share).toBe(0);
  });

  it('is 0 when all the broken rock is good', () => {
    expect(finesShare(volumes({ good: 80 }))).toBe(0);
  });

  it('is 1 when all the broken rock is fines', () => {
    expect(finesShare(volumes({ fines: 12 }))).toBe(1);
  });

  it('is 1 when all the broken rock is dust', () => {
    expect(finesShare(volumes({ dust: 7 }))).toBe(1);
  });

  it('counts fines and dust alike', () => {
    expect(finesShare(volumes({ good: 50, fines: 50 }))).toBeCloseTo(0.5, 10);
    expect(finesShare(volumes({ good: 50, dust: 50 }))).toBeCloseTo(0.5, 10);
  });

  it('ignores intact and cracked volume: they are not broken rock', () => {
    const base = finesShare(volumes({ good: 60, fines: 30, dust: 10 }));
    expect(finesShare(volumes({ intact: 5000, cracked: 1000, good: 60, fines: 30, dust: 10 }))).toBeCloseTo(base, 10);
  });

  it('stays within 0 and 1', () => {
    for (const v of [volumes({ good: 1 }), volumes({ fines: 1, dust: 1 }), volumes({ good: 3, fines: 5, dust: 9 })]) {
      const share = finesShare(v);
      expect(share).toBeGreaterThanOrEqual(0);
      expect(share).toBeLessThanOrEqual(1);
    }
  });

  it('a share built to sit exactly on the overcharge bound equals it', () => {
    // 100 of 400 m3 crushed.
    expect(finesShare(volumes({ good: 300, fines: 70, dust: 30 }))).toBe(OVERCHARGE_NOTE_MIN_FINES_SHARE);
  });
});

describe('FragmentationBand — blast report balance constants (#2202)', () => {
  it('lists reasons for at most 6 holes', () => {
    expect(BLAST_REPORT_MAX_HOLE_REASONS).toBe(6);
  });

  it('calls a shot overcharged from a quarter of its broken rock crushed fine', () => {
    expect(OVERCHARGE_NOTE_MIN_FINES_SHARE).toBe(0.25);
  });
});
