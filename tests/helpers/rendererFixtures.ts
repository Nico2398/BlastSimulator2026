// BlastSimulator2026 — shared GameRenderer test fixtures
//
// Lifted out of tests/unit/renderer/GameRenderer.test.ts so its landscape-
// building suites can live in files of their own: vitest parallelises across
// files, never within one, and every landscape build costs seconds, so one
// file holding all of them was a ~140 s floor under the whole unit run.

import { vi } from 'vitest';
import * as THREE from 'three';
import type { MiningContext } from '../../src/console/commands/mining.js';
import { createGame } from '../../src/core/state/GameState.js';
import { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { makeEmptyGameContext } from './gameContext.js';

export function makeMockSceneManager() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const sunLight = new THREE.DirectionalLight();
  const fill = new THREE.DirectionalLight();
  const ambient = new THREE.AmbientLight();
  const cameraController = { setTarget: vi.fn(), frameSite: vi.fn(), update: vi.fn(), setPanLeash: vi.fn(), distance: 100, viewTarget: new THREE.Vector3() };
  // Minimal fake CSM — attachCSM() reads .cascades synchronously; the rest
  // (.camera/.maxFar/.getExtendedBreaks/.shaders) only matter inside
  // onBeforeCompile, which these Node-only tests never trigger a real
  // WebGL compile to run (#458 T5.1).
  const csm = {
    cascades: 3,
    maxFar: 1200,
    camera,
    getExtendedBreaks: () => {},
    shaders: new Map(),
  };
  const postPipeline = {
    aerial: { setHazeColor: vi.fn(), setHeightRef: vi.fn(), setGrade: vi.fn(), update: vi.fn() },
  };
  return { scene, camera, sunLight, ambient, fill, csm, cameraController, postPipeline, renderer: { render: vi.fn() } as unknown };
}

export function makeCtx(seed = 42): MiningContext {
  const state = createGame({ seed, startingCash: 100_000 });
  const grid = new VoxelGrid(32, 16, 32);
  return makeEmptyGameContext({ state, grid });
}
