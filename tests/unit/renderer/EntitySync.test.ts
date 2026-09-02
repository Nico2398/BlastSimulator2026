// BlastSimulator2026 — Tests for EntitySync.syncEntitySets's driver-mesh
// suppression (issue #922)
//
// While `vehicle.driverId === employee.id`, the employee is logically inside
// the vehicle (EntityMovementTick.syncDriverPosition keeps their x/z glued
// to it every tick) — no character mesh should be created or kept for them.
// Before this fix, syncEntitySets added/kept a mesh for every employee in
// state.employees.employees unconditionally, so a driven employee's mesh sat
// visibly parked wherever they boarded while the vehicle drove off without
// them, and never disappeared once boarded.
//
// Uses real THREE.Scene + CharacterMesh instances rather than mocks — the
// same pattern VehicleMesh.test.ts uses (three.js runs fine headless, no
// WebGL context needed for scene graph construction).

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createGame } from '../../../src/core/state/GameState.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { Random } from '../../../src/core/math/Random.js';
import { syncEntitySets } from '../../../src/renderer/EntitySync.js';
import { CharacterMesh } from '../../../src/renderer/CharacterMesh.js';

const SEED = 42;

describe('syncEntitySets — suppresses the character mesh for a seated driver (#922)', () => {
  it('creates no character mesh for an employee whose id is already a vehicle driverId on first sync', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 5, 5);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
    vehicle.driverId = employee.id;

    const scene = new THREE.Scene();
    const characters = new CharacterMesh(scene);
    const renderedEmployeeIds = new Set<number>();

    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);

    expect(characters.count).toBe(0);
    expect(renderedEmployeeIds.has(employee.id)).toBe(false);
  });

  it('keeps a normal mesh for an employee walking toward a vehicle they have not boarded yet (driverId still null)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.destinationX = 5;
    employee.destinationZ = 5;
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
    vehicle.driverId = null;

    const scene = new THREE.Scene();
    const characters = new CharacterMesh(scene);
    const renderedEmployeeIds = new Set<number>();

    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);

    expect(characters.count).toBe(1);
    expect(renderedEmployeeIds.has(employee.id)).toBe(true);
  });

  it('a vehicle with no driver never suppresses anyone, even with several employees and vehicles present (boundary)', () => {
    const state = createGame({ seed: SEED });
    const { employee: a } = hireEmployee(state.employees, 'driller', new Random(SEED), 1, 1);
    const { employee: b } = hireEmployee(state.employees, 'surveyor', new Random(SEED + 1), 2, 2);
    purchaseVehicle(state.vehicles, 'drill_rig', 9, 9);
    purchaseVehicle(state.vehicles, 'debris_hauler', 11, 11);

    const scene = new THREE.Scene();
    const characters = new CharacterMesh(scene);
    const renderedEmployeeIds = new Set<number>();

    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);

    expect(characters.count).toBe(2);
    expect(renderedEmployeeIds.has(a.id)).toBe(true);
    expect(renderedEmployeeIds.has(b.id)).toBe(true);
  });

  it('removes an existing mesh the instant the employee becomes a seated driver on a later sync', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 5, 5);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
    vehicle.driverId = null;

    const scene = new THREE.Scene();
    const characters = new CharacterMesh(scene);
    const renderedEmployeeIds = new Set<number>();

    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);
    expect(characters.count).toBe(1);

    vehicle.driverId = employee.id;
    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);

    expect(characters.count).toBe(0);
    expect(renderedEmployeeIds.has(employee.id)).toBe(false);
  });

  it("re-adds the character mesh at the vehicle's dismount position once driverId clears again", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.driverId = employee.id;

    const scene = new THREE.Scene();
    const characters = new CharacterMesh(scene);
    const renderedEmployeeIds = new Set<number>();

    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);
    expect(characters.count).toBe(0);

    // Dismount: the vehicle drove to (12, 4), the driver's logical position
    // snapped to the vehicle's current cell (VehicleReservation.ts's own
    // dismount invariant, #593/#922), driverId cleared.
    vehicle.x = 12;
    vehicle.z = 4;
    employee.x = 12;
    employee.z = 4;
    vehicle.driverId = null;

    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);

    expect(characters.count).toBe(1);
    expect(renderedEmployeeIds.has(employee.id)).toBe(true);
  });

  it('suppresses only the driving employee when a second, non-driving employee is also present (boundary: mixed roster)', () => {
    const state = createGame({ seed: SEED });
    const { employee: driver } = hireEmployee(state.employees, 'driller', new Random(SEED), 5, 5);
    const { employee: onFoot } = hireEmployee(state.employees, 'surveyor', new Random(SEED + 1), 8, 8);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
    vehicle.driverId = driver.id;

    const scene = new THREE.Scene();
    const characters = new CharacterMesh(scene);
    const renderedEmployeeIds = new Set<number>();

    syncEntitySets(state, null, new Set(), null, new Set(), characters, renderedEmployeeIds);

    expect(characters.count).toBe(1);
    expect(renderedEmployeeIds.has(driver.id)).toBe(false);
    expect(renderedEmployeeIds.has(onFoot.id)).toBe(true);
  });
});
