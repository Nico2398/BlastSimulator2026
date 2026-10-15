// @vitest-environment jsdom
// BlastSimulator2026 — crew detail makeTrainingSection (#1388): courses grant new
// qualifications only, so an offer row advertises fee, duration and the salary
// raise, and a skill the employee already holds is a locked row with no button.

import { describe, it, expect } from 'vitest';
import { makeTrainingSection, perHour, type LinkFactory } from '../../../src/ui/crewDetailSections.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { planTraining } from '../../../src/core/entities/EmployeeTraining.js';
import { Random } from '../../../src/core/math/Random.js';
import { QUALIFICATION_SALARY_BONUS, TRAINING_BASE_FEE, TRAINING_LEVEL_FEE } from '../../../src/core/config/balance.js';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';

function setup(): { state: GameState; employee: Employee } {
  setLocale('en');
  const state = createGame({ seed: 42 });
  state.cash = 1_000_000;
  placeBuilding(state.buildings, 'geology_lab', 10, 10, 64, 64, 1);
  placeBuilding(state.buildings, 'blasting_academy', 30, 10, 64, 64, 1);
  const { employee } = hireEmployee(state.employees, 'driller', new Random(42), 2, 2); // holds blasting, not geology
  return { state, employee };
}

function rowFor(section: HTMLElement, skill: string): HTMLElement {
  const label = t(`course.${skill}`);
  const rows = Array.from(section.querySelectorAll('div')).filter(
    d => d.textContent?.includes(label) && d.querySelector('button') !== null || d.textContent?.includes(label) && d.children.length === 1,
  );
  // Innermost row that mentions the course label.
  const row = rows.find(r => !Array.from(r.querySelectorAll('div')).some(c => rows.includes(c)));
  if (!row) throw new Error(`no training row for ${skill}`);
  return row;
}

describe('makeTrainingSection — offer row (#1388)', () => {
  it('shows fee, ticks and the salary increase for a skill the employee lacks', () => {
    const { state, employee } = setup();
    const plan = planTraining(employee, 'geology', 1)!;
    const section = makeTrainingSection(employee, state, () => {});
    const text = rowFor(section, 'geology').textContent ?? '';
    expect(text).toContain(`${plan.fee}`);
    expect(text).toContain(`${plan.ticks}h`);
    expect(text).toContain(`+$${perHour(QUALIFICATION_SALARY_BONUS[1])}`);
  });

  it('flat fee equals TRAINING_BASE_FEE in the displayed text', () => {
    const { state, employee } = setup();
    const section = makeTrainingSection(employee, state, () => {});
    expect(rowFor(section, 'geology').textContent).toContain(String(TRAINING_BASE_FEE));
  });

  it('the offer row has an enabled train button that calls back with skill and school', () => {
    const { state, employee } = setup();
    const calls: Array<[string, number]> = [];
    const section = makeTrainingSection(employee, state, (skill, id) => calls.push([skill, id]));
    const btn = section.querySelector('.bs-train-btn[data-skill="geology"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('geology');
  });

  it('does not render the old level arrow in any course title', () => {
    const { state, employee } = setup();
    const section = makeTrainingSection(employee, state, () => {});
    expect(section.textContent).not.toContain('→');
  });
});

/** Level mention in an offer row: "level 2", "lvl 2" or "L2". */
const levelMention = (n: number) => new RegExp(`(level|lvl)\\s*${n}\\b|\\bL${n}\\b`, 'i');

function setupTier(tier: 1 | 2 | 3): { state: GameState; employee: Employee } {
  setLocale('en');
  const state = createGame({ seed: 42 });
  state.cash = 1_000_000;
  state.buildings.unlockedTiers['geology_lab'] = tier;
  state.buildings.unlockedTiers['blasting_academy'] = tier;
  placeBuilding(state.buildings, 'geology_lab', 10, 10, 64, 64, tier);
  placeBuilding(state.buildings, 'blasting_academy', 30, 10, 64, 64, tier);
  const { employee } = hireEmployee(state.employees, 'driller', new Random(42), 2, 2); // blasting 1, no geology
  return { state, employee };
}

describe('makeTrainingSection — level offers (#1726)', () => {
  it('an unlock offer at a tier-1 school names level 1', () => {
    const { state, employee } = setup();
    const section = makeTrainingSection(employee, state, () => {});
    expect(rowFor(section, 'geology').textContent).toMatch(levelMention(1));
  });

  it.each([2, 3] as const)('an unlock offer at a tier-%i school names that level, its fee and ticks', (tier) => {
    const { state, employee } = setupTier(tier);
    const plan = planTraining(employee, 'geology', tier)!;
    const text = rowFor(makeTrainingSection(employee, state, () => {}), 'geology').textContent ?? '';
    expect(text).toMatch(levelMention(plan.grantsLevel!));
    expect(text).toContain(String(TRAINING_LEVEL_FEE[tier]));
    expect(text).toContain(`${plan.ticks}h`);
  });

  it('a held level-1 skill at a tier-2 school is an enabled upgrade offer naming level 2 and the pay difference', () => {
    const { state, employee } = setupTier(2);
    const section = makeTrainingSection(employee, state, () => {});
    const btn = section.querySelector('.bs-train-btn[data-skill="blasting"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(false);
    const text = rowFor(section, 'blasting').textContent ?? '';
    expect(text).toMatch(levelMention(2));
    expect(text).toContain(`+$${perHour(QUALIFICATION_SALARY_BONUS[2] - QUALIFICATION_SALARY_BONUS[1])}`);
  });

  it('the upgrade button dispatches the train callback with skill and school id', () => {
    const { state, employee } = setupTier(2);
    const school = state.buildings.buildings.find(b => b.type === 'blasting_academy')!;
    const calls: Array<[string, number]> = [];
    const section = makeTrainingSection(employee, state, (skill, id) => calls.push([skill, id]));
    (section.querySelector('.bs-train-btn[data-skill="blasting"]') as HTMLButtonElement).click();
    expect(calls).toEqual([['blasting', school.id]]);
  });

  it('the train button is disabled when cash is below the level fee', () => {
    const { state, employee } = setupTier(3);
    state.cash = TRAINING_LEVEL_FEE[3] - 1;
    const btn = makeTrainingSection(employee, state, () => {}).querySelector('.bs-train-btn[data-skill="geology"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

describe('makeTrainingSection — refused courses (#1726)', () => {
  it('a held level-1 skill at a tier-1 school is not trainable and says a higher school is needed', () => {
    const { state, employee } = setup();
    const section = makeTrainingSection(employee, state, () => {});
    expect(section.querySelector('.bs-train-btn[data-skill="blasting"]:not([disabled])')).toBeNull();
    const row = rowFor(section, 'blasting');
    expect(row.textContent).toMatch(/higher school/i);
    expect(row.textContent).not.toMatch(/already qualified/i);
  });

  it('a held level-2 skill at a tier-2 school says a higher school is needed', () => {
    const { state, employee } = setupTier(2);
    assignSkill(state.employees, employee.id, 'blasting', 2);
    const section = makeTrainingSection(employee, state, () => {});
    expect(section.querySelector('.bs-train-btn[data-skill="blasting"]:not([disabled])')).toBeNull();
    expect(rowFor(section, 'blasting').textContent).toMatch(/higher school/i);
  });

  it.each([3, 4, 5] as const)('a held level-%i skill says top level and offers no enabled button', (level) => {
    const { state, employee } = setupTier(3);
    assignSkill(state.employees, employee.id, 'blasting', level);
    const section = makeTrainingSection(employee, state, () => {});
    expect(section.querySelector('.bs-train-btn[data-skill="blasting"]:not([disabled])')).toBeNull();
    expect(rowFor(section, 'blasting').textContent).toMatch(/top level/i);
  });

  it('a level-3 skill at a tier-1 school also says top level', () => {
    const { state, employee } = setup();
    assignSkill(state.employees, employee.id, 'blasting', 3);
    expect(rowFor(makeTrainingSection(employee, state, () => {}), 'blasting').textContent).toMatch(/top level/i);
  });

  it('when no taught skill can be trained, no enabled train button is offered at all', () => {
    const { state, employee } = setup();
    assignSkill(state.employees, employee.id, 'geology', 1);
    const section = makeTrainingSection(employee, state, () => {});
    expect(section.querySelectorAll('.bs-train-btn:not([disabled])')).toHaveLength(0);
  });
});


// ── #1762: school link while training or walking to school ──

const schoolLink: LinkFactory = (kind, id, label) => {
  const a = document.createElement('a');
  a.dataset['selectKind'] = kind;
  a.dataset['selectId'] = String(id);
  a.textContent = label;
  return a;
};

describe('makeTrainingSection — school link (#1762)', () => {
  it('in progress: links the school and keeps .bs-training-active[data-skill]', () => {
    const { state, employee } = setup();
    const school = state.buildings.buildings.find(b => b.type === 'blasting_academy')!;
    employee.trainingState = { buildingId: school.id, skill: 'geology', ticksRemaining: 7, fee: 100 };
    const section = makeTrainingSection(employee, state, () => {}, schoolLink);
    const active = section.querySelector('.bs-training-active[data-skill="geology"]');
    expect(active).not.toBeNull();
    const a = section.querySelector('[data-select-kind="building"]') as HTMLElement;
    expect(a).not.toBeNull();
    expect(a.dataset['selectId']).toBe(String(school.id));
    expect(section.textContent).toContain('7');
  });

  it('in progress without a factory: no link, active marker intact', () => {
    const { state, employee } = setup();
    const school = state.buildings.buildings[0]!;
    employee.trainingState = { buildingId: school.id, skill: 'geology', ticksRemaining: 7, fee: 100 };
    const section = makeTrainingSection(employee, state, () => {});
    expect(section.querySelector('[data-select-kind]')).toBeNull();
    expect(section.querySelector('.bs-training-active[data-skill="geology"]')).not.toBeNull();
  });

  it('walking to school: links the pending school, no active marker', () => {
    const { state, employee } = setup();
    const school = state.buildings.buildings.find(b => b.type === 'blasting_academy')!;
    employee.pendingTrainingState = { buildingId: school.id, skill: 'geology', ticksRemaining: 7, fee: 100 };
    const section = makeTrainingSection(employee, state, () => {}, schoolLink);
    const a = section.querySelector('[data-select-kind="building"]') as HTMLElement;
    expect(a).not.toBeNull();
    expect(a.dataset['selectId']).toBe(String(school.id));
    expect(section.querySelector('.bs-training-active')).toBeNull();
  });

  it('idle with offers: still renders train buttons and no school link', () => {
    const { state, employee } = setup();
    const section = makeTrainingSection(employee, state, () => {}, schoolLink);
    expect(section.querySelector('.bs-train-btn[data-skill="geology"]')).not.toBeNull();
    expect(section.querySelector('[data-select-kind]')).toBeNull();
  });
});
