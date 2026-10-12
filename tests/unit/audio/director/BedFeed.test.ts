import { describe, it, expect } from 'vitest';
import { BedFeed } from '../../../../src/audio/director/BedFeed.js';
import { RecordedLoop } from '../../../helpers/audioPlayerFakes.js';

describe('BedFeed', () => {
  it('sends a level that moved by at least the epsilon, with its ramp', () => {
    const loop = new RecordedLoop();
    const feed = new BedFeed(loop, 0.1);
    feed.set(0.5, 2);
    feed.set(0.62, 3);
    expect(loop.calls).toEqual([{ level: 0.5, rampS: 2 }, { level: 0.62, rampS: 3 }]);
  });

  it('holds back a change smaller than the epsilon, measured from the last level sent', () => {
    const loop = new RecordedLoop();
    const feed = new BedFeed(loop, 0.1);
    feed.set(0.5, 1);
    feed.set(0.55, 1);
    feed.set(0.45, 1);
    expect(loop.calls).toHaveLength(1);
    feed.set(0.59, 1);
    feed.set(0.61, 1);
    expect(loop.calls.map(c => c.level)).toEqual([0.5, 0.61]);
  });

  it('always sends the final zero, however small the step down to it', () => {
    const loop = new RecordedLoop();
    const feed = new BedFeed(loop, 0.1);
    feed.set(0.04, 1);
    expect(loop.calls).toHaveLength(0);
    feed.set(0.3, 1);
    feed.set(0.25, 1);
    feed.set(0, 1);
    expect(loop.calls.at(-1)).toEqual({ level: 0, rampS: 1 });
    feed.set(0, 1);
    expect(loop.calls).toHaveLength(2);
  });

  it('sends the zero after a level below the epsilon was sent', () => {
    const loop = new RecordedLoop();
    const feed = new BedFeed(loop, 0.1);
    feed.set(0.1, 1);
    feed.set(0, 1);
    expect(loop.calls.map(c => c.level)).toEqual([0.1, 0]);
  });

  it('with no epsilon sends every change and nothing else', () => {
    const loop = new RecordedLoop();
    const feed = new BedFeed(loop, 0);
    feed.set(0, 1);
    feed.set(1, 1);
    feed.set(1, 1);
    feed.set(0.999, 1);
    expect(loop.calls.map(c => c.level)).toEqual([1, 0.999]);
  });

  it('opens a lazy bed with its first level only', () => {
    let opened = 0;
    const loop = new RecordedLoop();
    const feed = new BedFeed(() => { opened++; return loop; }, 0.1);
    feed.set(0, 1);
    expect(opened).toBe(0);
    feed.set(1, 1);
    feed.set(0, 1);
    expect(opened).toBe(1);
    expect(loop.calls.map(c => c.level)).toEqual([1, 0]);
  });
});
