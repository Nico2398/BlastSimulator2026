// BlastSimulator2026 — Tests for vehicleEvacuationVerdict (src/core/engine/Evacuation.ts, #2100).
// The verdict is the pure query the Fire step shows and evacuateZone must agree with.

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { findPath } from '../../../src/core/nav/Pathfinding.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { evacuateZone, vehicleEvacuationVerdict } from '../../../src/core/engine/Evacuation.js';
import type { ZoneBounds } from '../../../src/core/entities/Zone.js';
import { hireEmployee, assignSkill, type Employee } from '../../../src/core/entities/Employee.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';
import { purchaseVehicle, type Vehicle } from '../../../src/core/entities/Vehicle.js';
import { Random } from '../../../src/core/math/Random.js';

const SEED = 42;
const ZONE: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };
const GRID_SIZE = 60;

/** A flat, solid size×size NavGrid; columns in [gapFrom, gapTo] are left empty (no floor), splitting the map. */
function walkableGrid(size: number, gap?: { from: number; to: number }): NavGrid {
  const vg = new VoxelGrid(size, size);
  for (let x = 0; x < size; x++) {
    if (gap && x >= gap.from && x <= gap.to) continue;
    for (let z = 0; z < size; z++) {
      vg.setVoxel(x, 0, z, {
        composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
        density: 1.0,
        oreDensities: {},
        fractureModifier: 1.0,
      });
    }
  }
  return NavGrid.buildNavGrid(vg, [], []);
}

interface Fixture { state: GameState; vehicle: Vehicle; rng: Random }

/** A game with a walkable map and a rock digger parked inside the zone, nobody aboard. */
function fixture(opts: { grid?: NavGrid | null } = {}): Fixture {
  const state = createGame({ seed: SEED });
  state.navGrid = opts.grid === undefined ? walkableGrid(GRID_SIZE) : opts.grid;
  const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 15, 15);
  vehicle.occupantIds = [];
  return { state, vehicle, rng: new Random(SEED) };
}

/** Hire an excavator-licensed driller at (x, z). */
function licensedDriver(f: Fixture, x: number, z: number): Employee {
  const { employee } = hireEmployee(f.state.employees, 'driller', f.rng, x, z);
  assignSkill(f.state.employees, employee.id, 'driving.excavator', 1);
  return employee;
}

/** Seat a licensed driver aboard the fixture's vehicle. */
function seatDriver(f: Fixture): Employee {
  const driver = licensedDriver(f, f.vehicle.x, f.vehicle.z);
  f.vehicle.occupantIds = [driver.id];
  driver.locomotion = { kind: 'mounted', vehicleId: f.vehicle.id };
  return driver;
}

describe('vehicleEvacuationVerdict — driven vehicle (C4)', () => {
  it('is driver_aboard when a driver is aboard and a safe destination exists', () => {
    const f = fixture();
    seatDriver(f);
    expect(vehicleEvacuationVerdict(f.state, f.vehicle, ZONE)).toBe('driver_aboard');
  });

  it('is stranded when a driver is aboard but there is no navGrid', () => {
    const f = fixture({ grid: null });
    seatDriver(f);
    expect(vehicleEvacuationVerdict(f.state, f.vehicle, ZONE)).toBe('stranded');
  });

  it('is stranded when a driver is aboard but no safe destination exists (zone swallows the map)', () => {
    const f = fixture({ grid: walkableGrid(22) });
    seatDriver(f);
    const huge: ZoneBounds = { x1: -50, z1: -50, x2: 80, z2: 80 };
    expect(vehicleEvacuationVerdict(f.state, f.vehicle, huge)).toBe('stranded');
  });
});

describe('vehicleEvacuationVerdict — driverless vehicle, driver available (C2)', () => {
  it('is will_be_fetched when a free licensed driver stands inside the zone', () => {
    const f = fixture();
    licensedDriver(f, 14, 14);
    expect(vehicleEvacuationVerdict(f.state, f.vehicle, ZONE)).toBe('will_be_fetched');
  });

  it('is will_be_fetched when a free licensed driver stands outside the zone', () => {
    const f = fixture();
    licensedDriver(f, 40, 40);
    expect(vehicleEvacuationVerdict(f.state, f.vehicle, ZONE)).toBe('will_be_fetched');
  });

  for (const rest of ['restTicksRemaining', 'pendingRestDuration'] as const) {
    it(`is will_be_fetched when the only licensed driver is resting outside (${rest})`, () => {
      const f = fixture();
      const driver = licensedDriver(f, 40, 40);
      driver[rest] = 30;
      expect(vehicleEvacuationVerdict(f.state, f.vehicle, ZONE)).toBe('will_be_fetched');
    });
  }
});

describe('vehicleEvacuationVerdict — driverless vehicle, nobody able to move it (C3)', () => {
  it('is stranded with no employees at all', () => {
    const f = fixture();
    expect(vehicleEvacuationVerdict(f.state, f.vehicle, ZONE)).toBe('stranded');
  });

  it('is stranded when the only employees are unlicensed for this vehicle', () => {
    const f = fixture();
    hireEmployee(f.state.employees, 'driller', f.rng, 14, 14);
    hireEmployee(f.state.employees, 'driller', f.rng, 40, 40);
    expect(vehicleEvacuationVerdict(f.state, f.vehicle, ZONE)).toBe('stranded');
  });

  it('is stranded when the only licensed driver cannot walk to the vehicle', () => {
    const f = fixture({ grid: walkableGrid(GRID_SIZE, { from: 28, to: 31 }) });
    const driver = licensedDriver(f, 45, 45);
    // Fixture self-check: the gap really splits the map.
    const path = findPath(f.state.navGrid!, {
      agentId: driver.id, fromX: driver.x, fromZ: driver.z, toX: f.vehicle.x, toZ: f.vehicle.z, avoidVehicles: false,
    });
    expect(path.found).toBe(false);
    expect(vehicleEvacuationVerdict(f.state, f.vehicle, ZONE)).toBe('stranded');
  });

  it('is stranded without a navGrid even with a licensed driver present', () => {
    const f = fixture({ grid: null });
    licensedDriver(f, 14, 14);
    expect(vehicleEvacuationVerdict(f.state, f.vehicle, ZONE)).toBe('stranded');
  });

  it('is stranded when no safe destination exists even with a licensed driver present', () => {
    const f = fixture({ grid: walkableGrid(22) });
    licensedDriver(f, 14, 14);
    const huge: ZoneBounds = { x1: -50, z1: -50, x2: 80, z2: 80 };
    expect(vehicleEvacuationVerdict(f.state, f.vehicle, huge)).toBe('stranded');
  });
});

describe('vehicleEvacuationVerdict — purity (C1)', () => {
  it('mutates no vehicle, employee, action or reservation state', () => {
    const f = fixture();
    const inZoneDriver = licensedDriver(f, 14, 14);
    const resting = licensedDriver(f, 40, 40);
    resting.restTicksRemaining = 30;
    const snapshot = () => JSON.stringify({
      employees: f.state.employees,
      vehicles: f.state.vehicles,
      pendingActions: f.state.pendingActions,
    });
    const before = snapshot();

    vehicleEvacuationVerdict(f.state, f.vehicle, ZONE);

    expect(snapshot()).toBe(before);
    expect(inZoneDriver.itinerary).toBeNull();
    expect(inZoneDriver.destinationX).toBeNull();
    expect(inZoneDriver.pendingDriverVehicleId).toBeNull();
  });

  it('is repeatable: the same state gives the same verdict twice', () => {
    const f = fixture();
    licensedDriver(f, 40, 40);
    const first = vehicleEvacuationVerdict(f.state, f.vehicle, ZONE);
    expect(vehicleEvacuationVerdict(f.state, f.vehicle, ZONE)).toBe(first);
  });
});

describe('vehicleEvacuationVerdict agrees with evacuateZone strandedVehicleIds (C5)', () => {
  type Setup = (f: Fixture) => void;
  const cases: Array<[string, Setup, { grid?: NavGrid | null }?]> = [
    ['driven, safe destination', f => { seatDriver(f); }],
    ['driven, no navGrid', f => { seatDriver(f); }, { grid: null }],
    ['driverless, licensed driver in zone', f => { licensedDriver(f, 14, 14); }],
    ['driverless, licensed driver outside', f => { licensedDriver(f, 40, 40); }],
    ['driverless, licensed driver resting outside', f => { licensedDriver(f, 40, 40).restTicksRemaining = 30; }],
    ['driverless, licensed driver about to rest outside', f => { licensedDriver(f, 40, 40).pendingRestDuration = 30; }],
    ['driverless, reserved for an action, licensed driver outside', f => { licensedDriver(f, 40, 40); reserveVehicle(f.state.vehicles, f.vehicle.id, 999); }],
    ['driverless, nobody', () => { /* empty */ }],
    ['driverless, only unlicensed crew', f => { hireEmployee(f.state.employees, 'driller', f.rng, 40, 40); }],
    ['driverless, licensed driver unreachable', f => { licensedDriver(f, 45, 45); }, { grid: walkableGrid(GRID_SIZE, { from: 28, to: 31 }) }],
    ['driverless, licensed driver but no navGrid', f => { licensedDriver(f, 14, 14); }, { grid: null }],
  ];

  it.each(cases)('%s', (_label, setup, opts) => {
    const f = fixture(opts);
    setup(f);

    const verdict = vehicleEvacuationVerdict(f.state, f.vehicle, ZONE);
    const result = evacuateZone(f.state, ZONE);

    expect(result.strandedVehicleIds.includes(f.vehicle.id)).toBe(verdict === 'stranded');
  });

  it('judges each vehicle in a mixed zone on its own', () => {
    const f = fixture();
    seatDriver(f);
    const { vehicle: orphan } = purchaseVehicle(f.state.vehicles, 'debris_hauler', 12, 12);
    orphan.occupantIds = [];

    const driven = vehicleEvacuationVerdict(f.state, f.vehicle, ZONE);
    const driverless = vehicleEvacuationVerdict(f.state, orphan, ZONE);
    const result = evacuateZone(f.state, ZONE);

    expect(result.strandedVehicleIds.includes(f.vehicle.id)).toBe(driven === 'stranded');
    expect(result.strandedVehicleIds.includes(orphan.id)).toBe(driverless === 'stranded');
  });
});
