// BlastSimulator2026 — Play log tests
// The recording decorator: ordering, the cap, passthrough of results, JSON shape, and the NULL player case.

import { describe, it, expect, vi } from 'vitest';
import { RecordingPlayer } from '../../../helpers/audioPlayerFakes.js';
import { createPlayLog, recordAudioPlayer } from '../../../../src/audio/debug/playLog.js';
import { NULL_AUDIO_PLAYER } from '../../../../src/audio/AudioPlayer.js';

function clock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1000;
  return { now: () => t, advance: ms => { t += ms; } };
}

describe('createPlayLog', () => {
  it('keeps the newest records when it passes its capacity, in the same array', () => {
    const log = createPlayLog(3, () => 0);
    const same = log.records;
    for (let i = 0; i < 5; i++) log.push({ atMs: i, kind: 'play', id: `s${i}` });
    expect(log.records).toBe(same);
    expect(log.records.map(r => r.id)).toEqual(['s2', 's3', 's4']);
  });

  it('measures time from its own creation', () => {
    const c = clock();
    const log = createPlayLog(10, c.now);
    c.advance(250.4);
    expect(log.elapsedMs()).toBe(250);
  });
});

describe('recordAudioPlayer', () => {
  it('records plays in call order with their options and returns the wrapped handle', () => {
    const c = clock();
    const log = createPlayLog(50, c.now);
    const player = new RecordingPlayer();
    const rec = recordAudioPlayer(player, log);
    expect(rec.play('ui_click')).toBe(player.plays[0]!.handle);
    c.advance(40);
    rec.play('blast_boom', { at: { x: 3, z: 4 }, gainDb: -2, delayS: 0.5, key: 'k', bus: 'effects' });
    expect(log.records).toEqual([
      { atMs: 0, kind: 'play', id: 'ui_click' },
      { atMs: 40, kind: 'play', id: 'blast_boom', bus: 'effects', at: { x: 3, z: 4 }, gainDb: -2, delayS: 0.5, key: 'k' },
    ]);
  });

  it('leaves undefined options out of the record so it round-trips through JSON unchanged', () => {
    const log = createPlayLog(10, () => 0);
    recordAudioPlayer(new RecordingPlayer(), log).play('ui_click', {});
    expect(Object.keys(log.records[0]!)).toEqual(['atMs', 'kind', 'id']);
    expect(JSON.parse(JSON.stringify(log.records))).toEqual(log.records);
  });

  it('marks a refused play as dropped and still returns null', () => {
    const log = createPlayLog(10, () => 0);
    const refusing = new RecordingPlayer();
    refusing.refuse.add('ui_hover');
    expect(recordAudioPlayer(refusing, log).play('ui_hover')).toBeNull();
    expect(log.records[0]).toEqual({ atMs: 0, kind: 'play', id: 'ui_hover', dropped: true });
  });

  it('records loop requests and level changes, and passes every call through', () => {
    const log = createPlayLog(10, () => 0);
    const player = new RecordingPlayer();
    const rec = recordAudioPlayer(player, log);
    const handle = rec.loop('amb_wind', { level: 0.2, rampS: 1 });
    handle.setLevel(0.5, 2);
    handle.stop(0.3);
    expect(player.bed('amb_wind').calls).toEqual([
      { level: 0.2, rampS: 1 },
      { level: 0.5, rampS: 2 },
      { level: 0, rampS: 0.3 },
    ]);
    expect(log.records).toEqual([
      { atMs: 0, kind: 'loop', id: 'amb_wind', level: 0.2 },
      { atMs: 0, kind: 'level', id: 'amb_wind', level: 0.5 },
    ]);
  });

  it('logs a bed level once when a director restates it every frame', () => {
    const log = createPlayLog(10, () => 0);
    const handle = recordAudioPlayer(new RecordingPlayer(), log).loop('amb_wind');
    handle.setLevel(0.4);
    handle.setLevel(0.4);
    handle.setLevel(0);
    handle.setLevel(0);
    expect(log.records.filter(r => r.kind === 'level').map(r => r.level)).toEqual([0.4, 0]);
  });

  it('records a duck by its bus and depth', () => {
    const log = createPlayLog(10, () => 0);
    const player = new RecordingPlayer();
    recordAudioPlayer(player, log).duck('ambient', -9, 1, 2);
    expect(player.ducks).toEqual([{ bus: 'ambient', amountDb: -9, holdS: 1, releaseS: 2 }]);
    expect(log.records).toEqual([{ atMs: 0, kind: 'duck', id: 'ambient', bus: 'ambient', gainDb: -9 }]);
  });

  it('delegates the listener without logging it, and mirrors `ready`', () => {
    const log = createPlayLog(10, () => 0);
    const inner = new RecordingPlayer();
    inner.ready = false;
    const rec = recordAudioPlayer(inner, log);
    const setListener = vi.spyOn(inner, 'setListener');
    rec.setListener({ x: 1, z: 2, rightX: 1, rightZ: 0, viewDistance: 30 });
    expect(setListener).toHaveBeenCalledOnce();
    expect(log.records).toHaveLength(0);
    expect(rec.ready).toBe(false);
    inner.ready = true;
    expect(rec.ready).toBe(true);
  });

  it('logs the intended sounds on top of the null player, which plays nothing', () => {
    const log = createPlayLog(10, () => 0);
    const rec = recordAudioPlayer(NULL_AUDIO_PLAYER, log);
    expect(rec.play('hire')).toBeNull();
    rec.loop('amb_wind').setLevel(1);
    expect(log.records.map(r => `${r.kind}:${r.id}`)).toEqual(['play:hire', 'loop:amb_wind', 'level:amb_wind']);
    expect(log.records[0]!.dropped).toBe(true);
  });
});
