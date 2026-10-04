// @vitest-environment jsdom
//
// Crew panel detail-section builders. CrewPanel.test.ts drives these through a
// mounted panel, which only ever reaches the states a default fixture happens
// to be in — the location line, the activity labels and the red morale band
// were all unreached that way. These test the exported units directly, one
// call per branch.

import { describe, it, expect } from 'vitest';
import {
  getInitials,
  roleColorHex,
  bandColor,
  moraleColor,
  describeActivity,
  makeHiredLocationStrip,
  makePaySection,
} from '../../../src/ui/crewDetailSections.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';
import type { EmployeeActivity } from '../../../src/core/entities/EmployeeActivity.js';
import { MORALE_THRESHOLDS, PAY_CYCLE_TICKS, QUALIFICATION_SALARY_BONUS } from '../../../src/core/config/balance.js';
import { BASE_SALARIES } from '../../../src/core/entities/Employee.js';
import enLocale from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import frLocale from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };
import { NavGrid } from '../../../src/core/nav/NavGrid.js';

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 1, name: 'Walt Diggins', role: 'driller', salary: 1000, morale: 60,
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

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1, type: 'debris_hauler', tier: 1, x: 0, z: 0, hp: 100,
    payload: null,
    occupantIds: [],
    ...overrides,
  };
}

function makeState(vehicles: Vehicle[] = []): GameState {
  const state = createGame({ seed: 1, mineType: 'desert' });
  state.vehicles.vehicles = vehicles;
  return state;
}

function makeFlatNavGrid(size: number, benchLevel: number): NavGrid {
  const cells = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ type: 'walkable' as const, moveCost: 1.0, benchLevel, vehicleOccupied: false })));
  return new NavGrid(size, size, cells, 0);
}

function activity(overrides: Partial<EmployeeActivity> = {}): EmployeeActivity {
  return { kind: 'idle', ticksRemaining: null, totalTicks: null, actionType: null, vehicleId: null, ...overrides };
}

describe('getInitials', () => {
  it('takes the first letter of every word', () => {
    expect(getInitials('Walt Diggins')).toBe('WD');
  });

  it('skips a word that has no first letter — a double space yields an empty segment', () => {
    expect(getInitials('Walt  Diggins')).toBe('WD');
  });
});

describe('roleColorHex', () => {
  it('renders the mesh color as a six-digit CSS hex', () => {
    expect(roleColorHex('driller')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('bandColor', () => {
  it('is red below the red bound', () => {
    expect(bandColor(10, 20, 60)).toBe('var(--bsx-critical)');
  });

  it('is amber between the bounds', () => {
    expect(bandColor(40, 20, 60)).toBe('var(--bsx-amber)');
  });

  it('is green at the green bound', () => {
    expect(bandColor(60, 20, 60)).toBe('var(--bsx-positive)');
  });
});

describe('moraleColor', () => {
  it('reads the morale bands off the balance config', () => {
    expect(moraleColor(MORALE_THRESHOLDS.low - 1)).toBe('var(--bsx-critical)');
    expect(moraleColor(MORALE_THRESHOLDS.high)).toBe('var(--bsx-positive)');
  });
});

describe('describeActivity', () => {
  it('labels a collapsed employee', () => {
    expect(describeActivity(activity({ kind: 'collapsed' }))).toBe('Collapsed');
  });

  it('labels a resting employee', () => {
    expect(describeActivity(activity({ kind: 'resting', ticksRemaining: 3 }))).toBe('Resting');
  });

  it('names the vehicle while driving', () => {
    expect(describeActivity(activity({ kind: 'driving', vehicleId: 7 }))).toBe('Driving #7');
  });

  it('names the vehicle while driving to a task', () => {
    expect(describeActivity(activity({ kind: 'driving_to_task', vehicleId: 7 }))).toBe('Driving to task (#7)');
  });

  it('names the action while working it', () => {
    expect(describeActivity(activity({ kind: 'working', actionType: 'drill_hole' }))).toBe('Drilling');
  });

  it('falls back to general work when a working employee has no action type', () => {
    expect(describeActivity(activity({ kind: 'working' }))).toBe('Working');
  });

  it('names the action being walked to', () => {
    expect(describeActivity(activity({ kind: 'walking', actionType: 'drill_hole' }))).toBe('Walking to Drilling');
  });

  it('says only walking when no action is dispatched yet', () => {
    expect(describeActivity(activity({ kind: 'walking' }))).toBe('Walking');
  });

  it('labels an idle employee', () => {
    expect(describeActivity(activity())).toBe('Idle');
  });
});

describe('makeHiredLocationStrip', () => {
  it('dates the hire from the tick it happened on', () => {
    const strip = makeHiredLocationStrip(makeEmployee({ hiredAtTick: 48 }), makeState());
    expect(strip.textContent).toContain('Day 3');
  });

  it('says the hire date is unknown for an employee with no hire tick', () => {
    const strip = makeHiredLocationStrip(makeEmployee(), makeState());
    expect(strip.textContent).toContain('Unknown');
  });

  it('reports the vehicle as the location while driving it', () => {
    const state = makeState([makeVehicle({ id: 4, occupantIds: [1] })]);
    expect(makeHiredLocationStrip(makeEmployee({ id: 1 }), state).textContent).toContain('Aboard #4');
  });

  it('reports the vehicle as the location while driving to a task', () => {
    const state = makeState([makeVehicle({ id: 4, occupantIds: [1] })]);
    state.vehicles.reservations.push({ vehicleId: 4, actionId: 9 });
    expect(makeHiredLocationStrip(makeEmployee({ id: 1 }), state).textContent).toContain('Aboard #4');
  });

  it('reports the destination while walking to it', () => {
    const strip = makeHiredLocationStrip(makeEmployee({ destinationX: 12, destinationZ: 8 }), makeState());
    expect(strip.textContent).toContain('Walking to (12, 8)');
  });

  it('falls back to the employee position when only one destination axis is set', () => {
    const strip = makeHiredLocationStrip(makeEmployee({ x: 5, z: 5, destinationX: 12 }), makeState());
    expect(strip.textContent).toContain('Walking to (12, 5)');
  });

  it('names the bench a standing employee is on', () => {
    const state = makeState();
    state.navGrid = makeFlatNavGrid(20, 2);
    expect(makeHiredLocationStrip(makeEmployee({ x: 5, z: 5 }), state).textContent).toContain('Bench 2 (5, 5)');
  });

  it('gives bare coordinates when the cell under the employee is off the grid', () => {
    const state = makeState();
    state.navGrid = makeFlatNavGrid(4, 2);
    expect(makeHiredLocationStrip(makeEmployee({ x: 40, z: 40 }), state).textContent).toContain('(40, 40)');
  });

  it('gives bare coordinates before any nav grid is built', () => {
    const state = makeState();
    state.navGrid = null;
    expect(makeHiredLocationStrip(makeEmployee({ x: 5, z: 5 }), state).textContent).toContain('(5, 5)');
  });
});

// ── PAY section: salary is paid once per PAY_CYCLE_TICKS, 1 tick = 1 game-hour (#1373) ──

describe('makePaySection per-hour display (#1373)', () => {
  /** Expected per-hour figure: salary / PAY_CYCLE_TICKS, 1 decimal, no trailing .0. */
  const perHour = (amount: number): string => String(Math.round((amount / PAY_CYCLE_TICKS) * 10) / 10);
  /** Prefix match that rejects a longer number ("$50" must not match "$500"). */
  const exactly = (prefix: string): RegExp => new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\d.])');
  const pay = (e: Employee): string => makePaySection(e, () => {}).textContent ?? '';

  it('shows salary 450 as $45/h, not $450/h', () => {
    const text = pay(makeEmployee({ salary: 45 * PAY_CYCLE_TICKS }));
    expect(text).toContain('$45/h');
    expect(text).not.toContain(`$${45 * PAY_CYCLE_TICKS}/h`);
  });

  it('derives the divisor from PAY_CYCLE_TICKS', () => {
    const salary = 450;
    expect(pay(makeEmployee({ salary }))).toContain(`$${perHour(salary)}/h`);
  });

  it('keeps one decimal when salary is not a multiple of the cycle', () => {
    const salary = 45 * PAY_CYCLE_TICKS + PAY_CYCLE_TICKS / 2;
    expect(pay(makeEmployee({ salary }))).toContain(`$${perHour(salary)}/h`);
    expect(perHour(salary)).toBe('45.5');
  });

  it('shows zero salary as $0/h', () => {
    expect(pay(makeEmployee({ salary: 0 }))).toContain('$0/h');
  });

  it('shows the default fixture salary 1000 per hour, not $1000/h', () => {
    const text = pay(makeEmployee());
    expect(text).toContain(`$${perHour(1000)}/h`);
    expect(text).not.toContain('$1000/h');
  });

  it('shows base figure per hour', () => {
    const e = makeEmployee({ role: 'driller' });
    expect(pay(e)).toMatch(exactly(`Base $${perHour(BASE_SALARIES.driller)}`));
  });

  it('shows skill bonus per hour', () => {
    const e = makeEmployee({
      qualifications: [{ category: 'drilling', proficiencyLevel: 2, xp: 0 }],
    });
    expect(pay(e)).toMatch(exactly(`+ skills $${perHour(QUALIFICATION_SALARY_BONUS[2])}`));
  });
});

describe('pay i18n keys keep placeholder parity (#1373)', () => {
  const placeholders = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort();
  const en = enLocale as Record<string, string>;
  const fr = frLocale as Record<string, string>;

  for (const key of ['ui.crew.pay_base', 'ui.crew.pay_bonus', 'ui.crew.pay_total']) {
    it(`${key} uses the same placeholders in en and fr`, () => {
      expect(placeholders(fr[key])).toEqual(placeholders(en[key]));
      expect(placeholders(en[key])).toEqual(['{amount}']);
    });
  }

  it('pay_total still reads per hour in both locales', () => {
    expect(en['ui.crew.pay_total']).toContain('/h');
    expect(fr['ui.crew.pay_total']).toContain('/h');
  });
});
