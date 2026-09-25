// BlastSimulator2026 — GameRenderer: one scene mesh per entity across a level load
//
// Level setup (GameRendererSceneSetup.buildPlayableMesh) used to add every
// building, vehicle and character to its mesh manager directly, without
// recording the id in the rendered-id sets that EntitySync.syncEntitySets
// diffs against. The sync that always follows a load then saw every entity as
// new and added it a second time. Each add* keys its entry by id in a Map, so
// the second add overwrote the entry and left the first group in the scene,
// orphaned: never updated, never removed. A vehicle that drove off left a
// frozen copy of itself at its spawn point, and a driver mounted when a level
// loaded kept a visible character on top of the vehicle, breaking
// gameplay-vehicle-fleet's "the two 3D models are never both visible".
//
// These tests count what is actually in the THREE scene. pickables() cannot
// see an orphan: it reads each manager's Map, which only holds the survivor.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GameRenderer } from '../../../src/renderer/GameRenderer.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import type { PickableKind } from '../../../src/renderer/Pickable.js';
import { makeMockSceneManager, makeCtx } from '../../helpers/rendererFixtures.js';

/** Scene groups tagged as `kind` (optionally one entity id), however many managers put them there. */
function sceneGroups(scene: THREE.Scene, kind: PickableKind, id?: number): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  scene.traverse(obj => {
    if (obj.userData['entityKind'] !== kind) return;
    if (id !== undefined && obj.userData['entityId'] !== id) return;
    found.push(obj);
  });
  return found;
}

describe('GameRenderer — one scene mesh per entity across a level load', () => {
  it('a freshly loaded level holds exactly one group per building, vehicle and employee', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = makeCtx();
    const state = ctx.state!;
    const { building } = placeBuilding(state.buildings, 'management_office', 2, 2, 32, 32, 1, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 10, 10);
    const { employee: a } = hireEmployee(state.employees, 'driller', new Random(1), 4, 4);
    const { employee: b } = hireEmployee(state.employees, 'driver', new Random(2), 6, 6);

    renderer.syncFromContext(ctx);

    expect(sceneGroups(sm.scene, 'building', building!.id)).toHaveLength(1);
    expect(sceneGroups(sm.scene, 'vehicle', vehicle.id)).toHaveLength(1);
    expect(sceneGroups(sm.scene, 'employee', a.id)).toHaveLength(1);
    expect(sceneGroups(sm.scene, 'employee', b.id)).toHaveLength(1);
  });

  it('a vehicle that drives away leaves no copy of itself at its spawn', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = makeCtx();
    const state = ctx.state!;
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_fragmenter', 10, 10);

    renderer.syncFromContext(ctx);
    vehicle.x = 20;
    vehicle.z = 12;
    renderer.syncFromContext(ctx);
    for (let i = 0; i < 60; i++) renderer.update(0.05);

    const groups = sceneGroups(sm.scene, 'vehicle', vehicle.id);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.position.x).toBeCloseTo(20, 1);
    expect(groups[0]!.position.z).toBeCloseTo(12, 1);
  });

  it('an employee already mounted when the level loads has no character mesh, only the vehicle', () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = makeCtx();
    const state = ctx.state!;
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 8, 8);
    const { employee: driver } = hireEmployee(state.employees, 'driller', new Random(3), 8, 8);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    renderer.syncFromContext(ctx);

    expect(sceneGroups(sm.scene, 'vehicle', vehicle.id)).toHaveLength(1);
    expect(sceneGroups(sm.scene, 'employee', driver.id)).toHaveLength(0);
  });
});
