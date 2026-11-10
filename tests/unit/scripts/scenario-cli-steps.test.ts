// BlastSimulator2026 — scenario-cli.ts: which steps `--screenshot-steps` captures
//
// Steps are named 0-based, as the `step-NN` screenshot files are; a typo
// fails the run rather than capturing nothing and reading as a pass.

import { describe, it, expect } from 'vitest';
import { parseStepSelection } from '../../../scripts/scenario-cli.js';

const steps = (spec: string, count: number): number[] | string => {
  const selection = parseStepSelection(spec, count);
  return 'error' in selection ? selection.error : [...selection.steps].sort((a, b) => a - b);
};

describe('parseStepSelection', () => {
  it('reads indices, ranges and last, comma-separated, each step once', () => {
    expect(steps('3', 10)).toEqual([3]);
    expect(steps('0,2-4,last', 10)).toEqual([0, 2, 3, 4, 9]);
    expect(steps(' 4 , 4-5 ', 10)).toEqual([4, 5]);
    expect(steps('last', 1)).toEqual([0]);
  });

  it('refuses a step the scenario does not have', () => {
    expect(steps('10', 10)).toContain('outside steps 0-9');
    expect(steps('8-12', 10)).toContain('outside steps 0-9');
  });

  it('refuses a reversed range, a malformed token and an empty list', () => {
    expect(steps('5-2', 10)).toContain('outside steps');
    expect(steps('first', 10)).toContain('"first" is not a step index');
    expect(steps('-1', 10)).toContain('is not a step index');
    expect(steps(' , ', 10)).toContain('names no step');
    expect(steps('last', 0)).toContain('has no steps');
  });
});
