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
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { addHole, holeNumericId } from '../../../src/core/mining/DrillPlan.js';

function makeMockSceneManager() {
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
    addOverlayObject: vi.fn(),
    removeOverlayObject: vi.fn(),
  };
  return { scene, camera, sunLight, ambient, fill, csm, cameraController, postPipeline, renderer: { render: vi.fn() } as unknown };
}

function makeCtx(): MiningContext {
  const state = createGame({ seed: 42, startingCash: 100_000 });
  const grid = new VoxelGrid(32, 16, 32);
  return {
    state,
    grid,
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

    const remeshSpy = vi.spyOn(renderer.terrain!, 'remeshRegion');
    const buildAllSpy = vi.spyOn(renderer.terrain!, 'buildAll');
    ctx.lastBlastFragments = [{ x: 10, y: 5, z: 10 }];

    renderer.onBlast(ctx);

    // executeBlast emits terrain:updated as part of the blast command itself;
    // main.ts's subscription calls gameRenderer.remeshTerrainRegion() from
    // that event (#458 T3.1), before onBlast() ever runs. onBlast() now only
    // owns fragment meshes and blast effects, not the terrain mesh.
    expect(remeshSpy).not.toHaveBeenCalled();
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

describe('GameRenderer — wind and clouds (#458 T7.1/D12)', () => {
  it('loadGame adds 5 cloud cluster InstancedMeshes and a gradient sky dome to the scene', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    renderer.syncFromContext(makeCtx());

    const cloudMeshes = sm.scene.children.filter((c) => c.name === 'cloud-cluster');
    expect(cloudMeshes).toHaveLength(5);
    const dome = sm.scene.children.find((c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.SphereGeometry);
    expect(dome).toBeDefined();
  });

  it('update() advances the terrain material cloud-shadow uniforms from their T5.3 inert defaults', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    renderer.syncFromContext(makeCtx());

    const uniforms = renderer.terrain!.sharedMaterial.customUniforms;
    const offsetBefore = (uniforms['uCloudOffset']!.value as THREE.Vector2).clone();

    for (let i = 0; i < 60; i++) renderer.update(0.1);

    // T5.3 wired uCloudCoverage inert at 0 until T7.1 turned it on — confirm
    // it's actually live now (update() pushes CloudLayer's coverage in),
    // not just present.
    expect(uniforms['uCloudCoverage']!.value).toBeGreaterThan(0);
    const offsetAfter = uniforms['uCloudOffset']!.value as THREE.Vector2;

    // Wind is never exactly zero-speed after warmup ticks (weather always has
    // a non-zero target speed, even 'sunny'), so the offset must have moved.
    expect(offsetAfter.equals(offsetBefore)).toBe(false);
  });

  it('a weather change reaches CloudLayer — storm raises cloud coverage toward its dense target', async () => {
    const { createWeatherCycle } = await import('../../../src/core/weather/WeatherCycle.js');
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = makeCtx();
    ctx.weatherCycle = createWeatherCycle(ctx.state!.seed);
    renderer.syncFromContext(ctx);

    const uniforms = renderer.terrain!.sharedMaterial.customUniforms;
    ctx.weatherCycle.current = 'storm';
    renderer.syncFromContext(ctx); // pushes the new weather into skybox + clouds
    for (let i = 0; i < 200; i++) renderer.update(0.05);

    expect(uniforms['uCloudCoverage']!.value as number).toBeGreaterThan(0.9);
  });
});

describe('GameRenderer — birds, smoke, water, vegetation (#458 T7.2/D12/A26)', () => {
  // makeCtx()'s hand-built VoxelGrid has no `state.world`, which
  // rebuildLandscapeMesh requires — these need the real console pipeline
  // (newGameCommand) to get a real biome + StructureSet (villages/rivers/
  // trees) landscape actually builds from.
  async function makeLandscapeCtx(mineType = 'green_foothills'): Promise<MiningContext> {
    const { newGameCommand } = await import('../../../src/console/commands/world.js');
    const ctx: MiningContext = {
      state: null, grid: null, landscape: null,
      emitter: new EventEmitter(),
    };
    const result = newGameCommand(ctx, [], { mine_type: mineType, seed: '42', size: '64' });
    expect(result.success).toBe(true); // guard: the rest of the test is meaningless if setup itself failed
    return ctx;
  }

  it('syncFromContext builds vegetation (and, seed/biome permitting, water) from the real StructureSet', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    renderer.syncFromContext(await makeLandscapeCtx());

    // Grass is unconditional (the rim band always has some candidates on a
    // 64-wide grid); trees/water/smoke depend on what this seed's
    // StructureSet actually placed, so only grass is asserted unconditionally.
    const grass = sm.scene.children.find((c) => c.name === 'vegetation-grass');
    expect(grass).toBeDefined();
  });

  it('update() runs birds/smoke/water without throwing across many frames', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    renderer.syncFromContext(await makeLandscapeCtx());

    expect(() => {
      for (let i = 0; i < 30; i++) renderer.update(0.1);
    }).not.toThrow();
  });

  it('notifyBlastScatter reaches BirdFlocks without throwing, before and after a game is loaded', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    expect(() => renderer.notifyBlastScatter(10, 10)).not.toThrow(); // no game loaded yet

    renderer.syncFromContext(await makeLandscapeCtx());
    expect(() => renderer.notifyBlastScatter(32, 32)).not.toThrow();
  });

  it('rebuilding the landscape (level swap) disposes the previous ambient meshes instead of accumulating them', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = await makeLandscapeCtx();
    renderer.syncFromContext(ctx);
    const grassCountAfterFirst = sm.scene.children.filter((c) => c.name === 'vegetation-grass').length;

    // Same seed, different grid object — takes the "grid changed, same seed"
    // branch that calls rebuildLandscapeMesh() a second time without going
    // through loadGame()'s clearAll() first (mirrors a campaign level swap).
    const { VoxelGrid } = await import('../../../src/core/world/VoxelGrid.js');
    ctx.grid = new VoxelGrid(64, 64, 64);
    ctx.landscape = null;
    renderer.syncFromContext(ctx);
    const grassCountAfterSecond = sm.scene.children.filter((c) => c.name === 'vegetation-grass').length;

    expect(grassCountAfterFirst).toBe(1);
    expect(grassCountAfterSecond).toBe(1); // still exactly one — the stale mesh was disposed, not left behind
  });
});

describe('GameRenderer — per-biome ambient extras (#458 T7.3)', () => {
  async function makeLandscapeCtx(mineType: string): Promise<MiningContext> {
    const { newGameCommand } = await import('../../../src/console/commands/world.js');
    const ctx: MiningContext = {
      state: null, grid: null, landscape: null,
      emitter: new EventEmitter(),
    };
    const result = newGameCommand(ctx, [], { mine_type: mineType, seed: '42', size: '64' });
    expect(result.success).toBe(true);
    return ctx;
  }

  it('builds dust devils, not fireflies, on an arid biome', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    renderer.syncFromContext(await makeLandscapeCtx('desert_badlands'));

    expect(sm.scene.children.find((c) => c.name === 'dust-devils')).toBeDefined();
    expect(sm.scene.children.find((c) => c.name === 'fireflies')).toBeUndefined();
  });

  it('builds fireflies, not dust devils, on the humid tropical biome', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    renderer.syncFromContext(await makeLandscapeCtx('tropical_karst'));

    expect(sm.scene.children.find((c) => c.name === 'fireflies')).toBeDefined();
    expect(sm.scene.children.find((c) => c.name === 'dust-devils')).toBeUndefined();
  });

  it('builds neither extra on a biome outside both sets', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    renderer.syncFromContext(await makeLandscapeCtx('green_foothills'));

    expect(sm.scene.children.find((c) => c.name === 'dust-devils')).toBeUndefined();
    expect(sm.scene.children.find((c) => c.name === 'fireflies')).toBeUndefined();
  });

  it('update() runs dust devils and fireflies without throwing across many frames', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    renderer.syncFromContext(await makeLandscapeCtx('red_canyon'));

    expect(() => {
      for (let i = 0; i < 30; i++) renderer.update(0.1);
    }).not.toThrow();
  });

  it('swapping from an arid to a non-arid biome disposes the stale dust-devils mesh instead of leaving it behind', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    renderer.syncFromContext(await makeLandscapeCtx('desert_badlands'));
    expect(sm.scene.children.find((c) => c.name === 'dust-devils')).toBeDefined();

    renderer.syncFromContext(await makeLandscapeCtx('green_foothills'));
    expect(sm.scene.children.find((c) => c.name === 'dust-devils')).toBeUndefined();
  });
});

describe('GameRenderer — scene picking (P2)', () => {
  it('pickables() is empty before any game is loaded', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    expect(renderer.pickables()).toEqual([]);
  });

  // makeCtx()'s grid is a VoxelGrid(32, 16, 32) at the origin — state.world
  // itself stays null until syncFromContext binds it, so placeBuilding's
  // bounds args are given directly rather than read from state.world.
  it('pickables() aggregates buildings, vehicles, and employees after sync', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    const { state } = ctx;
    placeBuilding(state!.buildings, 'management_office', 2, 2, 32, 32, 1, 0, 0);
    purchaseVehicle(state!.vehicles, 'debris_hauler');
    hireEmployee(state!.employees, 'driller', new Random(1));

    renderer.syncFromContext(ctx);

    // FragmentMesh always contributes its 8 shape buckets regardless of
    // whether any fragment was ever spawned (harmless empty raycast
    // targets), so assert presence rather than an exact kind list.
    const kinds = new Set(renderer.pickables().map(o => o.userData['entityKind']));
    expect(kinds.has('building')).toBe(true);
    expect(kinds.has('vehicle')).toBe(true);
    expect(kinds.has('employee')).toBe(true);
  });

  it('entityWorldPosition() resolves a synced building, vehicle, and employee', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    const { state } = ctx;
    const { building } = placeBuilding(state!.buildings, 'management_office', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number } };
    const { vehicle } = purchaseVehicle(state!.vehicles, 'debris_hauler');
    const { employee } = hireEmployee(state!.employees, 'driller', new Random(1));

    renderer.syncFromContext(ctx);

    expect(renderer.entityWorldPosition('building', building.id)).not.toBeNull();
    expect(renderer.entityWorldPosition('vehicle', vehicle.id)).not.toBeNull();
    expect(renderer.entityWorldPosition('employee', employee.id)).not.toBeNull();
  });

  it('entityWorldPosition() returns null for an id that was never synced', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    renderer.syncFromContext(makeCtx());
    expect(renderer.entityWorldPosition('building', 9999)).toBeNull();
    expect(renderer.entityWorldPosition('vehicle', 9999)).toBeNull();
    expect(renderer.entityWorldPosition('employee', 9999)).toBeNull();
    expect(renderer.entityWorldPosition('fragment', 9999)).toBeNull();
    expect(renderer.entityWorldPosition('hole', 9999)).toBeNull();
  });

  it('pickables() includes hole markers, tagged with their numeric hole id, after showBlastPlanOverlay()', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    renderer.syncFromContext(ctx);
    const hole = addHole(ctx.state!.drillHoles, 10, 10, 8, 0.15);

    renderer.showBlastPlanOverlay(ctx);

    const holePicks = renderer.pickables().filter(o => o.userData['entityKind'] === 'hole');
    expect(holePicks.length).toBeGreaterThan(0);
    expect(holePicks.map(o => o.userData['entityId'])).toContain(holeNumericId(hole.id));
  });

  it('entityWorldPosition() resolves a hole shown via showBlastPlanOverlay()', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    renderer.syncFromContext(ctx);
    const hole = addHole(ctx.state!.drillHoles, 10, 10, 8, 0.15);

    renderer.showBlastPlanOverlay(ctx);

    const pos = renderer.entityWorldPosition('hole', holeNumericId(hole.id));
    expect(pos).not.toBeNull();
    expect(pos!.x).toBeCloseTo(10);
    expect(pos!.z).toBeCloseTo(10);
  });

  it('pickables() drops hole markers once the plan overlay is hidden (empty plan)', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    renderer.syncFromContext(ctx);
    addHole(ctx.state!.drillHoles, 10, 10, 8, 0.15);
    renderer.showBlastPlanOverlay(ctx);
    expect(renderer.pickables().some(o => o.userData['entityKind'] === 'hole')).toBe(true);

    ctx.state!.drillHoles = [];
    renderer.showBlastPlanOverlay(ctx); // empty plan → overlay hides itself

    expect(renderer.pickables().some(o => o.userData['entityKind'] === 'hole')).toBe(false);
  });

  it('resolveFragmentId() resolves a spawned fragment through its bucket slot', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    renderer.syncFromContext(ctx);
    ctx.lastBlastFragmentData = [{
      id: 5,
      position: { x: 10, y: 5, z: 10 },
      volume: 0.5,
      mass: 1000,
      rockId: 'sandite',
      oreDensities: {},
      initialVelocity: { x: 0, y: 0, z: 0 },
      isProjection: false,
    }];
    renderer.onBlast(ctx);

    // id 5 % 8 === 5 → bucket 5, first (only) slot in that bucket → slot 0.
    expect(renderer.resolveFragmentId(5, 0)).toBe(5);
  });

  it('resolveFragmentId() returns null before any fragments are spawned', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    renderer.syncFromContext(makeCtx());
    expect(renderer.resolveFragmentId(0, 0)).toBeNull();
  });
});
