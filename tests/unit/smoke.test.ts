import { describe, it, expect } from 'vitest';

describe('smoke test', () => {
  it('basic arithmetic works', () => {
    expect(1 + 1).toBe(2);
  });

  it('string operations work', () => {
    expect('BlastSimulator2026').toContain('Blast');
  });
});
