// @vitest-environment jsdom
//
// Crew panel detail-section builders. CrewPanel.test.ts drives these through a
// mounted panel, which only ever reaches the states a default fixture happens
// to be in — the location line, the activity labels and the red morale band
// were all unreached that way. These test the exported units directly, one
// call per branch.

import { describe, it, expect, vi } from 'vitest';
import {
  getInitials,
  roleColorHex,
  bandColor,
  moraleColor,
  describeActivity,
  makeHiredLocationStrip,
  makePaySection,
  makeSkillsSection,
  makeCurrentTaskSection,
  makeRestSection,
  makeStatusTags,
  makeIdentitySection,
  type LinkFactory,
} from '../../../src/ui/crewDetailSections.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { Employee, EmployeeState } from '../../../src/core/entities/Employee.js';
import { giveRaise, calculateSalary } from '../../../src/core/entities/Employee.js';
import { gainXp } from '../../../src/core/entities/EmployeeGainXp.js';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';
import type { EmployeeActivity } from '../../../src/core/entities/EmployeeActivity.js';
import { MORALE_THRESHOLDS, PAY_CYCLE_TICKS, QUALIFICATION_SALARY_BONUS, XP_THRESHOLDS } from '../../../src/core/config/balance.js';
import { BASE_SALARIES } from '../../../src/core/entities/Employee.js';
import enLocale from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import frLocale from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };
import { t } from '../../../src/core/i18n/I18n.js';
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
    cargo: [],
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
  it('labels a stuck employee with the stuck text, not walking (#1387)', () => {
    const text = describeActivity(activity({ kind: 'stuck' }));
    expect(text).toBe(t('ui.crew.task_stuck'));
    expect(text).not.toBe(t('ui.crew.task_walking'));
    expect(text).not.toBe(t('ui.crew.task_idle'));
  });

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

  it('reports the current position, not a walk, while stuck', () => {
    const strip = makeHiredLocationStrip(makeEmployee({ x: 3, z: 4, destinationX: 12, destinationZ: 8, isMoveStuck: true }), makeState());
    expect(strip.textContent).toContain('Stuck at (3, 4)');
    expect(strip.textContent).not.toContain('Walking to');
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
      qualifications: [{ category: 'driving.drill_rig', proficiencyLevel: 2, xp: 0 }],
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
      expect(placeholders(fr[key] ?? '')).toEqual(placeholders(en[key] ?? ''));
      expect(placeholders(en[key] ?? '')).toEqual(['{amount}']);
    });
  }

  it('pay_total still reads per hour in both locales', () => {
    expect(en['ui.crew.pay_total']).toContain('/h');
    expect(fr['ui.crew.pay_total']).toContain('/h');
  });
});

describe('makePaySection raises line (#1383)', () => {
  const perHour = (amount: number): string => String(Math.round((amount / PAY_CYCLE_TICKS) * 10) / 10);
  const pay = (e: Employee): string => makePaySection(e, () => {}).textContent ?? '';
  const withParts = (raises?: number): Employee => {
    const bonus = QUALIFICATION_SALARY_BONUS[2];
    const base = BASE_SALARIES['driller'];
    return makeEmployee({
      role: 'driller',
      qualifications: [{ category: 'blasting', proficiencyLevel: 2, xp: 0 }],
      ...(raises === undefined ? {} : { raises }),
      salary: base + bonus + (raises ?? 0),
    });
  };

  it('shows base, skills, raises and total when raises is 250', () => {
    const e = withParts(250);
    const text = pay(e);
    expect(text).toContain(`Base $${perHour(BASE_SALARIES['driller'])}/h`);
    expect(text).toContain(`+ skills $${perHour(QUALIFICATION_SALARY_BONUS[2])}/h`);
    expect(text).toContain(`+ raises $${perHour(250)}/h`);
    expect(text).toContain(`$${perHour(e.salary)}/h`);
  });

  it('displayed parts sum to the total after a real giveRaise and a level-up', () => {
    const es = { employees: [makeEmployee({
      role: 'driller',
      qualifications: [{ category: 'blasting', proficiencyLevel: 1, xp: 0 }],
    })] } as unknown as EmployeeState;
    const e = es.employees[0]!;
    e.salary = calculateSalary(e);
    expect(giveRaise(es, e.id, 250)).toBe(true);
    expect(gainXp(es, e.id, 'blasting', XP_THRESHOLDS[2])?.leveledUp).toBe(true);
    expect(e.raises).toBe(250);

    const spans = Array.from(makePaySection(e, () => {}).querySelectorAll('span')).map(s => s.textContent ?? '');
    const num = (prefix: RegExp): number => {
      const m = spans.map(s => prefix.exec(s)).find(Boolean);
      expect(m).toBeTruthy();
      return parseFloat(m![1]!);
    };
    const base = num(/^Base \$([\d.]+)\/h$/);
    const skills = num(/^\+ skills \$([\d.]+)\/h$/);
    const raises = num(/^\+ raises \$([\d.]+)\/h$/);
    const total = num(/^\$([\d.]+)\/h$/);
    expect(skills).toBeGreaterThan(0);
    expect(raises).toBeGreaterThan(0);
    // each figure is rounded to 0.1, so allow 3 roundings of slack
    expect(Math.abs(base + skills + raises - total)).toBeLessThanOrEqual(0.15 + 1e-9);
  });

  it('shows $0 raises when raises is absent', () => {
    expect(pay(withParts(undefined))).toContain('+ raises $0/h');
  });
});


// ── #1762: inspector-facing location, task target, licence tier, rest ──

type LinkCall = { kind: string; id: number; label: string };

function recordingLinks(): { link: LinkFactory; calls: LinkCall[] } {
  const calls: LinkCall[] = [];
  const link: LinkFactory = (kind, id, label) => {
    calls.push({ kind, id, label });
    const a = document.createElement('a');
    a.dataset['selectKind'] = kind;
    a.dataset['selectId'] = String(id);
    a.textContent = label;
    return a;
  };
  return { link, calls };
}

function stateWithBuilding(type: 'living_quarters' | 'blasting_academy', id = 4): GameState {
  const s = makeState();
  s.buildings.buildings = [{ id, type, tier: 1, x: 8, z: 8, hp: 100, active: true, occupantIds: [] }];
  return s;
}

describe('makeHiredLocationStrip — inside / aboard links (#1762)', () => {
  it('inside a building with a link factory: a building link, label names the building', () => {
    const s = stateWithBuilding('living_quarters');
    const e = makeEmployee({ locomotion: { kind: 'inside', buildingId: 4 } });
    const { link, calls } = recordingLinks();
    const strip = makeHiredLocationStrip(e, s, link);
    const a = strip.querySelector('[data-select-kind="building"]') as HTMLElement;
    expect(a).not.toBeNull();
    expect(a.dataset['selectId']).toBe('4');
    expect(calls).toHaveLength(1);
    expect(strip.textContent).toContain(t('building.living_quarters.name'));
    expect(strip.textContent).not.toMatch(/ui\.crew\./);
  });

  it('inside a building without a factory: plain text naming the building, no links', () => {
    const s = stateWithBuilding('living_quarters');
    const e = makeEmployee({ locomotion: { kind: 'inside', buildingId: 4 } });
    const strip = makeHiredLocationStrip(e, s);
    expect(strip.querySelector('[data-select-kind]')).toBeNull();
    expect(strip.textContent).toContain(t('building.living_quarters.name'));
  });

  it('mounted with a link factory: a vehicle link', () => {
    const s = makeState([makeVehicle({ id: 9, occupantIds: [1] })]);
    const e = makeEmployee({ locomotion: { kind: 'mounted', vehicleId: 9 } });
    const { link } = recordingLinks();
    const strip = makeHiredLocationStrip(e, s, link);
    const a = strip.querySelector('[data-select-kind="vehicle"]') as HTMLElement;
    expect(a).not.toBeNull();
    expect(a.dataset['selectId']).toBe('9');
  });

  it('mounted without a factory keeps the plain Aboard text (Crew row unchanged)', () => {
    const s = makeState([makeVehicle({ id: 9, occupantIds: [1] })]);
    const e = makeEmployee({ locomotion: { kind: 'mounted', vehicleId: 9 } });
    const strip = makeHiredLocationStrip(e, s);
    expect(strip.querySelector('[data-select-kind]')).toBeNull();
    expect(strip.textContent).toContain(t('ui.crew.location_aboard', { vehicle: '#9' }));
  });

  it('stuck reports the number of ticks', () => {
    const e = makeEmployee({ isMoveStuck: true, moveConsecutiveFailures: 23, destinationX: 9, destinationZ: 9 });
    const text = makeHiredLocationStrip(e, makeState()).textContent ?? '';
    expect(text).toContain('23');
    expect(text).not.toMatch(/^ui\./);
  });

  it('walking to rest reads differently from plain walking', () => {
    const plain = makeEmployee({ destinationX: 9, destinationZ: 9 });
    const rest = makeEmployee({ destinationX: 9, destinationZ: 9, pendingRestDuration: 30 });
    const a = makeHiredLocationStrip(plain, makeState()).textContent;
    const b = makeHiredLocationStrip(rest, makeState()).textContent;
    expect(b).not.toBe(a);
    expect(b).not.toMatch(/ui\.crew\.location/);
  });

  it('walking to school reads differently from plain walking', () => {
    const plain = makeEmployee({ destinationX: 9, destinationZ: 9 });
    const school = makeEmployee({
      destinationX: 9, destinationZ: 9,
      pendingTrainingState: { buildingId: 4, skill: 'geology', ticksRemaining: 10, fee: 1 },
    });
    const a = makeHiredLocationStrip(plain, makeState()).textContent;
    const b = makeHiredLocationStrip(school, stateWithBuilding('blasting_academy')).textContent;
    expect(b).not.toBe(a);
  });

  it('plain bench / coordinate output is unchanged without a factory', () => {
    const s = makeState();
    s.navGrid = makeFlatNavGrid(16, 3);
    const text = makeHiredLocationStrip(makeEmployee({ x: 5, z: 5 }), s).textContent ?? '';
    expect(text).toContain(t('ui.crew.location_bench', { bench: 3, x: 5, z: 5 }));
  });
});

describe('makeSkillsSection — driving licence tier (#1762)', () => {
  const driving = (licenceLevel?: 1 | 2 | 3) => makeEmployee({
    qualifications: [{ category: 'driving.truck', proficiencyLevel: 2, xp: 0, ...(licenceLevel ? { licenceLevel } : {}) }],
  });

  it('shows tier 3 for a tier-3 licence', () => {
    expect(makeSkillsSection(driving(3)).textContent).toContain(t('ui.crew.licence_tier', { tier: 3 }));
  });

  it('an absent licenceLevel reads as tier 1', () => {
    expect(makeSkillsSection(driving()).textContent).toContain(t('ui.crew.licence_tier', { tier: 1 }));
  });

  it('a non-driving skill shows no licence tier', () => {
    const e = makeEmployee({ qualifications: [{ category: 'blasting' as never, proficiencyLevel: 1, xp: 0 }] });
    expect(makeSkillsSection(e).textContent).not.toContain(t('ui.crew.licence_tier', { tier: 1 }));
  });
});

describe('makeCurrentTaskSection — target link and queued count (#1762)', () => {
  const working = (payload: Record<string, unknown> | null, extra: Partial<Employee> = {}) => makeEmployee({
    activeActionId: 5, taskTicksRemaining: 10, activeTaskTotalTicks: 20, pendingActionType: 'repair_vehicle' as never,
    pendingActionPayload: payload, ...extra,
  });

  it('links the task target vehicle', () => {
    const s = makeState([makeVehicle({ id: 9 })]);
    const { link } = recordingLinks();
    const sec = makeCurrentTaskSection(working({ vehicleId: 9 }), s, link);
    const a = sec.querySelector('[data-select-kind="vehicle"]') as HTMLElement;
    expect(a).not.toBeNull();
    expect(a.dataset['selectId']).toBe('9');
  });

  it('no link when the target is gone', () => {
    const { link } = recordingLinks();
    const sec = makeCurrentTaskSection(working({ vehicleId: 9 }), makeState(), link);
    expect(sec.querySelector('[data-select-kind]')).toBeNull();
  });

  it('no link without a factory', () => {
    const s = makeState([makeVehicle({ id: 9 })]);
    expect(makeCurrentTaskSection(working({ vehicleId: 9 }), s).querySelector('[data-select-kind]')).toBeNull();
  });

  it('shows the queued task count when follow-ups are queued', () => {
    const e = working(null, { taskQueue: [7, 8] });
    const text = makeCurrentTaskSection(e, makeState()).textContent ?? '';
    expect(text).toContain(t('ui.crew.queued_tasks', { n: 3 }));
  });

  it('shows no queued line for an idle employee', () => {
    const text = makeCurrentTaskSection(makeEmployee(), makeState()).textContent ?? '';
    expect(text).not.toContain(t('ui.crew.queued_tasks', { n: 0 }));
    expect(text).not.toContain(t('ui.crew.queued_tasks', { n: 1 }));
  });
});

describe('makeRestSection (#1762)', () => {
  it('null when neither resting nor walking to rest', () => {
    expect(makeRestSection(makeEmployee(), makeState())).toBeNull();
  });

  it('resting inside a building: building link and time left', () => {
    const s = stateWithBuilding('living_quarters');
    const e = makeEmployee({ locomotion: { kind: 'inside', buildingId: 4 }, restTicksRemaining: 14 });
    const { link } = recordingLinks();
    const sec = makeRestSection(e, s, link)!;
    expect(sec).not.toBeNull();
    expect(sec.querySelector('[data-select-kind="building"]')).not.toBeNull();
    expect(sec.textContent).toContain('14');
  });

  it('walking to rest reads differently from resting', () => {
    const s = stateWithBuilding('living_quarters');
    const walking = makeEmployee({ destinationX: 8, destinationZ: 8, pendingRestDuration: 30 });
    const resting = makeEmployee({ locomotion: { kind: 'inside', buildingId: 4 }, restTicksRemaining: 14 });
    const w = makeRestSection(walking, s)!;
    expect(w).not.toBeNull();
    expect(w.textContent).not.toBe(makeRestSection(resting, s)!.textContent);
  });
});

describe('makeStatusTags / makeIdentitySection (#1762)', () => {
  it('status tags show a union chip only for unionized employees', () => {
    const plain = makeStatusTags(makeEmployee(), makeState());
    const union = makeStatusTags(makeEmployee({ unionized: true }), makeState());
    expect(union.textContent!.length + union.querySelectorAll('*').length)
      .toBeGreaterThan(plain.textContent!.length + plain.querySelectorAll('*').length);
  });

  it('identity shows name initials, role and morale', () => {
    const sec = makeIdentitySection(makeEmployee({ morale: 42, hiredAtTick: 48 }), makeState());
    const text = sec.textContent ?? '';
    expect(text).toContain('WD');
    expect(text).toContain(t('role.driller'));
    expect(text).toContain('42');
    expect(text).toContain(t('ui.crew.day_label', { day: 3 }));
  });

  it('identity does not throw for a legacy employee without hiredAtTick', () => {
    const fn = vi.fn(() => makeIdentitySection(makeEmployee(), makeState()));
    expect(fn).not.toThrow();
  });
});
