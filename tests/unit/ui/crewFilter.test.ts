// @vitest-environment jsdom
// BlastSimulator2026 — crew roster filter criteria and employee filtering (#2161).
import { describe, it, expect } from 'vitest';
import {
  CREW_SORT_KEYS,
  CREW_STATUS_CHOICES,
  crewCriteriaFromSelection,
  filterEmployees,
  type CrewCriteria,
} from '../../../src/ui/crewFilter.js';
import { FilterBarSelection } from '../../../src/ui/filterBar.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { Employee, EmployeeRole, SkillCategory } from '../../../src/core/entities/Employee.js';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';

function emp(id: number, overrides: Partial<Employee> = {}): Employee {
  return {
    id, name: `Emp ${id}`, role: 'driller', salary: 1000, morale: 60,
    unionized: false, injured: false, alive: true,
    x: 5, z: 5,
    qualifications: [],
    trainingState: null,
    activeActionId: null,
    fatigue: 100,
    collapsing: false,
    interruptedActionPayload: null,
    ticksWorked: 0,
    restTicksRemaining: null,
    restNeedKey: null,
    taskTicksRemaining: null,
    activeTaskSkill: null,
    destinationX: null,
    destinationZ: null,
    moveConsecutiveFailures: 0,
    isMoveStuck: false,
    pendingRestDuration: null,
    pendingRestNeedKey: null,
    pendingTaskDuration: null,
    pendingActionType: null,
    pendingActionPayload: null,
    pendingDriverVehicleId: null,
    taskQueue: [],
    locomotion: { kind: 'on_foot' },
    itinerary: null,
    vehicleWaitingTicks: 0,
    ...overrides,
  };
}

function vehicle(id: number, occupantIds: number[]): Vehicle {
  return { id, type: 'debris_hauler', tier: 1, x: 0, z: 0, hp: 100, cargo: [], occupantIds };
}

function stateOf(employees: Employee[], vehicles: Vehicle[] = []): GameState {
  const state = createGame({ seed: 1, mineType: 'desert' });
  state.employees.employees = employees;
  state.vehicles.vehicles = vehicles;
  return state;
}

const qual = (category: SkillCategory) => ({ category, proficiencyLevel: 1 as const, xp: 0 });

const NONE: CrewCriteria = { role: null, status: null, skill: null, sort: null };
const crit = (over: Partial<CrewCriteria>): CrewCriteria => ({ ...NONE, ...over });
const ids = (list: readonly Employee[]): number[] => list.map(e => e.id);
const run = (employees: Employee[], criteria: CrewCriteria, state?: GameState): number[] =>
  ids(filterEmployees(employees, criteria, state ?? stateOf(employees)));

describe('crewFilter constants', () => {
  it('offers sort keys name, morale, fatigue and salary', () => {
    expect([...CREW_SORT_KEYS].sort()).toEqual(['fatigue', 'morale', 'name', 'salary']);
  });

  it('offers status choices working, resting, idle, stuck and injured', () => {
    expect([...CREW_STATUS_CHOICES].sort()).toEqual(['idle', 'injured', 'resting', 'stuck', 'working']);
  });
});

describe('crewCriteriaFromSelection', () => {
  it('an untouched selection yields no criteria', () => {
    expect(crewCriteriaFromSelection(new FilterBarSelection())).toEqual(NONE);
  });

  it('reads the role from the main filter', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'surveyor';
    expect(crewCriteriaFromSelection(sel).role).toBe('surveyor');
  });

  it('reads the status group', () => {
    const sel = new FilterBarSelection();
    for (const status of CREW_STATUS_CHOICES) {
      sel.groups['status'] = status;
      expect(crewCriteriaFromSelection(sel).status).toBe(status);
    }
  });

  it('reads the skill group', () => {
    const sel = new FilterBarSelection();
    sel.groups['skill'] = 'geology';
    expect(crewCriteriaFromSelection(sel).skill).toBe('geology');
  });

  it('reads every sort key', () => {
    const sel = new FilterBarSelection();
    for (const key of CREW_SORT_KEYS) {
      sel.sort = key;
      expect(crewCriteriaFromSelection(sel).sort).toBe(key);
    }
  });

  it('groups set back to null read as unset', () => {
    const sel = new FilterBarSelection();
    sel.groups['status'] = null;
    sel.groups['skill'] = null;
    expect(crewCriteriaFromSelection(sel)).toEqual(NONE);
  });

  it('reads several choices at once', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'driver';
    sel.groups['status'] = 'idle';
    sel.groups['skill'] = 'driving.truck';
    sel.sort = 'morale';
    expect(crewCriteriaFromSelection(sel)).toEqual({ role: 'driver', status: 'idle', skill: 'driving.truck', sort: 'morale' });
  });
});

describe('filterEmployees — no filter', () => {
  it('no criteria returns every employee in stored order', () => {
    expect(run([emp(3), emp(1), emp(2)], NONE)).toEqual([3, 1, 2]);
  });

  it('an empty roster stays empty under any criteria', () => {
    expect(run([], crit({ role: 'blaster', sort: 'name' }))).toEqual([]);
  });

  it('does not mutate the input list', () => {
    const input = [emp(3, { name: 'Zed' }), emp(1, { name: 'Abe' })];
    filterEmployees(input, crit({ sort: 'name' }), stateOf(input));
    expect(ids(input)).toEqual([3, 1]);
  });
});

describe('filterEmployees — role', () => {
  const roster = [
    emp(1, { role: 'driller' }), emp(2, { role: 'blaster' }), emp(3, { role: 'driller' }),
    emp(4, { role: 'manager' }),
  ];

  it('keeps only that role, in stored order', () => {
    expect(run(roster, crit({ role: 'driller' }))).toEqual([1, 3]);
  });

  it('a role nobody holds matches nothing', () => {
    expect(run(roster, crit({ role: 'surveyor' as EmployeeRole }))).toEqual([]);
  });
});

describe('filterEmployees — status', () => {
  it('working matches a running task', () => {
    const roster = [emp(1, { taskTicksRemaining: 4 }), emp(2)];
    expect(run(roster, crit({ status: 'working' }))).toEqual([1]);
  });

  it('working matches walking toward a destination', () => {
    const roster = [emp(1, { destinationX: 9, destinationZ: 9 }), emp(2)];
    expect(run(roster, crit({ status: 'working' }))).toEqual([1]);
  });

  it('working matches training', () => {
    const training = { buildingId: 1, skill: 'repair' as SkillCategory, ticksRemaining: 3, fee: 0 };
    const roster = [emp(1, { trainingState: training }), emp(2)];
    expect(run(roster, crit({ status: 'working' }))).toEqual([1]);
  });

  it('working matches driving a vehicle, with or without a reserved job', () => {
    const roster = [emp(1), emp(2), emp(3)];
    const state = stateOf(roster, [vehicle(10, [1]), vehicle(11, [2])]);
    state.vehicles.reservations.push({ vehicleId: 11, actionId: 99 });
    expect(run(roster, crit({ status: 'working' }), state)).toEqual([1, 2]);
  });

  it('resting matches only resting employees', () => {
    const roster = [emp(1, { restTicksRemaining: 3 }), emp(2), emp(3, { taskTicksRemaining: 2 })];
    expect(run(roster, crit({ status: 'resting' }))).toEqual([1]);
  });

  it('idle matches only employees with nothing to do', () => {
    const roster = [emp(1), emp(2, { restTicksRemaining: 3 }), emp(3, { taskTicksRemaining: 2 }), emp(4)];
    expect(run(roster, crit({ status: 'idle' }))).toEqual([1, 4]);
  });

  it('stuck matches a stuck walker and a collapsed employee', () => {
    const roster = [
      emp(1, { destinationX: 3, destinationZ: 3, isMoveStuck: true }),
      emp(2, { collapsing: true }),
      emp(3, { destinationX: 3, destinationZ: 3 }),
      emp(4),
    ];
    expect(run(roster, crit({ status: 'stuck' }))).toEqual([1, 2]);
  });

  it('injured reads the injured flag whatever the employee is doing', () => {
    const roster = [
      emp(1, { injured: true }),
      emp(2, { injured: true, taskTicksRemaining: 5 }),
      emp(3, { injured: true, restTicksRemaining: 5 }),
      emp(4),
    ];
    expect(run(roster, crit({ status: 'injured' }))).toEqual([1, 2, 3]);
  });

  it('an injured employee still matches the status of their activity', () => {
    const roster = [emp(1, { injured: true, taskTicksRemaining: 5 }), emp(2, { injured: true, restTicksRemaining: 5 })];
    expect(run(roster, crit({ status: 'working' }))).toEqual([1]);
    expect(run(roster, crit({ status: 'resting' }))).toEqual([2]);
  });

  it('a healthy employee never matches injured', () => {
    expect(run([emp(1), emp(2, { taskTicksRemaining: 1 })], crit({ status: 'injured' }))).toEqual([]);
  });
});

describe('filterEmployees — skill', () => {
  const roster = [
    emp(1, { qualifications: [qual('blasting'), qual('driving.truck')] }),
    emp(2, { qualifications: [qual('geology')] }),
    emp(3, { qualifications: [qual('driving.excavator'), qual('driving.truck')] }),
    emp(4, { qualifications: [] }),
  ];

  it('matches an employee holding the category in the first qualification', () => {
    expect(run(roster, crit({ skill: 'geology' }))).toEqual([2]);
  });

  it('matches an employee holding the category in a later qualification', () => {
    expect(run(roster, crit({ skill: 'driving.truck' }))).toEqual([1, 3]);
  });

  it('a category nobody holds matches nothing', () => {
    expect(run(roster, crit({ skill: 'repair' }))).toEqual([]);
  });
});

describe('filterEmployees — criteria combine with AND', () => {
  const roster = [
    emp(1, { role: 'driller', taskTicksRemaining: 3, qualifications: [qual('blasting')] }),
    emp(2, { role: 'driller', qualifications: [qual('blasting')] }),
    emp(3, { role: 'blaster', taskTicksRemaining: 3, qualifications: [qual('blasting')] }),
    emp(4, { role: 'driller', taskTicksRemaining: 3, qualifications: [qual('geology')] }),
  ];

  it('role and status', () => {
    expect(run(roster, crit({ role: 'driller', status: 'working' }))).toEqual([1, 4]);
  });

  it('role, status and skill', () => {
    expect(run(roster, crit({ role: 'driller', status: 'working', skill: 'blasting' }))).toEqual([1]);
  });

  it('contradictory criteria match nothing', () => {
    expect(run(roster, crit({ role: 'blaster', status: 'idle' }))).toEqual([]);
  });

  it('filters first, then sorts what remains', () => {
    const mixed = [
      emp(1, { role: 'driller', name: 'Zed' }),
      emp(2, { role: 'blaster', name: 'Abe' }),
      emp(3, { role: 'driller', name: 'Mia' }),
    ];
    expect(run(mixed, crit({ role: 'driller', sort: 'name' }))).toEqual([3, 1]);
  });
});

describe('filterEmployees — sorting', () => {
  it('name sorts A to Z, ignoring case', () => {
    const roster = [emp(1, { name: 'carl' }), emp(2, { name: 'Alice' }), emp(3, { name: 'Bob' })];
    expect(run(roster, crit({ sort: 'name' }))).toEqual([2, 3, 1]);
  });

  it('names equal ignoring case tie by id', () => {
    const roster = [emp(5, { name: 'bob' }), emp(2, { name: 'Bob' }), emp(9, { name: 'BOB' })];
    expect(run(roster, crit({ sort: 'name' }))).toEqual([2, 5, 9]);
  });

  it('morale sorts lowest first', () => {
    const roster = [emp(1, { morale: 80 }), emp(2, { morale: 10 }), emp(3, { morale: 45 })];
    expect(run(roster, crit({ sort: 'morale' }))).toEqual([2, 3, 1]);
  });

  it('equal morale ties by id', () => {
    const roster = [emp(4, { morale: 50 }), emp(2, { morale: 50 }), emp(3, { morale: 20 })];
    expect(run(roster, crit({ sort: 'morale' }))).toEqual([3, 2, 4]);
  });

  it('fatigue sorts lowest gauge (most tired) first', () => {
    const roster = [emp(1, { fatigue: 90 }), emp(2, { fatigue: 5 }), emp(3, { fatigue: 50 })];
    expect(run(roster, crit({ sort: 'fatigue' }))).toEqual([2, 3, 1]);
  });

  it('equal fatigue ties by id', () => {
    const roster = [emp(7, { fatigue: 30 }), emp(6, { fatigue: 30 }), emp(8, { fatigue: 10 })];
    expect(run(roster, crit({ sort: 'fatigue' }))).toEqual([8, 6, 7]);
  });

  it('salary sorts highest first', () => {
    const roster = [emp(1, { salary: 500 }), emp(2, { salary: 1500 }), emp(3, { salary: 900 })];
    expect(run(roster, crit({ sort: 'salary' }))).toEqual([2, 3, 1]);
  });

  it('equal salary ties by id', () => {
    const roster = [emp(3, { salary: 800 }), emp(1, { salary: 800 }), emp(2, { salary: 1200 })];
    expect(run(roster, crit({ sort: 'salary' }))).toEqual([2, 1, 3]);
  });

  it('no sort keeps the stored order even when ids and names disagree', () => {
    const roster = [emp(3, { name: 'Zed', salary: 1 }), emp(1, { name: 'Abe', salary: 9 }), emp(2, { name: 'Mia', salary: 5 })];
    expect(run(roster, NONE)).toEqual([3, 1, 2]);
  });
});
