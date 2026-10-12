import { describe, it, expect } from 'vitest';
import { EvacuationSiren, evacuationRemaining } from '../../../../src/audio/director/EvacuationSiren.js';
import { SIREN_CONFIG } from '../../../../src/core/config/audio/game.js';
import { addEmployee, makeHarness, makeState, type Harness } from './helpers.js';

const STEP = 0.05;

interface Fixture {
  readonly h: Harness;
  readonly siren: EvacuationSiren;
  /** Run frames with a given input. */
  run(seconds: number, input: { armed: boolean; remaining?: number | null; muted?: boolean }): void;
}

function fixture(): Fixture {
  const h = makeHarness();
  const siren = new EvacuationSiren(h.env);
  return {
    h,
    siren,
    run(seconds, input) {
      for (let t = 0; t < seconds - 1e-9; t += STEP) {
        h.advance(STEP);
        siren.update(STEP, { armed: input.armed, remaining: input.remaining ?? null, muted: input.muted ?? false });
      }
    },
  };
}

const beepTimes = (f: Fixture): number[] => f.h.player.of('blast_beep').map(p => p.atS);
const gaps = (times: number[]): number[] => times.slice(1).map((t, i) => t - (times[i] ?? 0));

describe('EvacuationSiren while armed', () => {
  it('makes no sound and creates no bed while nothing is armed', () => {
    const f = fixture();
    f.run(20, { armed: false });
    expect(f.h.player.plays).toHaveLength(0);
    expect(f.h.player.loops.size).toBe(0);
  });

  it('raises the siren bed to full as the detonation is armed', () => {
    const f = fixture();
    f.run(1, { armed: true, remaining: 5 });
    const bed = f.h.player.bed('blast_siren');
    expect(bed.calls).toEqual([{ level: 1, rampS: SIREN_CONFIG.rampInS }]);
  });

  it('beeps slowly with a full crowd to clear, in real time', () => {
    const f = fixture();
    f.run(20, { armed: true, remaining: 8 });
    const times = beepTimes(f);
    expect(times.length).toBeGreaterThanOrEqual(11);
    for (const gap of gaps(times)) expect(gap).toBeCloseTo(SIREN_CONFIG.slowIntervalS, 1);
  });

  it('quickens as the zone empties and rises in pitch', () => {
    const f = fixture();
    const marks: number[] = [];
    for (const remaining of [10, 7, 4, 2, 0]) {
      f.run(8, { armed: true, remaining });
      marks.push(f.h.player.plays.length);
    }
    const intervalAt = (from: number, to: number): number => {
      const slice = f.h.player.plays.slice(from, to).map(p => p.atS);
      return gaps(slice).reduce((a, b) => a + b, 0) / Math.max(slice.length - 1, 1);
    };
    const intervals = marks.map((end, i) => intervalAt(marks[i - 1] ?? 0, end));
    expect(intervals).toEqual([...intervals].sort((a, b) => b - a));
    expect(intervals[0]).toBeGreaterThan(SIREN_CONFIG.slowIntervalS * 0.9);
    expect(intervals[4]).toBeLessThan(SIREN_CONFIG.fastIntervalS * 1.3);
    const pitches = f.h.player.plays.map(p => p.opts.pitchCents ?? 0);
    expect(pitches[0]).toBe(0);
    expect(pitches[pitches.length - 1]).toBeCloseTo(SIREN_CONFIG.maxPitchRiseCents, 5);
  });

  it('beeps at the slow pace when the count is unknown', () => {
    const f = fixture();
    f.run(10, { armed: true, remaining: null });
    for (const gap of gaps(beepTimes(f))) expect(gap).toBeCloseTo(SIREN_CONFIG.slowIntervalS, 1);
  });

  it('keeps its pace per real second whatever the frame rate', () => {
    const coarse = makeHarness();
    const siren = new EvacuationSiren(coarse.env);
    for (let t = 0; t < 16; t += 0.25) {
      coarse.advance(0.25);
      siren.update(0.25, { armed: true, remaining: 5, muted: false });
    }
    expect(coarse.player.of('blast_beep').length).toBeGreaterThanOrEqual(8);
    expect(coarse.player.of('blast_beep').length).toBeLessThanOrEqual(11);
  });

  it('stays silent behind a menu without forgetting it is armed, and resumes after', () => {
    const f = fixture();
    f.run(2, { armed: true, remaining: 5 });
    const beeps = f.h.player.of('blast_beep').length;
    f.run(10, { armed: true, remaining: 5, muted: true });
    expect(f.h.player.of('blast_beep')).toHaveLength(beeps);
    expect(f.h.player.bed('blast_siren').level).toBe(0);
    f.run(2, { armed: true, remaining: 5 });
    expect(f.h.player.bed('blast_siren').level).toBe(1);
    expect(f.h.player.of('blast_beep').length).toBeGreaterThan(beeps);
  });
});

describe('EvacuationSiren when the armed state clears', () => {
  it('goes quiet without a cancel sound when the blast announces itself', () => {
    const f = fixture();
    f.run(2, { armed: true, remaining: 2 });
    f.siren.notifyDetonation();
    f.run(5, { armed: false });
    expect(f.h.player.bed('blast_siren').calls.at(-1)).toEqual({ level: 0, rampS: SIREN_CONFIG.rampOutS });
    expect(f.h.player.of('blast_cancel')).toHaveLength(0);
  });

  it('goes quiet without a cancel sound when the blast announces itself a moment late', () => {
    const f = fixture();
    f.run(2, { armed: true, remaining: 2 });
    f.run(SIREN_CONFIG.cancelGraceS / 2, { armed: false });
    f.siren.notifyDetonation();
    f.run(5, { armed: false });
    expect(f.h.player.of('blast_cancel')).toHaveLength(0);
  });

  it('plays the cancel sound at once when the player cancelled', () => {
    const f = fixture();
    f.run(2, { armed: true, remaining: 2 });
    f.siren.notifyCancelled();
    f.run(STEP, { armed: false });
    expect(f.h.player.of('blast_cancel')).toHaveLength(1);
    f.run(5, { armed: false });
    expect(f.h.player.of('blast_cancel')).toHaveLength(1);
    expect(f.h.player.bed('blast_siren').level).toBe(0);
  });

  it('plays the cancel sound after the grace when nothing explained the end', () => {
    const f = fixture();
    f.run(2, { armed: true, remaining: 2 });
    f.run(SIREN_CONFIG.cancelGraceS - 0.1, { armed: false });
    expect(f.h.player.of('blast_cancel')).toHaveLength(0);
    f.run(0.3, { armed: false });
    expect(f.h.player.of('blast_cancel')).toHaveLength(1);
  });

  it('stops beeping the moment it is no longer armed', () => {
    const f = fixture();
    f.run(2, { armed: true, remaining: 2 });
    const beeps = f.h.player.of('blast_beep').length;
    f.run(5, { armed: false });
    expect(f.h.player.of('blast_beep')).toHaveLength(beeps);
  });

  it('ignores a cancel request when nothing is armed', () => {
    const f = fixture();
    f.siren.notifyCancelled();
    f.run(1, { armed: true, remaining: 2 });
    f.run(1, { armed: false });
    f.run(2, { armed: false });
    expect(f.h.player.of('blast_cancel')).toHaveLength(1);
  });

  it('starts a clean slate when armed again after a detonation', () => {
    const f = fixture();
    f.run(1, { armed: true, remaining: 2 });
    f.siren.notifyDetonation();
    f.run(1, { armed: false });
    f.run(1, { armed: true, remaining: 2 });
    f.run(1, { armed: false });
    f.run(2, { armed: false });
    expect(f.h.player.of('blast_cancel')).toHaveLength(1);
  });

  it('clear() silences the bed and drops a pending cancel', () => {
    const f = fixture();
    f.run(1, { armed: true, remaining: 2 });
    f.run(0.1, { armed: false });
    f.siren.clear();
    f.run(3, { armed: false });
    expect(f.h.player.of('blast_cancel')).toHaveLength(0);
    expect(f.h.player.bed('blast_siren').level).toBe(0);
  });
});

describe('evacuationRemaining', () => {
  function armedState() {
    const state = makeState();
    state.drillHoles.push({ id: 'H1', x: 50, z: 50, depth: 5, diameter: 0.1 });
    state.pendingDetonation = { armedTick: 0, strandedEmployeeIds: [], strandedVehicleIds: [], lastEvacuationTick: 0 };
    return state;
  }

  it('is null when nothing is armed', () => {
    expect(evacuationRemaining(makeState())).toBeNull();
  });

  it('counts the people still inside the zone while evacuating', () => {
    const state = armedState();
    addEmployee(state, 50, 50);
    addEmployee(state, 51, 50);
    addEmployee(state, 5000, 5000);
    expect(evacuationRemaining(state)).toBe(2);
  });

  it('counts the stranded when only they are left', () => {
    const state = armedState();
    const stuck = addEmployee(state, 50, 50);
    state.pendingDetonation!.strandedEmployeeIds.push(stuck.id);
    expect(evacuationRemaining(state)).toBe(1);
  });

  it('is zero once the zone is clear', () => {
    const state = armedState();
    addEmployee(state, 5000, 5000);
    expect(evacuationRemaining(state)).toBe(0);
  });
});
