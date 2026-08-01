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
  it('no longer remeshes terrain itself — that is driven by the terrain:updated event (#458 T0.2)', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    renderer.syncFromContext(ctx);

    const updateSpy = vi.spyOn(renderer.terrain!, 'update');
    const buildAllSpy = vi.spyOn(renderer.terrain!, 'buildAll');
    ctx.lastBlastFragments = [{ x: 10, y: 5, z: 10 }];

    renderer.onBlast(ctx);

    // executeBlast emits terrain:updated as part of the blast command itself;
    // main.ts's subscription calls gameRenderer.rebuildTerrain() from that
    // event, before onBlast() ever runs. onBlast() now only owns fragment
    // meshes and blast effects, not the terrain mesh.
    expect(updateSpy).not.toHaveBeenCalled();
    expect(buildAllSpy).not.toHaveBeenCalled();
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

describe('GameRenderer — ghost preview positioning (issue #406)', () => {
  it('snaps a ghost preview onto the terrain surface instead of the raw targetY:0 every dispatch sets', () => {
    // employees.ts always dispatches with targetY:0 — at any tile whose
    // surface sits above y=0 that box rendered buried inside solid voxels
    // and was never visible. syncFromContext must read the grid's actual
    // surface height the same way it already does for vehicles/characters.
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = makeCtx();
    // Solid column at (5, z) up to y=3 — surface sits at y=4 (getTerrainSurfaceY returns y+1).
    for (let y = 0; y <= 3; y++) {
      ctx.grid!.setVoxel(5, y, 5, { composition: { rocks: [] }, density: 1, oreDensities: {}, fractureModifier: 1 });
    }
    renderer.syncFromContext(ctx);
    const before = new Set(sm.scene.children);

    ctx.state!.ghostPreviews.push({ id: 1, type: 'general_work', targetX: 5, targetZ: 5, targetY: 0 });
    renderer.syncFromContext(ctx);

    expect(renderer.ghostCount).toBe(1);
    const mesh = sm.scene.children.find(c => !before.has(c)) as THREE.Mesh;
    expect(mesh).toBeDefined();
    expect(mesh.position.y).toBeGreaterThan(4); // above the y=4 surface, not buried at raw targetY:0
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
