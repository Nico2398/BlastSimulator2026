// @vitest-environment jsdom
// BlastSimulator2026 — UIManager NavGrid overlay wiring (issue #407)
//
// Regression coverage: UIManager never fed the live NavGrid into the MiniMap,
// and toggleNavGridOverlay() was an empty stub, so there was no player-facing
// way to see the nav-grid overlay even though MiniMap's drawing code was correct.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UIManager } from '../../../src/ui/UIManager.js';
import { MiniMap } from '../../../src/ui/MiniMap.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';

function makeState() {
  const state = createGame({ seed: 1, mineType: 'desert' });
  // Give the state a real, non-null NavGrid so the assertion below verifies
  // actual object pass-through, not just a null default.
  const grid = new VoxelGrid(4, 4, 4);
  for (let z = 0; z < 4; z++)
    for (let x = 0; x < 4; x++)
      grid.setVoxel(x, 0, z, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
  state.navGrid = NavGrid.buildNavGrid(grid, [], []);
  return state;
}

describe('UIManager — NavGrid overlay wiring', () => {
  let container: HTMLElement;
  let uiManager: UIManager | null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    uiManager = null;
  });

  afterEach(() => {
    uiManager?.dispose();
    container.remove();
    vi.restoreAllMocks();
  });

  it('update() feeds the current GameState.navGrid into the MiniMap', () => {
    // jsdom has no real canvas backend, so MiniMap.update()'s canvas drawing
    // would throw regardless of this fix — stub it out and verify only the
    // navGrid-feeding wiring under test.
    vi.spyOn(MiniMap.prototype, 'update').mockImplementation(() => {});
    const setNavGridSpy = vi.spyOn(MiniMap.prototype, 'setNavGrid');
    uiManager = new UIManager(container);
    const state = makeState();

    uiManager.update(state);

    expect(setNavGridSpy).toHaveBeenCalledWith(state.navGrid);
  });

  it('update() re-feeds the NavGrid on every call', () => {
    vi.spyOn(MiniMap.prototype, 'update').mockImplementation(() => {});
    const setNavGridSpy = vi.spyOn(MiniMap.prototype, 'setNavGrid');
    uiManager = new UIManager(container);
    const state = makeState();

    uiManager.update(state);
    uiManager.update(state);
    uiManager.update(state);

    expect(setNavGridSpy).toHaveBeenCalledTimes(3);
  });

  it('toggleNavGridOverlay() turns the overlay on from its default-off state', () => {
    const setVisibleSpy = vi.spyOn(MiniMap.prototype, 'setNavGridVisible');
    uiManager = new UIManager(container);

    uiManager.toggleNavGridOverlay();

    expect(setVisibleSpy).toHaveBeenCalledWith(true);
  });

  it('toggleNavGridOverlay() flips back off on a second call', () => {
    const setVisibleSpy = vi.spyOn(MiniMap.prototype, 'setNavGridVisible');
    uiManager = new UIManager(container);

    uiManager.toggleNavGridOverlay();
    uiManager.toggleNavGridOverlay();

    expect(setVisibleSpy).toHaveBeenNthCalledWith(1, true);
    expect(setVisibleSpy).toHaveBeenNthCalledWith(2, false);
  });

  it('toggleNavGridOverlay() alternates on repeated calls', () => {
    const setVisibleSpy = vi.spyOn(MiniMap.prototype, 'setNavGridVisible');
    uiManager = new UIManager(container);

    uiManager.toggleNavGridOverlay();
    uiManager.toggleNavGridOverlay();
    uiManager.toggleNavGridOverlay();

    expect(setVisibleSpy).toHaveBeenNthCalledWith(3, true);
  });
});
