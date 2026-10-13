// BlastSimulator2026 — Bursts coalesce: a huge event is a few sounds, not a wall
// A 200-fragment blast, a 2000-fragment blast, a 60-hole drill plan, a crew of forty finishing a shift, a hundred
// trucks hauling at once, and a paused mine, all on the real core state with the real directors. The counts are
// bounded by the design (bins, budgets, per-burst cues), not by how big the event is.

import { beforeAll, describe, expect, it } from 'vitest';
import { CrowdSim } from '../../../helpers/audioCrowding.js';
import { isBlastSound, peakIn } from '../../../helpers/audioCrowdingStats.js';
import { BLAST_AUDIO_CONFIG, HAUL_BUDGET_CONFIG } from '../../../../src/core/config/audio/game.js';
import type { FragmentFlight } from '../../../../src/core/mining/BlastResolve.js';
import { Random } from '../../../../src/core/math/Random.js';
import { addEmployee, addVehicle } from '../director/helpers.js';

const SETUP_TIMEOUT_MS = 30_000;
/** Real seconds after a shot for its whole timeline to have played out and every voice to have freed. */
const BLAST_SETTLE_S = 25;
const MAIN_LAYERS = ['blast_snap', 'blast_sub', 'blast_crack', 'blast_boom', 'blast_tail'] as const;

function startedGame(speed: 1 | 2 | 4 | 8): CrowdSim {
  const sim = new CrowdSim({ speed });
  sim.command('new_game seed:42');
  sim.chooseSpeed();
  sim.command('time resume');
  return sim;
}

/** Where the camera looks: the middle of the pit. */
function pitCentre(sim: CrowdSim): { x: number; z: number } {
  const grid = sim.engine.ctx.grid!;
  return { x: grid.minX + grid.sizeX / 2, z: grid.minZ + grid.sizeZ / 2 };
}

/** `count` fragments landing between `fromS` and `toS` seconds after the shot, around the origin. */
function flights(count: number, fromS: number, toS: number, seed: number): FragmentFlight[] {
  const random = new Random(seed);
  return Array.from({ length: count }, (_, i) => {
    const landing = random.nextFloat(fromS, toS);
    return {
      fragmentId: i,
      from: { x: 40, y: 20, z: 40 },
      to: { x: 40 + random.nextFloat(-20, 20), y: 10, z: 40 + random.nextFloat(-20, 20) },
      delayS: 0,
      durationS: landing,
      impactSpeed: random.nextFloat(5, 70),
      thrown: true,
    };
  });
}

/** Fire a blast of `fragmentCount` fragments at the listener's pit and play it out; returns its plays. */
function fireBlast(sim: CrowdSim, fragmentCount: number, fromS: number, toS: number) {
  const startIndex = sim.recorder.plays.length;
  const state = sim.state!;
  sim.director.onBlast({
    origin: { x: 40, z: 40 },
    holeCount: 40,
    flights: flights(fragmentCount, fromS, toS, fragmentCount),
    report: state.lastBlastReport,
  });
  sim.seconds(BLAST_SETTLE_S);
  return sim.recorder.plays.slice(startIndex).filter(p => isBlastSound(p.id));
}

describe('a blast of any size', () => {
  let sim: CrowdSim;

  beforeAll(() => {
    sim = startedGame(1);
    sim.seconds(2);
  }, SETUP_TIMEOUT_MS);

  // 2000 fragments over 8 s ask for exactly the cap (five layers plus 40 bins) and hear all of it, so for that row the
  // request cap below is the bar; the other rows are held to 1.2 times what they measured.
  const sizes = [
    { fragments: 10, spread: [0.1, 2], heardMeasured: 12 },
    { fragments: 200, spread: [0.1, 6], heardMeasured: 30 },
    { fragments: 2000, spread: [0.1, 8], heardMeasured: 45 },
    { fragments: 2000, spread: [0.1, 0.4], heardMeasured: 15 },
  ] as const;

  it.each(sizes)('$fragments fragments over $spread s: five main layers once, a rain bounded by its bins, never more than 15 a second', ({ fragments, spread, heardMeasured }) => {
    const plays = fireBlast(sim, fragments, spread[0], spread[1]);
    const heard = plays.filter(p => p.accepted);
    // The shot itself is never lost to the rain: each main layer plays exactly once, whatever follows.
    for (const layer of MAIN_LAYERS) expect(heard.filter(p => p.id === layer), layer).toHaveLength(1);
    // Requests never exceed the five layers plus the rain's bins (at most 40): 2000 fragments ask for no more than 200.
    expect(plays.length).toBeLessThanOrEqual(MAIN_LAYERS.length + BLAST_AUDIO_CONFIG.rain.maxBins);
    // Measured heard (see `heardMeasured` in the table): 12, 30, 45 and 15; the 2000 fragments within 0.4 s lose
    // their overflow to the engine's caps of 10 impacts and 8 pebbles at once instead of piling up.
    expect(heard.length).toBeLessThanOrEqual(Math.ceil(heardMeasured * 1.2));
    expect(heard.length).toBeGreaterThanOrEqual(Math.floor(heardMeasured * 0.75)); // and a big blast is not silent either
    // Measured busiest second 10, 9, 9 and 15.
    expect(peakIn(heard, 1)).toBeLessThanOrEqual(15);
  });

});

describe('a 60-hole drill plan', () => {
  let sim: CrowdSim;

  beforeAll(() => {
    // The staffed first level: three people and three vehicles who start drilling as soon as the plan is ordered.
    sim = new CrowdSim({ speed: 8 });
    sim.command('campaign start level:dusty_hollow');
    sim.chooseSpeed();
    sim.command('time resume');
  }, SETUP_TIMEOUT_MS);

  it('is one order cue, however many holes it orders', () => {
    const before = sim.recorder.plays.length;
    const result = sim.command('drill_plan grid rows:6 cols:10 spacing:3 depth:6 start:15,15');
    expect(result.success).toBe(true);
    expect(sim.state!.plannedDrillHoles).toHaveLength(60);
    expect(sim.recorder.plays.slice(before).filter(p => p.commandIndex === sim.recorder.commandIndex).map(p => `${p.source}:${p.id}`)).toEqual(['command:order_queued']);
  });

  it('finishing all 60 holes in one tick is one drill_done, and loading all 60 charges one charge_loaded', () => {
    const state = sim.state!;
    const before = sim.recorder.plays.length;
    state.drillHoles.push(...state.plannedDrillHoles.map(({ id, x, z, depth, diameter }) => ({ id, x, z, depth, diameter })));
    state.plannedDrillHoles = [];
    sim.waitTicks(1);
    for (const hole of state.drillHoles) state.chargesByHole[hole.id] = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };
    sim.waitTicks(1);
    sim.seconds(5);
    const ids = sim.recorder.plays.slice(before).filter(p => p.source === 'director').map(p => p.id);
    expect(ids.filter(id => id === 'drill_done')).toHaveLength(1);
    expect(ids.filter(id => id === 'charge_loaded')).toHaveLength(1);
  });

  it('is silent once the player pauses: no work burst, no distant life, no acknowledgement', () => {
    // First prove the crew is making noise at all: the two bulk jumps above, then 40 s of drilling and walking.
    const busyFrom = sim.recorder.plays.length;
    sim.command('drill_plan grid rows:2 cols:2 spacing:3 depth:6 start:30,30');
    sim.seconds(40);
    expect(sim.recorder.plays.slice(busyFrom).filter(p => p.source === 'director').length).toBeGreaterThan(0);
    sim.command('time pause');
    const before = sim.recorder.plays.length;
    sim.seconds(90);
    expect(sim.recorder.plays.slice(before)).toEqual([]);
  });
});

describe('many things happening at once', () => {
  let sim: CrowdSim;

  beforeAll(() => {
    sim = startedGame(1);
    sim.seconds(1);
  }, SETUP_TIMEOUT_MS);

  it('rings one bell per cooldown for a crew of forty finishing a shift, for a whole minute of shifts', () => {
    const before = sim.recorder.plays.length;
    for (let second = 0; second < 60; second++) {
      for (let employeeId = 1; employeeId <= 40; employeeId++) sim.engine.emitter.emit('employee:shift_change', { employeeId });
      sim.frames(60);
    }
    const bells = sim.recorder.plays.slice(before).filter(p => p.id === 'shift_whistle');
    // A bell is a landmark: no two within 20 s, so a minute of shift changes is 3 bells (measured 3). Before the
    // spacing went from 8 to 20 s it rang 8 times in the same minute.
    expect(bells).toHaveLength(3);
    for (let i = 1; i < bells.length; i++) expect(bells[i]!.tS - bells[i - 1]!.tS).toBeGreaterThanOrEqual(20);
  });

  it('plays one level-up and one unlock for forty promotions and ten finished researches', () => {
    const before = sim.recorder.plays.length;
    for (let employeeId = 1; employeeId <= 40; employeeId++) {
      sim.engine.emitter.emit('employee:levelup', { employeeId, category: 'driving.truck', oldLevel: 1, newLevel: 2 });
    }
    for (let i = 0; i < 10; i++) sim.engine.emitter.emit('research:completed', { targetType: 'research_center', targetTier: 2 });
    sim.frames(60);
    const ids = sim.recorder.plays.slice(before).map(p => p.id);
    expect(ids.filter(id => id === 'level_up')).toHaveLength(1);
    expect(ids.filter(id => id === 'unlock')).toHaveLength(1);
  });

  it('keeps a hundred trucks hauling to the shared budget: a burst of three plus 1.5 a second', () => {
    const state = sim.state!;
    const centre = pitCentre(sim);
    const trucks = Array.from({ length: 100 }, (_, i) => addVehicle(state, 'debris_hauler', centre.x + (i % 10), centre.z + Math.floor(i / 10)));
    const before = sim.recorder.plays.length;
    for (let second = 0; second < 10; second++) {
      for (const truck of trucks) {
        sim.engine.emitter.emit('vehicle:haul_loaded', { vehicleId: truck.id, fragmentId: truck.id });
        sim.engine.emitter.emit('vehicle:haul_delivered', { vehicleId: truck.id, fragmentId: truck.id });
        sim.engine.emitter.emit('vehicle:boulder_broken', { vehicleId: truck.id, fragmentId: truck.id, pieceIds: [] });
      }
      sim.frames(60);
    }
    const hauling = sim.recorder.plays.slice(before).filter(p => ['haul_load', 'haul_dump', 'boulder_break'].includes(p.id));
    // Ten seconds of 300 hauling events a second: capacity 3 plus 1.5 a second refilled, measured 17 of at most 18.
    expect(hauling.length).toBeLessThanOrEqual(HAUL_BUDGET_CONFIG.capacity + HAUL_BUDGET_CONFIG.refillPerS * 10 + 1);
    expect(hauling.length).toBeGreaterThanOrEqual(HAUL_BUDGET_CONFIG.capacity); // the trucks are heard
    expect(peakIn(hauling, 1)).toBeLessThanOrEqual(4);
  });

  it('plays one thud for forty collapse events from three workers and one honk for every truck of the mine stuck at once', () => {
    const state = sim.state!;
    const before = sim.recorder.plays.length;
    const centre = pitCentre(sim);
    const workers = Array.from({ length: 3 }, (_, i) => addEmployee(state, centre.x + i, centre.z));
    addVehicle(state, 'debris_hauler', centre.x, centre.z + 3);
    for (let i = 0; i < 40; i++) sim.engine.emitter.emit('employee:collapsed', { employeeId: workers[i % workers.length]!.id, needKey: 'fatigue' });
    expect(state.vehicles.vehicles.length).toBeGreaterThanOrEqual(100); // the hundred hauling trucks of the test above are still here
    for (const truck of state.vehicles.vehicles) sim.engine.emitter.emit('vehicle:stuck', { vehicleId: truck.id });
    sim.frames(60);
    const ids = sim.recorder.plays.slice(before).map(p => p.id);
    expect(ids.filter(id => id === 'worker_collapse')).toHaveLength(1);
    expect(ids.filter(id => id === 'vehicle_horn').length).toBe(1);
  });
});
