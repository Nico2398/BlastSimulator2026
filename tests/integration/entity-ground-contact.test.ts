// BlastSimulator2026 — Entity ground-contact invariant across the real
// renderer sync pipeline (#1145)
//
// Vehicles and employees already resnap to the terrain sampler every sync
// (GameRendererSync.ts's setSurfaceY calls, #408/#520) — they are the
// positive control here, proving this harness's invariant genuinely holds
// where the code is already correct. Buildings are the regression: today
// `buildingFootprintSurfaceY` (EntitySync.ts) samples the footprint's 4
// bounding-box corners `(x,z)`, `(x+sizeX,z)`, `(x,z+sizeZ)`,
// `(x+sizeX,z+sizeZ)` — three of those four columns sit one column PAST the
// footprint's own edge, outside it entirely — and takes the min. A building
// placed on a freshly-levelled, perfectly flat pad still bakes at the min of
// those three off-footprint corners, which the surrounding (unlevelled)
// terrain can put well below (or above) the pad itself (#1145 defect 1).
//
// Drives the actual production entry point, `syncGameRendererEntities`
// (GameRendererSync.ts), against real BuildingMesh/VehicleMesh/CharacterMesh
// instances — never reimplements the sampling/sync logic under test — through
// a real gameplay sequence: a `level_ground` order, a real blast, and a
// terrain-mutating dig, mirroring the console-driven style
// terrain-surface-y-post-blast.integration.test.ts and level-ground.test.ts
// already use for this exact class of bug (#1007/#1009).

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createRunner, runCommand, type RunnerWithContext } from '../../src/console/createRunner.js';
import { syncGameRendererEntities, type SyncDeps } from '../../src/renderer/GameRendererSync.js';
import { getTerrainSurfaceY } from '../../src/renderer/GameRendererTerrain.js';
import { BuildingMesh } from '../../src/renderer/BuildingMesh.js';
import { VehicleMesh } from '../../src/renderer/VehicleMesh.js';
import { CharacterMesh } from '../../src/renderer/CharacterMesh.js';
import { GhostMesh } from '../../src/renderer/GhostMesh.js';
import { placeBuilding, getBuildingDef } from '../../src/core/entities/Building.js';
import { expectNoWorldInvariantViolations } from '../helpers/worldInvariants.js';
import { GENERATED_TERRAIN_GRID_SIZE_Y } from '../helpers/gameContext.js';

// ── Harness: drives the real production sync entry point ───────────────────

interface Harness {
  buildings: BuildingMesh;
  vehicles: VehicleMesh;
  characters: CharacterMesh;
  ghosts: GhostMesh;
  renderedBuildingIds: Set<number>;
  renderedVehicleIds: Set<number>;
  renderedEmployeeIds: Set<number>;
  lastGhostRevision: number;
  terrainMeshRevision: number;
  lastSyncedTerrainRevision: number;
}

function makeHarness(): Harness {
  const scene = new THREE.Scene();
  return {
    buildings: new BuildingMesh(scene),
    vehicles: new VehicleMesh(scene),
    characters: new CharacterMesh(scene),
    ghosts: new GhostMesh(scene),
    renderedBuildingIds: new Set(),
    renderedVehicleIds: new Set(),
    renderedEmployeeIds: new Set(),
    lastGhostRevision: -1,
    terrainMeshRevision: 0,
    lastSyncedTerrainRevision: -1,
  };
}

/** One sync call through the real production entry point (syncGameRendererEntities). */
function sync(engine: RunnerWithContext, h: Harness): void {
  const grid = engine.ctx.grid!;
  const deps: SyncDeps = {
    state: engine.ctx.state!,
    weatherCycle: undefined,
    buildings: h.buildings,
    renderedBuildingIds: h.renderedBuildingIds,
    vehicles: h.vehicles,
    renderedVehicleIds: h.renderedVehicleIds,
    characters: h.characters,
    renderedEmployeeIds: h.renderedEmployeeIds,
    lastGrid: grid,
    ghosts: h.ghosts,
    lastGhostRevision: h.lastGhostRevision,
    terrainMeshRevision: h.terrainMeshRevision,
    lastSyncedTerrainRevision: h.lastSyncedTerrainRevision,
    taskProgress: null,
    pictograms: null,
    skybox: null,
    clouds: null,
    zone: null,
    getTerrainSurfaceY: (x: number, z: number) => getTerrainSurfaceY(grid, x, z),
    syncSurveyOverlay: () => {},
  };
  const result = syncGameRendererEntities(deps);
  h.lastGhostRevision = result.lastGhostRevision;
  h.lastSyncedTerrainRevision = result.lastSyncedTerrainRevision;
}

/**
 * Marks a terrain-mutating console command's mesh as rebuilt, mirroring
 * GameRendererTerrain.ts's `deps.terrainMeshRevision++` after every grid
 * mutation the real GameRenderer detects. This harness has no real terrain
 * mesh to rebuild, so it bumps the counter directly rather than reimplementing
 * the rebuild-detection logic under test.
 */
function markTerrainRebuilt(h: Harness): void {
  h.terrainMeshRevision++;
}

/** Every rendered building/vehicle/employee's Y must equal the terrain sampler at its own (x, z). */
function assertEveryEntityRestsOnTerrain(engine: RunnerWithContext, h: Harness): void {
  const grid = engine.ctx.grid!;
  const state = engine.ctx.state!;

  for (const b of state.buildings.buildings) {
    if (!h.renderedBuildingIds.has(b.id)) continue;
    const pos = h.buildings.getPosition(b.id)!;
    expect(pos.y, `building #${b.id} (${b.type}) at (${b.x},${b.z})`).toBe(getTerrainSurfaceY(grid, b.x, b.z));
  }

  for (const v of state.vehicles.vehicles) {
    if (!h.renderedVehicleIds.has(v.id)) continue;
    const pos = h.vehicles.getPosition(v.id)!;
    expect(pos.y, `vehicle #${v.id} (${v.type}) at (${v.x},${v.z})`).toBe(getTerrainSurfaceY(grid, v.x, v.z));
  }

  for (const e of state.employees.employees) {
    if (!h.renderedEmployeeIds.has(e.id)) continue;
    const pos = h.characters.getPosition(e.id)!;
    expect(pos.y, `employee #${e.id} at (${e.x},${e.z})`).toBe(getTerrainSurfaceY(grid, e.x, e.z));
  }
}

/** Ticks up to `maxTicks`, pinning fatigue to 100 each tick (established staffed-roster drive-to-completion pattern — see level-ground.test.ts / vehicles.integration.test.ts). */
function tickUntilGone(engine: RunnerWithContext, actionId: number, maxTicks = 500): boolean {
  for (let i = 0; i < maxTicks; i++) {
    if (!engine.ctx.state!.pendingActions.some(a => a.id === actionId)) return true;
    for (const emp of engine.ctx.state!.employees.employees) emp.fatigue = 100;
    runCommand(engine, 'tick 1');
  }
  return !engine.ctx.state!.pendingActions.some(a => a.id === actionId);
}

function driveToCompletion(engine: RunnerWithContext, maxTicks = 300, condition: () => boolean = () => true): void {
  for (let i = 0; i < maxTicks && condition(); i++) {
    for (const emp of engine.ctx.state!.employees.employees) emp.fatigue = 100;
    runCommand(engine, 'tick 1');
  }
}

describe('every rendered entity rests on the terrain sampler through the real sync pipeline (#1145)', () => {
  it('buildings, vehicles, and employees all sit at getTerrainSurfaceY(x,z) after a level_ground order, a real blast, and a terrain-mutating dig', () => {
    const engine = createRunner();
    expect(runCommand(engine, 'new_game seed:42 size:32 staffed:true').success).toBe(true);
    const grid = engine.ctx.grid!;
    const h = makeHarness();

    // ── Step 1: level a 2x2 pad — management_office tier1's own footprint —
    // through the real queued/dispatched console order, ticked to genuine
    // completion (mirrors level-ground.test.ts's own round trip, #1009).
    const padX = 20;
    const padZ = 20;
    const orderResult = runCommand(engine, `level_ground minX:${padX} maxX:${padX + 1} minZ:${padZ} maxZ:${padZ + 1}`);
    expect(orderResult.success).toBe(true);
    const levelAction = engine.ctx.state!.pendingActions.find(a => a.type === 'level_ground');
    expect(levelAction).toBeDefined();
    expect(tickUntilGone(engine, levelAction!.id)).toBe(true);

    // ── Step 2: place the building directly on the now-flat pad (bypasses
    // the place_building action queue purely for setup speed — buildings.
    // integration.test.ts's own suite calls placeBuilding() the same way).
    // ctx.grid is passed so the same flatness rule a real `build` order
    // enforces (#1008) still gates this placement.
    const placeResult = placeBuilding(
      engine.ctx.state!.buildings, 'management_office', padX, padZ, grid.sizeX, grid.sizeZ, 1, 0, 0, undefined, grid,
    );
    expect(placeResult.success).toBe(true);
    const building = placeResult.success ? placeResult.building : undefined;
    expect(building).toBeDefined();

    sync(engine, h);
    expectNoWorldInvariantViolations(engine.ctx.state!);

    // Fails today: buildingFootprintSurfaceY samples (padX+2,padZ),
    // (padX,padZ+2), (padX+2,padZ+2) — one column PAST the levelled 2x2
    // footprint's own edge, into unlevelled natural terrain — instead of the
    // footprint's own 4 columns, which the level_ground order made uniform.
    assertEveryEntityRestsOnTerrain(engine, h);

    // ── Step 3: a real blast elsewhere, changing terrain away from the pad
    // (mirrors terrain-surface-y-post-blast.integration.test.ts, #1007).
    expect(runCommand(engine, 'drill_plan grid rows:2 cols:3 spacing:4 depth:8 start:5,5').success).toBe(true);
    driveToCompletion(engine, 300, () => engine.ctx.state!.plannedDrillHoles.length > 0);
    expect(runCommand(engine, 'charge hole:* explosive:boomite amount:8 stemming:2').success).toBe(true);
    driveToCompletion(engine, 300, () => Object.keys(engine.ctx.state!.plannedChargesByHole).length > 0);
    expect(runCommand(engine, 'sequence auto delay_step:25').success).toBe(true);
    const blastResult = runCommand(engine, 'blast');
    expect(blastResult.success).toBe(true);
    expect(engine.ctx.state!.lastBlastReport!.clearedVoxels).toBeGreaterThan(0);
    markTerrainRebuilt(h);

    sync(engine, h);
    expectNoWorldInvariantViolations(engine.ctx.state!);
    assertEveryEntityRestsOnTerrain(engine, h);

    // ── Step 4: a terrain-mutating dig elsewhere — carved directly into the
    // live grid rather than driven through the full dig_ramp_segment
    // action queue, which needs hundreds of ticks to reach genuine
    // completion (vehicles.integration.test.ts's own #924 suite ticks up to
    // 800 times for exactly this reason). The direct-grid-mutation shortcut
    // for a "terrain changed under everyone's feet" event mirrors that same
    // suite's own segment-clearing setup.
    for (let z = 25; z <= 26; z++) {
      for (let x = 25; x <= 26; x++) {
        for (let y = GENERATED_TERRAIN_GRID_SIZE_Y - 1; y >= GENERATED_TERRAIN_GRID_SIZE_Y - 3; y--) {
          grid.clearVoxel(x, y, z);
        }
      }
    }
    markTerrainRebuilt(h);

    sync(engine, h);
    expectNoWorldInvariantViolations(engine.ctx.state!);
    assertEveryEntityRestsOnTerrain(engine, h);

    // ── Step 5: the building's own resnap-on-terrain-change requirement
    // (#1145 defect 2) — mutate the ground directly beneath the ALREADY-
    // BAKED building's own footprint and confirm a later sync updates it to
    // the new sampler value rather than keeping whatever was baked at
    // add-time. Buildings are baked once and never revisited today — only
    // vehicles/employees get a per-sync setSurfaceY correction.
    const def = getBuildingDef(building!.type, building!.tier);
    for (const [dx, dz] of def.footprint) {
      const cx = building!.x + dx;
      const cz = building!.z + dz;
      for (let y = GENERATED_TERRAIN_GRID_SIZE_Y - 1; y >= 0; y--) {
        if (grid.densityAt(cx, y, cz) > 0) {
          grid.clearVoxel(cx, y, cz);
          break;
        }
      }
    }
    markTerrainRebuilt(h);
    const newSurfaceYUnderBuilding = getTerrainSurfaceY(grid, building!.x, building!.z);

    sync(engine, h);

    const bakedPos = h.buildings.getPosition(building!.id)!;
    expect(bakedPos.y).toBe(newSurfaceYUnderBuilding);
  });
});
