import { describe, it, expect } from 'vitest';
import { planBlast, type BlastInfo, type PlannedCue } from '../../../../src/audio/director/blastPlan.js';
import { BLAST_AUDIO_CONFIG } from '../../../../src/core/config/audio/game.js';
import { Random } from '../../../../src/core/math/Random.js';

const ORIGIN = { x: 100, z: 50 };
const cfg = BLAST_AUDIO_CONFIG;

function blast(overrides: Partial<BlastInfo> = {}): BlastInfo {
  return { origin: ORIGIN, holeCount: 10, flights: [], report: null, ...overrides };
}

function plan(info: BlastInfo, chargeKg = 0, seed = 1): PlannedCue[] {
  return planBlast(info, chargeKg, new Random(seed));
}

const of = (cues: PlannedCue[], sound: PlannedCue['sound']): PlannedCue[] => cues.filter(c => c.sound === sound);

/** Flights landing evenly between two times, falling at a given speed near a point. */
function flights(count: number, from: number, to: number, speed = 30, at = { x: 120, z: 60 }): BlastInfo['flights'] {
  return Array.from({ length: count }, (_, i) => ({
    delayS: 0.1,
    durationS: from - 0.1 + ((to - from) * i) / Math.max(count - 1, 1),
    impactSpeed: speed,
    to: { x: at.x + (i % 7), z: at.z + (i % 5) },
  }));
}

describe('planBlast main report', () => {
  it('opens with the synthesized snap and sub-bass at 0, the loud ones placed at the blast', () => {
    const cues = plan(blast());
    const snap = of(cues, 'blast_snap')[0];
    const sub = of(cues, 'blast_sub')[0];
    expect(snap?.atS).toBe(0);
    expect(snap?.options.at).toEqual(ORIGIN);
    expect(snap?.options.pitchCents).toBeUndefined();
    expect(sub?.atS).toBe(0);
    expect(sub?.options.at).toBeUndefined();
  });

  it('lets the sampled crack follow the snap by the configured 20-40 ms and the boom by its own delay', () => {
    const cues = plan(blast());
    const crack = of(cues, 'blast_crack')[0];
    const boom = of(cues, 'blast_boom')[0];
    expect(cfg.crackDelayS).toBeGreaterThanOrEqual(0.02);
    expect(cfg.crackDelayS).toBeLessThanOrEqual(0.04);
    expect(crack?.atS).toBe(cfg.crackDelayS);
    expect(crack?.options.at).toEqual(ORIGIN);
    expect(boom?.atS).toBe(cfg.boomDelayS);
    expect(boom?.options.at).toEqual(ORIGIN);
  });

  it('orders the layers snap and sub, then boom, then crack, then the tail', () => {
    const cues = plan(blast());
    expect(cues.slice(0, 2).map(c => c.sound).sort()).toEqual(['blast_snap', 'blast_sub']);
    expect(cues.slice(2).map(c => c.sound)).toEqual(['blast_boom', 'blast_crack', 'blast_tail']);
  });

  it('brings the tail in a beat after the boom', () => {
    for (let seed = 1; seed < 30; seed++) {
      const tail = of(plan(blast(), 0, seed), 'blast_tail')[0];
      expect(tail?.atS).toBeGreaterThanOrEqual(cfg.tailMinDelayS);
      expect(tail?.atS).toBeLessThan(cfg.tailMaxDelayS);
      expect(tail?.options.at).toBeUndefined();
    }
  });

  it('scales the loudness from nothing to +4 dB and never above', () => {
    const boost = (info: BlastInfo, kg = 0): number => of(plan(info, kg), 'blast_crack')[0]?.options.gainDb ?? NaN;
    expect(boost(blast({ holeCount: 0 }))).toBe(0);
    const levels = [1, 4, 10, 30, 60, 500].map(holeCount => boost(blast({ holeCount })));
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(levels[0]).toBeGreaterThanOrEqual(0);
    expect(levels[levels.length - 1]).toBe(cfg.maxBoostDb);
    expect(levels.every(l => l <= cfg.maxBoostDb)).toBe(true);
  });

  it('scales the snap with the same intensity as the crack and the sub-bass', () => {
    for (const holeCount of [0, 1, 10, 60, 500]) {
      const cues = plan(blast({ holeCount }));
      const boost = of(cues, 'blast_crack')[0]?.options.gainDb;
      expect(of(cues, 'blast_snap')[0]?.options.gainDb).toBe(boost);
      expect(of(cues, 'blast_sub')[0]?.options.gainDb).toBe(boost);
    }
    expect(of(plan(blast({ holeCount: 60 })), 'blast_snap')[0]?.options.gainDb).toBe(cfg.maxBoostDb);
  });

  it('weighs charge mass alongside hole count, and prefers the mass the renderer states', () => {
    const boost = (info: BlastInfo, kg: number): number => of(plan(info, kg), 'blast_crack')[0]?.options.gainDb ?? NaN;
    expect(boost(blast({ holeCount: 10 }), 600)).toBeGreaterThan(boost(blast({ holeCount: 10 }), 0));
    expect(boost(blast({ holeCount: 10 }), 5)).toBeLessThan(boost(blast({ holeCount: 10 }), 0));
    expect(boost(blast({ holeCount: 10, chargeKg: 600 }), 5)).toBe(boost(blast({ holeCount: 10 }), 600));
  });

  it('makes a bigger blast deeper but leaves a small one at its natural pitch', () => {
    const pitch = (holeCount: number): number => of(plan(blast({ holeCount })), 'blast_boom')[0]?.options.pitchCents ?? NaN;
    expect(Math.abs(pitch(0))).toBe(0);
    expect(pitch(60)).toBe(-cfg.boomPitchDropCents);
    expect(pitch(20)).toBeGreaterThan(pitch(60));
  });

  it('is sorted by time and repeatable for a seed', () => {
    const info = blast({ flights: flights(300, 1, 6), report: { destroyedBuildings: [{ x: 1, z: 1 }], fizzledHoleIds: ['H1'] } });
    const a = plan(info, 0, 9);
    expect(a.map(c => c.atS)).toEqual(a.map(c => c.atS).sort((x, y) => x - y));
    expect(plan(info, 0, 9)).toEqual(a);
  });
});

describe('planBlast debris rain', () => {
  it('turns two thousand flights into a few dozen impacts', () => {
    const rain = plan(blast({ flights: flights(2000, 0.8, 9) })).filter(c => c.sound === 'debris_hit' || c.sound === 'debris_pebble');
    expect(rain.length).toBeGreaterThanOrEqual(cfg.rain.minBins);
    expect(rain.length).toBeLessThanOrEqual(cfg.rain.maxBins);
  });

  it('lands each impact when its fragments land, spread over the whole fall', () => {
    const rain = plan(blast({ flights: flights(2000, 0.8, 9) })).filter(c => c.sound === 'debris_hit');
    const times = rain.map(c => c.atS);
    expect(Math.min(...times)).toBeGreaterThanOrEqual(0.8);
    expect(Math.max(...times)).toBeLessThanOrEqual(9);
    expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(7);
  });

  it('weights an impact by its fragment count: loudest where most land, capped, with a floor', () => {
    const rain = plan(blast({ flights: [...flights(1, 1, 1), ...flights(100, 3, 3), ...flights(250, 5, 5), ...flights(1000, 7, 7)] })).filter(c => c.sound.startsWith('debris'));
    const gain = (at: number): number => rain.find(c => Math.abs(c.atS - at) < 0.01)?.options.gainDb ?? NaN;
    const top = cfg.rain.baseDb + cfg.rain.maxBoostDb;
    expect(gain(7)).toBe(top);
    expect(gain(5)).toBeCloseTo(top - 6.02, 1);
    expect(gain(3)).toBeCloseTo(top - 10, 5);
    expect(gain(1)).toBe(top + cfg.rain.minRelativeDb);
  });

  it('keeps a small blast quiet: a lone fragment is as loud as the rain gets', () => {
    const rain = plan(blast({ flights: flights(4, 1, 4) })).filter(c => c.sound.startsWith('debris'));
    expect(rain.length).toBeGreaterThan(0);
    expect(rain.every(c => c.options.gainDb === cfg.rain.baseDb)).toBe(true);
  });

  it('gives every impact its own cooldown key', () => {
    const rain = plan(blast({ flights: flights(2000, 0.8, 9) })).filter(c => c.sound.startsWith('debris'));
    expect(new Set(rain.map(c => c.options.key)).size).toBe(rain.length);
  });

  it('sends light bins as pebbles and heavy fast ones as deeper hits', () => {
    const light = plan(blast({ flights: flights(2, 2, 2, 5) })).filter(c => c.sound.startsWith('debris'));
    expect(light.map(c => c.sound)).toEqual(['debris_pebble']);
    expect(light[0]?.options.pitchCents).toBe(-0);

    const slowFew = plan(blast({ flights: flights(2, 2, 2, 60) })).find(c => c.sound.startsWith('debris'));
    expect(slowFew?.sound).toBe('debris_hit');

    const fastHeavy = plan(blast({ flights: flights(40, 2, 2, 80) })).find(c => c.sound === 'debris_hit');
    const slowHeavy = plan(blast({ flights: flights(40, 2, 2, 20) })).find(c => c.sound === 'debris_hit');
    expect(fastHeavy?.options.pitchCents).toBe(-(cfg.rain.maxPitchDropCents + cfg.rain.heavyExtraDropCents));
    expect(fastHeavy?.options.pitchCents ?? 0).toBeLessThan(slowHeavy?.options.pitchCents ?? 0);
  });

  it('places each impact at the centre of the fragments it stands for', () => {
    const fall = [
      { delayS: 0, durationS: 2, impactSpeed: 40, to: { x: 10, z: 0 } },
      { delayS: 0, durationS: 2, impactSpeed: 40, to: { x: 30, z: 20 } },
    ];
    const hit = plan(blast({ flights: fall })).find(c => c.sound.startsWith('debris'));
    expect(hit?.options.at).toEqual({ x: 20, z: 10 });
    expect(hit?.atS).toBe(2);
  });

  it('copes with no flights and with flights that all land together', () => {
    expect(plan(blast()).filter(c => c.sound.startsWith('debris'))).toEqual([]);
    const together = plan(blast({ flights: flights(500, 4, 4) })).filter(c => c.sound.startsWith('debris'));
    expect(together).toHaveLength(1);
  });
});

describe('planBlast consequences', () => {
  it('adds nothing without a report', () => {
    const cues = plan(blast());
    expect(cues.map(c => c.sound).sort()).toEqual(['blast_boom', 'blast_crack', 'blast_snap', 'blast_sub', 'blast_tail']);
  });

  it('adds a quieter, lower snap at the head of each secondary blast, ahead of its crack and boom', () => {
    const secondaryBlasts = [0, 1].map(i => ({ x: 300 + i, z: 20, explosivesKg: 100 }));
    const cues = plan(blast({ report: { secondaryBlasts } }));
    const snaps = of(cues, 'blast_snap').slice(1);
    const cracks = of(cues, 'blast_crack').slice(1);
    const booms = of(cues, 'blast_boom').slice(1);
    expect(snaps).toHaveLength(2);
    snaps.forEach((snap, i) => {
      expect(snap.options.at).toEqual({ x: 300 + i, z: 20 });
      expect(snap.options.pitchCents).toBe(cfg.secondary.snapPitchCents);
      expect(snap.options.gainDb).toBe((cracks[i]?.options.gainDb ?? NaN) + cfg.secondary.snapGainOffsetDb);
      expect(snap.options.gainDb).toBeLessThan(cracks[i]?.options.gainDb ?? NaN);
      expect(cracks[i]?.atS).toBeCloseTo(snap.atS + cfg.crackDelayS, 9);
      expect(booms[i]?.atS).toBeCloseTo(snap.atS + cfg.secondary.boomDelayS, 9);
    });
    expect(snaps[0]?.atS).toBeGreaterThanOrEqual(cfg.secondary.firstDelayS);
  });

  it('adds lower, delayed secondary blasts at their own position, capped', () => {
    const secondaryBlasts = [0, 1, 2, 3, 4].map(i => ({ x: 200 + i, z: 10, explosivesKg: 100 }));
    const cues = plan(blast({ report: { secondaryBlasts } }));
    const booms = of(cues, 'blast_boom').slice(1);
    expect(booms).toHaveLength(cfg.secondary.maxCount);
    booms.forEach((boom, i) => {
      expect(boom.options.at).toEqual({ x: 200 + i, z: 10 });
      expect(boom.options.pitchCents).toBe(cfg.secondary.boomPitchCents);
      expect(boom.atS).toBeGreaterThanOrEqual(cfg.secondary.firstDelayS + i * cfg.secondary.spacingS);
    });
    expect(of(cues, 'blast_crack').slice(1).every(c => c.options.pitchCents === cfg.secondary.crackPitchCents)).toBe(true);
  });

  it('makes a bigger secondary louder, between its limits', () => {
    const gain = (kg: number): number => of(plan(blast({ report: { secondaryBlasts: [{ x: 0, z: 0, explosivesKg: kg }] } })), 'blast_boom')[1]?.options.gainDb ?? NaN;
    expect(gain(0)).toBe(cfg.secondary.minGainDb);
    expect(gain(1e6)).toBe(cfg.secondary.maxGainDb);
    expect(gain(100)).toBeGreaterThan(gain(10));
  });

  it('crashes destroyed buildings in turn after the boom, capped', () => {
    const destroyedBuildings = [0, 1, 2, 3].map(i => ({ x: 10 * i, z: 5 }));
    const crashes = of(plan(blast({ report: { destroyedBuildings } })), 'building_demolished');
    expect(crashes).toHaveLength(cfg.demolish.maxCount);
    expect(crashes.map(c => c.options.at)).toEqual(destroyedBuildings.slice(0, 3));
    expect(crashes[0]?.atS).toBe(cfg.demolish.firstDelayS);
    expect(crashes[1]?.atS).toBe(cfg.demolish.firstDelayS + cfg.demolish.spacingS);
  });

  it('pops a dud for each fizzled hole near the blast, capped', () => {
    const duds = of(plan(blast({ report: { fizzledHoleIds: ['a', 'b', 'c', 'd', 'e'] } })), 'blast_dud');
    expect(duds).toHaveLength(cfg.dud.maxCount);
    for (const dud of duds) {
      expect(Math.abs((dud.options.at?.x ?? 1e9) - ORIGIN.x)).toBeLessThanOrEqual(cfg.dud.scatterM);
      expect(Math.abs((dud.options.at?.z ?? 1e9) - ORIGIN.z)).toBeLessThanOrEqual(cfg.dud.scatterM);
    }
  });

  it('adds one muted alert about a second later when someone was hurt, and only then', () => {
    const hurt = of(plan(blast({ report: { accidents: [{ type: 'injury' }, { type: 'death' }] } })), 'notify_bad');
    expect(hurt).toHaveLength(1);
    expect(hurt[0]?.atS).toBe(cfg.casualty.delayS);
    expect(hurt[0]?.options.gainDb).toBe(cfg.casualty.gainDb);
    expect(of(plan(blast({ report: { accidents: [{ type: 'building_damage' }] } })), 'notify_bad')).toEqual([]);
    expect(of(plan(blast({ report: {} })), 'notify_bad')).toEqual([]);
  });
});
