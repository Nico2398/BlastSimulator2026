import { describe, it, expect } from 'vitest';
import { WorkSounds } from '../../../../src/audio/director/WorkSounds.js';
import { WORK_CONFIG } from '../../../../src/core/config/audio/game.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import type { ActionType } from '../../../../src/core/state/GameState.js';
import { addEmployee, addVehicle, listenerAt, makeHarness, makeState, mount, startWorking, type Harness } from './helpers.js';

const STEP = 0.1;

interface Fixture {
  readonly h: Harness;
  readonly work: WorkSounds;
  readonly state: GameState;
  /** Run `seconds` of frames, advancing the clock the sounds read. */
  run(seconds: number, active?: boolean): void;
}

function fixture(): Fixture {
  const state = makeState();
  const h = makeHarness({ state, listener: listenerAt(0, 0, 40) });
  const work = new WorkSounds(h.env);
  return {
    h,
    work,
    state,
    run(seconds, active = true) {
      for (let t = 0; t < seconds - 1e-9; t += STEP) {
        h.advance(STEP);
        work.update(STEP, active);
      }
    },
  };
}

/** A driller on foot working an action at x. */
function worker(state: GameState, x: number, type: ActionType = 'drill_hole') {
  const employee = addEmployee(state, x, 0);
  startWorking(employee, type);
  return employee;
}

describe('WorkSounds bursts', () => {
  it('stays silent when nobody is working', () => {
    const f = fixture();
    addEmployee(f.state, 5, 0);
    f.work.refresh(f.state);
    f.run(30);
    expect(f.h.player.plays).toHaveLength(0);
  });

  it('bursts at a working site every 1.8 to 4 real seconds, with jitter', () => {
    const f = fixture();
    worker(f.state, 5);
    f.work.refresh(f.state);
    f.run(60);
    const plays = f.h.player.of('work_drill');
    expect(plays.length).toBeGreaterThan(60 / WORK_CONFIG.burstMaxS - 1);
    expect(plays.length).toBeLessThan(60 / WORK_CONFIG.burstMinS + 1);
    const gaps = plays.slice(1).map((p, i) => p.atS - (plays[i]?.atS ?? 0));
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(WORK_CONFIG.burstMinS - STEP);
      expect(gap).toBeLessThanOrEqual(WORK_CONFIG.burstMaxS + STEP);
    }
    expect(new Set(gaps.map(g => g.toFixed(1))).size).toBeGreaterThan(3);
    expect(plays[0]?.opts.at).toEqual({ x: 5, z: 0 });
    expect(plays[0]?.atS).toBeLessThanOrEqual(WORK_CONFIG.firstBurstMaxS + STEP);
  });

  it.each([
    ['drill_hole', 'work_drill'],
    ['dig_ramp_segment', 'work_dig'],
    ['level_ground', 'work_dig'],
    ['place_building', 'work_hammer'],
    ['demolish_building', 'work_hammer'],
    ['repair_vehicle', 'work_hammer'],
  ] as const)('makes the %s sound for %s work', (type, sound) => {
    const f = fixture();
    worker(f.state, 5, type);
    f.work.refresh(f.state);
    f.run(10);
    expect(new Set(f.h.player.ids)).toEqual(new Set([sound]));
  });

  it.each(['charge_hole', 'survey', 'general_work', 'rest', 'haul_debris'] as const)('keeps %s work silent', type => {
    const f = fixture();
    worker(f.state, 5, type);
    f.work.refresh(f.state);
    f.run(20);
    expect(f.h.player.plays).toHaveLength(0);
  });

  it('only the nearest sites make sound at once', () => {
    const f = fixture();
    const workers = [10, 20, 30, 40].map(x => worker(f.state, x));
    f.work.refresh(f.state);
    f.run(40);
    const xs = new Set(f.h.player.plays.map(p => p.opts.at?.x));
    expect(xs).toEqual(new Set(workers.slice(0, WORK_CONFIG.maxSites).map(w => w.x)));
  });

  it('hands the sound to the next site when a nearer one finishes', () => {
    const f = fixture();
    const near = worker(f.state, 10);
    worker(f.state, 20);
    worker(f.state, 30);
    f.work.refresh(f.state);
    f.run(10);
    near.taskTicksRemaining = null;
    f.work.refresh(f.state);
    f.h.player.clear();
    f.run(20);
    expect(new Set(f.h.player.plays.map(p => p.opts.at?.x))).toEqual(new Set([20, 30]));
  });

  it('ignores sites beyond earshot', () => {
    const f = fixture();
    worker(f.state, 5000);
    f.work.refresh(f.state);
    f.run(30);
    expect(f.h.player.plays).toHaveLength(0);
  });

  it('follows a pulled-back camera to farther sites', () => {
    const f = fixture();
    worker(f.state, 200);
    f.work.refresh(f.state);
    f.run(20);
    expect(f.h.player.plays).toHaveLength(0);
    f.h.setListener(listenerAt(0, 0, 150));
    f.run(20);
    expect(f.h.player.plays.length).toBeGreaterThan(0);
  });

  it('stops the moment the task ends', () => {
    const f = fixture();
    const driller = worker(f.state, 5);
    f.work.refresh(f.state);
    f.run(10);
    expect(f.h.player.plays.length).toBeGreaterThan(0);
    driller.taskTicksRemaining = null;
    f.work.refresh(f.state);
    f.h.player.clear();
    f.run(30);
    expect(f.h.player.plays).toHaveLength(0);
  });

  it('makes no sound while inactive (paused or behind a menu) and resumes after', () => {
    const f = fixture();
    worker(f.state, 5);
    f.work.refresh(f.state);
    f.run(30, false);
    expect(f.h.player.plays).toHaveLength(0);
    f.run(10, true);
    expect(f.h.player.plays.length).toBeGreaterThan(0);
  });

  it('keeps quiet while suppressed, then resumes', () => {
    const f = fixture();
    worker(f.state, 5);
    f.work.refresh(f.state);
    f.work.suppress(10);
    f.run(9.5);
    expect(f.h.player.plays).toHaveLength(0);
    f.run(10);
    expect(f.h.player.plays.length).toBeGreaterThan(0);
  });

  it('is driven by frames, not by how many ticks refresh saw', () => {
    const f = fixture();
    worker(f.state, 5);
    for (let i = 0; i < 8; i++) f.work.refresh(f.state);
    f.run(20);
    const eight = f.h.player.plays.length;
    const g = fixture();
    worker(g.state, 5);
    g.work.refresh(g.state);
    g.run(20);
    expect(eight).toBe(g.h.player.plays.length);
  });

  it('places a mounted worker at its vehicle, following the renderer', () => {
    const state = makeState();
    const rig = addVehicle(state, 'drill_rig', 5, 0);
    const driller = worker(state, 5);
    mount(state, driller, rig);
    const h = makeHarness({ state, listener: listenerAt(0, 0, 40), entityPosition: (kind, id) => (kind === 'vehicle' && id === rig.id ? { x: 7, z: 1 } : null) });
    const work = new WorkSounds(h.env);
    work.refresh(state);
    for (let t = 0; t < 10; t += STEP) { h.advance(STEP); work.update(STEP, true); }
    expect(h.player.plays[0]?.opts.at).toEqual({ x: 7, z: 1 });
  });

  it('ignores dead workers', () => {
    const f = fixture();
    worker(f.state, 5).alive = false;
    f.work.refresh(f.state);
    f.run(20);
    expect(f.h.player.plays).toHaveLength(0);
  });
});

describe('WorkSounds machinery bed', () => {
  it('stays untouched with nothing going on', () => {
    const f = fixture();
    f.work.refresh(f.state);
    f.run(20);
    expect(f.h.player.bed('amb_machinery').calls).toHaveLength(0);
  });

  it('swells with the working units near the listener, smoothly, up to its ceiling', () => {
    const f = fixture();
    for (let i = 0; i < 12; i++) worker(f.state, 5 + i, 'charge_hole');
    f.work.refresh(f.state);
    f.run(30);
    const bed = f.h.player.bed('amb_machinery');
    expect(bed.level).toBeGreaterThan(WORK_CONFIG.machinery.maxLevel * 0.9);
    expect(bed.level).toBeLessThanOrEqual(WORK_CONFIG.machinery.maxLevel);
    const levels = bed.calls.map(c => c.level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(bed.calls.length).toBeLessThan(40);
    expect(bed.calls.every(c => c.rampS === WORK_CONFIG.machinery.rampS)).toBe(true);
  });

  it('counts drivers too, and scales with how many', () => {
    const few = fixture();
    const many = fixture();
    for (const [f, n] of [[few, 1], [many, 5]] as const) {
      for (let i = 0; i < n; i++) {
        const rig = addVehicle(f.state, 'debris_hauler', 5, i);
        const driver = addEmployee(f.state, 5, i, 'driver');
        mount(f.state, driver, rig);
        driver.itinerary = {} as never;
        driver.taskTicksRemaining = null;
      }
      f.work.refresh(f.state);
      f.run(30);
    }
    const level = (f: Fixture): number => f.h.player.bed('amb_machinery').level;
    expect(level(few)).toBeGreaterThan(0);
    expect(level(many)).toBeGreaterThan(level(few));
  });

  it('fades to silence when paused or when the work ends, and reaches exactly zero', () => {
    const f = fixture();
    for (let i = 0; i < 6; i++) worker(f.state, 5 + i, 'charge_hole');
    f.work.refresh(f.state);
    f.run(20);
    expect(f.h.player.bed('amb_machinery').level).toBeGreaterThan(0.3);
    f.run(30, false);
    expect(f.h.player.bed('amb_machinery').level).toBe(0);
  });

  it('ignores units out of earshot', () => {
    const f = fixture();
    for (let i = 0; i < 6; i++) worker(f.state, 3000 + i, 'charge_hole');
    f.work.refresh(f.state);
    f.run(20);
    expect(f.h.player.bed('amb_machinery').level).toBe(0);
  });

  it('clear() silences the bed and forgets the sites', () => {
    const f = fixture();
    for (let i = 0; i < 6; i++) worker(f.state, 5 + i);
    f.work.refresh(f.state);
    f.run(20);
    f.work.clear();
    expect(f.h.player.bed('amb_machinery').level).toBe(0);
    f.h.player.clear();
    f.run(20);
    expect(f.h.player.plays).toHaveLength(0);
  });
});
