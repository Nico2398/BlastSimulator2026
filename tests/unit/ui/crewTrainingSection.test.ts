// @vitest-environment jsdom
// BlastSimulator2026 — crew detail makeTrainingSection (#1388): courses grant new
// qualifications only, so an offer row advertises fee, duration and the salary
// raise, and a skill the employee already holds is a locked row with no button.

import { describe, it, expect } from 'vitest';
import { makeTrainingSection, perHour } from '../../../src/ui/crewDetailSections.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { planTraining } from '../../../src/core/entities/EmployeeTraining.js';
import { Random } from '../../../src/core/math/Random.js';
import { QUALIFICATION_SALARY_BONUS, TRAINING_BASE_FEE } from '../../../src/core/config/balance.js';
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

describe('makeTrainingSection — held skill (#1388)', () => {
  it('renders a locked already-qualified row with no train button', () => {
    const { state, employee } = setup();
    const section = makeTrainingSection(employee, state, () => {});
    expect(section.querySelector('.bs-train-btn[data-skill="blasting"]')).toBeNull();
    const row = rowFor(section, 'blasting');
    expect(row.textContent).toMatch(/already qualified/i);
    expect(row.querySelector('button')).toBeNull();
  });

  it('a held skill at a higher level is also locked, never trainable', () => {
    const { state, employee } = setup();
    assignSkill(state.employees, employee.id, 'blasting', 4);
    const section = makeTrainingSection(employee, state, () => {});
    expect(section.querySelector('.bs-train-btn[data-skill="blasting"]')).toBeNull();
    expect(rowFor(section, 'blasting').textContent).toMatch(/already qualified/i);
  });

  it('when every taught skill is held, no train button is offered at all', () => {
    const { state, employee } = setup();
    assignSkill(state.employees, employee.id, 'geology', 1);
    const section = makeTrainingSection(employee, state, () => {});
    expect(section.querySelectorAll('.bs-train-btn')).toHaveLength(0);
  });
});
