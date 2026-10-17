// BlastSimulator2026 — buildSurveyOverlayOptions() unit tests (#770)
//
// buildSurveyOverlayOptions() currently runs its own manual top-down voxel
// scan to find each survey column's surface Y, using a stale
// `voxel.density > 0` threshold. computeVoxelColumnSurfaceY() (VoxelGrid.ts)
// is the canonical scan and uses the correct isSolidAt threshold
// (density >= 0.5). The two diverge on a fractional-density voxel (#458
// terrain overhaul introduced these), which is exactly what test 2 below
// pins down as a regression: it must fail against the current unfixed
// buildSurveyOverlayOptions() and pass once it delegates to
// computeVoxelColumnSurfaceY().

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { buildSurveyOverlayOptions, syncGameRendererEntities } from '../../../src/renderer/GameRendererSync.js';
import type { SyncDeps } from '../../../src/renderer/GameRendererSync.js';
import { VoxelGrid, firstEmptyLayerAboveGround } from '../../../src/core/world/VoxelGrid.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { SurveyResult } from '../../../src/core/mining/SurveyCalc.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { addHole } from '../../../src/core/mining/DrillPlan.js';
import { columnOreValuePerM3 } from '../../../src/core/mining/BlastValueEstimate.js';
import { Random } from '../../../src/core/math/Random.js';
import { CharacterMesh } from '../../../src/renderer/CharacterMesh.js';
import { RampArrowLayer } from '../../../src/renderer/RampArrow.js';
import type { PlannedRamp } from '../../../src/core/state/GameState.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { GameRenderer } from '../../../src/renderer/GameRenderer.js';
import { makeMockSceneManager, makeCtx } from '../../helpers/rendererFixtures.js';

const holeCounter = { nextHoleId: 1 };

function makeSurveyResult(overrides: Partial<SurveyResult> = {}): SurveyResult {
  return {
    id: 1,
    method: 'seismic',
    centerX: 5,
    centerZ: 5,
    completedTick: 0,
    surveyorId: 1,
    estimates: { '5,5': { sparkium: 0.5 } },
    confidence: 0.85,
    ...overrides,
  };
}

function makeState(surveyResults: SurveyResult[]): GameState {
  const state = createGame({ seed: 42, startingCash: 100_000 });
  state.surveyResults = surveyResults;
  return state;
}

describe('buildSurveyOverlayOptions()', () => {
  it('matches computeVoxelColumnSurfaceY for a fully-solid column', () => {
    const grid = new VoxelGrid(20, 20);
    for (let y = 0; y <= 3; y++) {
      grid.fillVoxel(5, y, 5, 0, undefined, 1.0);
    }
    const state = makeState([makeSurveyResult()]);

    const options = buildSurveyOverlayOptions(state, grid);

    expect(options).not.toBeNull();
    const point = options!.points.find(p => p.x === 5 && p.z === 5);
    expect(point).toBeDefined();
    expect(point!.surfaceY).toBe(firstEmptyLayerAboveGround(grid, 5, 5));
    expect(point!.surfaceY).toBe(4);
  });

  it('uses the isSolidAt (density >= 0.5) threshold on a fractional-density band, not density > 0', () => {
    const grid = new VoxelGrid(20, 20);
    grid.fillVoxel(5, 0, 5, 0, undefined, 1.0);
    grid.fillVoxel(5, 1, 5, 0, undefined, 1.0);
    grid.fillVoxel(5, 2, 5, 0, undefined, 1.0);
    // Below the isSolidAt threshold (0.5) but above 0 — the old
    // `density > 0` scan would wrongly treat this voxel as solid.
    grid.fillVoxel(5, 3, 5, 0, undefined, 0.2);
    const state = makeState([makeSurveyResult()]);

    const options = buildSurveyOverlayOptions(state, grid);

    expect(options).not.toBeNull();
    const point = options!.points.find(p => p.x === 5 && p.z === 5);
    expect(point).toBeDefined();
    // Correct: topmost isSolidAt-true voxel (y=2) + 1 = 3.
    // The unfixed manual scan returns 4 (treats y=3's density 0.2 as solid).
    expect(point!.surfaceY).toBe(3);
    expect(point!.surfaceY).toBe(firstEmptyLayerAboveGround(grid, 5, 5));
  });

  it('returns surfaceY 0 for a column with no solid voxel anywhere', () => {
    const grid = new VoxelGrid(20, 20);
    // No fillVoxel calls on column (5,5) — stays air.
    const state = makeState([makeSurveyResult()]);

    const options = buildSurveyOverlayOptions(state, grid);

    expect(options).not.toBeNull();
    const point = options!.points.find(p => p.x === 5 && p.z === 5);
    expect(point).toBeDefined();
    expect(point!.surfaceY).toBe(0);
    expect(point!.surfaceY).toBe(firstEmptyLayerAboveGround(grid, 5, 5));
  });

  it('clamps an out-of-bounds survey column the same way computeVoxelColumnSurfaceY does', () => {
    const grid = new VoxelGrid(20, 20);
    grid.fillVoxel(5, 0, 5, 0, undefined, 1.0);
    const state = makeState([
      makeSurveyResult({ centerX: 1000, centerZ: 1000, estimates: { '1000,1000': { sparkium: 0.5 } } }),
    ]);

    const options = buildSurveyOverlayOptions(state, grid);

    expect(options).not.toBeNull();
    const point = options!.points.find(p => p.x === 1000 && p.z === 1000);
    expect(point).toBeDefined();
    expect(point!.surfaceY).toBe(firstEmptyLayerAboveGround(grid, 1000, 1000));
  });

  it('sets valuePerM3 on each point from that column\'s own estimates (#1684)', () => {
    const grid = new VoxelGrid(20, 20);
    grid.fillVoxel(5, 0, 5, 0, undefined, 1.0);
    grid.fillVoxel(6, 0, 5, 0, undefined, 1.0);
    const state = makeState([makeSurveyResult({
      estimates: { '5,5': { sparkium: 0.4 }, '6,5': { dirtite: 0.1 } },
    })]);

    const options = buildSurveyOverlayOptions(state, grid)!;
    const rich = options.points.find(p => p.x === 5 && p.z === 5)!;
    const poor = options.points.find(p => p.x === 6 && p.z === 5)!;

    expect(rich.valuePerM3).toBeCloseTo(columnOreValuePerM3({ sparkium: 0.4 }, 'legacy'), 3);
    expect(poor.valuePerM3).toBeCloseTo(columnOreValuePerM3({ dirtite: 0.1 }, 'legacy'), 3);
    expect(rich.valuePerM3!).toBeGreaterThan(poor.valuePerM3!);
  });

  it('prices columns in the level market (#1681)', () => {
    const grid = new VoxelGrid(20, 20);
    grid.fillVoxel(5, 0, 5, 0, undefined, 1.0);
    const state = makeState([makeSurveyResult({ estimates: { '5,5': { sparkium: 0.4 } } })]);
    state.contracts.market = 'production';
    const options = buildSurveyOverlayOptions(state, grid)!;
    const rich = options.points.find(p => p.x === 5 && p.z === 5)!;
    expect(rich.valuePerM3).toBeCloseTo(columnOreValuePerM3({ sparkium: 0.4 }, 'production'), 3);
  });

  it('keeps valuePerM3 on stale-survey points too, so the overlay can decide the grey (#1684)', () => {
    const grid = new VoxelGrid(20, 20);
    grid.fillVoxel(5, 0, 5, 0, undefined, 1.0);
    const state = makeState([makeSurveyResult({ stale: true })]);

    const point = buildSurveyOverlayOptions(state, grid)!.points.find(p => p.x === 5 && p.z === 5)!;
    expect(point.fresh).toBe(false);
    expect(point.valuePerM3).toBeGreaterThan(0);
  });

  it('returns null when no grid is bound', () => {
    const state = makeState([makeSurveyResult()]);
    expect(buildSurveyOverlayOptions(state, null)).toBeNull();
  });

  it('returns null when there are no survey results', () => {
    const grid = new VoxelGrid(20, 20);
    const state = makeState([]);
    expect(buildSurveyOverlayOptions(state, grid)).toBeNull();
  });

  // #1184: the overlay's old `(computeVoxelColumnSurfaceY(...) ?? -1) + 1`
  // shim conflated "no ground" with a real surface at y = -1 — a column
  // genuinely surfacing at or below y = 0 must still sit one layer above its
  // true surface, not the no-ground fallback.
  it('#1184: sits one layer above a real surface at or below y = 0, not the no-ground fallback', () => {
    const grid = new VoxelGrid(20, 20);
    grid.fillVoxel(5, -5, 5, 0, undefined, 1.0); // surface below y = 0
    grid.fillVoxel(6, 0, 6, 0, undefined, 1.0); // surface exactly at y = 0
    const state = makeState([
      makeSurveyResult({ estimates: { '5,5': { sparkium: 0.5 }, '6,6': { sparkium: 0.5 } } }),
    ]);

    const options = buildSurveyOverlayOptions(state, grid);

    expect(options).not.toBeNull();
    const belowZero = options!.points.find(p => p.x === 5 && p.z === 5);
    const atZero = options!.points.find(p => p.x === 6 && p.z === 6);
    expect(belowZero).toBeDefined();
    expect(atZero).toBeDefined();
    expect(belowZero!.surfaceY).toBe(-4); // one layer above y = -5, not the fallback (0)
    expect(atZero!.surfaceY).toBe(1);
    expect(belowZero!.surfaceY).toBe(firstEmptyLayerAboveGround(grid, 5, 5));
    expect(atZero!.surfaceY).toBe(firstEmptyLayerAboveGround(grid, 6, 6));
  });
});

// ── Zone blink regression (#952) ──
//
// The drawn safety zone (state.zone.activeZone) never resets once defined —
// see Zone.ts's doc comments on isZoneStillBlastThreatened. Blinking must
// track whether the LIVE drill plan's danger box still overlaps that drawn
// rectangle, not merely whether an employee is standing inside a rectangle
// that was drawn at some point in the past. On unfixed main, the blink block
// in syncGameRendererEntities only checks `zone !== null &&
// isInZone(e.x, e.z, zone)` — it never reads state.drillHoles at all, so an
// employee who walks back over the old rectangle after the blast fired (or
// after the plan moved elsewhere) blinks forever.

function makeZoneSyncDeps(state: GameState, characters: CharacterMesh): SyncDeps {
  return {
    state,
    buildings: null,
    renderedBuildingIds: new Set(),
    vehicles: null,
    renderedVehicleIds: new Set(),
    characters,
    renderedEmployeeIds: new Set(),
    pictograms: null,
    lastGrid: null,
    ghosts: null,
    lastGhostRevision: -1,
    terrainMeshRevision: 0,
    lastSyncedTerrainRevision: -1,
    taskProgress: null,
    skybox: null,
    clouds: null,
    zone: state.zone.activeZone,
    getTerrainSurfaceY: () => 0,
    syncSurveyOverlay: () => {},
  };
}

describe('syncGameRendererEntities() — zone blink tracks live blast threat (#952)', () => {
  it('keeps an employee inside the drawn zone blinking while drillHoles still overlap it', () => {
    const state = createGame({ seed: 42, startingCash: 100_000 });
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1), 5, 5);
    state.zone.activeZone = { x1: 0, z1: 0, x2: 10, z2: 10 };
    // Hole at (5,5), margin 15 → danger box (-10,-10)-(20,20), overlaps (0,0)-(10,10).
    addHole(holeCounter, state.drillHoles, 5, 5, 10, 0.1);

    const characters = new CharacterMesh(new THREE.Scene());
    const spy = vi.spyOn(characters, 'setEvacuating');

    syncGameRendererEntities(makeZoneSyncDeps(state, characters));

    expect(spy).toHaveBeenCalledWith(employee.id, true);
  });

  it('stops blinking once drillHoles empties — blast fired or plan cancelled — even though the drawn zone never resets', () => {
    const state = createGame({ seed: 42, startingCash: 100_000 });
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1), 5, 5);
    state.zone.activeZone = { x1: 0, z1: 0, x2: 10, z2: 10 };
    state.drillHoles = [];

    const characters = new CharacterMesh(new THREE.Scene());
    const spy = vi.spyOn(characters, 'setEvacuating');

    syncGameRendererEntities(makeZoneSyncDeps(state, characters));

    expect(spy).toHaveBeenCalledWith(employee.id, false);
  });

  it('stops blinking once the live plan has moved elsewhere, even though the danger box once overlapped the drawn zone', () => {
    const state = createGame({ seed: 42, startingCash: 100_000 });
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1), 5, 5);
    state.zone.activeZone = { x1: 0, z1: 0, x2: 10, z2: 10 };
    // Hole far away — margin-padded box nowhere near (0,0)-(10,10).
    addHole(holeCounter, state.drillHoles, 1000, 1000, 10, 0.1);

    const characters = new CharacterMesh(new THREE.Scene());
    const spy = vi.spyOn(characters, 'setEvacuating');

    syncGameRendererEntities(makeZoneSyncDeps(state, characters));

    expect(spy).toHaveBeenCalledWith(employee.id, false);
  });

  it('never blinks an employee standing outside the drawn zone, regardless of drillHoles', () => {
    const state = createGame({ seed: 42, startingCash: 100_000 });
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1), 25, 25);
    state.zone.activeZone = { x1: 0, z1: 0, x2: 10, z2: 10 };
    addHole(holeCounter, state.drillHoles, 5, 5, 10, 0.1);

    const characters = new CharacterMesh(new THREE.Scene());
    const spy = vi.spyOn(characters, 'setEvacuating');

    syncGameRendererEntities(makeZoneSyncDeps(state, characters));

    expect(spy).toHaveBeenCalledWith(employee.id, false);
  });

  it('never blinks anyone when no zone is active, regardless of drillHoles', () => {
    const state = createGame({ seed: 42, startingCash: 100_000 });
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1), 5, 5);
    state.zone.activeZone = null;
    addHole(holeCounter, state.drillHoles, 5, 5, 10, 0.1);

    const characters = new CharacterMesh(new THREE.Scene());
    const spy = vi.spyOn(characters, 'setEvacuating');

    syncGameRendererEntities(makeZoneSyncDeps(state, characters));

    expect(spy).toHaveBeenCalledWith(employee.id, false);
  });

  it('regression repro: stops blinking on the very next sync after the blast fires, without the zone being redrawn', () => {
    const state = createGame({ seed: 42, startingCash: 100_000 });
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1), 5, 5);
    state.zone.activeZone = { x1: 0, z1: 0, x2: 10, z2: 10 };
    addHole(holeCounter, state.drillHoles, 5, 5, 10, 0.1);

    const characters = new CharacterMesh(new THREE.Scene());
    const spy = vi.spyOn(characters, 'setEvacuating');

    // First sync: plan is live and charged — employee blinks.
    syncGameRendererEntities(makeZoneSyncDeps(state, characters));
    expect(spy).toHaveBeenLastCalledWith(employee.id, true);

    // Blast fires: drillHoles clears. Zone is never redrawn/reset.
    state.drillHoles = [];
    syncGameRendererEntities(makeZoneSyncDeps(state, characters));

    expect(spy).toHaveBeenLastCalledWith(employee.id, false);
  });
});

describe('syncGameRendererEntities() — ramp arrows (#1211)', () => {
  function plannedRamp(id: number, segmentCount: number): PlannedRamp {
    return {
      id,
      def: { originX: 16, originZ: 19, direction: 'south', length: 12, targetDepth: 3 },
      footprint: { minX: 15, maxX: 17, minZ: 19, maxZ: 30 },
      segments: Array.from({ length: segmentCount }, (_, index) => ({
        index, actionId: 100 + index, cells: [], region: null, done: false, carvedCount: 0,
      })),
    };
  }

  function syncWith(state: GameState, rampArrows: RampArrowLayer): void {
    syncGameRendererEntities({
      ...makeZoneSyncDeps(state, new CharacterMesh(new THREE.Scene())),
      rampArrows,
    });
  }

  it('keeps a planned ramp\'s arrow until its last segment is dug, then draws none', () => {
    const state = createGame({ seed: 42, startingCash: 100_000 });
    const ramp = plannedRamp(1, 3);
    state.plannedRamps.push(ramp);
    const scene = new THREE.Scene();
    const arrows = new RampArrowLayer(scene, () => 0);

    syncWith(state, arrows);
    expect(arrows.count).toBe(1);
    expect(arrows.getArrow(1)?.parent).toBe(scene);

    ramp.segments[0]!.done = true;
    ramp.segments[1]!.done = true;
    syncWith(state, arrows);
    expect(arrows.count).toBe(1);

    ramp.segments[2]!.done = true;
    syncWith(state, arrows);
    expect(arrows.count).toBe(0);
    expect(scene.getObjectByName('ramp-arrow')).toBeUndefined();
  });

  it('drops the arrow when the finished ramp leaves plannedRamps', () => {
    const state = createGame({ seed: 42, startingCash: 100_000 });
    state.plannedRamps.push(plannedRamp(1, 2), plannedRamp(2, 2));
    const arrows = new RampArrowLayer(new THREE.Scene(), () => 0);

    syncWith(state, arrows);
    expect(arrows.count).toBe(2);

    state.plannedRamps.splice(0, 1);
    syncWith(state, arrows);
    expect(arrows.count).toBe(1);
    expect(arrows.getArrow(1)).toBeNull();
    expect(arrows.getArrow(2)).not.toBeNull();
  });
});

function frag(id: number, x: number, y: number, z: number): FragmentData {
  return {
    id,
    position: { x, y, z },
    volume: 0.1, mass: 200, rockId: 'sandite', oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false,
    halfExtents: { x: 0.2, y: 0.2, z: 0.2 }, shapeSeed: id, origin: { x, y, z },
  };
}

/** Fragment instances currently drawn by the renderer's FragmentMesh. */
function drawnFragments(renderer: GameRenderer): number {
  return (renderer as any).fragments.count as number;
}

// ── Replacing the state of a live scene (#1868) ──
//
// The Saves modal's load handler swaps ctx.state and calls syncFromContext():
// same seed, same biome, so no level reload runs. The previous game's fragment
// meshes used to stay drawn and the loaded state's were never spawned.

describe('GameRenderer.syncFromContext — state replacement redraws fragments (#1868)', () => {
  function stateWith(frags: FragmentData[], seed = 42): GameState {
    const state = createGame({ seed, startingCash: 100_000 });
    addBlastFragments(state.logistics, frags);
    return state;
  }

  it('replacing a state that has fragments with one that has none leaves nothing drawn', () => {
    const ctx = makeCtx();
    ctx.state = stateWith([frag(1, 10, 5, 10), frag(2, 12, 5, 10)]);
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    renderer.syncFromContext(ctx);
    expect(drawnFragments(renderer)).toBe(2);

    ctx.state = stateWith([]);
    renderer.syncFromContext(ctx);

    expect(drawnFragments(renderer)).toBe(0);
    expect(renderer.entityWorldPosition('fragment', 1)).toBeNull();
  });

  it('replacing a state that has none with one that has fragments draws the new ones', () => {
    const ctx = makeCtx();
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    renderer.syncFromContext(ctx);
    expect(drawnFragments(renderer)).toBe(0);

    ctx.state = stateWith([frag(7, 10, 5, 10), frag(8, 12, 5, 10), frag(9, 14, 5, 10)]);
    renderer.syncFromContext(ctx);

    expect(drawnFragments(renderer)).toBe(3);
    const p = renderer.entityWorldPosition('fragment', 8)!;
    expect(p.x).toBeCloseTo(12, 4);
    expect(p.z).toBeCloseTo(10, 4);
  });

  it('swapping piles drops the old fragments and draws only the new state\'s', () => {
    const ctx = makeCtx();
    ctx.state = stateWith([frag(1, 10, 5, 10), frag(2, 12, 5, 10)]);
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    renderer.syncFromContext(ctx);

    ctx.state = stateWith([frag(50, 20, 5, 20)]);
    renderer.syncFromContext(ctx);

    expect(drawnFragments(renderer)).toBe(1);
    expect(renderer.entityWorldPosition('fragment', 1)).toBeNull();
    expect(renderer.entityWorldPosition('fragment', 50)).not.toBeNull();
  });

  it('only draws on-ground fragments of the replacing state', () => {
    const ctx = makeCtx();
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    renderer.syncFromContext(ctx);

    const next = stateWith([frag(1, 10, 5, 10), frag(2, 12, 5, 10)]);
    next.logistics.fragments[1]!.state = 'stored';
    ctx.state = next;
    renderer.syncFromContext(ctx);

    expect(drawnFragments(renderer)).toBe(1);
    expect(renderer.entityWorldPosition('fragment', 2)).toBeNull();
  });

  it('repeated syncs of the same state object neither clear nor respawn a blast-spawned pile', () => {
    const ctx = makeCtx();
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    renderer.syncFromContext(ctx);
    // Fragments spawned by a blast live in the mesh; the state's logistics
    // list is not what drew them here.
    ctx.lastBlastFragmentData = [frag(100, 10, 5, 10), frag(101, 12, 5, 10)];
    renderer.onBlast(ctx);
    expect(drawnFragments(renderer)).toBe(2);
    const spawnSpy = vi.spyOn((renderer as any).fragments, 'spawnFragments');

    renderer.syncFromContext(ctx);
    renderer.syncFromContext(ctx);

    expect(drawnFragments(renderer)).toBe(2);
    expect(renderer.entityWorldPosition('fragment', 100)).not.toBeNull();
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it('resets an in-flight blast animation when the state is replaced', () => {
    const ctx = makeCtx();
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    renderer.syncFromContext(ctx);
    ctx.lastBlastFlights = [{
      fragmentId: 100, from: { x: 10, y: 20, z: 10 }, to: { x: 10, y: 5, z: 10 },
      delayS: 0, durationS: 5, impactSpeed: 10, thrown: false,
    }];
    ctx.lastBlastFragmentData = [frag(100, 10, 5, 10)];
    renderer.onBlast(ctx);
    expect(renderer.fragmentPlaybackDuration).toBeGreaterThan(0);

    ctx.state = stateWith([frag(1, 20, 5, 20)]);
    renderer.syncFromContext(ctx);

    expect(renderer.fragmentPlaybackDuration).toBe(0);
    expect(renderer.blastPlayback.isPlaying).toBe(false);
    expect(renderer.entityWorldPosition('fragment', 100)).toBeNull();
    expect(renderer.entityWorldPosition('fragment', 1)).not.toBeNull();
  });
});
