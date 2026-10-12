import { describe, it, expect } from 'vitest';
import { jumpTo, rampTo, smoothTo } from '../../../../src/audio/engine/audioParams.js';
import { FakeParam } from '../../../helpers/audioFakes.js';

function param(initial: number, now = 0): { p: FakeParam; asParam: AudioParam } {
  const p = new FakeParam(initial, { currentTime: now });
  return { p, asParam: p as unknown as AudioParam };
}

describe('audioParams', () => {
  it('smoothTo drops queued automation, pins the current value and approaches the target', () => {
    const { p, asParam } = param(0.5);
    smoothTo(asParam, 1, 2, 0.03);
    expect(p.events.map(e => e.type)).toEqual(['cancel', 'set', 'target']);
    expect(p.events[1]).toMatchObject({ value: 0.5, time: 2 });
    expect(p.events[2]).toMatchObject({ value: 1, time: 2, timeConstant: 0.03 });
  });

  it('jumpTo sets the value at once', () => {
    const { p, asParam } = param(1);
    jumpTo(asParam, 0, 0);
    expect(p.value).toBe(0);
    expect(p.events.map(e => e.type)).toEqual(['cancel', 'set']);
  });

  it('rampTo arrives at the target after the duration', () => {
    const { p, asParam } = param(0.2, 1);
    rampTo(asParam, 0, 1, 0.5);
    expect(p.events.map(e => e.type)).toEqual(['cancel', 'set', 'linear']);
    expect(p.events[2]).toMatchObject({ value: 0, time: 1.5 });
  });
});
