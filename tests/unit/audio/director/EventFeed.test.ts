import { describe, it, expect } from 'vitest';
import { EventEmitter } from '../../../../src/core/state/EventEmitter.js';
import { EventFeed } from '../../../../src/audio/director/EventFeed.js';
import { LevelStings } from '../../../../src/audio/director/LevelStings.js';
import { Subscriptions } from '../../../../src/audio/director/Subscriptions.js';
import { DIRECTOR_CONFIG, EVENT_CUES, FLAG_CUES, HAUL_BUDGET_CONFIG } from '../../../../src/core/config/audio/game.js';
import { addEmployee, addVehicle, listenerAt, makeHarness, makeState, type Harness } from './helpers.js';
import type { GameState } from '../../../../src/core/state/GameState.js';

interface Fixture {
  readonly h: Harness;
  readonly emitter: EventEmitter;
  readonly feed: EventFeed;
  readonly state: GameState;
  readonly errors: unknown[];
}

function fixture(): Fixture {
  const state = makeState();
  const h = makeHarness({ state, listener: listenerAt(0, 0, 40) });
  const emitter = new EventEmitter();
  const errors: unknown[] = [];
  const feed = new EventFeed(h.env, new LevelStings(h.env));
  feed.attach(new Subscriptions(emitter, e => errors.push(e)));
  return { h, emitter, feed, state, errors };
}

/** The cues that spend the shared hauling budget (the backup alarm that goes with them does not). */
const HAULING = new Set(['haul_load', 'haul_dump', 'boulder_break']);
const hauling = (h: Harness): Harness['player']['plays'] => h.player.plays.filter(p => HAULING.has(p.id));

describe('EventFeed hauling', () => {
  it('plays a bounded number of loads for a hundred hauls in one burst, nearest first', () => {
    const { h, emitter, feed, state } = fixture();
    const trucks = Array.from({ length: 100 }, (_, i) => addVehicle(state, 'debris_hauler', 1 + i * 0.5, 0));
    for (const truck of [...trucks].reverse()) emitter.emit('vehicle:haul_loaded', { vehicleId: truck.id, fragmentId: truck.id });
    feed.flush();
    const loads = h.player.of('haul_load');
    expect(loads).toHaveLength(EVENT_CUES.haulLoad.maxPerFlush);
    expect(loads.map(p => p.opts.at?.x)).toEqual([1, 1.5]);
  });

  it('plays dumps and boulder breaks from their own events', () => {
    const { h, emitter, feed, state } = fixture();
    const truck = addVehicle(state, 'debris_hauler', 3, 3);
    emitter.emit('vehicle:haul_delivered', { vehicleId: truck.id, fragmentId: 1 });
    emitter.emit('vehicle:boulder_broken', { vehicleId: truck.id, fragmentId: 1, pieceIds: [2, 3] });
    feed.flush();
    expect(h.player.ids).toEqual(['haul_dump', 'vehicle_reverse', 'boulder_break']);
  });

  it('spends one shared budget, so a long busy spell stays a texture', () => {
    const { h, emitter, feed, state } = fixture();
    for (let burst = 0; burst < 20; burst++) {
      const truck = addVehicle(state, 'debris_hauler', 2, burst);
      emitter.emit('vehicle:haul_loaded', { vehicleId: truck.id, fragmentId: 0 });
      emitter.emit('vehicle:haul_delivered', { vehicleId: truck.id, fragmentId: 0 });
      feed.flush();
    }
    expect(hauling(h)).toHaveLength(HAUL_BUDGET_CONFIG.capacity);
    feed.update(2);
    const truck = addVehicle(state, 'debris_hauler', 2, 30);
    emitter.emit('vehicle:haul_loaded', { vehicleId: truck.id, fragmentId: 0 });
    feed.flush();
    expect(hauling(h)).toHaveLength(HAUL_BUDGET_CONFIG.capacity + 1);
  });

  it('keeps one vehicle to one cue per cooldown, in real time', () => {
    const { h, emitter, feed, state } = fixture();
    const truck = addVehicle(state, 'debris_hauler', 2, 2);
    const haul = (): void => {
      emitter.emit('vehicle:haul_loaded', { vehicleId: truck.id, fragmentId: 0 });
      feed.flush();
      feed.update(0.01);
    };
    haul();
    h.advance(EVENT_CUES.haulLoad.entityCooldownS - 0.1);
    haul();
    expect(h.player.of('haul_load')).toHaveLength(1);
    h.advance(0.2);
    haul();
    expect(h.player.of('haul_load')).toHaveLength(2);
  });

  it('drops hauls out of earshot or from vehicles it cannot place', () => {
    const { h, emitter, feed, state } = fixture();
    const far = addVehicle(state, 'debris_hauler', 5000, 0);
    emitter.emit('vehicle:haul_loaded', { vehicleId: far.id, fragmentId: 0 });
    emitter.emit('vehicle:haul_loaded', { vehicleId: 9999, fragmentId: 0 });
    feed.flush();
    expect(h.player.plays).toHaveLength(0);
  });

  it('forgets what it was asked once flushed', () => {
    const { h, emitter, feed, state } = fixture();
    const truck = addVehicle(state, 'debris_hauler', 2, 2);
    emitter.emit('vehicle:haul_loaded', { vehicleId: truck.id, fragmentId: 0 });
    feed.flush();
    h.advance(100);
    feed.flush();
    expect(h.player.ids).toEqual(['haul_load', 'vehicle_reverse']);
  });

  it('remembers at most a bounded number of vehicles per burst', () => {
    const state = makeState();
    let lookups = 0;
    const h = makeHarness({ state, entityPosition: () => { lookups++; return { x: 1, z: 1 }; } });
    const emitter = new EventEmitter();
    const feed = new EventFeed(h.env, new LevelStings(h.env));
    feed.attach(new Subscriptions(emitter, () => undefined));
    for (let id = 1; id <= DIRECTOR_CONFIG.maxPendingEntities + 300; id++) emitter.emit('vehicle:haul_loaded', { vehicleId: id, fragmentId: 0 });
    feed.flush();
    // A haul marks two intents (the load and the backup alarm); each remembers at most maxPendingEntities vehicles.
    expect(lookups).toBeLessThanOrEqual(DIRECTOR_CONFIG.maxPendingEntities * 2 * 2);
  });

  it('sounds a backup alarm with the hauling, one truck at a time and spaced well apart, outside the hauling budget', () => {
    const { h, emitter, feed, state } = fixture();
    const haul = (y: number): void => {
      const truck = addVehicle(state, 'debris_hauler', 2, y);
      emitter.emit('vehicle:haul_loaded', { vehicleId: truck.id, fragmentId: 0 });
      emitter.emit('vehicle:haul_delivered', { vehicleId: truck.id, fragmentId: 0 });
      feed.flush();
    };
    for (let burst = 0; burst < 10; burst++) {
      haul(burst);
      h.advance(1);
    }
    expect(h.player.of('vehicle_reverse')).toHaveLength(1);
    h.advance(EVENT_CUES.reverse.spacingS);
    haul(20);
    expect(h.player.of('vehicle_reverse')).toHaveLength(2);
    expect(EVENT_CUES.reverse.spacingS).toBeGreaterThanOrEqual(10);
  });
});

describe('EventFeed vehicles and crew', () => {
  it('starts an engine when a driver mounts, once per vehicle per cooldown', () => {
    const { h, emitter, feed, state } = fixture();
    const truck = addVehicle(state, 'drill_rig', 4, 4);
    emitter.emit('employee:mounted', { employeeId: 1, vehicleId: truck.id });
    feed.flush();
    emitter.emit('employee:mounted', { employeeId: 1, vehicleId: truck.id });
    feed.flush();
    expect(h.player.ids).toEqual(['vehicle_start']);
  });

  it('honks a stuck vehicle at most every half minute', () => {
    const { h, emitter, feed, state } = fixture();
    const truck = addVehicle(state, 'debris_hauler', 4, 4);
    for (let second = 0; second < 40; second++) {
      emitter.emit('vehicle:stuck', { vehicleId: truck.id });
      feed.flush();
      h.advance(1);
    }
    expect(h.player.of('vehicle_horn')).toHaveLength(2);
  });

  it('plays a collapse where the worker fell', () => {
    const { h, emitter, feed, state } = fixture();
    const worker = addEmployee(state, 6, 7);
    emitter.emit('employee:collapsed', { employeeId: worker.id, needKey: 'fatigue' });
    feed.flush();
    expect(h.player.ids).toEqual(['worker_collapse']);
    expect(h.player.plays[0]?.opts.at).toEqual({ x: 6, z: 7 });
  });

  it('falls back to a muted alert for a collapse nobody can see, once per cooldown', () => {
    const { h, emitter, feed, state } = fixture();
    const worker = addEmployee(state, 9000, 0);
    for (let i = 0; i < 3; i++) {
      emitter.emit('employee:collapsed', { employeeId: worker.id, needKey: 'fatigue' });
      feed.flush();
    }
    expect(h.player.ids).toEqual(['notify_bad']);
    expect(h.player.plays[0]?.opts.gainDb).toBe(FLAG_CUES.offscreenCollapse.gainDb);
    expect(h.player.plays[0]?.opts.at).toBeUndefined();
  });
});

describe('EventFeed one-per-burst cues', () => {
  it('rings one bell for a whole crew changing shift, then not again within the cooldown', () => {
    const { h, emitter, feed } = fixture();
    for (let id = 1; id <= 50; id++) emitter.emit('employee:shift_change', { employeeId: id });
    feed.flush();
    for (let id = 1; id <= 50; id++) emitter.emit('employee:shift_change', { employeeId: id });
    feed.flush();
    expect(h.player.ids).toEqual(['shift_whistle']);
    h.advance(FLAG_CUES.shiftWhistle.cooldownS);
    emitter.emit('employee:shift_change', { employeeId: 1 });
    feed.flush();
    expect(h.player.ids).toEqual(['shift_whistle', 'shift_whistle']);
  });

  it('plays one level-up for a burst of promotions and one unlock for finished research', () => {
    const { h, emitter, feed } = fixture();
    for (let id = 1; id <= 20; id++) emitter.emit('employee:levelup', { employeeId: id, category: 'driving.drill_rig', oldLevel: 1, newLevel: 2 });
    emitter.emit('research:completed', { targetType: 'living_quarters', targetTier: 2 });
    feed.flush();
    expect(h.player.ids.sort()).toEqual(['level_up', 'unlock']);
  });

  it('does nothing until flushed, and nothing after being cleared', () => {
    const { h, emitter, feed } = fixture();
    emitter.emit('employee:shift_change', { employeeId: 1 });
    expect(h.player.plays).toHaveLength(0);
    feed.clear();
    feed.flush();
    expect(h.player.plays).toHaveLength(0);
  });

  it('gives the budget back on reset', () => {
    const { h, emitter, feed, state } = fixture();
    for (let burst = 0; burst < HAUL_BUDGET_CONFIG.capacity + 2; burst++) {
      const truck = addVehicle(state, 'debris_hauler', 2, burst);
      emitter.emit('vehicle:haul_loaded', { vehicleId: truck.id, fragmentId: 0 });
      feed.flush();
    }
    feed.reset();
    const truck = addVehicle(state, 'debris_hauler', 2, 50);
    emitter.emit('vehicle:haul_loaded', { vehicleId: truck.id, fragmentId: 0 });
    feed.flush();
    expect(hauling(h)).toHaveLength(HAUL_BUDGET_CONFIG.capacity + 1);
  });
});

describe('EventFeed stings', () => {
  it('plays the win sting on level completion', () => {
    const { h, emitter } = fixture();
    emitter.emit('level:complete', { levelId: 'a', totalProfit: 1, blastsPerformed: 1, casualties: 0, finalWellBeing: 50, finalEcology: 50, finalSafety: 50, stars: 3 });
    expect(h.player.ids).toEqual(['level_win']);
  });

  it.each([
    ['bankruptcy:triggered', { cash: -1 }],
    ['arrest:triggered', { exposure: 1 }],
    ['ecology:shutdown', {}],
    ['revolt:triggered', {}],
  ] as const)('plays the lose sting on %s, once per level', (event, payload) => {
    const { h, emitter } = fixture();
    emitter.emit(event, payload as never);
    emitter.emit('revolt:triggered', {});
    expect(h.player.ids).toEqual(['level_lose']);
  });
});
