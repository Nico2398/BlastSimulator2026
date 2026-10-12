import { describe, it, expect } from 'vitest';
import { BlastAudio } from '../../../../src/audio/director/BlastAudio.js';
import { planBlast, type BlastInfo } from '../../../../src/audio/director/blastPlan.js';
import { BLAST_AUDIO_CONFIG } from '../../../../src/core/config/audio/game.js';
import { Random } from '../../../../src/core/math/Random.js';
import { makeHarness, type Harness } from './helpers.js';

const cfg = BLAST_AUDIO_CONFIG;
const FRAME = 1 / 60;

function bigBlast(seed = 3): BlastInfo {
  const random = new Random(seed);
  return {
    origin: { x: 100, z: 50 },
    holeCount: 40,
    flights: Array.from({ length: 2000 }, () => ({
      delayS: random.nextFloat(0, 1),
      durationS: random.nextFloat(0.5, 7),
      impactSpeed: random.nextFloat(5, 70),
      to: { x: 100 + random.nextFloat(-40, 40), z: 50 + random.nextFloat(-40, 40) },
    })),
    report: { destroyedBuildings: [{ x: 90, z: 40 }], accidents: [{ type: 'injury' }] },
  };
}

interface Fixture {
  readonly h: Harness;
  readonly blast: BlastAudio;
  readonly suppressed: number[];
  /** Advance real time frame by frame, the way the director's update does. */
  run(seconds: number): void;
}

function fixture(): Fixture {
  const h = makeHarness({ seed: 42 });
  const suppressed: number[] = [];
  const blast = new BlastAudio(h.env, s => suppressed.push(s));
  return {
    h,
    blast,
    suppressed,
    run(seconds) {
      for (let t = 0; t < seconds - 1e-9; t += FRAME) {
        h.advance(FRAME);
        blast.update(FRAME);
      }
    },
  };
}

describe('BlastAudio timeline', () => {
  it('starts the snap, crack, boom and sub-bass the moment the flash fires, the sampled layers a few ms behind', () => {
    const f = fixture();
    f.blast.play(bigBlast(), 0);
    const started = f.h.player.plays.filter(p => p.atS === 0);
    expect(started.map(p => p.id)).toEqual(expect.arrayContaining(['blast_snap', 'blast_crack', 'blast_boom', 'blast_sub']));
    expect(f.h.player.of('blast_snap')[0]?.opts.delayS).toBe(0);
    expect(f.h.player.of('blast_sub')[0]?.opts.delayS).toBe(0);
    expect(f.h.player.of('blast_crack')[0]?.opts.delayS).toBe(cfg.crackDelayS);
    expect(f.h.player.of('blast_boom')[0]?.opts.delayS).toBe(cfg.boomDelayS);
  });

  it('puts every sound on the audio clock exactly where the plan says', () => {
    const f = fixture();
    const info = bigBlast();
    const expected = planBlast(info, 0, new Random(42));
    f.blast.play(info, 0);
    f.run(10);
    const starts = f.h.player.plays.map(p => p.atS + (p.opts.delayS ?? 0));
    expect(starts).toHaveLength(expected.length);
    const sortedStarts = [...starts].sort((a, b) => a - b);
    sortedStarts.forEach((start, i) => expect(start).toBeCloseTo(expected[i]?.atS ?? NaN, 6));
  });

  it('hands sounds over just ahead of their time, never booking the whole rain at once', () => {
    const f = fixture();
    f.blast.play(bigBlast(), 0);
    const booked = (): number => f.h.player.plays.filter(p => p.atS + (p.opts.delayS ?? 0) > f.h.clock.nowS + 1e-9).length;
    let peak = booked();
    for (let t = 0; t < 10; t += FRAME) {
      f.h.advance(FRAME);
      f.blast.update(FRAME);
      peak = Math.max(peak, booked());
    }
    expect(f.h.player.plays.length).toBeGreaterThan(30);
    expect(peak).toBeLessThan(15);
    expect(f.h.player.plays.every(p => (p.opts.delayS ?? 0) <= cfg.lookaheadS + 1e-9)).toBe(true);
  });

  it('gives each debris impact its own cooldown key, so close impacts are not dropped', () => {
    const f = fixture();
    f.blast.play(bigBlast(), 0);
    f.run(10);
    const rain = f.h.player.plays.filter(p => p.id === 'debris_hit' || p.id === 'debris_pebble');
    expect(new Set(rain.map(p => p.opts.key)).size).toBe(rain.length);
  });

  it('ducks the ambience hard and keeps work sounds quiet while it plays', () => {
    const f = fixture();
    f.blast.play(bigBlast(), 0);
    expect(f.h.player.ducks).toEqual([{ bus: 'ambient', ...cfg.duck }]);
    expect(f.suppressed).toEqual([cfg.workSuppressS]);
  });

  it('holds its breath before the boom when the blast job starts', () => {
    const f = fixture();
    f.blast.preRoll();
    expect(f.h.player.ducks).toEqual([{ bus: 'ambient', ...cfg.preRollDuck }]);
    expect(f.suppressed).toEqual([cfg.preRollDuck.holdS]);
    expect(f.h.player.plays).toHaveLength(0);
  });

  it('uses the charge mass it is told about when the renderer does not give one', () => {
    const quiet = fixture();
    const loud = fixture();
    const info = { ...bigBlast(), holeCount: 10 };
    quiet.blast.play(info, 0);
    loud.blast.play(info, 600);
    const gain = (f: Fixture): number => f.h.player.of('blast_crack')[0]?.opts.gainDb ?? NaN;
    expect(gain(loud)).toBeGreaterThan(gain(quiet));
  });

  it('layers a second blast on top of the first without losing either', () => {
    const f = fixture();
    f.blast.play(bigBlast(1), 0);
    f.run(2);
    f.blast.play(bigBlast(2), 0);
    f.run(10);
    expect(f.h.player.of('blast_boom').length).toBe(2);
  });

  it('drops sounds a frame hitch left far behind, and plays the recent ones at once', () => {
    const f = fixture();
    f.blast.play(bigBlast(), 0);
    const before = f.h.player.plays.length;
    f.h.advance(20);
    f.blast.update(20);
    expect(f.h.player.plays).toHaveLength(before);
    expect(f.h.player.of('notify_bad')).toHaveLength(0);
  });

  it('plays a sound that is only slightly late immediately', () => {
    const f = fixture();
    f.blast.play({ origin: { x: 0, z: 0 }, holeCount: 5, flights: [], report: { accidents: [{ type: 'death' }] } }, 0);
    f.h.advance(cfg.casualty.delayS + cfg.lateSkipS / 2);
    f.blast.update(cfg.casualty.delayS + cfg.lateSkipS / 2);
    const alert = f.h.player.of('notify_bad')[0];
    expect(alert).toBeDefined();
    expect(alert?.opts.delayS).toBe(0);
  });
});

describe('BlastAudio cancel', () => {
  it('fades out what is playing and forgets what has not been booked', () => {
    const f = fixture();
    f.blast.play(bigBlast(), 0);
    f.run(1);
    const played = f.h.player.plays.length;
    f.blast.cancel();
    const stopped = f.h.player.plays.filter(p => p.handle.stopped);
    expect(stopped).toHaveLength(played);
    expect(stopped.every(p => p.handle.stops[0] === cfg.cancelFadeS)).toBe(true);
    f.run(10);
    expect(f.h.player.plays).toHaveLength(played);
  });

  it('is harmless with nothing to cancel, and again', () => {
    const f = fixture();
    expect(() => { f.blast.cancel(); f.blast.cancel(); }).not.toThrow();
    f.blast.play(bigBlast(), 0);
    f.blast.cancel();
    f.blast.cancel();
  });

  it('keeps a blast that comes after a cancel', () => {
    const f = fixture();
    f.blast.play(bigBlast(), 0);
    f.blast.cancel();
    f.h.player.clearPlays();
    f.blast.play(bigBlast(), 0);
    expect(f.h.player.of('blast_boom')).toHaveLength(1);
    expect(f.h.player.plays.some(p => p.handle.stopped)).toBe(false);
  });

  it('remembers a bounded number of sounds to cancel', () => {
    const f = fixture();
    for (let seed = 1; seed <= 4; seed++) f.blast.play(bigBlast(seed), 0);
    f.run(10);
    expect(f.h.player.plays.length).toBeGreaterThan(cfg.maxRetainedHandles);
    f.blast.cancel();
    expect(f.h.player.plays.filter(p => p.handle.stopped)).toHaveLength(cfg.maxRetainedHandles);
  });
});
