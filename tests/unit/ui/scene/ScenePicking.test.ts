// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { pickScene, ScenePicking, HOVER_TAG_DWELL_MS, type EntityPick } from '../../../../src/ui/scene/ScenePicking.js';
import { BuildingMesh } from '../../../../src/renderer/BuildingMesh.js';
import { VehicleMesh } from '../../../../src/renderer/VehicleMesh.js';
import { CharacterMesh } from '../../../../src/renderer/CharacterMesh.js';
import { FragmentMesh } from '../../../../src/renderer/FragmentMesh.js';
import { TerrainMesh } from '../../../../src/renderer/TerrainMesh.js';
import { VoxelGrid, type VoxelData } from '../../../../src/core/world/VoxelGrid.js';
import type { GameRenderer } from '../../../../src/renderer/GameRenderer.js';

function makeSolidVoxel(rockId = 'sandite'): VoxelData {
  return { composition: { rocks: [{ rockId, coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };
}

/** Camera positioned directly above (x, z), looking straight down — NDC (0,0) hits whatever is at that column. */
function makeTopDownCamera(x: number, z: number, y = 30): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(x, y, z);
  camera.lookAt(x, 0, z);
  camera.updateMatrixWorld();
  return camera;
}

/** Minimal stand-in for GameRenderer exposing only what pickScene() reads. */
function makeFakeRenderer(opts: {
  pickables?: THREE.Object3D[];
  terrainMeshes?: THREE.Mesh[];
  landscapeMeshes?: THREE.Mesh[];
  fragments?: FragmentMesh;
}): GameRenderer {
  return {
    pickables: () => opts.pickables ?? [],
    rampIdAtTile: () => null,
    terrain: opts.terrainMeshes ? { meshes: opts.terrainMeshes } : null,
    // Mirrors GameRenderer's public `landscape` field (#558) — pickScene must
    // fall back to it so ground past the site's claimed edge can be aimed at.
    landscape: opts.landscapeMeshes ? { meshes: opts.landscapeMeshes } : null,
    resolveFragmentId: (bucketIndex: number, instanceId: number) =>
      opts.fragments?.fragmentIdAt(bucketIndex, instanceId) ?? null,
  } as unknown as GameRenderer;
}

/** A flat, featureless landscape quad at world height `y`, standing in for LandscapeMesh's real tile geometry. */
function makeFlatLandscapeMesh(y = 0, size = 40): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(size, size);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.position.set(0, y, 0);
  mesh.updateMatrixWorld();
  return mesh;
}

function makeSolidTerrain(sizeX = 8, sizeY = 4, sizeZ = 8): TerrainMesh {
  const scene = new THREE.Scene();
  const grid = new VoxelGrid(sizeX, sizeZ);
  for (let x = 0; x < sizeX; x++)
    for (let y = 0; y < sizeY; y++)
      for (let z = 0; z < sizeZ; z++)
        grid.setVoxel(x, y, z, makeSolidVoxel());
  const tm = new TerrainMesh(scene, grid);
  tm.buildAll();
  return tm;
}

describe('pickScene', () => {
  it('returns an empty pick when the ray hits nothing', () => {
    const camera = makeTopDownCamera(5, 5);
    const renderer = makeFakeRenderer({});
    const result = pickScene(0, 0, camera, renderer);
    expect(result.entity).toBeNull();
    expect(result.terrain).toBeNull();
  });

  it('resolves a building hit to its (kind, id)', () => {
    const scene = new THREE.Scene();
    const bm = new BuildingMesh(scene);
    bm.addBuilding({ id: 7, type: 'management_office', tier: 1, x: 4, z: 4, hp: 100, active: true, occupantIds: [] }, 0);
    scene.updateMatrixWorld(true); // group transforms are never auto-updated without a render() call
    const camera = makeTopDownCamera(5, 5); // management_office is 2x2 footprint centred at (5,0,5)
    const renderer = makeFakeRenderer({ pickables: bm.pickables() });

    const result = pickScene(0, 0, camera, renderer);
    expect(result.entity).toEqual(expect.objectContaining({ kind: 'building', id: 7 }));
    expect(result.terrain).toBeNull();
    bm.dispose();
  });

  it('resolves a vehicle hit to its (kind, id)', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const vehicle = { id: 3, type: 'debris_hauler', x: 5, z: 5, hp: 100, tier: 1, cargo: [], occupantIds: [] } as never;
    vm.addVehicle(vehicle, { vehicles: [vehicle], nextId: 4, driverBoardingCount: 0, reservations: [] } as never, [], 0);
    scene.updateMatrixWorld(true);
    const camera = makeTopDownCamera(5, 5);
    const renderer = makeFakeRenderer({ pickables: vm.pickables() });

    const result = pickScene(0, 0, camera, renderer);
    expect(result.entity).toEqual(expect.objectContaining({ kind: 'vehicle', id: 3 }));
    vm.dispose();
  });

  it('resolves an employee hit to its (kind, id)', () => {
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene);
    cm.addEmployee({ id: 9, name: 'Test', role: 'driller', salary: 100, morale: 50, unionized: false, injured: false, alive: true, x: 5, z: 5 } as never, 0);
    scene.updateMatrixWorld(true);
    const camera = makeTopDownCamera(5, 5);
    const renderer = makeFakeRenderer({ pickables: cm.pickables() });

    const result = pickScene(0, 0, camera, renderer);
    expect(result.entity).toEqual(expect.objectContaining({ kind: 'employee', id: 9 }));
    cm.dispose();
  });

  it('resolves a fragment hit through its bucket instance', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene, new THREE.MeshBasicMaterial());
    fm.spawnFragments([{
      id: 12, position: { x: 5, y: 0.5, z: 5 }, volume: 4, mass: 1000,
      rockId: 'sandite', oreDensities: {}, initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false,
      halfExtents: { x: 0.4, y: 0.4, z: 0.4 }, shapeSeed: 12,
      origin: { x: 5, y: 0.5, z: 5 },
    }]);
    const camera = makeTopDownCamera(5, 5);
    const renderer = makeFakeRenderer({ pickables: fm.pickables(), fragments: fm });

    const result = pickScene(0, 0, camera, renderer);
    expect(result.entity).toEqual(expect.objectContaining({ kind: 'fragment', id: 12 }));
    fm.dispose();
  });

  it('raw-ground picks (selectRamps=false) see through fragments to the terrain beneath', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene, new THREE.MeshBasicMaterial());
    fm.spawnFragments([{
      id: 12, position: { x: 5.5, y: 0.5, z: 5.5 }, volume: 4, mass: 1000,
      rockId: 'sandite', oreDensities: {}, initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false,
      halfExtents: { x: 0.4, y: 0.4, z: 0.4 }, shapeSeed: 12,
      origin: { x: 5.5, y: 0.5, z: 5.5 },
    }]);
    const tm = makeSolidTerrain();
    const camera = makeTopDownCamera(5.5, 5.5);
    const renderer = makeFakeRenderer({ pickables: fm.pickables(), fragments: fm, terrainMeshes: tm.meshes });

    const result = pickScene(0, 0, camera, renderer, undefined, false);
    expect(result.entity).toBeNull();
    expect(result.terrain).toEqual(expect.objectContaining({ tileX: 5, tileZ: 5 }));
    fm.dispose();
    tm.dispose();
  });

  it('falls back to terrain with floored tile coordinates when no entity is hit', () => {
    const tm = makeSolidTerrain();
    const camera = makeTopDownCamera(3.7, 2.2);
    const renderer = makeFakeRenderer({ terrainMeshes: tm.meshes });

    const result = pickScene(0, 0, camera, renderer);
    expect(result.entity).toBeNull();
    expect(result.terrain).toEqual(expect.objectContaining({ tileX: 3, tileZ: 2 }));
    tm.dispose();
  });

  it('an entity above the terrain surface wins over the terrain beneath it', () => {
    const tm = makeSolidTerrain(8, 4, 8); // solid up to y=4, surface at y=4
    const scene = new THREE.Scene();
    const bm = new BuildingMesh(scene);
    bm.addBuilding({ id: 1, type: 'management_office', tier: 1, x: 4, z: 4, hp: 100, active: true, occupantIds: [] }, 4); // sits on the surface
    scene.updateMatrixWorld(true);
    // Off pure-integer so the pick point can't land exactly on a tile boundary
    // (the marching-cubes surface isn't a perfectly flat integer-aligned plane).
    const camera = makeTopDownCamera(5.3, 5.3, 60);
    const renderer = makeFakeRenderer({ pickables: bm.pickables(), terrainMeshes: tm.meshes });

    const result = pickScene(0, 0, camera, renderer);
    expect(result.entity).toEqual(expect.objectContaining({ kind: 'building', id: 1 }));
    bm.dispose();
    tm.dispose();
  });

  it('terrain in front of an entity occludes it (depth-correct, not kind-priority)', () => {
    const tm = makeSolidTerrain(8, 4, 8); // solid column top at y=4
    const scene = new THREE.Scene();
    const bm = new BuildingMesh(scene);
    // Buried well below the terrain surface — camera above should hit the terrain top first.
    bm.addBuilding({ id: 1, type: 'management_office', tier: 1, x: 4, z: 4, hp: 100, active: true, occupantIds: [] }, -10);
    scene.updateMatrixWorld(true);
    const camera = makeTopDownCamera(5.3, 5.3, 60);
    const renderer = makeFakeRenderer({ pickables: bm.pickables(), terrainMeshes: tm.meshes });

    const result = pickScene(0, 0, camera, renderer);
    expect(result.entity).toBeNull();
    expect(result.terrain).toEqual(expect.objectContaining({ tileX: 5, tileZ: 5 }));
    bm.dispose();
    tm.dispose();
  });

  // ── #558: landscape past the site's claimed edge joins the raycast ──────

  it('resolves a terrain pick against a landscape mesh when no terrain mesh is present', () => {
    const landscape = makeFlatLandscapeMesh();
    const camera = makeTopDownCamera(3.7, 2.2);
    const renderer = makeFakeRenderer({ landscapeMeshes: [landscape] });

    const result = pickScene(0, 0, camera, renderer);
    expect(result.entity).toBeNull();
    expect(result.terrain).toEqual(expect.objectContaining({ tileX: 3, tileZ: 2 }));
  });

  it('falls back to the landscape mesh when a terrain mesh is present but the ray misses it', () => {
    const tm = makeSolidTerrain(8, 4, 8); // solid terrain only spans x,z in [0,8)
    const landscape = makeFlatLandscapeMesh(0, 200); // far past the terrain's own footprint
    // Aim well outside the terrain mesh's footprint, onto the landscape only.
    const camera = makeTopDownCamera(50.5, 40.5);
    const renderer = makeFakeRenderer({ terrainMeshes: tm.meshes, landscapeMeshes: [landscape] });

    const result = pickScene(0, 0, camera, renderer);
    expect(result.entity).toBeNull();
    expect(result.terrain).toEqual(expect.objectContaining({ tileX: 50, tileZ: 40 }));
    tm.dispose();
  });

  it('depth decides between an entity and the landscape the same way it does for terrain — not mesh kind', () => {
    const landscape = makeFlatLandscapeMesh(0, 200);
    const scene = new THREE.Scene();
    const bm = new BuildingMesh(scene);
    bm.addBuilding({ id: 1, type: 'management_office', tier: 1, x: 50, z: 50, hp: 100, active: true, occupantIds: [] }, 4); // sits above the landscape
    scene.updateMatrixWorld(true);
    const camera = makeTopDownCamera(51.3, 51.3, 60);
    const renderer = makeFakeRenderer({ pickables: bm.pickables(), landscapeMeshes: [landscape] });

    const result = pickScene(0, 0, camera, renderer);
    expect(result.entity).toEqual(expect.objectContaining({ kind: 'building', id: 1 }));
    bm.dispose();
  });
});

describe('ScenePicking (class — canvas wiring, debounce, click-vs-drag)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function makeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}),
    });
    return canvas;
  }

  /** pickScene() always calls renderer.pickables()/renderer.terrain before the (stubbed) raycast ever runs — needs real no-op implementations, not `{}`. */
  function makeStubRenderer(): GameRenderer {
    return { pickables: () => [], terrain: null, resolveFragmentId: () => null } as unknown as GameRenderer;
  }

  /** Every raycast in these tests resolves to `hit` (or nothing) regardless of geometry — isolates the class's event/timing logic from pickScene's own (separately tested) raycasting math. */
  function stubHit(hit: EntityPick | null): void {
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue(
      hit
        ? [{
            object: (() => { const o = new THREE.Object3D(); o.userData['entityKind'] = hit.kind; o.userData['entityId'] = hit.id; return o; })(),
            distance: hit.distance,
            point: hit.point,
          } as THREE.Intersection]
        : [],
    );
  }

  function fireMouse(canvas: HTMLCanvasElement, type: string, x: number, y: number, button = 0): void {
    canvas.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button, bubbles: true }));
  }

  const SAMPLE_HIT: EntityPick = { kind: 'employee', id: 5, point: new THREE.Vector3(1, 0, 1), distance: 10 };

  // ── #1766: the aim latch is gone; moves use the in-scene point pick ─────

  it('exposes no aim latch (moves arm the point pick instead)', () => {
    vi.useFakeTimers();
    const canvas = makeCanvas();
    stubHit(SAMPLE_HIT);
    const sp = new ScenePicking(canvas, new THREE.PerspectiveCamera(), makeStubRenderer());
    fireMouse(canvas, 'mousemove', 400, 300);
    vi.advanceTimersByTime(100);
    expect('aim' in sp).toBe(false);
    expect((sp as unknown as Record<string, unknown>).aim).toBeUndefined();
  });

  it('still clears hover when the cursor leaves the canvas', () => {
    vi.useFakeTimers();
    const canvas = makeCanvas();
    stubHit(SAMPLE_HIT);
    const sp = new ScenePicking(canvas, new THREE.PerspectiveCamera(), makeStubRenderer());
    fireMouse(canvas, 'mousemove', 400, 300);
    vi.advanceTimersByTime(100);
    expect(sp.hover).not.toBeNull();
    canvas.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(sp.hover).toBeNull();
  });

  it('does not fire the hover handler before the 60ms delay elapses', () => {
    vi.useFakeTimers();
    const canvas = makeCanvas();
    stubHit(SAMPLE_HIT);
    const sp = new ScenePicking(canvas, new THREE.PerspectiveCamera(), makeStubRenderer());
    const onHover = vi.fn();
    sp.setHoverChangeHandler(onHover);

    fireMouse(canvas, 'mousemove', 100, 100);
    vi.advanceTimersByTime(59);
    expect(onHover).not.toHaveBeenCalled();
    sp.dispose();
  });

  it('fires the hover handler once the 60ms delay elapses', () => {
    vi.useFakeTimers();
    const canvas = makeCanvas();
    stubHit(SAMPLE_HIT);
    const sp = new ScenePicking(canvas, new THREE.PerspectiveCamera(), makeStubRenderer());
    const onHover = vi.fn();
    sp.setHoverChangeHandler(onHover);

    fireMouse(canvas, 'mousemove', 100, 100);
    vi.advanceTimersByTime(60);
    expect(onHover).toHaveBeenCalledTimes(1);
    expect(onHover.mock.calls[0]![0]).toEqual(expect.objectContaining({ entity: expect.objectContaining({ kind: 'employee', id: 5 }) }));
    sp.dispose();
  });

  it('repeated moves over the same target do not restart or repeat the hover timer', () => {
    vi.useFakeTimers();
    const canvas = makeCanvas();
    stubHit(SAMPLE_HIT);
    const sp = new ScenePicking(canvas, new THREE.PerspectiveCamera(), makeStubRenderer());
    const onHover = vi.fn();
    sp.setHoverChangeHandler(onHover);

    fireMouse(canvas, 'mousemove', 100, 100);
    vi.advanceTimersByTime(30);
    fireMouse(canvas, 'mousemove', 101, 101); // same resolved target — same pick every time (stubbed)
    vi.advanceTimersByTime(30); // 60ms since the first move, but the second move didn't reset lastHoverKey's timer path
    expect(onHover).toHaveBeenCalledTimes(1);
    sp.dispose();
  });

  it('moving to a new target clears the pending timer and starts a fresh one', () => {
    vi.useFakeTimers();
    const canvas = makeCanvas();
    const sp = new ScenePicking(canvas, new THREE.PerspectiveCamera(), makeStubRenderer());
    const onHover = vi.fn();
    sp.setHoverChangeHandler(onHover);

    stubHit({ kind: 'employee', id: 1, point: new THREE.Vector3(), distance: 5 });
    fireMouse(canvas, 'mousemove', 100, 100);
    vi.advanceTimersByTime(40);
    stubHit({ kind: 'vehicle', id: 2, point: new THREE.Vector3(), distance: 5 });
    fireMouse(canvas, 'mousemove', 200, 200);
    vi.advanceTimersByTime(40); // 80ms since the first move, but only 40ms since the second — first must not have fired
    expect(onHover).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20); // 60ms since the second move
    expect(onHover).toHaveBeenCalledTimes(1);
    expect(onHover.mock.calls[0]![0]).toEqual(expect.objectContaining({ entity: expect.objectContaining({ kind: 'vehicle', id: 2 }) }));
    sp.dispose();
  });

  it('mouseleave hides the hover immediately, without waiting for the delay', () => {
    vi.useFakeTimers();
    const canvas = makeCanvas();
    stubHit(SAMPLE_HIT);
    const sp = new ScenePicking(canvas, new THREE.PerspectiveCamera(), makeStubRenderer());
    const onHover = vi.fn();
    sp.setHoverChangeHandler(onHover);
    fireMouse(canvas, 'mousemove', 100, 100);
    vi.advanceTimersByTime(60);
    onHover.mockClear();

    canvas.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(onHover).toHaveBeenCalledWith(null);
    sp.dispose();
  });

  it('a click within the movement threshold selects the hit entity', () => {
    const canvas = makeCanvas();
    stubHit(SAMPLE_HIT);
    const sp = new ScenePicking(canvas, new THREE.PerspectiveCamera(), makeStubRenderer());
    const onSelect = vi.fn();
    sp.setSelectChangeHandler(onSelect);

    fireMouse(canvas, 'mousedown', 100, 100);
    fireMouse(canvas, 'mouseup', 102, 101); // 2px of jitter — still a click
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: 'employee', id: 5 }));
    expect(sp.selection).toEqual(expect.objectContaining({ kind: 'employee', id: 5 }));
    sp.dispose();
  });

  it('a drag beyond the movement threshold does not select', () => {
    const canvas = makeCanvas();
    stubHit(SAMPLE_HIT);
    const sp = new ScenePicking(canvas, new THREE.PerspectiveCamera(), makeStubRenderer());
    const onSelect = vi.fn();
    sp.setSelectChangeHandler(onSelect);

    fireMouse(canvas, 'mousedown', 100, 100);
    fireMouse(canvas, 'mouseup', 160, 100); // 60px — a camera-orbit drag, not a click
    expect(onSelect).not.toHaveBeenCalled();
    expect(sp.selection).toBeNull();
    sp.dispose();
  });

  it('right-button mouseup is ignored (camera panning owns the right button)', () => {
    const canvas = makeCanvas();
    stubHit(SAMPLE_HIT);
    const sp = new ScenePicking(canvas, new THREE.PerspectiveCamera(), makeStubRenderer());
    const onSelect = vi.fn();
    sp.setSelectChangeHandler(onSelect);

    fireMouse(canvas, 'mousedown', 100, 100, 2);
    fireMouse(canvas, 'mouseup', 100, 100, 2);
    expect(onSelect).not.toHaveBeenCalled();
    sp.dispose();
  });

  it('clicking empty ground deselects the current selection', () => {
    const canvas = makeCanvas();
    stubHit(SAMPLE_HIT);
    const sp = new ScenePicking(canvas, new THREE.PerspectiveCamera(), makeStubRenderer());
    fireMouse(canvas, 'mousedown', 100, 100);
    fireMouse(canvas, 'mouseup', 100, 100);
    expect(sp.selection).not.toBeNull();

    const onSelect = vi.fn();
    sp.setSelectChangeHandler(onSelect);
    stubHit(null);
    fireMouse(canvas, 'mousedown', 300, 300);
    fireMouse(canvas, 'mouseup', 300, 300);
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(sp.selection).toBeNull();
    sp.dispose();
  });

  it('select() sets the selection and fires the handler directly, without a scene click', () => {
    const canvas = makeCanvas();
    const sp = new ScenePicking(canvas, new THREE.PerspectiveCamera(), makeStubRenderer());
    const onSelect = vi.fn();
    sp.setSelectChangeHandler(onSelect);

    sp.select(SAMPLE_HIT);
    expect(onSelect).toHaveBeenCalledWith(SAMPLE_HIT);
    expect(sp.selection).toBe(SAMPLE_HIT);
    sp.dispose();
  });

  it('clearSelection() deselects and fires the handler with null', () => {
    const canvas = makeCanvas();
    const sp = new ScenePicking(canvas, new THREE.PerspectiveCamera(), makeStubRenderer());
    sp.select(SAMPLE_HIT);
    const onSelect = vi.fn();
    sp.setSelectChangeHandler(onSelect);

    sp.clearSelection();
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(sp.selection).toBeNull();
    sp.dispose();
  });

  it('no hover fires while a drag is in progress (any button)', () => {
    vi.useFakeTimers();
    const canvas = makeCanvas();
    stubHit(SAMPLE_HIT);
    const sp = new ScenePicking(canvas, new THREE.PerspectiveCamera(), makeStubRenderer());
    const onHover = vi.fn();
    sp.setHoverChangeHandler(onHover);

    fireMouse(canvas, 'mousedown', 100, 100, 2); // right-button pan
    fireMouse(canvas, 'mousemove', 150, 150, 2);
    vi.advanceTimersByTime(100);
    expect(onHover).not.toHaveBeenCalled();
    sp.dispose();
  });

  it('dispose() removes listeners — events after dispose do nothing', () => {
    const canvas = makeCanvas();
    stubHit(SAMPLE_HIT);
    const sp = new ScenePicking(canvas, new THREE.PerspectiveCamera(), makeStubRenderer());
    const onSelect = vi.fn();
    sp.setSelectChangeHandler(onSelect);
    sp.dispose();

    fireMouse(canvas, 'mousedown', 100, 100);
    fireMouse(canvas, 'mouseup', 100, 100);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('dispose() clears the canvas cursor', () => {
    const canvas = makeCanvas();
    stubHit(SAMPLE_HIT);
    const sp = new ScenePicking(canvas, new THREE.PerspectiveCamera(), makeStubRenderer());
    canvas.style.cursor = 'pointer';
    sp.dispose();
    expect(canvas.style.cursor).toBe('');
  });
});

// ── #1752: rest (dwell) detection for the hover tag ──────────────────────────

describe('ScenePicking — rest handler (#1752)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function makeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}),
    });
    return canvas;
  }

  function makeRenderer(): GameRenderer {
    return { pickables: () => [], terrain: null, rampIdAtTile: () => null, resolveFragmentId: () => null } as unknown as GameRenderer;
  }

  /** The next raycast resolves to bare terrain at tile (x, z). */
  function stubTile(x: number, z: number): void {
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([
      { object: new THREE.Object3D(), distance: 10, point: new THREE.Vector3(x + 0.5, 0, z + 0.5) } as THREE.Intersection,
    ]);
  }

  function stubEntity(): void {
    const o = new THREE.Object3D();
    o.userData['entityKind'] = 'building';
    o.userData['entityId'] = 3;
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([
      { object: o, distance: 10, point: new THREE.Vector3(1, 0, 1) } as THREE.Intersection,
    ]);
  }

  function move(canvas: HTMLCanvasElement, x = 100, y = 100): void {
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
  }

  function setup() {
    vi.useFakeTimers();
    const canvas = makeCanvas();
    const sp = new ScenePicking(canvas, new THREE.PerspectiveCamera(), makeRenderer());
    const onRest = vi.fn();
    sp.setRestChangeHandler(onRest);
    return { canvas, sp, onRest };
  }

  it('dwell is far longer than the 60ms hover re-pick', () => {
    expect(HOVER_TAG_DWELL_MS).toBeGreaterThan(60);
  });

  it('does not fire at the 60ms hover delay', () => {
    const { canvas, sp, onRest } = setup();
    stubTile(3, 4);
    move(canvas);
    vi.advanceTimersByTime(60);
    expect(onRest).not.toHaveBeenCalled();
    sp.dispose();
  });

  it('does not fire one millisecond before the dwell elapses', () => {
    const { canvas, sp, onRest } = setup();
    stubTile(3, 4);
    move(canvas);
    vi.advanceTimersByTime(HOVER_TAG_DWELL_MS - 1);
    expect(onRest).not.toHaveBeenCalled();
    sp.dispose();
  });

  it('fires once with the pick when the dwell elapses', () => {
    const { canvas, sp, onRest } = setup();
    stubTile(3, 4);
    move(canvas);
    vi.advanceTimersByTime(HOVER_TAG_DWELL_MS);
    expect(onRest).toHaveBeenCalledTimes(1);
    expect(onRest.mock.calls[0]![0]).toEqual(expect.objectContaining({
      terrain: expect.objectContaining({ tileX: 3, tileZ: 4 }),
    }));
    vi.advanceTimersByTime(HOVER_TAG_DWELL_MS * 3);
    expect(onRest).toHaveBeenCalledTimes(1);
    sp.dispose();
  });

  it('repeated moves over the same tile do not restart the dwell', () => {
    const { canvas, sp, onRest } = setup();
    stubTile(3, 4);
    move(canvas);
    vi.advanceTimersByTime(HOVER_TAG_DWELL_MS - 100);
    move(canvas, 101, 101);
    vi.advanceTimersByTime(100);
    expect(onRest).toHaveBeenCalledTimes(1);
    sp.dispose();
  });

  it('sweeping across tiles faster than the dwell never fires', () => {
    const { canvas, sp, onRest } = setup();
    for (let x = 0; x < 20; x++) {
      stubTile(x, 4);
      move(canvas, 100 + x, 100);
      vi.advanceTimersByTime(HOVER_TAG_DWELL_MS - 50);
    }
    expect(onRest).not.toHaveBeenCalled();
    sp.dispose();
  });

  it('moving to another tile after a rest fires null, then fires the new pick after a fresh dwell', () => {
    const { canvas, sp, onRest } = setup();
    stubTile(3, 4);
    move(canvas);
    vi.advanceTimersByTime(HOVER_TAG_DWELL_MS);
    onRest.mockClear();

    stubTile(5, 4);
    move(canvas, 140, 100);
    expect(onRest).toHaveBeenCalledTimes(1);
    expect(onRest).toHaveBeenLastCalledWith(null);
    vi.advanceTimersByTime(HOVER_TAG_DWELL_MS - 1);
    expect(onRest).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onRest).toHaveBeenCalledTimes(2);
    expect(onRest.mock.calls[1]![0]).toEqual(expect.objectContaining({
      terrain: expect.objectContaining({ tileX: 5, tileZ: 4 }),
    }));
    sp.dispose();
  });

  it('moving to another tile before any rest does not fire null', () => {
    const { canvas, sp, onRest } = setup();
    stubTile(3, 4);
    move(canvas);
    vi.advanceTimersByTime(100);
    stubTile(5, 4);
    move(canvas, 140, 100);
    expect(onRest).not.toHaveBeenCalled();
    sp.dispose();
  });

  it('an entity pick also rests (the consumer decides it shows nothing)', () => {
    const { canvas, sp, onRest } = setup();
    stubEntity();
    move(canvas);
    vi.advanceTimersByTime(HOVER_TAG_DWELL_MS);
    expect(onRest).toHaveBeenCalledTimes(1);
    expect(onRest.mock.calls[0]![0]).toEqual(expect.objectContaining({
      entity: expect.objectContaining({ kind: 'building', id: 3 }),
    }));
    sp.dispose();
  });

  it('mouseleave after a rest fires null', () => {
    const { canvas, sp, onRest } = setup();
    stubTile(3, 4);
    move(canvas);
    vi.advanceTimersByTime(HOVER_TAG_DWELL_MS);
    onRest.mockClear();
    canvas.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(onRest).toHaveBeenCalledWith(null);
    sp.dispose();
  });

  it('mouseleave before the dwell elapses cancels it', () => {
    const { canvas, sp, onRest } = setup();
    stubTile(3, 4);
    move(canvas);
    vi.advanceTimersByTime(HOVER_TAG_DWELL_MS - 50);
    canvas.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    vi.advanceTimersByTime(HOVER_TAG_DWELL_MS);
    expect(onRest).not.toHaveBeenCalledWith(expect.objectContaining({ terrain: expect.anything() }));
    sp.dispose();
  });

  it('mousedown after a rest fires null, and no rest follows during the drag', () => {
    const { canvas, sp, onRest } = setup();
    stubTile(3, 4);
    move(canvas);
    vi.advanceTimersByTime(HOVER_TAG_DWELL_MS);
    onRest.mockClear();
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, button: 0, bubbles: true }));
    expect(onRest).toHaveBeenCalledWith(null);
    onRest.mockClear();
    stubTile(6, 6);
    move(canvas, 200, 200);
    vi.advanceTimersByTime(HOVER_TAG_DWELL_MS * 2);
    expect(onRest).not.toHaveBeenCalled();
    sp.dispose();
  });

  it('mousedown before the dwell elapses cancels it', () => {
    const { canvas, sp, onRest } = setup();
    stubTile(3, 4);
    move(canvas);
    vi.advanceTimersByTime(HOVER_TAG_DWELL_MS - 50);
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, button: 2, bubbles: true }));
    vi.advanceTimersByTime(HOVER_TAG_DWELL_MS);
    expect(onRest).not.toHaveBeenCalledWith(expect.objectContaining({ terrain: expect.anything() }));
    sp.dispose();
  });

  it('setEnabled(false) after a rest fires null', () => {
    const { canvas, sp, onRest } = setup();
    stubTile(3, 4);
    move(canvas);
    vi.advanceTimersByTime(HOVER_TAG_DWELL_MS);
    onRest.mockClear();
    sp.setEnabled(false);
    expect(onRest).toHaveBeenCalledWith(null);
    sp.dispose();
  });

  it('setEnabled(false) before the dwell elapses cancels it', () => {
    const { canvas, sp, onRest } = setup();
    stubTile(3, 4);
    move(canvas);
    vi.advanceTimersByTime(HOVER_TAG_DWELL_MS - 50);
    sp.setEnabled(false);
    vi.advanceTimersByTime(HOVER_TAG_DWELL_MS);
    expect(onRest).not.toHaveBeenCalledWith(expect.objectContaining({ terrain: expect.anything() }));
    sp.dispose();
  });

  it('leaves the 60ms hover timing unchanged', () => {
    const { canvas, sp } = setup();
    const onHover = vi.fn();
    sp.setHoverChangeHandler(onHover);
    stubTile(3, 4);
    move(canvas);
    vi.advanceTimersByTime(60);
    expect(onHover).toHaveBeenCalledTimes(1);
    expect(sp.hover?.terrain?.tileX).toBe(3);
    sp.dispose();
  });
});

// ── #1298: a built ramp is pickable when no entity is hit ─────────────────────

describe('pickScene — ramps (#1298)', () => {
  /** The renderer resolves a terrain tile to the id of the built ramp covering it (contract: `rampIdAtTile`). */
  function withRamps(base: GameRenderer, rampIdAtTile: (x: number, z: number) => number | null): GameRenderer {
    return Object.assign(base, { rampIdAtTile }) as GameRenderer;
  }

  it('returns a ramp entity for a terrain hit on a ramp tile', () => {
    const tm = makeSolidTerrain();
    const camera = makeTopDownCamera(3.7, 2.2);
    const renderer = withRamps(makeFakeRenderer({ terrainMeshes: tm.meshes }), (x, z) => (x === 3 && z === 2 ? 4 : null));

    const result = pickScene(0, 0, camera, renderer);
    expect(result.entity).toEqual(expect.objectContaining({ kind: 'ramp', id: 4 }));
    tm.dispose();
  });

  it('keeps the ground tile under a ramp, so Move Here can target a ramp tile', () => {
    const tm = makeSolidTerrain();
    const camera = makeTopDownCamera(3.7, 2.2);
    const renderer = withRamps(makeFakeRenderer({ terrainMeshes: tm.meshes }), (x, z) => (x === 3 && z === 2 ? 4 : null));

    const result = pickScene(0, 0, camera, renderer);
    expect(result.terrain).toEqual(expect.objectContaining({ tileX: 3, tileZ: 2 }));
    tm.dispose();
  });

  it('keeps plain terrain for a tile that is not on any ramp', () => {
    const tm = makeSolidTerrain();
    const camera = makeTopDownCamera(3.7, 2.2);
    const renderer = withRamps(makeFakeRenderer({ terrainMeshes: tm.meshes }), () => null);

    const result = pickScene(0, 0, camera, renderer);
    expect(result.entity).toBeNull();
    expect(result.terrain).toEqual(expect.objectContaining({ tileX: 3, tileZ: 2 }));
    tm.dispose();
  });

  it('a building on a ramp tile keeps priority over the ramp', () => {
    const scene = new THREE.Scene();
    const bm = new BuildingMesh(scene);
    bm.addBuilding({ id: 7, type: 'management_office', tier: 1, x: 4, z: 4, hp: 100, active: true, occupantIds: [] }, 0);
    scene.updateMatrixWorld(true);
    const camera = makeTopDownCamera(5, 5);
    const renderer = withRamps(makeFakeRenderer({ pickables: bm.pickables() }), () => 1);

    const result = pickScene(0, 0, camera, renderer);
    expect(result.entity).toEqual(expect.objectContaining({ kind: 'building', id: 7 }));
    bm.dispose();
  });

  it('a vehicle on a ramp tile keeps priority over the ramp', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const vehicle = { id: 3, type: 'debris_hauler', x: 5, z: 5, hp: 100, tier: 1, cargo: [], occupantIds: [] } as never;
    vm.addVehicle(vehicle, { vehicles: [vehicle], nextId: 4, driverBoardingCount: 0, reservations: [] } as never, [], 0);
    scene.updateMatrixWorld(true);
    const camera = makeTopDownCamera(5, 5);
    const renderer = withRamps(makeFakeRenderer({ pickables: vm.pickables() }), () => 1);

    const result = pickScene(0, 0, camera, renderer);
    expect(result.entity).toEqual(expect.objectContaining({ kind: 'vehicle', id: 3 }));
    vm.dispose();
  });

  it('resolves ramps on the landscape fallback too and reports the hit point and distance', () => {
    const landscape = makeFlatLandscapeMesh();
    const camera = makeTopDownCamera(3.7, 2.2);
    const renderer = withRamps(makeFakeRenderer({ landscapeMeshes: [landscape] }), (x, z) => (x === 3 && z === 2 ? 2 : null));

    const result = pickScene(0, 0, camera, renderer);
    expect(result.entity).toEqual(expect.objectContaining({ kind: 'ramp', id: 2 }));
    expect(result.entity!.distance).toBeGreaterThan(0);
  });
});
