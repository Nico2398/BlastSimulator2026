// BlastSimulator2026 — GameRenderer unit tests
// Covers diagnostics accessors (lastGridId / terrain.gridId), onBlast()'s
// localized-remesh vs. full-rebuild branching and fragment spawning, and the
// safety-zone → CharacterMesh.setEvacuating() wiring in syncFromContext().

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { GameRenderer } from '../../../src/renderer/GameRenderer.js';
import { FragmentMesh } from '../../../src/renderer/FragmentMesh.js';
import { CharacterMesh } from '../../../src/renderer/CharacterMesh.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { defineZone } from '../../../src/core/entities/Zone.js';
import { Random } from '../../../src/core/math/Random.js';
import { createTubingState } from '../../../src/core/mining/Tubing.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';

function makeMockSceneManager() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const sun = new THREE.DirectionalLight();
  const ambient = new THREE.AmbientLight();
  const cameraController = { setTarget: vi.fn(), frameSite: vi.fn(), update: vi.fn() };
  return { scene, camera, sun, ambient, cameraController, renderer: { render: vi.fn() } as unknown };
}

function makeCtx(): MiningContext {
  const state = createGame({ seed: 42, startingCash: 100_000 });
  const grid = new VoxelGrid(32, 16, 32);
  return {
    state,
    grid,
    softwareTier: 0,
    tubingState: createTubingState(),
    emitter: new EventEmitter(),
  };
}

describe('GameRenderer — diagnostics accessors', () => {
  it('lastGridId is null before any game is loaded', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    expect(renderer.lastGridId).toBeNull();
  });

  it('lastGridId and terrain.gridId match the bound grid after syncFromContext', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    renderer.syncFromContext(ctx);

    expect(renderer.lastGridId).toBe(ctx.grid!.id);
    expect(renderer.terrain?.gridId).toBe(ctx.grid!.id);
  });
});

describe('GameRenderer — onBlast()', () => {
  it('routes to terrain.update() rather than a direct buildAll() call when fragment positions are available', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    renderer.syncFromContext(ctx);

    const updateSpy = vi.spyOn(renderer.terrain!, 'update');
    ctx.lastBlastFragments = [{ x: 10, y: 5, z: 10 }];

    renderer.onBlast(ctx);

    // TerrainMesh.update() currently rebuilds via buildAll() internally
    // (documented as "simple but correct"), so buildAll IS invoked — just
    // not directly by onBlast. This asserts the onBlast routing, not
    // TerrainMesh's internal remesh strategy.
    expect(updateSpy).toHaveBeenCalledWith(ctx.lastBlastFragments);
  });

  it('falls back to a full rebuild when fragment position data is unavailable', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    renderer.syncFromContext(ctx);

    const buildAllSpy = vi.spyOn(renderer.terrain!, 'buildAll');
    ctx.lastBlastFragments = [];

    renderer.onBlast(ctx);

    expect(buildAllSpy).toHaveBeenCalled();
  });

  it('spawns fragment meshes when full fragment data is available', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    renderer.syncFromContext(ctx);

    const spawnSpy = vi.spyOn(FragmentMesh.prototype, 'spawnFragments');
    ctx.lastBlastFragmentData = [{
      id: 0,
      position: { x: 10, y: 5, z: 10 },
      volume: 0.5,
      mass: 1000,
      rockId: 'sandite',
      oreDensities: {},
      initialVelocity: { x: 0, y: 0, z: 0 },
      isProjection: false,
    }];

    renderer.onBlast(ctx);

    expect(spawnSpy).toHaveBeenCalledWith(ctx.lastBlastFragmentData);
    spawnSpy.mockRestore();
  });

  it('does nothing before a game has been loaded', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    // syncFromContext was never called — terrain/lastGrid are still null.
    expect(() => renderer.onBlast(ctx)).not.toThrow();
  });
});

describe('GameRenderer — safety zone evacuation wiring', () => {
  it('marks employees inside the active zone as evacuating', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    const rng = new Random(1);
    const { employee } = hireEmployee(ctx.state!.employees, 'driller', rng, 5, 5);
    defineZone(ctx.state!.zone, { x1: 0, z1: 0, x2: 10, z2: 10 });

    const evacSpy = vi.spyOn(CharacterMesh.prototype, 'setEvacuating');
    renderer.syncFromContext(ctx);

    expect(evacSpy).toHaveBeenCalledWith(employee.id, true);
    evacSpy.mockRestore();
  });

  it('does not mark employees outside the active zone as evacuating', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    const rng = new Random(1);
    const { employee } = hireEmployee(ctx.state!.employees, 'driller', rng, 25, 25);
    defineZone(ctx.state!.zone, { x1: 0, z1: 0, x2: 10, z2: 10 });

    const evacSpy = vi.spyOn(CharacterMesh.prototype, 'setEvacuating');
    renderer.syncFromContext(ctx);

    expect(evacSpy).toHaveBeenCalledWith(employee.id, false);
    evacSpy.mockRestore();
  });

  it('clears evacuating state once no zone is active', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    const rng = new Random(1);
    const { employee } = hireEmployee(ctx.state!.employees, 'driller', rng, 5, 5);

    const evacSpy = vi.spyOn(CharacterMesh.prototype, 'setEvacuating');
    renderer.syncFromContext(ctx);

    expect(evacSpy).toHaveBeenCalledWith(employee.id, false);
    evacSpy.mockRestore();
  });
});

describe('GameRenderer — camera framing', () => {
  it('frames the site on the first load, using the grid size as the span', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    renderer.syncFromContext(makeCtx());

    expect(sm.cameraController.frameSite).toHaveBeenCalled();
    const [cx, , cz, span] = sm.cameraController.frameSite.mock.calls.at(-1)!;
    expect(cx).toBe(16);
    expect(cz).toBe(16);
    expect(span).toBe(32);
  });

  it('re-frames when a level swaps the grid while keeping the seed', () => {
    // campaign start replaces the VoxelGrid but not the seed, so loadGame()
    // never runs — without a re-frame the new site renders off-centre.
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = makeCtx();
    renderer.syncFromContext(ctx);
    sm.cameraController.frameSite.mockClear();

    ctx.grid = new VoxelGrid(24, 12, 24);
    renderer.syncFromContext(ctx);

    expect(sm.cameraController.frameSite).toHaveBeenCalled();
    const [cx, , cz, span] = sm.cameraController.frameSite.mock.calls.at(-1)!;
    expect(cx).toBe(12);
    expect(cz).toBe(12);
    expect(span).toBe(24);
  });

  it('does not re-frame when the grid is unchanged', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = makeCtx();
    renderer.syncFromContext(ctx);
    sm.cameraController.frameSite.mockClear();

    renderer.syncFromContext(ctx);
    expect(sm.cameraController.frameSite).not.toHaveBeenCalled();
  });
});
