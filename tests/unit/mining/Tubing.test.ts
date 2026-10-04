import { describe, it, expect } from 'vitest';
import {
  createTubingState,
  buyTubing,
  installTubing,
  removeHoleTubing,
  clearTubing,
  hasTubing,
  TUBING_COST,
} from '../../../src/core/mining/Tubing.js';

const KNOWN = ['hole_1', 'hole_2'];

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

    const result = installTubing(state, 'hole_1', KNOWN);
    expect(result.success).toBe(true);
    expect(hasTubing(state, 'hole_1')).toBe(true);
    expect(state.inventory).toBe(4);
  });

  it('installed tubing prevents water effect on explosives', () => {
    const state = createTubingState();
    buyTubing(state, 1, 50000);
    installTubing(state, 'hole_1', KNOWN);

    // This verifies the hasTubing check that feeds into waterEffect()
    expect(hasTubing(state, 'hole_1')).toBe(true);
    expect(hasTubing(state, 'hole_2')).toBe(false);
  });

  it('cannot install tubing if none in inventory', () => {
    const state = createTubingState();
    const result = installTubing(state, 'hole_1', KNOWN);
    expect(result.success).toBe(false);
    expect(result.message).toContain('No tubing');
  });

  it('cannot install tubing on same hole twice', () => {
    const state = createTubingState();
    buyTubing(state, 5, 50000);
    installTubing(state, 'hole_1', KNOWN);
    const result = installTubing(state, 'hole_1', KNOWN);
    expect(result.success).toBe(false);
  });

  it('unknown hole is refused: names the hole, no cost, inventory and record untouched', () => {
    const state = createTubingState();
    buyTubing(state, 3, 50000);
    const result = installTubing(state, 'NOPE', ['H1']);
    expect(result.success).toBe(false);
    expect(result.message).toContain('NOPE');
    expect(result.cost).toBe(0);
    expect(state.inventory).toBe(3);
    expect(hasTubing(state, 'NOPE')).toBe(false);
  });

  it('unknown hole with empty inventory reports not-found, not "No tubing"', () => {
    const state = createTubingState();
    const result = installTubing(state, 'NOPE', ['H1']);
    expect(result.success).toBe(false);
    expect(result.message).toContain('NOPE');
    expect(result.message).not.toContain('No tubing');
    expect(hasTubing(state, 'NOPE')).toBe(false);
  });

  it('unknown hole with empty known list is refused', () => {
    const state = createTubingState();
    buyTubing(state, 1, 50000);
    const result = installTubing(state, 'H1', []);
    expect(result.success).toBe(false);
    expect(state.inventory).toBe(1);
  });

  it('known hole succeeds and consumes one unit', () => {
    const state = createTubingState();
    buyTubing(state, 2, 50000);
    const result = installTubing(state, 'H1', ['H1', 'H2']);
    expect(result.success).toBe(true);
    expect(state.inventory).toBe(1);
    expect(hasTubing(state, 'H1')).toBe(true);
  });

  it('known hole with empty inventory reports No tubing', () => {
    const state = createTubingState();
    const result = installTubing(state, 'H1', ['H1']);
    expect(result.success).toBe(false);
    expect(result.message).toContain('No tubing');
  });

  it('removeHoleTubing returns true, clears the id, and gives no refund', () => {
    const state = createTubingState();
    buyTubing(state, 2, 50000);
    installTubing(state, 'hole_1', KNOWN);
    expect(removeHoleTubing(state, 'hole_1')).toBe(true);
    expect(hasTubing(state, 'hole_1')).toBe(false);
    expect(state.inventory).toBe(1);
  });

  it('removeHoleTubing returns false when absent and leaves state untouched', () => {
    const state = createTubingState();
    buyTubing(state, 2, 50000);
    installTubing(state, 'hole_1', KNOWN);
    expect(removeHoleTubing(state, 'hole_2')).toBe(false);
    expect(hasTubing(state, 'hole_1')).toBe(true);
    expect(state.inventory).toBe(1);
  });

  it('clearTubing empties installedHoles and keeps inventory', () => {
    const state = createTubingState();
    buyTubing(state, 3, 50000);
    installTubing(state, 'hole_1', KNOWN);
    installTubing(state, 'hole_2', KNOWN);
    clearTubing(state);
    expect(state.installedHoles.size).toBe(0);
    expect(state.inventory).toBe(1);
  });

  it('clearTubing on empty state is a no-op', () => {
    const state = createTubingState();
    clearTubing(state);
    expect(state.installedHoles.size).toBe(0);
    expect(state.inventory).toBe(0);
  });
});
