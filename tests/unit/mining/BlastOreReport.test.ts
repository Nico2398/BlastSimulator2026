import { describe, it, expect } from 'vitest';
import { clampCollectedOre } from '../../../src/core/mining/BlastOreReport.js';

describe('clampCollectedOre', () => {
  it('floors negative entries at 0 and leaves others untouched', () => {
    const ore = { a: -0.5, b: 3, c: 0 };
    clampCollectedOre(ore);
    expect(ore).toEqual({ a: 0, b: 3, c: 0 });
  });
});
