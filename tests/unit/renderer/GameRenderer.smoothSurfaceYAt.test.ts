// BlastSimulator2026 — GameRenderer.smoothSurfaceYAt() / surfaceYAt() coverage
// Both are one-line public wrappers (#1006) delegating to the
// GameRendererPicking free functions of the same name, which in turn
// delegate to PickingDeps.getTerrainSurfaceY / getSmoothTerrainSurfaceY.
// Exercised directly here since no other test file calls either wrapper.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GameRenderer } from '../../../src/renderer/GameRenderer.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { makeEmptyGameContext } from '../../helpers/gameContext.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';

function makeMockSceneManager() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const sunLight = new THREE.DirectionalLight();
  const fill = new THREE.DirectionalLight();
  const ambient = new THREE.AmbientLight();
  const cameraController = { setTarget: () => {}, frameSite: () => {}, update: () => {}, setPanLeash: () => {}, distance: 100, viewTarget: new THREE.Vector3() };
  const csm = { cascades: 3, maxFar: 1200, camera, getExtendedBreaks: () => {}, shaders: new Map() };
  const postPipeline = {
    aerial: { setHazeColor: () => {}, setHeightRef: () => {}, setGrade: () => {}, update: () => {} },
    addOverlayObject: () => {},
    removeOverlayObject: () => {},
  };
  return { scene, camera, sunLight, ambient, fill, csm, cameraController, postPipeline, renderer: { render: () => {} } as unknown };
}

function makeCtx(seed = 42): MiningContext {
  const state = createGame({ seed, startingCash: 100_000 });
  const grid = new VoxelGrid(32, 16, 32);
  return makeEmptyGameContext({ state, grid });
}

describe('GameRenderer — surfaceYAt / smoothSurfaceYAt wrappers (#1006)', () => {
  it('surfaceYAt(x, z) returns 0 before any game is loaded (no grid)', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    expect(renderer.surfaceYAt(5, 5)).toBe(0);
  });

  it('smoothSurfaceYAt(x, z) returns 0 before any game is loaded (no grid)', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    expect(renderer.smoothSurfaceYAt(5, 5)).toBe(0);
  });

  it('smoothSurfaceYAt(x, z) delegates to the smoothed voxel-column sampler once a grid is synced', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    renderer.syncFromContext(ctx);

    const smoothed = renderer.smoothSurfaceYAt(5, 5);
    expect(typeof smoothed).toBe('number');
    expect(Number.isNaN(smoothed)).toBe(false);
  });
});
