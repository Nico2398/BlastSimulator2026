// BlastSimulator2026 — Mix event dispatch and the live timeline runner

import { describe, expect, it, vi } from 'vitest';
import { dispatchMixEvent, DispatchTally } from '../../../../src/audio/lab/mixDispatch.js';
import { LiveTimeline } from '../../../../src/audio/lab/liveTimeline.js';
import { TimelineBuilder } from '../../../../src/audio/lab/timeline.js';
import { RecordingPlayer } from '../../../helpers/audioPlayerFakes.js';

describe('dispatchMixEvent', () => {
  it('plays a one-shot with the delay and its options', () => {
    const player = new RecordingPlayer();
    const outcome = dispatchMixEvent(player, { kind: 'play', t: 3, id: 'ui_click', opts: { gainDb: -3, key: 'k' } }, 0.25);
    expect(player.calls).toEqual([{ id: 'ui_click', opts: { gainDb: -3, key: 'k', delayS: 0.25 } }]);
    expect(outcome).toMatchObject({ id: 'ui_click', dropped: false, isPlay: true });
  });

  it('never asks for a negative delay', () => {
    const player = new RecordingPlayer();
    dispatchMixEvent(player, { kind: 'play', t: 0, id: 'ui_click' }, -0.2);
    expect(player.plays[0]?.opts?.delayS).toBe(0);
  });

  it('reports a refused play as dropped', () => {
    const player = new RecordingPlayer();
    player.refuse.add('ui_click');
    expect(dispatchMixEvent(player, { kind: 'play', t: 0, id: 'ui_click' }, 0).dropped).toBe(true);
  });

  it('sets a bed level and returns the bed', () => {
    const player = new RecordingPlayer();
    const outcome = dispatchMixEvent(player, { kind: 'loop', t: 0, id: 'amb_wind', level: 0.4, rampS: 2 }, 0);
    expect(player.bed('amb_wind').calls).toEqual([{ level: 0.4, rampS: 2 }]);
    expect(outcome.bed).toBeDefined();
    expect(outcome.isPlay).toBe(false);
  });

  it('ducks a bus', () => {
    const player = new RecordingPlayer();
    const outcome = dispatchMixEvent(player, { kind: 'duck', t: 0, bus: 'ambient', amountDb: -12, holdS: 1, releaseS: 2 }, 0);
    expect(player.ducks).toEqual([{ bus: 'ambient', amountDb: -12, holdS: 1, releaseS: 2 }]);
    expect(outcome.id).toBe('');
  });
});

describe('DispatchTally', () => {
  it('counts requested and dropped one-shots by id, most dropped first', () => {
    const tally = new DispatchTally();
    tally.record({ id: 'a', dropped: false, isPlay: true });
    tally.record({ id: 'b', dropped: true, isPlay: true });
    tally.record({ id: 'c', dropped: true, isPlay: true });
    tally.record({ id: 'c', dropped: true, isPlay: true });
    tally.record({ id: 'amb_wind', dropped: false, isPlay: false });
    expect(tally.requested).toBe(4);
    expect(tally.dropped).toBe(3);
    expect(Object.entries(tally.droppedByIdRecord())).toEqual([['c', 2], ['b', 1]]);
  });
});

describe('LiveTimeline', () => {
  const events = new TimelineBuilder()
    .loop(0, 'amb_wind', 0.5, 1)
    .play(0.2, 'ui_click')
    .play(1, 'ui_open')
    .play(5, 'ui_close')
    .build();
  const options = (player: RecordingPlayer, onFinished?: () => void) => ({ player, events, durationS: 3, lookaheadS: 0.1, releaseS: 0.5, ...(onFinished ? { onFinished } : {}) });

  it('books each event shortly before it is due, with the remaining time as its delay', () => {
    const player = new RecordingPlayer();
    const run = new LiveTimeline(options(player));
    run.start(100);
    expect(player.plays).toEqual([]);
    expect(player.lastLevel('amb_wind')).toBe(0.5);
    run.update(100.15);
    expect(player.plays).toHaveLength(1);
    expect(player.plays[0]?.opts?.delayS).toBeCloseTo(0.05, 5);
    run.update(100.95);
    expect(player.plays.map(p => p.id)).toEqual(['ui_click', 'ui_open']);
    expect(run.running).toBe(true);
  });

  it('ignores events beyond its duration and fades the beds out when it ends', () => {
    const player = new RecordingPlayer();
    const onFinished = vi.fn();
    const run = new LiveTimeline(options(player, onFinished));
    run.start(0);
    run.update(1);
    run.update(3);
    expect(run.running).toBe(false);
    expect(player.plays.map(p => p.id)).toEqual(['ui_click', 'ui_open']);
    expect(player.bed('amb_wind').calls.at(-1)).toEqual({ level: 0, rampS: 0.5 });
    expect(onFinished).toHaveBeenCalledTimes(1);
    run.update(10);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('stops on request, once', () => {
    const player = new RecordingPlayer();
    const onFinished = vi.fn();
    const run = new LiveTimeline(options(player, onFinished));
    run.stop();
    expect(onFinished).not.toHaveBeenCalled();
    run.start(0);
    run.stop();
    run.stop();
    expect(run.running).toBe(false);
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(player.lastLevel('amb_wind')).toBe(0);
  });

  it('tallies what the player refused', () => {
    const player = new RecordingPlayer();
    player.refuse.add('ui_click');
    const run = new LiveTimeline(options(player));
    run.start(0);
    run.update(2);
    expect(run.tally.requested).toBe(2);
    expect(run.tally.dropped).toBe(1);
  });

  it('does nothing before it is started', () => {
    const player = new RecordingPlayer();
    new LiveTimeline(options(player)).update(5);
    expect(player.plays).toEqual([]);
  });
});
