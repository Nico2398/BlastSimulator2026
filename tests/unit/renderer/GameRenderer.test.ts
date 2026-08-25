// BlastSimulator2026 — GameRenderer unit tests
// Covers diagnostics accessors (lastGridId / terrain.gridId), onBlast()'s
// localized-remesh vs. full-rebuild branching and fragment spawning, and the
// safety-zone → CharacterMesh.setEvacuating() wiring in syncFromContext().

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { GameRenderer } from '../../../src/renderer/GameRenderer.js';
import { FragmentMesh } from '../../../src/renderer/FragmentMesh.js';
import { CharacterMesh } from '../../../src/renderer/CharacterMesh.js';
import { TerrainMesh } from '../../../src/renderer/TerrainMesh.js';
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
import type { SurveyResult } from '../../../src/core/mining/SurveyCalc.js';
import { GhostMesh } from '../../../src/renderer/GhostMesh.js';

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
      halfExtents: { x: 0.4, y: 0.4, z: 0.4 },
      shapeSeed: 3,
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

describe('GameRenderer — movement interpolation, no hard-snap on sync (#520)', () => {
  it('does not hard-snap employee x/z to the raw GameState value on sync, but instantly corrects y to the terrain surface', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = makeCtx();
    const { employee } = hireEmployee(ctx.state!.employees, 'driller', new Random(1), 5, 5);
    renderer.syncFromContext(ctx);

    // Solid column at the employee's new position so its terrain surface
    // height differs from the flat y=0 the first sync placed it at.
    for (let y = 0; y <= 2; y++) {
      ctx.grid!.setVoxel(20, y, 20, { composition: { rocks: [] }, density: 1, oreDensities: {}, fractureModifier: 1 });
    }
    employee.x = 20;
    employee.z = 20;
    renderer.syncFromContext(ctx);

    const pos = renderer.entityWorldPosition('employee', employee.id);
    expect(pos).not.toBeNull();
    // x/z must NOT be hard-snapped to the raw new GameState value on sync —
    // that would pre-empt the mesh's own eased glide (no update() call
    // happened between the two syncFromContext() calls here).
    expect(pos!.x).not.toBe(20);
    expect(pos!.z).not.toBe(20);
    // y must still be corrected immediately, independent of the x/z glide.
    expect(pos!.y).toBeGreaterThan(2);
  });

  it('does not hard-snap vehicle x/z to the raw GameState value on sync, but instantly corrects y to the terrain surface', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = makeCtx();
    const { vehicle } = purchaseVehicle(ctx.state!.vehicles, 'debris_hauler', 5, 5);
    renderer.syncFromContext(ctx);

    for (let y = 0; y <= 2; y++) {
      ctx.grid!.setVoxel(20, y, 20, { composition: { rocks: [] }, density: 1, oreDensities: {}, fractureModifier: 1 });
    }
    vehicle.x = 20;
    vehicle.z = 20;
    vehicle.targetX = 20;
    vehicle.targetZ = 20;
    renderer.syncFromContext(ctx);

    const pos = renderer.entityWorldPosition('vehicle', vehicle.id);
    expect(pos).not.toBeNull();
    expect(pos!.x).not.toBe(20);
    expect(pos!.z).not.toBe(20);
    expect(pos!.y).toBeGreaterThan(2);
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
      halfExtents: { x: 0.4, y: 0.4, z: 0.4 },
      shapeSeed: 5,
    }];
    renderer.onBlast(ctx);

    // shapeSeed 5 % 24 === 5 → bucket 5, first (only) slot in that bucket → slot 0.
    expect(renderer.resolveFragmentId(5, 0)).toBe(5);
  });

  it('resolveFragmentId() returns null before any fragments are spawned', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    renderer.syncFromContext(makeCtx());
    expect(renderer.resolveFragmentId(0, 0)).toBeNull();
  });
});

describe('GameRenderer — ambient decoration follows game clock, not wall clock (#490)', () => {
  it('ambient clock stays at zero while the game starts paused', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    ctx.state!.isPaused = true;
    renderer.syncFromContext(ctx);

    for (let i = 0; i < 5; i++) renderer.update(0.5);

    expect(renderer.ambientClockSeconds).toBe(0);
  });

  it('ambient clock advances 4x as far at 4x timeScale as at 1x, for the same wall-clock delta', () => {
    const renderer1 = new GameRenderer(makeMockSceneManager() as any);
    const ctx1 = makeCtx();
    ctx1.state!.timeScale = 1;
    ctx1.state!.isPaused = false;
    renderer1.syncFromContext(ctx1);

    const renderer4 = new GameRenderer(makeMockSceneManager() as any);
    const ctx4 = makeCtx();
    ctx4.state!.timeScale = 4;
    ctx4.state!.isPaused = false;
    renderer4.syncFromContext(ctx4);

    for (let i = 0; i < 10; i++) {
      renderer1.update(0.1);
      renderer4.update(0.1);
    }

    expect(renderer4.ambientClockSeconds).toBeCloseTo(renderer1.ambientClockSeconds * 4, 5);
  });

  it('two half-steps advance the ambient clock exactly as far as one whole step', () => {
    const rendererA = new GameRenderer(makeMockSceneManager() as any);
    const ctxA = makeCtx();
    ctxA.state!.timeScale = 2;
    ctxA.state!.isPaused = false;
    rendererA.syncFromContext(ctxA);
    rendererA.update(0.2);

    const rendererB = new GameRenderer(makeMockSceneManager() as any);
    const ctxB = makeCtx();
    ctxB.state!.timeScale = 2;
    ctxB.state!.isPaused = false;
    rendererB.syncFromContext(ctxB);
    rendererB.update(0.1);
    rendererB.update(0.1);

    expect(rendererA.ambientClockSeconds).toBeCloseTo(rendererB.ambientClockSeconds, 10);
  });

  it('pausing mid-run freezes the ambient clock; resuming continues without a catch-up jump', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    ctx.state!.timeScale = 2;
    ctx.state!.isPaused = false;
    renderer.syncFromContext(ctx);

    for (let i = 0; i < 3; i++) renderer.update(0.1);
    const beforePause = renderer.ambientClockSeconds;

    ctx.state!.isPaused = true;
    renderer.syncFromContext(ctx);
    for (let i = 0; i < 5; i++) renderer.update(0.1);
    expect(renderer.ambientClockSeconds).toBe(beforePause);

    ctx.state!.isPaused = false;
    renderer.syncFromContext(ctx);
    renderer.update(0.1);

    expect(renderer.ambientClockSeconds - beforePause).toBeCloseTo(0.1 * 2, 10);
  });

  it('dt = 0 leaves the ambient clock unchanged', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    ctx.state!.timeScale = 3;
    ctx.state!.isPaused = false;
    renderer.syncFromContext(ctx);

    renderer.update(0.1);
    const before = renderer.ambientClockSeconds;
    renderer.update(0);

    expect(renderer.ambientClockSeconds).toBe(before);
  });

  it('a capped-but-large per-frame dt at max timeScale scales linearly, no secondary clamp', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    ctx.state!.timeScale = 8;
    ctx.state!.isPaused = false;
    renderer.syncFromContext(ctx);

    renderer.update(0.1);

    expect(renderer.ambientClockSeconds).toBeCloseTo(0.8, 10);
  });
});

// ── Survey confidence overlay visibility preference (#496) ─────────────────
//
// Bug: syncSurveyOverlay derives visibility purely from "are there survey
// results" (options.points.length > 0), never consulting the player's own
// preference — so once any survey exists the overlay can never be hidden.
// These tests drive the preference through setSurveyOverlayVisible() and
// assert against the real SurveyConfidenceOverlay's show()/hide(), the same
// object syncSurveyOverlay() itself calls via terrain.getSurveyOverlay().

function makeOverlaySurveyResult(overrides: Partial<SurveyResult> = {}): SurveyResult {
  return {
    id: 1, method: 'seismic', centerX: 20, centerZ: 20, completedTick: 0,
    surveyorId: 1, estimates: { '20,20': { sparkium: 0.6 } }, confidence: 0.85,
    ...overrides,
  };
}

describe('GameRenderer — survey confidence overlay visibility preference (#496)', () => {
  it('surveyOverlayVisible defaults to true on a fresh GameRenderer', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    expect(renderer.surveyOverlayVisible).toBe(true);
  });

  it('setSurveyOverlayVisible(false) then syncFromContext with survey results never calls show()', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    renderer.syncFromContext(ctx); // loadGame — builds terrain/overlay

    const overlay = renderer.terrain!.getSurveyOverlay();
    const showSpy = vi.spyOn(overlay, 'show');

    renderer.setSurveyOverlayVisible(false);
    ctx.state!.surveyResults = [makeOverlaySurveyResult()];
    renderer.syncFromContext(ctx);

    expect(showSpy).not.toHaveBeenCalled();
  });

  it('setSurveyOverlayVisible(false) called after results are already synced immediately hides the overlay', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    ctx.state!.surveyResults = [makeOverlaySurveyResult()];
    renderer.syncFromContext(ctx); // overlay shown (visible defaults true)

    const overlay = renderer.terrain!.getSurveyOverlay();
    const hideSpy = vi.spyOn(overlay, 'hide');

    // No further syncFromContext() call — the setter itself must re-sync.
    renderer.setSurveyOverlayVisible(false);

    expect(hideSpy).toHaveBeenCalled();
  });

  it('setSurveyOverlayVisible(true) after hiding re-shows with the full current point set', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    ctx.state!.surveyResults = [makeOverlaySurveyResult()];
    renderer.syncFromContext(ctx);

    const overlay = renderer.terrain!.getSurveyOverlay();
    renderer.setSurveyOverlayVisible(false);
    const showSpy = vi.spyOn(overlay, 'show');

    renderer.setSurveyOverlayVisible(true);

    expect(showSpy).toHaveBeenCalledTimes(1);
    const options = showSpy.mock.calls[0]![0];
    expect(options.points.length).toBeGreaterThan(0);
  });

  it('regression #496: hiding, then a new survey result arriving via syncFromContext, must not silently re-show the overlay', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    ctx.state!.surveyResults = [makeOverlaySurveyResult({ id: 1, centerX: 20, centerZ: 20, estimates: { '20,20': { sparkium: 0.5 } } })];
    renderer.syncFromContext(ctx);
    renderer.setSurveyOverlayVisible(false);

    const overlay = renderer.terrain!.getSurveyOverlay();
    const showSpy = vi.spyOn(overlay, 'show');

    // A second, different survey result lands — state mutates and
    // syncFromContext runs again, exactly as it does after every command.
    ctx.state!.surveyResults = [
      ...ctx.state!.surveyResults,
      makeOverlaySurveyResult({ id: 2, centerX: 30, centerZ: 30, estimates: { '30,30': { sparkium: 0.4 } } }),
    ];
    renderer.syncFromContext(ctx);

    expect(showSpy).not.toHaveBeenCalled();
  });

  it('empty surveyResults hides the overlay regardless of the visibility preference', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    renderer.syncFromContext(ctx); // no survey results, preference stays default true

    const overlay = renderer.terrain!.getSurveyOverlay();
    const hideSpy = vi.spyOn(overlay, 'hide');

    renderer.syncFromContext(ctx); // re-sync with still-empty results

    expect(hideSpy).toHaveBeenCalled();
  });
});

// ── Terrain/landscape boundary wiring (#559) ────────────────────────────────
//
// playableCut()'s meshClaimsColumn field, the edge-height sampler's
// setEdgeHeightSampler()-before-buildAll() init ordering, and its idempotent
// re-apply on landscape rebuild all previously shipped with zero test
// coverage (semantic-reviewer, #559 fix-bug pass).

describe('GameRenderer — playableCut/meshClaimsColumn wiring (#559)', () => {
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

  it('playableCut(grid).meshClaimsColumn delegates to grid.claimsColumnForMeshing', async () => {
    const claimsSpy = vi.spyOn(VoxelGrid.prototype, 'claimsColumnForMeshing');
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);

    renderer.syncFromContext(await makeLandscapeCtx());

    // The landscape build cuts itself against playableCut(grid), whose
    // meshClaimsColumn is wired straight to grid.claimsColumnForMeshing
    // (GameRenderer.playableCut) -- a boundary quad anywhere in the built
    // landscape necessarily calls it via LandscapeMesh's classifyQuad.
    expect(claimsSpy).toHaveBeenCalled();
    const [x, z] = claimsSpy.mock.calls[0]!;
    expect(typeof x).toBe('number');
    expect(typeof z).toBe('number');
    claimsSpy.mockRestore();
  });

  it('loadGame() sets the terrain edge-height sampler BEFORE buildAll(), and it is non-null afterward', async () => {
    const setSamplerSpy = vi.spyOn(TerrainMesh.prototype, 'setEdgeHeightSampler');
    const buildAllSpy = vi.spyOn(TerrainMesh.prototype, 'buildAll');
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);

    renderer.syncFromContext(await makeLandscapeCtx());

    expect(setSamplerSpy).toHaveBeenCalled();
    expect(buildAllSpy).toHaveBeenCalled();
    // vitest mock functions record a global invocation order counter --
    // setEdgeHeightSampler's first call must precede buildAll's first call,
    // pinning the #559 init-ordering fix (previously buildAll ran first,
    // so the initial mesh missed the boundary-normal fix entirely).
    expect(setSamplerSpy.mock.invocationCallOrder[0]!).toBeLessThan(buildAllSpy.mock.invocationCallOrder[0]!);
    // The dead-code concern (quality-reviewer): currentEdgeHeightSampler
    // actually earns its keep here, proving the sampler GameRenderer wired in
    // reached TerrainMesh, not just that some setter was called.
    expect(renderer.terrain!.currentEdgeHeightSampler).not.toBeNull();

    setSamplerSpy.mockRestore();
    buildAllSpy.mockRestore();
  });

  it('rebuildLandscapeMesh() (level swap) re-applies the edge-height sampler', async () => {
    const setSamplerSpy = vi.spyOn(TerrainMesh.prototype, 'setEdgeHeightSampler');
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = await makeLandscapeCtx();
    renderer.syncFromContext(ctx); // loadGame() — 1st setEdgeHeightSampler call
    const callsAfterLoad = setSamplerSpy.mock.calls.length;
    expect(callsAfterLoad).toBeGreaterThan(0);

    // Same seed, different grid object — the "grid changed, same seed" branch
    // that calls rebuildLandscapeMesh() a second time without going through
    // loadGame()'s clearAll() first (mirrors a campaign level swap), exactly
    // as the existing ambient-mesh test above exercises.
    ctx.grid = new VoxelGrid(64, 64, 64);
    ctx.landscape = null;
    renderer.syncFromContext(ctx);

    expect(setSamplerSpy.mock.calls.length).toBeGreaterThan(callsAfterLoad);
    expect(renderer.terrain!.currentEdgeHeightSampler).not.toBeNull();

    setSamplerSpy.mockRestore();
  });
});

// ── Staged level load (#474) ──
//
// enterLevel() in main.ts no longer drives the whole load through one
// syncFromContext() call — it runs buildPlayableMesh() / buildLandscapeMesh()
// / buildAmbient() / finishLevelLoad() as separate weighted LoadPhases, so
// the loading screen can paint a frame between each. These prove the staged
// path lands in the same place syncFromContext() always did.

describe('GameRenderer — staged level load (#474)', () => {
  async function makeLandscapeCtx(mineType = 'green_foothills'): Promise<MiningContext> {
    const { newGameCommand } = await import('../../../src/console/commands/world.js');
    const ctx: MiningContext = { state: null, grid: null, landscape: null, emitter: new EventEmitter() };
    const result = newGameCommand(ctx, [], { mine_type: mineType, seed: '42', size: '64' });
    expect(result.success).toBe(true);
    return ctx;
  }

  it('buildPlayableMesh() + buildLandscapeMesh() + buildAmbient() + finishLevelLoad(), run as separate staged calls, reach the same end state as one syncFromContext() call', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = await makeLandscapeCtx();

    renderer.buildPlayableMesh(ctx);
    renderer.buildLandscapeMesh(ctx);
    renderer.buildAmbient(ctx);
    renderer.finishLevelLoad(ctx);

    expect(renderer.lastGridId).toBe(ctx.grid!.id);
    expect(renderer.terrain).not.toBeNull();
    expect(renderer.landscape).not.toBeNull();
    // Grass is the unconditional ambient signal the existing #458 T7.2 tests
    // already rely on — present whenever buildAmbient() actually ran.
    expect(sm.scene.children.find((c) => c.name === 'vegetation-grass')).toBeDefined();
    expect(sm.cameraController.frameSite).toHaveBeenCalled();
  });

  it('finishLevelLoad() records the same bookkeeping loadGame() does, so a later syncFromContext() call does not repeat the load', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = await makeLandscapeCtx();
    const buildAllSpy = vi.spyOn(TerrainMesh.prototype, 'buildAll');

    renderer.buildPlayableMesh(ctx);
    renderer.buildLandscapeMesh(ctx);
    renderer.buildAmbient(ctx);
    renderer.finishLevelLoad(ctx);
    expect(buildAllSpy).toHaveBeenCalledTimes(1);

    // Same seed, same grid — without finishLevelLoad()'s bookkeeping this
    // would look like an unseen seed and re-run the whole load, doubling the
    // cost the staged phases were just charged for.
    renderer.syncFromContext(ctx);
    expect(buildAllSpy).toHaveBeenCalledTimes(1);

    buildAllSpy.mockRestore();
  });

  it('finishLevelLoad() is a no-op without a loaded state/grid, rather than throwing', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    expect(() => renderer.finishLevelLoad({ state: null, grid: null, landscape: null, emitter: new EventEmitter() })).not.toThrow();
  });
});

// ── Ghost/terrain resync dirty-check gating (#761) ──────────────────────────
//
// syncEntities() unconditionally re-syncs ~1000 ghost-preview meshes on
// every console command today, which is what stalls tutorial-interactive.json
// at step 37 in interaction mode (30s timeout). The fix gates GhostMesh.sync()
// behind `ghostPreviewsRevision !== lastGhostRevision || terrainMeshRevision
// !== lastSyncedTerrainRevision` — TaskDispatch.ts bumps ghostPreviewsRevision
// at its four ghostPreviews-mutating call sites (see
// tests/unit/engine/TaskDispatch.test.ts's own #761 suite); nothing in this
// repo yet bumps terrainMeshRevision (the field exists, stubbed at a constant
// 0, with a TODO(implementer) marking where a future remesh call bumps it).
//
// These assert the gating decision through the three diagnostic getters
// (lastGhostRevisionSynced / terrainMeshRevisionCount / lastTerrainRevisionSynced)
// and by spying on GhostMesh.prototype.sync directly — the same seam
// GameRenderer's other tests already use for onBlast()/spawnFragments above.

describe('GameRenderer — ghost/terrain resync dirty-check gating (#761)', () => {
  it('lastGhostRevisionSynced starts at -1 before any sync', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    expect(renderer.lastGhostRevisionSynced).toBe(-1);
  });

  it('lastTerrainRevisionSynced starts at -1 before any sync', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    expect(renderer.lastTerrainRevisionSynced).toBe(-1);
  });

  it('terrainMeshRevisionCount starts at 0 before any sync', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    expect(renderer.terrainMeshRevisionCount).toBe(0);
  });

  it('the first syncFromContext() call records the current ghostPreviewsRevision/terrainMeshRevision as synced', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    const ctx = makeCtx();
    expect(ctx.state!.ghostPreviewsRevision).toBe(0); // fresh GameState default

    renderer.syncFromContext(ctx);

    expect(renderer.lastGhostRevisionSynced).toBe(0);
    expect(renderer.lastTerrainRevisionSynced).toBe(renderer.terrainMeshRevisionCount);
  });

  it('GhostMesh.sync() runs on the first syncFromContext() call', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = makeCtx();
    const syncSpy = vi.spyOn(GhostMesh.prototype, 'sync');

    renderer.syncFromContext(ctx);

    expect(syncSpy).toHaveBeenCalledTimes(1);
    syncSpy.mockRestore();
  });

  it('a second syncFromContext() call with unchanged ghostPreviewsRevision and terrainMeshRevision does NOT re-sync ghosts', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = makeCtx();
    renderer.syncFromContext(ctx); // first sync — always runs
    const syncSpy = vi.spyOn(GhostMesh.prototype, 'sync');

    renderer.syncFromContext(ctx); // nothing changed since the first sync

    expect(syncSpy).not.toHaveBeenCalled();
    syncSpy.mockRestore();
  });

  it('bumping ghostPreviewsRevision between two syncFromContext() calls triggers a re-sync', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = makeCtx();
    renderer.syncFromContext(ctx);
    const syncSpy = vi.spyOn(GhostMesh.prototype, 'sync');

    // Simulates what TaskDispatch's dispatch/claim/complete/interrupt sites
    // do to state.ghostPreviewsRevision between two command-driven syncs.
    ctx.state!.ghostPreviewsRevision += 1;
    renderer.syncFromContext(ctx);

    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(renderer.lastGhostRevisionSynced).toBe(ctx.state!.ghostPreviewsRevision);
    syncSpy.mockRestore();
  });

  it('three consecutive unchanged syncFromContext() calls after the first sync ghosts exactly once in total', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = makeCtx();
    const syncSpy = vi.spyOn(GhostMesh.prototype, 'sync');

    renderer.syncFromContext(ctx);
    renderer.syncFromContext(ctx);
    renderer.syncFromContext(ctx);
    renderer.syncFromContext(ctx);

    expect(syncSpy).toHaveBeenCalledTimes(1);
    syncSpy.mockRestore();
  });
});
