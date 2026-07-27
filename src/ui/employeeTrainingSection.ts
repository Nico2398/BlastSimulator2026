// BlastSimulator2026 — Employee training controls
//
// The only in-game path to a qualification a role is not hired with, and to any
// proficiency above Rookie. Without a control here, `driving.excavator` and
// `driving.drill_rig` belong to nobody and no employee ever improves.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import type { Employee, SkillCategory } from '../core/entities/Employee.js';
import {
  planTraining,
  trainableSkills,
  MAX_PROFICIENCY,
} from '../core/entities/EmployeeTraining.js';
import type { Building } from '../core/entities/Building.js';

/** Every skill taught by a school standing on site, with its best school. */
export interface SkillOffer {
  skill: SkillCategory;
  building: Building;
}

/**
 * Courses the site can currently run. Highest tier wins per skill, because a
 * better school teaches the same course faster.
 */
export function availableCourses(state: GameState): SkillOffer[] {
  const best = new Map<SkillCategory, Building>();
  for (const building of state.buildings.buildings) {
    for (const skill of trainableSkills(building.type)) {
      const current = best.get(skill);
      if (!current || building.tier > current.tier) best.set(skill, building);
    }
  }
  return [...best.entries()].map(([skill, building]) => ({ skill, building }));
}

function statusLine(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'bs-training-status';
  el.style.cssText = 'font-size:10px;color:#a08060;margin:2px 0';
  el.textContent = text;
  return el;
}

/**
 * Build the training block for one employee.
 *
 * Always returns an element with a `.bs-training-status` line, so a player — or
 * the action probe — is told why a course is unavailable instead of finding an
 * inert panel.
 */
export function makeTrainingSection(
  e: Employee,
  state: GameState,
  run: ((cmd: string) => unknown) | undefined,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'bs-training-section';
  el.style.cssText = 'margin-top:6px';

  const header = document.createElement('div');
  header.style.cssText = 'font-size:9px;color:#857b6b;text-transform:uppercase;margin-bottom:2px';
  header.textContent = t('ui.employees.training');
  el.appendChild(header);

  if (e.trainingState) {
    el.appendChild(statusLine(t('ui.employees.training_in_progress')
      .replace('{skill}', e.trainingState.skill)
      .replace('{ticks}', String(e.trainingState.ticksRemaining))));
    return el;
  }

  const courses = availableCourses(state);
  if (courses.length === 0) {
    el.appendChild(statusLine(t('ui.employees.training_no_school')));
    return el;
  }

  let offered = 0;
  for (const { skill, building } of courses) {
    const plan = planTraining(e, skill, building.tier);
    const row = document.createElement('div');
    row.className = 'bs-training-row';
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px';

    const label = document.createElement('div');
    label.style.cssText = 'flex:1;min-width:0;font-size:10px;color:#d0b090';

    const btn = document.createElement('button');
    btn.className = 'bs-btn bs-btn-primary bs-train-btn';
    btn.style.cssText = 'padding:1px 6px;font-size:10px';
    btn.textContent = t('ui.employees.train');
    btn.dataset['skill'] = skill;
    btn.dataset['employee'] = String(e.id);

    if (!plan) {
      // Already Master — showing a priced button that can only fail is worse
      // than showing the reason.
      label.textContent = `${skill} — ${t('ui.employees.training_maxed')}`;
      btn.disabled = true;
    } else {
      offered++;
      label.textContent = `${skill} ${plan.currentLevel}→${plan.targetLevel} · $${plan.fee} · ${plan.ticks}t`;
      btn.disabled = state.cash < plan.fee || e.injured;
      btn.addEventListener('click', () => {
        run?.(`employee train ${e.id} skill:${skill} building:${building.id}`);
      });
    }

    row.append(label, btn);
    el.appendChild(row);
  }

  if (e.injured) {
    el.appendChild(statusLine(t('ui.employees.training_injured')));
  } else if (offered === 0) {
    el.appendChild(statusLine(t('ui.employees.training_all_maxed')
      .replace('{max}', String(MAX_PROFICIENCY))));
  } else {
    el.appendChild(statusLine(t('ui.employees.training_hint')));
  }

  return el;
}
