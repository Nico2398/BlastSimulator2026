// BlastSimulator2026 — The director's real-time spacing, found missing by the crowding audit
// Per-entity cues (collapse, vehicle start) were spaced only per entity, so a big crew at 8x repeated them as
// fast as the entities took turns. They are now also spaced across entities, in real seconds. And a blast in
// flight books nothing more once a full-screen menu is up.

import { describe, expect, it } from 'vitest';
import { BlastAudio } from '../../../../src/audio/director/BlastAudio.js';
import type { BlastInfo } from '../../../../src/audio/director/blastPlan.js';
import { EventFeed } from '../../../../src/audio/director/EventFeed.js';
import { LevelStings } from '../../../../src/audio/director/LevelStings.js';
import { CooldownGate } from '../../../../src/audio/director/rateLimit.js';
import { Subscriptions } from '../../../../src/audio/director/Subscriptions.js';
import { EVENT_CUES, FLAG_CUES } from '../../../../src/core/config/audio/game.js';
import { EventEmitter } from '../../../../src/core/state/EventEmitter.js';
import { addEmployee, addVehicle, fallingTo, listenerAt, makeHarness, makeState } from '../director/helpers.js';

function feedFixture() {
  const state = makeState();
  const h = makeHarness({ state, listener: listenerAt(0, 0, 40) });
  const emitter = new EventEmitter();
  const feed = new EventFeed(h.env, new LevelStings(h.env));
  feed.attach(new Subscriptions(emitter, error => { throw error; }));
  return { h, emitter, feed, state };
}

describe('CooldownGate.isReady', () => {
  it('reports a key off cooldown without starting one', () => {
    let now = 0;
    const gate = new CooldownGate(() => now);
    expect(gate.isReady('a')).toBe(true);
    expect(gate.isReady('a')).toBe(true);
    gate.tryPass('a', 2);
    expect(gate.isReady('a')).toBe(false);
    now = 2;
    expect(gate.isReady('a')).toBe(true);
  });
});

describe('EventFeed spacing across entities', () => {
  it('lets one vehicle start through per spacing however many take turns, then the next after it', () => {
    const { h, emitter, feed, state } = feedFixture();
    const trucks = Array.from({ length: 6 }, (_, i) => addVehicle(state, 'debris_hauler', 3 + i, 0));
    // One truck starts every second for six seconds: the sixth second is past the 5 s spacing.
    for (const truck of trucks) {
      emitter.emit('employee:mounted', { employeeId: 1, vehicleId: truck.id });
      feed.flush();
      h.advance(1);
    }
    expect(h.player.of('vehicle_start')).toHaveLength(2);
    expect(EVENT_CUES.vehicleStart.spacingS).toBe(5);
  });

  it('spaces collapses of different workers, and stays silent rather than falling back to the muted alert', () => {
    const { h, emitter, feed, state } = feedFixture();
    const workers = Array.from({ length: 5 }, (_, i) => addEmployee(state, 4 + i, 4));
    for (const worker of workers) {
      emitter.emit('employee:collapsed', { employeeId: worker.id, needKey: 'fatigue' });
      feed.flush();
      h.advance(1);
    }
    // Five collapses in five seconds: one thud, and no `notify_bad` stand-in for the four near ones it spaced out.
    expect(h.player.ids).toEqual(['worker_collapse']);
    h.advance(EVENT_CUES.collapse.spacingS);
    emitter.emit('employee:collapsed', { employeeId: workers[4]!.id, needKey: 'fatigue' });
    feed.flush();
    expect(h.player.ids).toEqual(['worker_collapse', 'worker_collapse']);
  });

  it('still raises the muted alert for a collapse nobody can see', () => {
    const { h, emitter, feed, state } = feedFixture();
    const far = addEmployee(state, 9000, 0);
    emitter.emit('employee:collapsed', { employeeId: far.id, needKey: 'fatigue' });
    feed.flush();
    expect(h.player.ids).toEqual(['notify_bad']);
    expect(h.player.plays[0]?.opts.gainDb).toBe(FLAG_CUES.offscreenCollapse.gainDb);
  });

  it('leaves unspaced intents alone: two haulers load in consecutive flushes', () => {
    const { h, emitter, feed, state } = feedFixture();
    for (const x of [3, 4]) {
      const truck = addVehicle(state, 'debris_hauler', x, 0);
      emitter.emit('vehicle:haul_loaded', { vehicleId: truck.id, fragmentId: 1 });
      feed.flush();
    }
    expect(EVENT_CUES.haulLoad.spacingS).toBe(0);
    expect(h.player.of('haul_load')).toHaveLength(2);
  });
});

describe('BlastAudio.hush', () => {
  const info: BlastInfo = {
    origin: { x: 5, z: 5 },
    holeCount: 20,
    flights: Array.from({ length: 300 }, (_, i) => fallingTo({ x: 5 + (i % 7), z: 5 + (i % 5) }, { delayS: 0, durationS: 0.5 + i * 0.03, impactSpeed: 30 })),
    report: null,
  };

  it('keeps the shot already booked but books none of the rain still to come', () => {
    const h = makeHarness({ seed: 4 });
    const blast = new BlastAudio(h.env, () => undefined);
    blast.play(info, 100);
    const rain = () => h.player.plays.filter(p => p.id.startsWith('debris')).length;
    const bookedAtShot = h.player.plays.length;
    const rainAtShot = rain();
    blast.hush();
    for (let frame = 0; frame < 60 * 12; frame++) {
      h.advance(1 / 60);
      blast.update(1 / 60);
    }
    expect(bookedAtShot).toBeGreaterThanOrEqual(4);
    expect(rain()).toBe(rainAtShot);
    // The tail is not rain: it may still be booked after the hush.
    expect(h.player.of('blast_tail')).toHaveLength(1);
  });
});
