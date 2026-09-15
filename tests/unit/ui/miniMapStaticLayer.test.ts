// BlastSimulator2026 — StaticLayerInputs (mini-map static-layer change detection)
//
// The terrain shading and grid lines are the mini-map's expensive layers
// (~10k fillRect calls on a 96×96 site) and change only when the terrain
// does. StaticLayerInputs is the exact compare that decides when to repaint
// them; these pin that it fires on every input the painters read and stays
// quiet otherwise.

import { describe, it, expect } from 'vitest';
import { StaticLayerInputs, MAP_SIZE, type MapProjection } from '../../../src/ui/miniMapLayers.js';
import { makeGameContext } from '../../helpers/gameContext.js';
import type { GameState } from '../../../src/core/state/GameState.js';

function projectionFor(state: GameState): MapProjection {
  const world = state.world!;
  return { originX: world.minX, originZ: world.minZ, scaleX: MAP_SIZE / world.sizeX, scaleZ: MAP_SIZE / world.sizeZ };
}

describe('StaticLayerInputs.capture', () => {
  it('reports a change on the first capture and none on an identical second one', () => {
    const state = makeGameContext({ seed: 42, size: 32 }).state!;
    const proj = projectionFor(state);
    const inputs = new StaticLayerInputs();

    expect(inputs.capture(state, proj)).toBe(true);
    expect(inputs.capture(state, proj)).toBe(false);
    expect(inputs.capture(state, proj)).toBe(false);
  });

  it('reports a change when one cell\'s bench level moves, then settles again', () => {
    const state = makeGameContext({ seed: 42, size: 32 }).state!;
    const proj = projectionFor(state);
    const inputs = new StaticLayerInputs();
    inputs.capture(state, proj);

    const nav = state.navGrid!;
    const cell = nav.cellAt(nav.originX + 3, nav.originZ + 3)!;
    cell.benchLevel += 1;

    expect(inputs.capture(state, proj)).toBe(true);
    expect(inputs.capture(state, proj)).toBe(false);
  });

  it('reports a change when a cell\'s type changes (a blast turning rock into void)', () => {
    const state = makeGameContext({ seed: 42, size: 32 }).state!;
    const proj = projectionFor(state);
    const inputs = new StaticLayerInputs();
    inputs.capture(state, proj);

    const nav = state.navGrid!;
    nav.cellAt(nav.originX + 5, nav.originZ + 7)!.type = 'void';

    expect(inputs.capture(state, proj)).toBe(true);
  });

  it('reports a change when the projection moves or scales (a site that grew)', () => {
    const state = makeGameContext({ seed: 42, size: 32 }).state!;
    const proj = projectionFor(state);
    const inputs = new StaticLayerInputs();
    inputs.capture(state, proj);

    expect(inputs.capture(state, { ...proj, originX: proj.originX - 8 })).toBe(true);
    expect(inputs.capture(state, { ...proj, originX: proj.originX - 8 })).toBe(false);
    expect(inputs.capture(state, { ...proj, originX: proj.originX - 8, scaleX: proj.scaleX / 2 })).toBe(true);
  });

  it('reports a change when the nav grid goes away or comes back', () => {
    const state = makeGameContext({ seed: 42, size: 32 }).state!;
    const proj = projectionFor(state);
    const inputs = new StaticLayerInputs();
    inputs.capture(state, proj);
    const nav = state.navGrid;

    state.navGrid = null;
    expect(inputs.capture(state, proj)).toBe(true);
    expect(inputs.capture(state, proj)).toBe(false);

    state.navGrid = nav;
    expect(inputs.capture(state, proj)).toBe(true);
  });

  it('reports a change when a second game replaces the grid with one of another size', () => {
    const small = makeGameContext({ seed: 42, size: 32 }).state!;
    const large = makeGameContext({ seed: 42, size: 48 }).state!;
    const inputs = new StaticLayerInputs();
    inputs.capture(small, projectionFor(small));

    expect(inputs.capture(large, projectionFor(large))).toBe(true);
    expect(inputs.capture(large, projectionFor(large))).toBe(false);
  });
});
