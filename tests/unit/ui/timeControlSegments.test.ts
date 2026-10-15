import { describe, it, expect } from 'vitest';
import { activeTimeSegment } from '../../../src/ui/timeControlSegments.js';

describe('activeTimeSegment (#1751)', () => {
  it('lights pause when paused at 1x', () => {
    expect(activeTimeSegment(1, true)).toBe('pause');
  });

  it('lights pause, not the kept speed, when paused at 4x', () => {
    expect(activeTimeSegment(4, true)).toBe('pause');
  });

  it('lights pause for every speed while paused', () => {
    for (const s of [1, 2, 4, 8]) expect(activeTimeSegment(s, true)).toBe('pause');
  });

  it('lights the running speed', () => {
    expect(activeTimeSegment(1, false)).toBe(1);
    expect(activeTimeSegment(2, false)).toBe(2);
    expect(activeTimeSegment(4, false)).toBe(4);
    expect(activeTimeSegment(8, false)).toBe(8);
  });

  it('lights nothing for a running speed that has no segment', () => {
    expect(activeTimeSegment(3, false)).toBeNull();
    expect(activeTimeSegment(0, false)).toBeNull();
  });
});
