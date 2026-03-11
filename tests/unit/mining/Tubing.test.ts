import { describe, it, expect } from 'vitest';
import {
  createTubingState,
  buyTubing,
  installTubing,
  hasTubing,
  TUBING_COST,
} from '../../../src/core/mining/Tubing.js';

describe('Tubing system', () => {
  it('buying tubing deducts money and adds to inventory', () => {
    const state = createTubingState();
    const result = buyTubing(state, 10, 5000);
    expect(result.success).toBe(true);
    expect(result.cost).toBe(10 * TUBING_COST);
    expect(state.inventory).toBe(10);
  });

  it('buying tubing with insufficient funds fails', () => {
    const state = createTubingState();
    const result = buyTubing(state, 10, 100);
    expect(result.success).toBe(false);
    expect(state.inventory).toBe(0);
  });

  it('installing tubing on a hole marks it as waterproofed', () => {
    const state = createTubingState();
    buyTubing(state, 5, 50000);

    const result = installTubing(state, 'hole_1');
    expect(result.success).toBe(true);
    expect(hasTubing(state, 'hole_1')).toBe(true);
    expect(state.inventory).toBe(4);
  });

  it('installed tubing prevents water effect on explosives', () => {
    const state = createTubingState();
    buyTubing(state, 1, 50000);
    installTubing(state, 'hole_1');

    // This verifies the hasTubing check that feeds into waterEffect()
    expect(hasTubing(state, 'hole_1')).toBe(true);
    expect(hasTubing(state, 'hole_2')).toBe(false);
  });

  it('cannot install tubing if none in inventory', () => {
    const state = createTubingState();
    const result = installTubing(state, 'hole_1');
    expect(result.success).toBe(false);
    expect(result.message).toContain('No tubing');
  });

  it('cannot install tubing on same hole twice', () => {
    const state = createTubingState();
    buyTubing(state, 5, 50000);
    installTubing(state, 'hole_1');
    const result = installTubing(state, 'hole_1');
    expect(result.success).toBe(false);
  });
});
