// BlastSimulator2026 — The crowding harness measures what it says it measures
// The recorder must admit and refuse sounds the way the real engine does, the statistics must count windows
// and overlaps correctly, and the simulated render loop must tick the game once per real second at the chosen
// speed. Without these, the numbers in the other crowding tests would mean nothing.

import { beforeAll, describe, expect, it } from 'vitest';
import { SOUND_CATALOG } from '../../../../src/audio/SoundCatalog.js';
import { BLAST_TAIL_CONFIG } from '../../../../src/core/config/audio/synth.js';
import { CrowdRecorder, CrowdSim, soundDurationS } from '../../../helpers/audioCrowding.js';
import { formatStats, isBlastSound, maxInWindow, maxOverlap, peakIn, summarize } from '../../../helpers/audioCrowdingStats.js';
import { listenerAt } from '../director/helpers.js';

describe('soundDurationS', () => {
  it('reads a sample from its MP3 header and a synthesized sound from its recipe config', () => {
    expect(soundDurationS('blast_tail')).toBe(BLAST_TAIL_CONFIG.durationSec);
    expect(soundDurationS('ui_click')).toBeGreaterThan(0.01);
    expect(soundDurationS('ui_click')).toBeLessThan(1);
    expect(soundDurationS('thunder')).toBeGreaterThan(5);
  });

  it('knows a duration for every one-shot in the catalog', () => {
    for (const [id, def] of Object.entries(SOUND_CATALOG)) {
      if ('loop' in def) continue;
      expect(soundDurationS(id as Parameters<typeof soundDurationS>[0]), id).toBeGreaterThan(0);
    }
  });
});

describe('CrowdRecorder admission', () => {
  it('refuses a repeat inside the cooldown and admits it after', () => {
    const recorder = new CrowdRecorder();
    expect(recorder.play('ui_denied')).not.toBeNull();
    recorder.advance(0.05);
    expect(recorder.play('ui_denied')).toBeNull();
    recorder.advance(SOUND_CATALOG.ui_denied.cooldownMs / 1000 + 0.01);
    expect(recorder.play('ui_denied')).not.toBeNull();
    expect(recorder.plays.map(p => [p.accepted, p.dropReason])).toEqual([[true, null], [false, 'budget'], [true, null]]);
  });

  it('caps the voices of one sound until the first one has finished', () => {
    const recorder = new CrowdRecorder();
    const cap = SOUND_CATALOG.debris_pebble.maxVoices;
    for (let i = 0; i < cap + 2; i++) recorder.play('debris_pebble', { key: `k${i}` });
    expect(recorder.heard).toHaveLength(cap);
    recorder.advance(soundDurationS('debris_pebble') + 0.01);
    expect(recorder.play('debris_pebble', { key: 'later' })).not.toBeNull();
  });

  it('frees the slot of a stopped voice at once', () => {
    const recorder = new CrowdRecorder();
    const handle = recorder.play('ui_invalid');
    recorder.advance(SOUND_CATALOG.ui_invalid.cooldownMs / 1000 + 0.01);
    expect(recorder.play('ui_invalid')).toBeNull();
    handle?.stop();
    expect(recorder.play('ui_invalid')).not.toBeNull();
  });

  it('culls a positional sound far from the listener and ignores a position on a flat one', () => {
    const recorder = new CrowdRecorder();
    recorder.setListener(listenerAt(0, 0, 40));
    expect(recorder.play('building_built', { at: { x: 5000, z: 0 } })).toBeNull();
    expect(recorder.plays[0]).toMatchObject({ accepted: false, dropReason: 'culled' });
    expect(recorder.play('building_built', { at: { x: 5, z: 0 } })).not.toBeNull();
    expect(recorder.play('ui_confirm', { at: { x: 5000, z: 0 } })).not.toBeNull();
  });

  it('records when a delayed sound starts, its bus, its source and the command in progress', () => {
    const recorder = new CrowdRecorder();
    recorder.advance(10);
    recorder.source = 'command';
    recorder.commandIndex = 4;
    recorder.play('thunder', { delayS: 1.5, bus: 'effects' });
    expect(recorder.plays[0]).toMatchObject({ tS: 10, startS: 11.5, bus: 'effects', source: 'command', commandIndex: 4, key: 'thunder' });
  });

  it('records bed levels and ducks', () => {
    const recorder = new CrowdRecorder();
    recorder.advance(2);
    const bed = recorder.loop('amb_wind', { level: 0.3 });
    bed.setLevel(0.5);
    bed.stop();
    recorder.duck('ambient', -8);
    expect(recorder.beds.map(b => b.level)).toEqual([0.3, 0.5, 0]);
    expect(recorder.ducks).toEqual([{ bus: 'ambient', tS: 2, amountDb: -8 }]);
  });
});

describe('statistics', () => {
  it('counts the most points in any window', () => {
    expect(maxInWindow([])).toBe(0);
    expect(maxInWindow([0, 0.2, 0.4, 5, 5.1])).toBe(3);
    expect(maxInWindow([0, 1, 2, 3], 1)).toBe(1);
    expect(maxInWindow([0, 1, 2, 3], 2.5)).toBe(3);
    expect(peakIn([{ startS: 9 }, { startS: 1 }, { startS: 1.5 }], 1)).toBe(2);
  });

  it('counts the most sounds playing at one instant, a sound ending as another starts not overlapping', () => {
    expect(maxOverlap([])).toBe(0);
    expect(maxOverlap([{ startS: 0, durationS: 2 }, { startS: 1, durationS: 2 }, { startS: 1.5, durationS: 0.1 }])).toBe(3);
    expect(maxOverlap([{ startS: 0, durationS: 1 }, { startS: 1, durationS: 1 }])).toBe(1);
  });

  it('sums plays per minute, per sound and per bus, counting only what the engine admitted as heard', () => {
    const recorder = new CrowdRecorder();
    for (let i = 0; i < 6; i++) {
      recorder.advance(i * 10);
      recorder.play('ui_confirm');
    }
    recorder.play('ui_confirm'); // same instant as the last: inside the cooldown, refused
    const stats = summarize(recorder.plays, 60);
    expect(stats.requested).toBe(7);
    expect(stats.heard).toBe(6);
    expect(stats.totalPerMinute).toBe(6);
    expect(stats.perMinuteByBus.ui).toBe(6);
    expect(stats.byId.get('ui_confirm')).toMatchObject({ requested: 7, heard: 6, perMinute: 6, maxPerSecond: 1 });
    expect(formatStats('run', stats)).toContain('ui_confirm');
  });

  it('knows which sounds belong to a blast', () => {
    expect(['blast_boom', 'debris_hit', 'blast_cancel'].every(isBlastSound)).toBe(true);
    expect(['haul_load', 'ui_click'].some(isBlastSound)).toBe(false);
  });
});

/** A bare mine started and running at `speed`, the way a player begins. */
function startedGame(speed: 1 | 2 | 4 | 8): CrowdSim {
  const sim = new CrowdSim({ speed });
  sim.command('new_game seed:42');
  sim.chooseSpeed();
  sim.command('time resume');
  return sim;
}

describe('CrowdSim time', () => {
  let sim: CrowdSim;

  beforeAll(() => {
    sim = startedGame(4);
  }, 30_000);

  it('plays the game at the chosen speed: one `tick <speed>` command each real second', () => {
    const start = sim.state!.tickCount;
    const commandsBefore = sim.commands.length;
    sim.seconds(5);
    expect(sim.state!.timeScale).toBe(4);
    expect(sim.state!.tickCount - start).toBe(20);
    expect(sim.commands.slice(commandsBefore)).toEqual(Array(5).fill('tick 4'));
  });

  it('chooses the speed once, with the player command that voices it', () => {
    sim.chooseSpeed();
    expect(sim.commands.filter(c => c.startsWith('time speed'))).toEqual(['time speed 4']);
    expect(sim.recorder.plays.filter(p => p.id === 'ui_tab')).toHaveLength(1);
  });

  it('waits an exact number of ticks whatever the speed, and until a condition holds or its budget is spent', () => {
    const tick = sim.state!.tickCount;
    sim.waitTicks(10);
    expect(sim.state!.tickCount).toBe(tick + 10);
    const goal = sim.state!.tickCount + 5;
    expect(sim.waitUntil(() => sim.state!.tickCount >= goal, 50)).toBe(true);
    expect(sim.waitUntil(() => false, 4)).toBe(false);
  });
});

describe('CrowdSim player', () => {
  let sim: CrowdSim;

  beforeAll(() => {
    sim = startedGame(1);
  }, 30_000);

  it('freezes the game while the player types, and while a menu is up, but lets the audio frames run', () => {
    const tick = sim.state!.tickCount;
    const before = sim.realS;
    sim.command('time resume', 600);
    expect(sim.state!.tickCount).toBe(tick);
    expect(sim.realS - before).toBeCloseTo(10, 1);
    sim.menuUp = true;
    sim.seconds(5);
    expect(sim.state!.tickCount).toBe(tick);
    sim.menuUp = false;
    sim.seconds(2);
    expect(sim.state!.tickCount).toBe(tick + 2);
  });

  it('voices a refused command as a denial, but not an optional one that found no button', () => {
    const before = sim.realS;
    const denials = (): number => sim.recorder.plays.filter(p => p.id === 'ui_denied').length;
    sim.command('contract accept no_such_contract', 30, true);
    expect(denials()).toBe(0);
    expect(sim.realS).toBe(before);
    expect(sim.refused).toEqual([]);
    sim.command('contract accept no_such_contract', 30);
    expect(denials()).toBe(1);
    expect(sim.refused).toHaveLength(1);
    expect(sim.realS).toBeGreaterThan(before);
  });

  it('does not wait for ever on a paused game', () => {
    sim.command('time pause');
    const tick = sim.state!.tickCount;
    const before = sim.realS;
    sim.waitTicks(100);
    expect(sim.state!.tickCount).toBe(tick);
    expect(sim.realS - before).toBeLessThan(1);
  });
});

describe('CrowdSim blast', () => {
  it('reports a blast to the director once, at the instant the shot lands', () => {
    const sim = new CrowdSim({ speed: 8 });
    sim.command('campaign start level:dusty_hollow');
    sim.chooseSpeed();
    sim.command('time resume');
    sim.command('drill_plan grid rows:1 cols:2 spacing:3 depth:6 start:15,15');
    sim.waitUntil(() => sim.state!.plannedDrillHoles.length === 0, 900);
    sim.command('charge hole:* explosive:boomite amount:5 stemming:2');
    sim.waitUntil(() => Object.keys(sim.state!.plannedChargesByHole).length === 0, 3000);
    sim.command('weather set sunny');
    sim.command('blast detonate');
    sim.waitUntil(() => sim.state!.drillHoles.length === 0, 600);
    expect(sim.recorder.plays.filter(p => p.id === 'blast_snap')).toHaveLength(1);
  }, 30_000);
});
