import { describe, it, expect, vi } from 'vitest';
import { GameAudioDirector, type CommandReport, type FrameInput } from '../../../../src/audio/director/GameAudioDirector.js';
import type { BlastInfo } from '../../../../src/audio/director/blastPlan.js';
import type { OneShotId } from '../../../../src/audio/SoundCatalog.js';
import type { PlayOptions, SoundHandle } from '../../../../src/audio/AudioPlayer.js';
import { AMBIENCE_CONFIG, BLAST_AUDIO_CONFIG, DIFF_CONFIG, HAUL_BUDGET_CONFIG, SIREN_CONFIG, WORK_CONFIG } from '../../../../src/core/config/audio/game.js';
import { parseCommand } from '../../../../src/console/ConsoleRunner.js';
import { EventEmitter } from '../../../../src/core/state/EventEmitter.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import { Random } from '../../../../src/core/math/Random.js';
import { RecordingPlayer } from '../../../helpers/audioPlayerFakes.js';
import { addAction, addBuilding, addEmployee, addVehicle, advanceTicks, fallingTo, listenerAt, makeState, mount, removeAction, startWorking } from './helpers.js';

class ThrowingPlayer extends RecordingPlayer {
  throwOnPlay = false;
  throwOnDuck = false;
  override play(id: OneShotId, opts?: PlayOptions): SoundHandle | null {
    if (this.throwOnPlay) throw new Error('play failed');
    return super.play(id, opts);
  }
  override duck(...args: Parameters<RecordingPlayer['duck']>): void {
    if (this.throwOnDuck) throw new Error('duck failed');
    super.duck(...args);
  }
}

const FRAME = 0.1;
const LISTENER = listenerAt(0, 0, 40);

function setup(options: { state?: GameState; entityPosition?: (kind: 'employee' | 'vehicle' | 'building', id: number) => { x: number; z: number } | null; category?: string } = {}) {
  const player = new ThrowingPlayer();
  const emitter = new EventEmitter();
  const errors: unknown[] = [];
  const director = new GameAudioDirector({
    player,
    emitter,
    random: new Random(11),
    onError: e => errors.push(e),
    ...(options.entityPosition ? { entityPosition: options.entityPosition } : {}),
    eventCategory: () => options.category,
  });
  let clock = 0;
  player.now = () => clock;
  const state = options.state ?? makeState();
  const run = (seconds: number, frame: Partial<FrameInput> = {}): void => {
    for (let t = 0; t < seconds - 1e-9; t += FRAME) {
      clock += FRAME;
      director.update({ dtS: FRAME, state, menuUp: false, listener: LISTENER, ...frame });
    }
  };
  const command = (line: string, overrides: Partial<CommandReport> = {}): void => {
    director.onCommand({ parsed: parseCommand(line), success: true, prevState: state, state, ...overrides });
  };
  return { player, emitter, errors, director, state, run, command, clock: () => clock };
}

/** A running game: baseline taken, a first frame seen. */
function started(options: Parameters<typeof setup>[0] = {}) {
  const s = setup(options);
  s.run(FRAME);
  s.player.clear();
  return s;
}

describe('GameAudioDirector baseline', () => {
  it('plays nothing for a loaded world, however much it holds', () => {
    const state = makeState();
    addBuilding(state, 'living_quarters', 3, 3);
    addVehicle(state, 'drill_rig', 4, 4);
    state.finances.transactions.push({ tick: 0, amount: 90000, type: 'income', category: 'contracts', description: '' });
    state.events.pendingEvent = { eventId: 'x', firedAtTick: 0 };
    state.damage.accidents.push({ tick: 0, type: 'death', entityId: 1, fragmentId: 0, kineticEnergy: 0 });
    const s = setup({ state });
    s.command('load slot1', { prevState: null });
    s.run(3);
    expect(s.player.plays).toHaveLength(0);
    expect(s.player.ducks).toHaveLength(0);
  });

  it('treats a replaced state object as a new level: silent baseline, then normal play', () => {
    const s = started();
    const next = makeState();
    addBuilding(next, 'living_quarters', 3, 3);
    s.director.update({ dtS: FRAME, state: next, menuUp: false, listener: LISTENER });
    expect(s.player.plays).toHaveLength(0);
    addBuilding(next, 'management_office', 5, 5);
    s.director.onCommand({ parsed: parseCommand('build x'), success: true, prevState: next, state: next });
    expect(s.player.ids).toEqual(['building_built']);
  });

  it('baselines silently when a command itself replaces the state', () => {
    const s = started();
    const next = makeState();
    addBuilding(next, 'living_quarters', 3, 3);
    s.director.onCommand({ parsed: parseCommand('new_game'), success: true, prevState: s.state, state: next });
    expect(s.player.plays).toHaveLength(0);
  });

  it('forgets the old game on reset, so the same state is a baseline again', () => {
    const s = started();
    s.director.reset();
    addBuilding(s.state, 'living_quarters', 3, 3);
    s.command('anything');
    expect(s.player.plays).toHaveLength(0);
    addBuilding(s.state, 'management_office', 5, 5);
    s.command('anything');
    expect(s.player.ids).toEqual(['building_built']);
  });

  it('ignores commands with no game', () => {
    const s = started();
    s.director.onCommand({ parsed: parseCommand('help'), success: true, prevState: null, state: null });
    expect(s.player.plays).toHaveLength(0);
    expect(s.errors).toEqual([]);
  });
});

describe('GameAudioDirector state cues', () => {
  it('plays a bought vehicle at once, without waiting for a tick', () => {
    const s = started();
    addVehicle(s.state, 'debris_hauler', 8, 8);
    s.command('vehicle buy debris_hauler');
    expect(s.player.ids).toEqual(['vehicle_start']);
  });

  it('plays one cue per category for an 8x batch of ticks, nothing for a bigger jump', () => {
    const s = started();
    addBuilding(s.state, 'living_quarters', 3, 3);
    addBuilding(s.state, 'management_office', 6, 6);
    addVehicle(s.state, 'drill_rig', 4, 4);
    addVehicle(s.state, 'debris_hauler', 5, 4);
    s.state.finances.transactions.push({ tick: 1, amount: 3000, type: 'income', category: 'contracts', description: '' });
    advanceTicks(s.state, 8);
    s.command('tick 8');
    expect(s.player.ids.sort()).toEqual(['building_built', 'coins_big', 'vehicle_start']);

    s.player.clear();
    addBuilding(s.state, 'research_center', 9, 9);
    advanceTicks(s.state, 9);
    s.command('tick 9');
    expect(s.player.plays).toHaveLength(0);
  });

  it('chimes for a finished ramp and rings the cash register for a big contract', () => {
    const s = started();
    const dig = addAction(s.state, 'dig_ramp_segment');
    s.command('tick');
    removeAction(s.state, dig.id);
    s.state.finances.transactions.push({ tick: 1, amount: DIFF_CONFIG.income.tillAmount, type: 'income', category: 'contracts', description: '' });
    advanceTicks(s.state, 1);
    s.command('tick');
    expect(s.player.ids.sort()).toEqual(['cash_till', 'order_done']);
  });

  it('alerts on a pending event with its category flourish, steps the ambience aside, and does not repeat', () => {
    const s = started({ category: 'mafia' });
    s.state.events.pendingEvent = { eventId: 'godfather', firedAtTick: 3 };
    s.state.isPaused = true;
    s.command('tick');
    expect(s.player.ids).toEqual(['notify_alert', 'event_mafia']);
    expect(s.player.of('event_mafia')[0]?.opts.delayS).toBe(DIFF_CONFIG.eventAlert.flourishDelayS);
    expect(s.player.ducks).toEqual([{ bus: 'ambient', ...DIFF_CONFIG.eventAlert.duck }]);
    s.player.clear();
    s.command('tick');
    s.run(2);
    expect(s.player.plays).toHaveLength(0);
  });

  it('plays the level-end sting once, from the diff or the core event, whichever comes first', () => {
    const s = started();
    s.state.levelEnded = true;
    s.state.levelEndReason = 'bankruptcy';
    s.command('tick');
    s.emitter.emit('bankruptcy:triggered', { cash: -1 });
    s.emitter.emit('revolt:triggered', {});
    expect(s.player.ids).toEqual(['level_lose']);
    expect(s.player.ducks).toHaveLength(1);
  });

  it('plays the win sting from the core event alone', () => {
    const s = started();
    s.emitter.emit('level:complete', { levelId: 'a', totalProfit: 1, blastsPerformed: 1, casualties: 0, finalWellBeing: 50, finalEcology: 50, finalSafety: 50, stars: 2 });
    expect(s.player.ids).toEqual(['level_win']);
  });

  it('plays the sting again in the next level', () => {
    const s = started();
    s.emitter.emit('level:complete', { levelId: 'a', totalProfit: 1, blastsPerformed: 1, casualties: 0, finalWellBeing: 50, finalEcology: 50, finalSafety: 50, stars: 2 });
    const next = makeState();
    s.director.update({ dtS: FRAME, state: next, menuUp: false, listener: LISTENER });
    s.emitter.emit('bankruptcy:triggered', { cash: -1 });
    expect(s.player.ids).toEqual(['level_win', 'level_lose']);
  });
});

describe('GameAudioDirector level-end sting after "keep playing"', () => {
  function wonThenKeptPlaying() {
    const s = started();
    s.state.levelEnded = true;
    s.state.levelEndReason = 'completed';
    s.command('tick');
    expect(s.player.ids).toEqual(['level_win']);
    // convertWinToFreePlay: the same state object, running again.
    s.state.levelEnded = false;
    s.state.levelEndReason = null;
    s.command('campaign keep_playing');
    return s;
  }

  it('plays the lose sting for a defeat the diff sees in the free play that followed a win', () => {
    const s = wonThenKeptPlaying();
    s.state.levelEnded = true;
    s.state.levelEndReason = 'bankruptcy';
    s.command('tick');
    expect(s.player.ids).toEqual(['level_win', 'level_lose']);
  });

  it('plays the lose sting for a defeat the core event announces in that free play', () => {
    const s = wonThenKeptPlaying();
    s.emitter.emit('bankruptcy:triggered', { cash: -1 });
    expect(s.player.ids).toEqual(['level_win', 'level_lose']);
  });

  it('still plays only one sting while the level stays over', () => {
    const s = wonThenKeptPlaying();
    s.state.levelEnded = true;
    s.state.levelEndReason = 'bankruptcy';
    s.command('tick');
    s.emitter.emit('bankruptcy:triggered', { cash: -1 });
    s.command('tick');
    expect(s.player.ids).toEqual(['level_win', 'level_lose']);
  });
});

describe('GameAudioDirector event cues', () => {
  it('plays hauling at the renderer position and keeps a hundred-trip burst a texture at 8x', () => {
    const trucks = new Map<number, { x: number; z: number }>();
    const s = started({ entityPosition: (kind, id) => (kind === 'vehicle' ? trucks.get(id) ?? null : null) });
    for (let i = 0; i < 100; i++) {
      const truck = addVehicle(s.state, 'debris_hauler', 0, 0);
      trucks.set(truck.id, { x: 2 + (i % 20), z: 3 });
    }
    for (let second = 0; second < 10; second++) {
      for (const truck of s.state.vehicles.vehicles) {
        s.emitter.emit('vehicle:haul_loaded', { vehicleId: truck.id, fragmentId: truck.id });
        s.emitter.emit('vehicle:haul_delivered', { vehicleId: truck.id, fragmentId: truck.id });
      }
      advanceTicks(s.state, 8);
      s.command('tick 8');
      s.run(1);
    }
    const hauling = s.player.plays.filter(p => p.id === 'haul_load' || p.id === 'haul_dump');
    expect(hauling.length).toBeGreaterThan(0);
    expect(hauling.length).toBeLessThanOrEqual(HAUL_BUDGET_CONFIG.capacity + HAUL_BUDGET_CONFIG.refillPerS * 10 + 1);
    expect(hauling[0]?.opts.at?.z).toBe(3);
    expect(hauling[0]?.opts.at?.x).toBeGreaterThanOrEqual(2);
  });

  it('rings one shift bell for a whole crew', () => {
    const s = started();
    for (let id = 1; id <= 40; id++) s.emitter.emit('employee:shift_change', { employeeId: id });
    advanceTicks(s.state, 1);
    s.command('tick');
    s.run(1);
    expect(s.player.ids).toEqual(['shift_bell']);
  });

  it('flushes event cues on the next frame when no command followed', () => {
    const s = started();
    s.emitter.emit('research:completed', { targetType: 'living_quarters', targetTier: 2 });
    expect(s.player.plays).toHaveLength(0);
    s.run(FRAME);
    expect(s.player.ids).toEqual(['unlock']);
  });
});

describe('GameAudioDirector menus and pause', () => {
  it('plays nothing behind a full-screen menu and does not replay it afterwards', () => {
    const s = started();
    s.run(FRAME, { menuUp: true });
    addBuilding(s.state, 'living_quarters', 3, 3);
    s.state.events.pendingEvent = { eventId: 'x', firedAtTick: 1 };
    s.emitter.emit('employee:shift_change', { employeeId: 1 });
    s.emitter.emit('research:completed', { targetType: 'living_quarters', targetTier: 2 });
    s.command('tick');
    s.run(3, { menuUp: true });
    s.run(3);
    expect(s.player.plays).toHaveLength(0);
    expect(s.player.ducks).toHaveLength(0);
  });

  it('keeps only a very quiet wind at the main menu, with no game', () => {
    const s = setup();
    s.run(3, { state: null, menuUp: true, listener: null });
    expect(s.player.plays).toHaveLength(0);
    expect(s.player.bed('amb_wind').level).toBe(AMBIENCE_CONFIG.menuWindLevel);
    expect(s.player.bed('amb_rain_heavy').level).toBe(0);
    expect(s.player.bed('amb_machinery').calls).toHaveLength(0);
  });

  it('opens the weather beds when the game starts and closes them behind a menu', () => {
    const s = started();
    s.state.weather.current = 'heavy_rain';
    s.run(AMBIENCE_CONFIG.minDwellS + 1);
    expect(s.player.bed('amb_rain_heavy').level).toBeGreaterThan(0.5);
    s.run(1, { menuUp: true });
    expect(s.player.bed('amb_rain_heavy').level).toBe(0);
    expect(s.player.bed('amb_wind').level).toBe(AMBIENCE_CONFIG.menuWindLevel);
  });

  it('follows the weather of the running game', () => {
    const s = started();
    s.run(1);
    const calm = s.player.bed('amb_wind').level;
    s.state.weather.current = 'storm';
    s.run(AMBIENCE_CONFIG.minDwellS + 1);
    expect(s.player.bed('amb_wind').level).toBeGreaterThan(calm * 2);
    expect(s.player.bed('amb_rain_heavy').level).toBe(AMBIENCE_CONFIG.weather.storm.rainHeavy);
  });

  it('eases the beds, stops work sounds and mutes the machinery while paused', () => {
    const s = started();
    s.state.weather.current = 'heavy_rain';
    for (let i = 0; i < 8; i++) startWorking(addEmployee(s.state, 5 + i, 0), 'drill_hole');
    s.command('tick');
    s.run(30);
    expect(s.player.of('work_drill').length).toBeGreaterThan(0);
    expect(s.player.bed('amb_machinery').level).toBeGreaterThan(0.3);
    const rain = s.player.bed('amb_rain_heavy').level;

    s.state.isPaused = true;
    s.player.clear();
    s.run(30);
    expect(s.player.of('work_drill')).toHaveLength(0);
    expect(s.player.bed('amb_machinery').level).toBe(0);
    expect(s.player.bed('amb_rain_heavy').level).toBeCloseTo(rain * AMBIENCE_CONFIG.pausedFactor, 6);

    s.state.isPaused = false;
    s.run(30);
    expect(s.player.of('work_drill').length).toBeGreaterThan(0);
    expect(s.player.bed('amb_machinery').level).toBeGreaterThan(0.3);
  });

  it('stays quiet once the level is over', () => {
    const s = started();
    startWorking(addEmployee(s.state, 5, 0), 'drill_hole');
    s.command('tick');
    s.state.levelEnded = true;
    s.run(30);
    expect(s.player.of('work_drill')).toHaveLength(0);
  });
});

describe('GameAudioDirector work sounds', () => {
  it('picks up work that starts after a command and drops it when it ends', () => {
    const s = started();
    const driller = addEmployee(s.state, 6, 0);
    s.run(10);
    expect(s.player.plays).toHaveLength(0);
    startWorking(driller, 'dig_ramp_segment');
    s.command('tick');
    s.run(10);
    expect(s.player.of('work_dig').length).toBeGreaterThan(0);
    driller.taskTicksRemaining = null;
    s.command('tick');
    s.player.clear();
    s.run(20);
    expect(s.player.of('work_dig')).toHaveLength(0);
  });

  it('is driven by frame time: no frames, no sound, and one huge frame is only a quarter second', () => {
    const s = started();
    startWorking(addEmployee(s.state, 6, 0), 'drill_hole');
    s.command('tick');
    for (let i = 0; i < 1000; i++) s.director.update({ dtS: 0, state: s.state, menuUp: false, listener: LISTENER });
    expect(s.player.plays).toHaveLength(0);
    s.director.update({ dtS: 1000, state: s.state, menuUp: false, listener: LISTENER });
    s.director.update({ dtS: 1000, state: s.state, menuUp: false, listener: LISTENER });
    expect(s.player.plays.length).toBeLessThanOrEqual(1);
  });

  it('makes the same sound per real second at any game speed', () => {
    const count = (timeScale: number): number => {
      const s = started();
      s.state.timeScale = timeScale;
      startWorking(addEmployee(s.state, 6, 0), 'drill_hole');
      for (let second = 0; second < 30; second++) {
        advanceTicks(s.state, timeScale);
        s.command(`tick ${timeScale}`);
        s.run(1);
      }
      return s.player.of('work_drill').length;
    };
    expect(count(1)).toBeGreaterThan(5);
    expect(count(8)).toBe(count(1));
  });

  it('forwards the listener to the player each frame', () => {
    const s = setup();
    s.run(0.3);
    expect(s.player.listeners).toHaveLength(3);
    expect(s.player.listeners[0]).toBe(LISTENER);
  });

  it('keeps work sites inside the configured count', () => {
    const s = started();
    for (let i = 0; i < 10; i++) startWorking(addEmployee(s.state, 5 + i * 2, 0), 'drill_hole');
    s.command('tick');
    s.run(60);
    const places = new Set(s.player.of('work_drill').map(p => p.opts.at?.x));
    expect(places.size).toBeLessThanOrEqual(WORK_CONFIG.maxSites);
  });

  it('follows a mounted driller to its vehicle', () => {
    const s = started({ entityPosition: kind => (kind === 'vehicle' ? { x: 9, z: 9 } : null) });
    const rig = addVehicle(s.state, 'drill_rig', 5, 5);
    const driller = addEmployee(s.state, 5, 5, 'driller');
    mount(s.state, driller, rig);
    startWorking(driller, 'drill_hole');
    s.command('tick');
    s.run(10);
    expect(s.player.of('work_drill')[0]?.opts.at).toEqual({ x: 9, z: 9 });
  });
});

describe('GameAudioDirector blasts', () => {
  const info = (overrides: Partial<BlastInfo> = {}): BlastInfo => ({
    origin: { x: 20, z: 10 },
    holeCount: 30,
    flights: Array.from({ length: 400 }, (_, i) => fallingTo({ x: 20 + (i % 10), z: 10 }, { delayS: 0.2, durationS: 1 + (i % 50) * 0.1, impactSpeed: 30 })),
    report: null,
    ...overrides,
  });

  it('starts the boom the moment the renderer says so and ducks the ambience', () => {
    const s = started();
    s.director.onBlast(info());
    expect(s.player.ids).toEqual(expect.arrayContaining(['blast_crack', 'blast_boom', 'blast_sub']));
    expect(s.player.ducks.at(-1)).toEqual({ bus: 'ambient', ...BLAST_AUDIO_CONFIG.duck });
  });

  it('rains debris over the next seconds, in real time', () => {
    const s = started();
    s.director.onBlast(info());
    s.run(8);
    const rain = s.player.plays.filter(p => p.id === 'debris_hit' || p.id === 'debris_pebble');
    expect(rain.length).toBeGreaterThanOrEqual(BLAST_AUDIO_CONFIG.rain.minBins);
    expect(rain.length).toBeLessThanOrEqual(BLAST_AUDIO_CONFIG.rain.maxBins);
  });

  it('holds work sounds back while the blast plays', () => {
    const s = started();
    startWorking(addEmployee(s.state, 6, 0), 'drill_hole');
    s.command('tick');
    s.director.onBlast(info());
    s.run(BLAST_AUDIO_CONFIG.workSuppressS - 0.3);
    expect(s.player.of('work_drill')).toHaveLength(0);
    s.run(10);
    expect(s.player.of('work_drill').length).toBeGreaterThan(0);
  });

  it('dips the ambience as the blast job starts', () => {
    const s = started();
    s.emitter.emit('blast:started', { originX: 0, originY: 0, originZ: 0 });
    const { amountDb, holdS, releaseS } = BLAST_AUDIO_CONFIG.preRollDuck;
    expect(s.player.ducks).toEqual([{ bus: 'ambient', amountDb, holdS, releaseS }]);
  });

  it('cuts the scheduled sounds when playback is skipped', () => {
    const s = started();
    s.director.onBlast(info());
    s.run(1);
    const played = s.player.plays.length;
    s.director.cancelBlast();
    expect(s.player.plays.filter(p => p.handle.stopped)).toHaveLength(played);
    s.run(10);
    expect(s.player.plays).toHaveLength(played);
  });

  it('remembers the charge that was loaded before the blast cleared it', () => {
    const loud = started();
    const quiet = started();
    for (const [s, kg] of [[loud, 600], [quiet, 0]] as const) {
      if (kg > 0) {
        s.state.drillHoles.push({ id: 'H1', x: 20, z: 10, depth: 8, diameter: 0.1 });
        s.state.chargesByHole['H1'] = { explosiveId: 'anfo', amountKg: kg, stemmingM: 2 };
        s.command('charge hole:H1');
        s.state.drillHoles.length = 0;
        s.state.chargesByHole = {};
        s.state.lastBlastReport = {} as unknown as GameState['lastBlastReport'];
        s.command('tick');
        s.player.clear();
      }
      s.director.onBlast(info({ holeCount: 4, flights: [] }));
    }
    const gain = (s: ReturnType<typeof started>): number => s.player.of('blast_crack')[0]?.opts.gainDb ?? NaN;
    expect(gain(loud)).toBeGreaterThan(gain(quiet));
  });

  it('hears the destroyed building once, in the blast timeline and not in the diff', () => {
    const s = started();
    addBuilding(s.state, 'living_quarters', 15, 10);
    s.command('tick');
    s.player.clear();
    s.state.buildings.buildings.length = 0;
    s.state.lastBlastReport = {} as unknown as GameState['lastBlastReport'];
    s.command('tick');
    expect(s.player.plays).toHaveLength(0);
    s.director.onBlast(info({ flights: [], report: { destroyedBuildings: [{ x: 15, z: 10 }] } }));
    s.run(3);
    const crashes = s.player.of('building_demolished');
    expect(crashes).toHaveLength(1);
    expect((crashes[0]?.atS ?? 0) + (crashes[0]?.opts.delayS ?? 0)).toBeGreaterThan(BLAST_AUDIO_CONFIG.boomDelayS);
  });

  it('hears a building and a vehicle that flyrock destroyed, where they stood, once and after the boom', () => {
    const s = started();
    const hall = addBuilding(s.state, 'living_quarters', 15, 10);
    const truck = addVehicle(s.state, 'debris_hauler', 22, 12);
    s.command('tick');
    s.player.clear();
    // The blast removes them from the game; the renderer then fires the flash, before anyone looks at the world again.
    s.state.buildings.buildings.length = 0;
    s.state.vehicles.vehicles.length = 0;
    s.state.lastBlastReport = {} as unknown as GameState['lastBlastReport'];
    s.director.onBlast(info({ flights: [], report: { accidents: [{ type: 'building_destroyed', entityId: hall.id }, { type: 'vehicle_destroyed', entityId: truck.id }] } }));
    s.command('tick');
    s.run(3);
    const crash = s.player.of('building_demolished');
    const scrap = s.player.of('vehicle_scrap');
    expect(crash).toHaveLength(1);
    expect(crash[0]?.opts.at).toEqual({ x: 15, z: 10 });
    expect(scrap).toHaveLength(1);
    expect(scrap[0]?.opts.at).toEqual({ x: 22, z: 12 });
    const boom = s.player.of('blast_boom')[0];
    for (const cue of [...crash, ...scrap]) expect((cue.atS) + (cue.opts.delayS ?? 0)).toBeGreaterThan(boom ? boom.atS + (boom.opts.delayS ?? 0) : Infinity);
  });

  it('does not voice a building twice when the report lists it and an accident names it', () => {
    const s = started();
    const hall = addBuilding(s.state, 'living_quarters', 15, 10);
    s.command('tick');
    s.player.clear();
    s.state.buildings.buildings.length = 0;
    s.director.onBlast(info({ flights: [], report: { destroyedBuildings: [{ x: 15, z: 10, buildingId: hall.id }], accidents: [{ type: 'building_destroyed', entityId: hall.id }] } }));
    s.run(3);
    expect(s.player.of('building_demolished')).toHaveLength(1);
  });

  it('stays quiet about a destroyed vehicle when the flash comes after the world was looked at again', () => {
    const s = started();
    const truck = addVehicle(s.state, 'debris_hauler', 22, 12);
    s.command('tick');
    s.state.vehicles.vehicles.length = 0;
    s.command('tick');
    s.player.clear();
    s.director.onBlast(info({ flights: [], report: { accidents: [{ type: 'vehicle_destroyed', entityId: truck.id }] } }));
    s.run(3);
    expect(s.player.of('vehicle_scrap')).toHaveLength(0);
  });

  it('holds the dip and the work sounds until the flash, however long the blast job takes', () => {
    const s = started();
    startWorking(addEmployee(s.state, 6, 0), 'drill_hole');
    s.command('tick');
    s.run(BLAST_AUDIO_CONFIG.preRollDuck.holdS + 3);
    expect(s.player.of('work_drill').length).toBeGreaterThan(0);
    s.player.clear();
    s.player.ducks.length = 0;
    s.emitter.emit('blast:started', { originX: 0, originY: 0, originZ: 0 });
    const longJobS = 3 * BLAST_AUDIO_CONFIG.preRollDuck.holdS + 2;
    s.run(longJobS);
    expect(s.player.of('work_drill')).toHaveLength(0);
    expect(s.player.ducks.length).toBeGreaterThanOrEqual(Math.floor(longJobS / BLAST_AUDIO_CONFIG.preRollDuck.holdS));
    s.director.onBlast(info());
    const ducksAtFlash = s.player.ducks.length;
    s.run(1);
    expect(s.player.ducks).toHaveLength(ducksAtFlash);
  });

  it('forgets the rain still to fall when a menu comes up, and keeps the tail and the later blasts', () => {
    const s = started();
    s.director.onBlast(info({ report: { secondaryBlasts: [{ x: 40, z: 10, explosivesKg: 100 }] } }));
    s.run(FRAME, { menuUp: true });
    const rainAtMenu = s.player.plays.filter(p => p.id.startsWith('debris')).length;
    s.run(8, { menuUp: true });
    expect(s.player.plays.filter(p => p.id.startsWith('debris'))).toHaveLength(rainAtMenu);
    expect(s.player.of('blast_tail')).toHaveLength(1);
    expect(s.player.of('blast_boom')).toHaveLength(2);
  });

  it('ignores a blast with no game or behind a menu', () => {
    const s = setup();
    s.director.onBlast(info());
    expect(s.player.plays).toHaveLength(0);
    const t = started();
    t.run(FRAME, { menuUp: true });
    t.director.onBlast(info());
    expect(t.player.plays).toHaveLength(0);
  });
});

describe('GameAudioDirector evacuation siren', () => {
  function armed() {
    const s = started();
    s.state.drillHoles.push({ id: 'H1', x: 50, z: 50, depth: 5, diameter: 0.1 });
    const crew = [0, 1, 2, 3, 4, 5].map(i => addEmployee(s.state, 50 + i, 50));
    s.command('tick');
    s.state.pendingDetonation = { armedTick: 0, strandedEmployeeIds: [], strandedVehicleIds: [], lastEvacuationTick: 0 };
    s.command('blast detonate');
    return { s, crew };
  }

  it('wails while armed and beeps faster as the zone empties', () => {
    const { s, crew } = armed();
    s.run(6);
    expect(s.player.bed('blast_siren').level).toBe(1);
    const slow = s.player.of('blast_beep').length;
    expect(slow).toBeGreaterThanOrEqual(3);
    s.player.clear();
    for (const worker of crew) worker.x = 5000;
    s.command('tick');
    s.run(6);
    expect(s.player.of('blast_beep').length).toBeGreaterThan(slow);
  });

  it('plays the cancel blip at once for `blast cancel`', () => {
    const { s } = armed();
    s.run(2);
    s.state.pendingDetonation = null;
    s.command('blast cancel');
    s.run(FRAME);
    expect(s.player.of('blast_cancel')).toHaveLength(1);
    expect(s.player.bed('blast_siren').level).toBe(0);
  });

  it('goes quiet without a cancel blip when the blast starts', () => {
    const { s } = armed();
    s.run(2);
    s.state.pendingDetonation = null;
    s.run(FRAME);
    s.emitter.emit('blast:started', { originX: 0, originY: 0, originZ: 0 });
    s.run(3);
    expect(s.player.of('blast_cancel')).toHaveLength(0);
    expect(s.player.bed('blast_siren').level).toBe(0);
  });

  it('goes quiet without a cancel blip when the report lands first', () => {
    const { s } = armed();
    s.run(2);
    s.state.pendingDetonation = null;
    s.state.lastBlastReport = {} as unknown as GameState['lastBlastReport'];
    s.command('tick');
    s.run(3);
    expect(s.player.of('blast_cancel')).toHaveLength(0);
  });

  it('calls it a cancel when nothing explains the end', () => {
    const { s } = armed();
    s.run(2);
    s.state.pendingDetonation = null;
    s.run(SIREN_CONFIG.cancelGraceS + 0.3);
    expect(s.player.of('blast_cancel')).toHaveLength(1);
  });

  it('is muted behind a menu', () => {
    const { s } = armed();
    s.run(1, { menuUp: true });
    expect(s.player.bed('blast_siren').level).toBe(0);
  });

  it('is muted, with no beeps, while the game is paused, and resumes with it', () => {
    const { s } = armed();
    s.run(2);
    expect(s.player.bed('blast_siren').level).toBe(1);
    s.state.isPaused = true;
    s.run(1);
    expect(s.player.bed('blast_siren').level).toBe(0);
    s.player.clear();
    s.run(20);
    expect(s.player.of('blast_beep')).toHaveLength(0);
    s.state.isPaused = false;
    s.run(2);
    expect(s.player.bed('blast_siren').level).toBe(1);
    expect(s.player.of('blast_beep').length).toBeGreaterThan(0);
  });
});

describe('GameAudioDirector sky', () => {
  it('rolls thunder after a lightning flash', () => {
    const s = started();
    s.state.weather.current = 'storm';
    s.run(1);
    s.director.onLightning();
    expect(s.player.of('thunder')).toHaveLength(1);
    expect(s.player.of('thunder')[0]?.opts.delayS).toBeGreaterThanOrEqual(AMBIENCE_CONFIG.thunder.minDelayS);
  });

  it('is silent for a flash behind a menu', () => {
    const s = started();
    s.run(1, { menuUp: true });
    s.director.onLightning();
    expect(s.player.plays).toHaveLength(0);
  });

  it('adds the occasional far-off sound while a game runs', () => {
    const s = started();
    s.run(900);
    const far = s.player.plays.filter(p => p.opts.bus === 'ambient');
    expect(far.length).toBeGreaterThan(5);
  });
});

describe('GameAudioDirector robustness', () => {
  it('never lets an audio failure reach the caller, and reports it', () => {
    const s = started();
    s.player.throwOnPlay = true;
    addBuilding(s.state, 'living_quarters', 3, 3);
    expect(() => s.command('tick')).not.toThrow();
    expect(() => s.run(1)).not.toThrow();
    expect(() => s.director.onBlast({ origin: { x: 0, z: 0 }, holeCount: 3, flights: [], report: null })).not.toThrow();
    expect(() => s.director.onLightning()).not.toThrow();
    expect(s.errors.length).toBeGreaterThan(0);
  });

  it('keeps a throwing emitter handler from aborting the tick that emitted', () => {
    const s = started();
    s.player.throwOnDuck = true;
    let reached = false;
    expect(() => {
      s.emitter.emit('level:complete', { levelId: 'a', totalProfit: 1, blastsPerformed: 1, casualties: 0, finalWellBeing: 50, finalEcology: 50, finalSafety: 50, stars: 3 });
      reached = true;
    }).not.toThrow();
    expect(reached).toBe(true);
    expect(s.errors).toHaveLength(1);
  });

  it('reports to the console once when no error handler is given', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const player = new ThrowingPlayer();
      const emitter = new EventEmitter();
      const director = new GameAudioDirector({ player, emitter, random: new Random(1) });
      const state = makeState();
      director.update({ dtS: FRAME, state, menuUp: false, listener: LISTENER });
      player.throwOnDuck = true;
      for (let i = 0; i < 3; i++) {
        director.onBlast({ origin: { x: 0, z: 0 }, holeCount: 1, flights: [], report: null });
      }
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('stops reacting to the game after dispose, and silences every bed', () => {
    const s = started();
    s.state.weather.current = 'heavy_rain';
    s.run(1);
    s.director.dispose();
    expect(s.player.bed('amb_rain_heavy').level).toBe(0);
    expect(s.player.bed('amb_wind').level).toBe(0);
    s.emitter.emit('employee:shift_change', { employeeId: 1 });
    s.run(1);
    expect(s.player.of('shift_bell')).toHaveLength(0);
  });
});
