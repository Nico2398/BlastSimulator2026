// BlastSimulator2026 — Crew panel detail-section builders (redesign P6)
// HIRED/LOCATION, NEEDS, CURRENT TASK, and SKILLS blocks shown when a roster
// card is expanded. Split out of CrewPanel.ts to keep both files under the
// file-size guideline, mirroring the old EmployeePanel/employeeDetailSections
// split this replaces.

import { t } from '../core/i18n/I18n.js';
import { el, gauge, button, reasonLine } from './dom.js';
import type { Employee, EmployeeRole, SkillCategory } from '../core/entities/Employee.js';
import { BASE_SALARIES } from '../core/entities/Employee.js';
import type { GameState } from '../core/state/GameState.js';
import type { ActionType } from '../core/state/GameState.js';
import { computeEmployeeActivity, taskProgressFraction, type EmployeeActivity } from '../core/entities/EmployeeActivity.js';
import { availableTrainingOffers, planTraining, MAX_PROFICIENCY } from '../core/entities/EmployeeTraining.js';
import { NEED_THRESHOLDS, MORALE_THRESHOLDS, XP_THRESHOLDS, PROFICIENCY_MULTIPLIERS, QUALIFICATION_SALARY_BONUS } from '../core/config/balance.js';
import { ROLE_COLORS } from '../renderer/CharacterMesh.js';

/** Quick-raise amounts offered in the PAY block — flat $ presets, not derived from any per-role scale. */
export const RAISE_PRESETS = [50, 100, 250];

/** `0xRRGGBB` (renderer/CharacterMesh.ts) → CSS `#rrggbb`, so the panel avatar matches the in-scene mesh color exactly. */
export function roleColorHex(role: EmployeeRole): string {
  return `#${ROLE_COLORS[role].toString(16).padStart(6, '0')}`;
}

export function getInitials(name: string): string {
  return name.split(' ').map(w => w[0] ?? '').join('');
}

/** Red below `redBelow`, amber below `greenAtOrAbove`, green at or above it — shared by morale and every need gauge, each with its own real thresholds. */
export function bandColor(value: number, redBelow: number, greenAtOrAbove: number): string {
  if (value < redBelow) return 'var(--bsx-critical)';
  if (value < greenAtOrAbove) return 'var(--bsx-amber)';
  return 'var(--bsx-positive)';
}

export function moraleColor(morale: number): string {
  return bandColor(morale, MORALE_THRESHOLDS.low, MORALE_THRESHOLDS.high);
}

const ACTION_LABEL_KEY: Record<ActionType, string> = {
  drill_hole: 'ui.crew.action_drill_hole',
  charge_hole: 'ui.crew.action_charge_hole',
  set_sequence: 'ui.crew.action_set_sequence',
  place_building: 'ui.crew.action_place_building',
  demolish_building: 'ui.crew.action_demolish_building',
  survey: 'ui.crew.action_survey',
  fragment_debris: 'ui.crew.action_fragment_debris',
  haul_debris: 'ui.crew.action_haul_debris',
  rest: 'ui.crew.task_resting',
  general_work: 'ui.crew.action_general_work',
};

/** Player-facing label for one EmployeeActivity — the Crew panel's only consumer of the activity's `kind`/`actionType` beyond raw ticks. */
export function describeActivity(activity: EmployeeActivity): string {
  switch (activity.kind) {
    case 'collapsed': return t('ui.crew.task_collapsed');
    case 'resting': return t('ui.crew.task_resting');
    case 'driving': return t('ui.crew.task_driving', { vehicle: `#${activity.vehicleId}` });
    case 'working': return t(activity.actionType ? ACTION_LABEL_KEY[activity.actionType] : 'ui.crew.action_general_work');
    case 'walking': return activity.actionType
      ? t('ui.crew.task_walking_to', { task: t(ACTION_LABEL_KEY[activity.actionType]) })
      : t('ui.crew.task_walking');
    case 'idle': return t('ui.crew.task_idle');
  }
}

function microLabel(text: string): HTMLElement {
  return el('span', { text, attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-micro)' } });
}

function well(children: (Node | null | undefined)[]): HTMLElement {
  return el('div', { className: 'bsx-well', attrs: { style: 'padding:9px 10px;display:flex;flex-direction:column;gap:6px' }, children });
}

// ── HIRED / LOCATION ──

export function makeHiredLocationStrip(e: Employee, state: GameState): HTMLElement {
  const hired = e.hiredAtTick !== undefined
    ? t('ui.crew.day_label', { day: Math.floor(e.hiredAtTick / 24) + 1 })
    : t('ui.crew.hired_unknown');

  const activity = computeEmployeeActivity(e, state.vehicles.vehicles);
  let location: string;
  if (activity.kind === 'driving') {
    location = t('ui.crew.location_aboard', { vehicle: `#${activity.vehicleId}` });
  } else if (e.destinationX !== null || e.destinationZ !== null) {
    location = t('ui.crew.location_walking', { x: e.destinationX ?? e.x, z: e.destinationZ ?? e.z });
  } else {
    const bench = state.navGrid?.cellAt(e.x, e.z)?.benchLevel;
    location = bench !== undefined
      ? t('ui.crew.location_bench', { bench, x: e.x, z: e.z })
      : t('ui.crew.location_coords', { x: e.x, z: e.z });
  }

  const wrap = el('div', { attrs: { style: 'display:flex;border-radius:var(--bsx-r-card);background:var(--bsx-well);overflow:hidden' } });
  const col = (label: string, value: string, grow: number): HTMLElement => el('div', {
    attrs: { style: `flex:${grow};padding:8px 9px;display:flex;flex-direction:column;gap:3px` },
    children: [microLabel(label), el('span', { text: value, className: 'bsx-mono', attrs: { style: 'font-size:10px' } })],
  });
  const hiredCol = col(t('ui.crew.hired'), hired, 1);
  hiredCol.style.borderRight = '1px solid var(--bsx-hairline)';
  wrap.append(hiredCol, col(t('ui.crew.location'), location, 2));
  return wrap;
}

// ── NEEDS ──

export function makeNeedsSection(e: Employee): HTMLElement {
  const wrap = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:7px' } });
  wrap.appendChild(microLabel(t('ui.crew.needs')));
  const rows: Array<[string, number, { low: number; critical: number }]> = [
    [t('ui.crew.need_hunger'), e.hunger, NEED_THRESHOLDS.hunger],
    [t('ui.crew.need_fatigue'), e.fatigue, NEED_THRESHOLDS.fatigue],
    [t('ui.crew.need_break'), e.breakNeed, NEED_THRESHOLDS.breakNeed],
  ];
  for (const [label, value, thresholds] of rows) {
    const row = gauge(label, value, bandColor(value, thresholds.critical, thresholds.low), { thresholdPct: thresholds.low, labelWidth: 52 });
    row.dataset['need'] = label;
    wrap.appendChild(row);
  }
  return wrap;
}

// ── CURRENT TASK ──

export function makeCurrentTaskSection(e: Employee, state: GameState): HTMLElement {
  const activity = computeEmployeeActivity(e, state.vehicles.vehicles);
  const wrap = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:6px' } });
  wrap.appendChild(microLabel(t('ui.crew.current_task')));

  const headRow = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px' } });
  headRow.append(
    el('span', { text: describeActivity(activity), attrs: { style: 'font:600 11px/1 var(--bsx-font-ui)' } }),
  );
  if (activity.ticksRemaining !== null) {
    headRow.appendChild(el('span', {
      text: t('ui.crew.ticks_left', { n: activity.ticksRemaining }),
      className: 'bsx-mono',
      attrs: { style: 'margin-left:auto;font-size:10px;color:var(--bsx-text-micro)' },
    }));
  }

  const children: HTMLElement[] = [headRow];
  const fraction = taskProgressFraction(activity);
  if (fraction !== null) {
    const pct = Math.round(fraction * 100);
    const track = el('div', { attrs: { style: 'height:4px;border-radius:2px;overflow:hidden;background:#242c36' } });
    track.appendChild(el('div', { attrs: { style: `height:100%;background:var(--bsx-amber);width:${Math.max(0, Math.min(100, pct))}%` } }));
    children.push(track);
  }
  wrap.appendChild(well(children));
  return wrap;
}

// ── SKILLS ──

export function makeSkillsSection(e: Employee): HTMLElement {
  const wrap = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:6px' } });
  wrap.appendChild(microLabel(t('ui.crew.skills')));

  if (e.qualifications.length === 0) {
    wrap.appendChild(el('div', { text: t('ui.crew.no_skills'), attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-micro)' } }));
    return wrap;
  }

  for (const q of e.qualifications) {
    const headRow = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px' } });
    const stars = '★'.repeat(q.proficiencyLevel) + '☆'.repeat(5 - q.proficiencyLevel);
    headRow.append(
      el('span', { text: t(`skill.${q.category}`), attrs: { style: 'font:600 11px/1 var(--bsx-font-ui)' } }),
      el('span', { text: stars, attrs: { style: 'font:400 11px/1 var(--bsx-font-mono);color:var(--bsx-amber);letter-spacing:.1em' } }),
    );

    const atMax = q.proficiencyLevel >= 5;
    const xpText = atMax
      ? t('ui.crew.skill_maxed')
      : t('ui.crew.skill_xp', { xp: q.xp, next: XP_THRESHOLDS[(q.proficiencyLevel + 1) as 2 | 3 | 4 | 5] });
    headRow.appendChild(el('span', { text: xpText, className: 'bsx-mono', attrs: { style: 'margin-left:auto;font-size:10px;color:var(--bsx-text-micro)' } }));

    let xpPct = 100;
    if (!atMax) {
      const current = XP_THRESHOLDS[q.proficiencyLevel];
      const next = XP_THRESHOLDS[(q.proficiencyLevel + 1) as 2 | 3 | 4 | 5];
      xpPct = next > current ? Math.max(0, Math.min(100, Math.round(((q.xp - current) / (next - current)) * 100))) : 0;
    }
    const xpTrack = el('div', { attrs: { style: 'height:3px;border-radius:2px;overflow:hidden;background:#242c36' } });
    xpTrack.appendChild(el('div', { attrs: { style: `height:100%;background:var(--bsx-ore);width:${xpPct}%` } }));

    const effect = el('span', {
      text: t('ui.crew.skill_effect', { mult: PROFICIENCY_MULTIPLIERS[q.proficiencyLevel].toFixed(2) }),
      className: 'bsx-mono',
      attrs: { style: 'font-size:10px;color:var(--bsx-positive)' },
    });

    wrap.appendChild(well([headRow, xpTrack, effect]));
  }
  return wrap;
}

// ── PAY ──

/**
 * A raise costs nothing upfront — giveRaise only raises the ongoing salary
 * and immediately lifts morale — so unlike training there is no affordability
 * gate here; every preset button is always clickable.
 */
export function makePaySection(e: Employee, onRaise: (amount: number) => void): HTMLElement {
  const wrap = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:6px' } });
  wrap.appendChild(microLabel(t('ui.crew.pay')));

  const base = BASE_SALARIES[e.role];
  const bonus = e.qualifications.reduce((sum, q) => sum + QUALIFICATION_SALARY_BONUS[q.proficiencyLevel], 0);
  const breakdownRow = el('div', { className: 'bsx-mono', attrs: { style: 'display:flex;font-size:10px;color:var(--bsx-text-muted)' } });
  breakdownRow.append(
    el('span', { text: t('ui.crew.pay_base', { amount: base }) }),
    el('span', { text: t('ui.crew.pay_bonus', { amount: bonus }), attrs: { style: 'margin-left:8px' } }),
    el('span', { text: t('ui.crew.pay_total', { amount: e.salary }), attrs: { style: 'margin-left:auto;color:var(--bsx-text-primary);font-weight:600' } }),
  );

  const raiseRow = el('div', { attrs: { style: 'display:flex;align-items:center;gap:6px' } });
  raiseRow.appendChild(el('span', { text: t('ui.crew.give_raise'), attrs: { style: 'font:400 10px/1 var(--bsx-font-ui);color:var(--bsx-text-micro)' } }));
  for (const amount of RAISE_PRESETS) {
    const btn = button('ghost', t('ui.crew.raise_amount', { amount }));
    btn.style.cssText = 'height:26px;padding:0 10px;font:600 10px/1 var(--bsx-font-mono)';
    btn.addEventListener('click', () => onRaise(amount));
    raiseRow.appendChild(btn);
  }

  const note = el('span', { text: t('ui.crew.raise_note'), attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-micro)' } });
  wrap.appendChild(well([breakdownRow, raiseRow, note]));
  return wrap;
}

// ── TRAINING ──

export function makeTrainingSection(e: Employee, state: GameState, onTrain: (skill: SkillCategory, buildingId: number) => void): HTMLElement {
  const wrap = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:6px' } });
  wrap.appendChild(microLabel(t('ui.crew.training')));

  if (e.trainingState) {
    wrap.appendChild(well([el('span', {
      text: t('ui.crew.training_in_progress', { skill: t(`skill.${e.trainingState.skill}`), n: e.trainingState.ticksRemaining }),
      attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-secondary)' },
    })]));
    return wrap;
  }

  const offers = availableTrainingOffers(state.buildings.buildings);
  if (offers.length === 0) {
    wrap.appendChild(well([el('span', { text: t('ui.crew.training_no_school'), attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-micro)' } })]));
    return wrap;
  }

  const rows: HTMLElement[] = [];
  let anyOffered = false;
  for (const { skill, building } of offers) {
    const plan = planTraining(e, skill, building.tier);
    const row = el('div', { attrs: { style: 'display:flex;align-items:center;gap:9px' } });
    const info = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:0' } });

    if (!plan) {
      info.append(
        el('span', { text: t(`course.${skill}`), attrs: { style: 'font:600 11px/1 var(--bsx-font-ui)' } }),
        el('span', { text: t('ui.crew.training_maxed', { level: t(`proficiency.${MAX_PROFICIENCY}`) }), attrs: { style: 'font:400 10px/1.3 var(--bsx-font-ui);color:var(--bsx-text-micro)' } }),
      );
      row.append(info, button('locked', t('ui.crew.train'), { disabled: true }));
    } else {
      anyOffered = true;
      info.append(
        el('span', { text: `${t(`course.${skill}`)} ${plan.currentLevel}→${plan.targetLevel}`, attrs: { style: 'font:600 11px/1 var(--bsx-font-ui)' } }),
        el('span', {
          text: t('ui.crew.training_offer', { school: t(`building.${building.type}.name`), tier: building.tier, fee: plan.fee, ticks: plan.ticks }),
          attrs: { style: 'font:400 10px/1.3 var(--bsx-font-ui);color:var(--bsx-text-micro)' },
        }),
      );
      const trainBtn = button('warn', t('ui.crew.train'), { disabled: state.cash < plan.fee || e.injured });
      trainBtn.classList.add('bs-train-btn');
      trainBtn.dataset['skill'] = skill;
      trainBtn.dataset['employee'] = String(e.id);
      trainBtn.addEventListener('click', () => onTrain(skill, building.id));
      row.append(info, trainBtn);
    }
    rows.push(row);
  }

  if (e.injured) rows.push(reasonLine(t('ui.crew.training_injured'), true));
  else if (!anyOffered) rows.push(reasonLine(t('ui.crew.training_all_maxed', { level: t(`proficiency.${MAX_PROFICIENCY}`) })));

  wrap.appendChild(well(rows));
  return wrap;
}

// ── DISMISS ──

export function makeDismissSection(e: Employee, onDismiss: () => void): HTMLElement {
  const wrap = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:5px' } });
  const btn = button('danger', t('ui.crew.dismiss'), { disabled: e.unionized });
  btn.style.width = '100%';
  if (!e.unionized) btn.addEventListener('click', onDismiss);
  wrap.appendChild(btn);
  if (e.unionized) wrap.appendChild(reasonLine(t('ui.crew.dismiss_union_blocked')));
  return wrap;
}
