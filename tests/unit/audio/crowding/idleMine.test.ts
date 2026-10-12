// BlastSimulator2026 — An idle mine is quiet, and a menu is silent
// Five real minutes of a campaign level nobody touches (no orders, no clicks, an event dialog left unanswered),
// at 1x and at 8x, then a game hidden behind a full-screen menu while the world keeps raising events.

import { beforeAll, describe, expect, it } from 'vitest';
import type { CrowdSim } from '../../../helpers/audioCrowding.js';
import { playIdle, playScenario } from '../../../helpers/audioCrowdingScenario.js';
import { peakIn, summarize } from '../../../helpers/audioCrowdingStats.js';
import { AMBIENCE_CONFIG } from '../../../../src/core/config/audio/game.js';

const IDLE_S = 300;
/** The player's own two commands at the start (choose the speed, resume) take about this long. */
const SETUP_S = 3;
const RUN_TIMEOUT_MS = 60_000;

let idle1x: CrowdSim;
let idle8x: CrowdSim;

beforeAll(() => {
  idle1x = playIdle(IDLE_S, { speed: 1 });
  idle8x = playIdle(IDLE_S, { speed: 8 });
}, RUN_TIMEOUT_MS);

describe('an idle mine at 1x', () => {
  it('makes no interface sound once the player stopped clicking', () => {
    // Measured: the interface bus plays 2 sounds, both in the first two seconds (the player's own speed choice and resume).
    const late = idle1x.recorder.heard.filter(p => p.bus === 'ui' && p.tS > SETUP_S);
    expect(late.map(p => p.id)).toEqual([]);
  });

  it('plays under 6 sounds a minute: bells and far-off life, nothing like a work site', () => {
    // Measured 16 sounds in 302 s (3.2 a minute): 7 shift bells, 7 distant-life sounds, the player's two commands.
    const stats = summarize(idle1x.recorder.plays, idle1x.realS);
    expect(stats.totalPerMinute).toBeLessThan(6);
    expect(stats.maxVoices).toBeLessThanOrEqual(2);
  });

  it('plays at most two sounds in any ten seconds once the opening commands are done', () => {
    // Measured 2: a shift bell and a distant sound can fall in the same ten seconds.
    const later = idle1x.recorder.heard.filter(p => p.tS > SETUP_S);
    expect(peakIn(later, 10)).toBeLessThanOrEqual(2);
  });

  it('plays its distant life on the ambient bus, quietly and rarely', () => {
    // LIFE_CONFIG spaces them 25 to 70 s apart: at most 12 in five minutes, measured 7.
    const life = idle1x.recorder.heard.filter(p => p.bus === 'ambient');
    expect(life.length).toBeLessThanOrEqual(12);
    expect(life.every(p => p.positional)).toBe(true);
  });

  it('is measured on a mine that really ran for the five minutes', () => {
    // 300 ticks at 1x: no event dialog froze it, so the quiet above is the mine's, not a stopped clock's.
    expect(idle1x.state!.tickCount).toBeGreaterThanOrEqual(295);
    expect(idle1x.state!.levelEnded).toBe(false);
  });
});

describe('an idle mine at 8x', () => {
  it('plays under 3 sounds a minute and ends on a single level sting', () => {
    // Measured: 7 sounds in 302 s. Left alone the mine goes bankrupt at tick 319, 40 real seconds in, and the
    // lose sting is heard once; the game is then over and silent.
    const stats = summarize(idle8x.recorder.plays, idle8x.realS);
    expect(stats.totalPerMinute).toBeLessThan(3);
    expect(idle8x.recorder.heard.filter(p => p.id === 'level_lose')).toHaveLength(1);
    expect(idle8x.recorder.heard.filter(p => p.bus === 'ui' && p.tS > SETUP_S)).toEqual([]);
  });
});

describe('a full-screen menu', () => {
  const MENU_S = 60;
  let sim: CrowdSim;
  let playsBefore: number;
  let bedsBefore: number;

  beforeAll(() => {
    // A busy game, 45 real seconds in, then the main menu comes up over it.
    sim = playScenario('vibration-budget', { speed: 8, maxRealS: 45 });
    playsBefore = sim.recorder.plays.length;
    bedsBefore = sim.recorder.beds.length;
    sim.menuUp = true;
    sim.frames(1); // the director learns about the menu on the next frame, as in the render loop
    // The world keeps raising events behind the menu: a shift change, a level-up, research, a collapse, hauling,
    // a lightning flash and a game command (the console is reachable from the page even behind a menu).
    const { emitter } = sim.engine;
    const state = sim.state!;
    const vehicleId = state.vehicles.vehicles[0]!.id;
    const employeeId = state.employees.employees[0]!.id;
    for (let second = 0; second < MENU_S; second++) {
      emitter.emit('employee:shift_change', { employeeId });
      emitter.emit('employee:levelup', { employeeId, category: 'driving.truck', oldLevel: 1, newLevel: 2 });
      emitter.emit('research:completed', { targetType: 'living_quarters', targetTier: 2 });
      emitter.emit('employee:collapsed', { employeeId, needKey: 'fatigue' });
      emitter.emit('vehicle:haul_loaded', { vehicleId, fragmentId: 1 });
      emitter.emit('vehicle:haul_delivered', { vehicleId, fragmentId: 1 });
      emitter.emit('vehicle:stuck', { vehicleId });
      sim.director.onLightning();
      sim.frames(60);
    }
  }, RUN_TIMEOUT_MS);

  it('plays nothing at all while it is up', () => {
    // Every cue the world raised for a minute was dropped, and the distant life and work bursts stayed quiet.
    expect(sim.recorder.plays.slice(playsBefore)).toEqual([]);
  });

  it('leaves only a barely audible wind: every bed ends at the menu level or lower', () => {
    // The machinery bed eases down from its working level (0.18 when the menu came up) to silence, not instantly.
    const finalLevel = new Map<string, number>();
    for (const change of sim.recorder.beds.slice(bedsBefore)) finalLevel.set(change.id, change.level);
    expect(finalLevel.size).toBeGreaterThan(0);
    for (const [id, level] of finalLevel) expect(level, id).toBeLessThanOrEqual(AMBIENCE_CONFIG.menuWindLevel);
    expect(finalLevel.get('amb_machinery')).toBe(0);
  });

  it('plays no backlog when it closes: what the world raised behind it is forgotten', () => {
    sim.menuUp = false;
    sim.frames(8 * 60);
    // Measured: only the mine's own life resumes (a shift bell, a hammer, a building going up).
    const raisedBehindIt = new Set(['level_up', 'unlock', 'haul_load', 'haul_dump', 'vehicle_horn', 'thunder']);
    expect(sim.recorder.plays.slice(playsBefore).filter(p => raisedBehindIt.has(p.id))).toEqual([]);
  });
});
