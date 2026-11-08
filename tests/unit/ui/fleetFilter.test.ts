// @vitest-environment jsdom
// BlastSimulator2026 — fleet list filter criteria and vehicle filtering (#2161).
import { describe, it, expect } from 'vitest';
import {
  FLEET_SORT_KEYS,
  FLEET_STATUS_CHOICES,
  fleetCriteriaFromSelection,
  filterVehicles,
  type FleetCriteria,
} from '../../../src/ui/fleetFilter.js';
import { FilterBarSelection } from '../../../src/ui/filterBar.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import { getVehicleDefByTier, type Vehicle, type VehicleRole, type VehicleTier } from '../../../src/core/entities/Vehicle.js';

function driver(id: number, overrides: Partial<Employee> = {}): Employee {
  return {
    id, name: `Driver ${id}`, role: 'driver', salary: 400, morale: 60,
    unionized: false, injured: false, alive: true, x: 0, z: 0,
    qualifications: [], trainingState: null, activeActionId: null,
    fatigue: 100, collapsing: false,
    interruptedActionPayload: null, ticksWorked: 0,
    restTicksRemaining: null, restNeedKey: null, taskTicksRemaining: null,
    activeTaskSkill: null, destinationX: null, destinationZ: null,
    moveConsecutiveFailures: 0, isMoveStuck: false,
    pendingRestDuration: null, pendingRestNeedKey: null,
    pendingTaskDuration: null, pendingActionType: null,
    pendingActionPayload: null, pendingDriverVehicleId: null,
    taskQueue: [],
    locomotion: { kind: 'on_foot' },
    itinerary: null,
    vehicleWaitingTicks: 0,
    ...overrides,
  };
}

function veh(id: number, overrides: Partial<Vehicle> = {}): Vehicle {
  return { id, type: 'debris_hauler', tier: 1, x: 0, z: 0, hp: 100, cargo: [], occupantIds: [], ...overrides };
}

function stateOf(vehicles: Vehicle[], employees: Employee[] = []): GameState {
  const state = createGame({ seed: 1, mineType: 'desert' });
  state.vehicles.vehicles = vehicles;
  state.employees.employees = employees;
  return state;
}

const NONE: FleetCriteria = { role: null, tier: null, status: null, sort: null };
const crit = (over: Partial<FleetCriteria>): FleetCriteria => ({ ...NONE, ...over });
const ids = (list: readonly Vehicle[]): number[] => list.map(v => v.id);
const run = (vehicles: Vehicle[], criteria: FleetCriteria, employees: Employee[] = []): number[] =>
  ids(filterVehicles(vehicles, criteria, stateOf(vehicles, employees)));
const maxHp = (role: VehicleRole, tier: VehicleTier): number => getVehicleDefByTier(role, tier).maxHp;

describe('fleetFilter constants', () => {
  it('offers sort keys hp and tier', () => {
    expect([...FLEET_SORT_KEYS].sort()).toEqual(['hp', 'tier']);
  });

  it('offers status choices working, waiting, stuck and damaged', () => {
    expect([...FLEET_STATUS_CHOICES].sort()).toEqual(['damaged', 'stuck', 'waiting', 'working']);
  });
});

describe('fleetCriteriaFromSelection', () => {
  it('an untouched selection yields no criteria', () => {
    expect(fleetCriteriaFromSelection(new FilterBarSelection())).toEqual(NONE);
  });

  it('reads the role from the main filter', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'drill_rig';
    expect(fleetCriteriaFromSelection(sel).role).toBe('drill_rig');
  });

  it('reads the tier group as a number', () => {
    const sel = new FilterBarSelection();
    for (const tier of [1, 2, 3]) {
      sel.groups['tier'] = String(tier);
      expect(fleetCriteriaFromSelection(sel).tier).toBe(tier);
    }
  });

  it('reads the status group', () => {
    const sel = new FilterBarSelection();
    for (const status of FLEET_STATUS_CHOICES) {
      sel.groups['status'] = status;
      expect(fleetCriteriaFromSelection(sel).status).toBe(status);
    }
  });

  it('reads every sort key', () => {
    const sel = new FilterBarSelection();
    for (const key of FLEET_SORT_KEYS) {
      sel.sort = key;
      expect(fleetCriteriaFromSelection(sel).sort).toBe(key);
    }
  });

  it('groups set back to null read as unset', () => {
    const sel = new FilterBarSelection();
    sel.groups['tier'] = null;
    sel.groups['status'] = null;
    expect(fleetCriteriaFromSelection(sel)).toEqual(NONE);
  });

  it('reads several choices at once', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'rock_digger';
    sel.groups['tier'] = '2';
    sel.groups['status'] = 'stuck';
    sel.sort = 'hp';
    expect(fleetCriteriaFromSelection(sel)).toEqual({ role: 'rock_digger', tier: 2, status: 'stuck', sort: 'hp' });
  });
});

describe('filterVehicles — no filter', () => {
  it('no criteria returns every vehicle in stored order', () => {
    expect(run([veh(3), veh(1), veh(2)], NONE)).toEqual([3, 1, 2]);
  });

  it('an empty fleet stays empty under any criteria', () => {
    expect(run([], crit({ role: 'drill_rig', sort: 'hp' }))).toEqual([]);
  });

  it('does not mutate the input list', () => {
    const input = [veh(3, { tier: 1 }), veh(1, { tier: 3 })];
    filterVehicles(input, crit({ sort: 'tier' }), stateOf(input));
    expect(ids(input)).toEqual([3, 1]);
  });
});

describe('filterVehicles — role and tier', () => {
  const fleet = [
    veh(1, { type: 'debris_hauler', tier: 1 }),
    veh(2, { type: 'drill_rig', tier: 2 }),
    veh(3, { type: 'debris_hauler', tier: 3 }),
    veh(4, { type: 'drill_rig', tier: 1 }),
  ];

  it('role keeps only that vehicle type', () => {
    expect(run(fleet, crit({ role: 'drill_rig' }))).toEqual([2, 4]);
  });

  it('a role nobody owns matches nothing', () => {
    expect(run(fleet, crit({ role: 'charging_truck' }))).toEqual([]);
  });

  it('tier keeps only that tier', () => {
    expect(run(fleet, crit({ tier: 1 }))).toEqual([1, 4]);
    expect(run(fleet, crit({ tier: 3 }))).toEqual([3]);
  });

  it('role and tier combine with AND', () => {
    expect(run(fleet, crit({ role: 'drill_rig', tier: 1 }))).toEqual([4]);
    expect(run(fleet, crit({ role: 'drill_rig', tier: 3 }))).toEqual([]);
  });
});

describe('filterVehicles — status', () => {
  it('working matches an occupant running a task', () => {
    const fleet = [veh(1, { occupantIds: [10] }), veh(2, { occupantIds: [11] })];
    const crew = [driver(10, { taskTicksRemaining: 3 }), driver(11)];
    expect(run(fleet, crit({ status: 'working' }), crew)).toEqual([1]);
  });

  it('working matches a vehicle under way on an itinerary (moving)', () => {
    const fleet = [veh(1, { occupantIds: [10] }), veh(2, { occupantIds: [11] })];
    const crew = [
      driver(10, { itinerary: { legs: [], goal: { kind: 'none' }, workTicks: 0, estTotalTicks: 0 } as unknown as Employee['itinerary'] }),
      driver(11),
    ];
    expect(run(fleet, crit({ status: 'working' }), crew)).toEqual([1]);
  });

  it('working matches a hauler on a reserved job (hauling)', () => {
    const fleet = [veh(1, { occupantIds: [10] }), veh(2, { occupantIds: [11] })];
    const state = stateOf(fleet, [driver(10), driver(11)]);
    state.vehicles.reservations.push({ vehicleId: 1, actionId: 7 });
    expect(ids(filterVehicles(fleet, crit({ status: 'working' }), state))).toEqual([1]);
  });

  it('waiting matches an occupant blocked in traffic', () => {
    const fleet = [veh(1, { occupantIds: [10] }), veh(2, { occupantIds: [11] })];
    const crew = [driver(10, { vehicleWaitingTicks: 4 }), driver(11)];
    expect(run(fleet, crit({ status: 'waiting' }), crew)).toEqual([1]);
  });

  it('stuck matches an occupant that cannot move on', () => {
    const fleet = [veh(1, { occupantIds: [10] }), veh(2, { occupantIds: [11] })];
    const crew = [driver(10, { isMoveStuck: true, moveConsecutiveFailures: 3 }), driver(11)];
    expect(run(fleet, crit({ status: 'stuck' }), crew)).toEqual([1]);
  });

  it('damaged matches a broken vehicle (hp 0), occupied or not', () => {
    const fleet = [veh(1, { hp: 0 }), veh(2, { hp: 0, occupantIds: [10] }), veh(3, { hp: 40 })];
    expect(run(fleet, crit({ status: 'damaged' }), [driver(10, { taskTicksRemaining: 2 })])).toEqual([1, 2]);
  });

  it('a broken vehicle with a busy occupant is damaged, not working', () => {
    const fleet = [veh(1, { hp: 0, occupantIds: [10] })];
    expect(run(fleet, crit({ status: 'working' }), [driver(10, { taskTicksRemaining: 2 })])).toEqual([]);
  });

  it('an idle vehicle matches no status choice', () => {
    const fleet = [veh(1), veh(2, { occupantIds: [10] })];
    for (const status of FLEET_STATUS_CHOICES) {
      expect(run(fleet, crit({ status }), [driver(10)])).toEqual([]);
    }
  });

  it('stuck wins over working for the same occupant', () => {
    const fleet = [veh(1, { occupantIds: [10] })];
    const crew = [driver(10, { isMoveStuck: true, taskTicksRemaining: 4 })];
    expect(run(fleet, crit({ status: 'stuck' }), crew)).toEqual([1]);
    expect(run(fleet, crit({ status: 'working' }), crew)).toEqual([]);
  });

  it('the status is read off the driver seat, the first occupant', () => {
    const fleet = [veh(1, { occupantIds: [10, 11] })];
    const crew = [driver(10), driver(11, { taskTicksRemaining: 4 })];
    expect(run(fleet, crit({ status: 'working' }), crew)).toEqual([]);
  });

  it('status combines with role and tier by AND', () => {
    const fleet = [
      veh(1, { type: 'drill_rig', tier: 2, occupantIds: [10] }),
      veh(2, { type: 'drill_rig', tier: 1, occupantIds: [11] }),
      veh(3, { type: 'debris_hauler', tier: 2, occupantIds: [12] }),
    ];
    const crew = [driver(10, { taskTicksRemaining: 1 }), driver(11, { taskTicksRemaining: 1 }), driver(12, { taskTicksRemaining: 1 })];
    expect(run(fleet, crit({ status: 'working', role: 'drill_rig', tier: 2 }), crew)).toEqual([1]);
    expect(run(fleet, crit({ status: 'working', tier: 2 }), crew)).toEqual([1, 3]);
  });
});

describe('filterVehicles — sorting', () => {
  it('hp sorts by the fraction of the tier maximum, lowest first', () => {
    // Raw hp ascending would be 1, 3, 2; as fractions the order is 2, 3, 1.
    const fleet = [
      veh(1, { tier: 1, hp: maxHp('debris_hauler', 1) * 0.9 }),
      veh(2, { tier: 3, hp: maxHp('debris_hauler', 3) * 0.5 }),
      veh(3, { tier: 2, hp: maxHp('debris_hauler', 2) * 0.7 }),
    ];
    expect(fleet[0]!.hp).toBeLessThan(fleet[2]!.hp);
    expect(fleet[2]!.hp).toBeLessThan(fleet[1]!.hp);
    expect(run(fleet, crit({ sort: 'hp' }))).toEqual([2, 3, 1]);
  });

  it('hp compares across roles by fraction of their own tier maximum', () => {
    const fleet = [
      veh(1, { type: 'drill_rig', tier: 1, hp: maxHp('drill_rig', 1) * 0.8 }),
      veh(2, { type: 'debris_hauler', tier: 1, hp: maxHp('debris_hauler', 1) * 0.3 }),
    ];
    expect(run(fleet, crit({ sort: 'hp' }))).toEqual([2, 1]);
  });

  it('equal hp fractions tie by id', () => {
    const fleet = [
      veh(5, { tier: 1, hp: maxHp('debris_hauler', 1) * 0.5 }),
      veh(2, { tier: 1, hp: maxHp('debris_hauler', 1) * 0.5 }),
      veh(3, { tier: 1, hp: maxHp('debris_hauler', 1) * 0.1 }),
    ];
    expect(run(fleet, crit({ sort: 'hp' }))).toEqual([3, 2, 5]);
  });

  it('a broken vehicle (hp 0) comes first under the hp sort', () => {
    const fleet = [veh(1, { hp: maxHp('debris_hauler', 1) }), veh(2, { hp: 0 })];
    expect(run(fleet, crit({ sort: 'hp' }))).toEqual([2, 1]);
  });

  it('tier sorts highest first', () => {
    const fleet = [veh(1, { tier: 1 }), veh(2, { tier: 3 }), veh(3, { tier: 2 })];
    expect(run(fleet, crit({ sort: 'tier' }))).toEqual([2, 3, 1]);
  });

  it('equal tiers tie by id', () => {
    const fleet = [veh(4, { tier: 2 }), veh(1, { tier: 2 }), veh(2, { tier: 3 })];
    expect(run(fleet, crit({ sort: 'tier' }))).toEqual([2, 1, 4]);
  });

  it('filters first, then sorts what remains', () => {
    const fleet = [
      veh(1, { type: 'drill_rig', tier: 1 }),
      veh(2, { type: 'debris_hauler', tier: 3 }),
      veh(3, { type: 'drill_rig', tier: 2 }),
    ];
    expect(run(fleet, crit({ role: 'drill_rig', sort: 'tier' }))).toEqual([3, 1]);
  });

  it('no sort keeps the stored order', () => {
    const fleet = [veh(3, { tier: 1 }), veh(1, { tier: 3 }), veh(2, { tier: 2 })];
    expect(run(fleet, NONE)).toEqual([3, 1, 2]);
  });
});
