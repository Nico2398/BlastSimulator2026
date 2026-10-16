// BlastSimulator2026 — Crew panel detail-section builders (redesign P6)
// HIRED/LOCATION, NEEDS, CURRENT TASK, and SKILLS blocks shown when a roster
// card is expanded. Split out of CrewPanel.ts to keep both files under the
// file-size guideline, mirroring the old EmployeePanel/employeeDetailSections
// split this replaces.

import { t } from '../core/i18n/I18n.js';
import { el, gauge, button, reasonLine } from './dom.js';
import type { Employee, EmployeeRole, SkillCategory } from '../core/entities/Employee.js';
import { BASE_SALARIES, calculateQualificationBonus, managementLevelOf, injuryHoursRemaining, employeeQueueDepth, isLicenceSkill } from '../core/entities/Employee.js';
import { managerNegotiationBonusPct } from '../core/economy/Negotiation.js';
import type { GameState } from '../core/state/GameState.js';
import type { ActionType } from '../core/state/GameState.js';
import { computeEmployeeActivity, taskProgressFraction, type EmployeeActivity } from '../core/entities/EmployeeActivity.js';
import { availableTrainingOffers, planTraining, trainingRefusal, isSchoolFull, heldCourseLevel } from '../core/entities/EmployeeTraining.js';
import { perHour } from '../core/economy/formatMoney.js';
import { NEED_THRESHOLDS, MORALE_THRESHOLDS, XP_THRESHOLDS, PROFICIENCY_MULTIPLIERS } from '../core/config/balance.js';
import { ROLE_COLORS } from '../renderer/CharacterMesh.js';
import { iconEl } from './icons.js';
import type { ConfirmModalConfig } from './panels/ConfirmModal.js';
import { describeRamp } from './describeRamp.js';
import { resolveEmployeeLocation, resolveTaskTarget, trainingSchool, type EntityRef } from './crewFacts.js';

/** Builds a clickable reference to another entity; the host decides what a click does (the inspector selects it). */
export type LinkFactory = (kind: EntityRef['kind'], id: number, label: string) => HTMLElement;

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

export const ACTION_LABEL_KEY: Record<ActionType, string> = {
  drill_hole: 'ui.crew.action_drill_hole',
  charge_hole: 'ui.crew.action_charge_hole',
  dig_ramp_segment: 'ui.crew.action_dig_ramp_segment',
  level_ground: 'ui.crew.action_level_ground',
  place_building: 'ui.crew.action_place_building',
  demolish_building: 'ui.crew.action_demolish_building',
  survey: 'ui.crew.action_survey',
  fragment_debris: 'ui.crew.action_fragment_debris',
  haul_debris: 'ui.crew.action_haul_debris',
  repair_vehicle: 'ui.crew.action_repair_vehicle',
  rest: 'ui.crew.task_resting',
  general_work: 'ui.crew.action_general_work',
};

/** Player-facing label for one EmployeeActivity — the Crew panel's only consumer of the activity's `kind`/`actionType` beyond raw ticks. */
export function describeActivity(activity: EmployeeActivity): string {
  switch (activity.kind) {
    case 'collapsed': return t('ui.crew.task_collapsed');
    case 'resting': return t('ui.crew.task_resting');
    case 'driving': return t('ui.crew.task_driving', { vehicle: `#${activity.vehicleId}` });
    case 'driving_to_task': return t('ui.crew.task_driving_to_task', { vehicle: `#${activity.vehicleId}` });
    case 'working': return t(activity.actionType ? ACTION_LABEL_KEY[activity.actionType] : 'ui.crew.action_general_work');
    case 'walking': return activity.actionType
      ? t('ui.crew.task_walking_to', { task: t(ACTION_LABEL_KEY[activity.actionType]) })
      : t('ui.crew.task_walking');
    case 'idle': return t('ui.crew.task_idle');
    case 'training': return t('ui.crew.task_training');
    case 'stuck': return t('ui.crew.task_stuck');
  }
}

function microLabel(text: string): HTMLElement {
  return el('span', { text, attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-micro)' } });
}

function well(children: (Node | null | undefined)[]): HTMLElement {
  return el('div', { className: 'bsx-well', attrs: { style: 'padding:9px 10px;display:flex;flex-direction:column;gap:6px' }, children });
}

/** Title line over a detail line, the text block shared by every training-offer row. */
function trainingInfoBlock(title: string, detail: string): HTMLElement {
  const info = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:0' } });
  info.append(
    el('span', { text: title, attrs: { style: 'font:600 11px/1 var(--bsx-font-ui)' } }),
    el('span', { text: detail, attrs: { style: 'font:400 10px/1.3 var(--bsx-font-ui);color:var(--bsx-text-micro)' } }),
  );
  return info;
}

/** Stand-in for a link inside a translated sentence; splitting on it keeps the translation's word order. */
const LINK_SENTINEL = '\u0001';

/** One sentence with an entity link in it; plain text when no factory is given. */
function linkedSentence(key: string, param: string, label: string, ref: EntityRef, link: LinkFactory | undefined, params: Record<string, string | number> = {}): HTMLElement {
  if (!link) return el('span', { text: t(key, { ...params, [param]: label }) });
  const [before = '', after = ''] = t(key, { ...params, [param]: LINK_SENTINEL }).split(LINK_SENTINEL);
  const span = el('span');
  span.append(before, link(ref.kind, ref.id, label), after);
  return span;
}

function buildingLabel(ref: EntityRef, state: Pick<GameState, 'buildings'>): string {
  const b = state.buildings.buildings.find(x => x.id === ref.id);
  return b ? t(`building.${b.type}.name`) : `#${ref.id}`;
}

function targetLabel(ref: EntityRef, state: Pick<GameState, 'buildings' | 'vehicles' | 'builtRamps'>): string {
  if (ref.kind === 'building') return buildingLabel(ref, state);
  if (ref.kind === 'vehicle') {
    const v = state.vehicles.vehicles.find(x => x.id === ref.id);
    return v ? `${t(`vehicle_type.${v.type}`)} #${v.id}` : `#${ref.id}`;
  }
  const ramp = state.builtRamps.find(r => r.id === ref.id);
  return ramp ? describeRamp(ramp).title : `#${ref.id}`;
}

function hiredText(e: Employee): string {
  return e.hiredAtTick !== undefined
    ? t('ui.crew.day_label', { day: Math.floor(e.hiredAtTick / 24) + 1 })
    : t('ui.crew.hired_unknown');
}

// ── HIRED / LOCATION ──

export function makeHiredLocationStrip(e: Employee, state: GameState, link?: LinkFactory): HTMLElement {
  const hired = hiredText(e);
  const activity = computeEmployeeActivity(e, state.vehicles);
  const loc = resolveEmployeeLocation(e, state);
  let location: string | HTMLElement;
  if (loc.kind === 'inside') {
    location = linkedSentence('ui.crew.location_inside', 'building', buildingLabel(loc.building, state), loc.building, link);
  } else if (loc.kind === 'aboard' || activity.kind === 'driving' || activity.kind === 'driving_to_task') {
    const vehicle: EntityRef | null = loc.kind === 'aboard' ? loc.vehicle
      : activity.vehicleId !== undefined && activity.vehicleId !== null ? { kind: 'vehicle', id: activity.vehicleId } : null;
    location = vehicle
      ? linkedSentence('ui.crew.location_aboard', 'vehicle', `#${vehicle.id}`, vehicle, link)
      : t('ui.crew.location_aboard_unknown');
  } else if (loc.kind === 'stuck') {
    location = t('ui.crew.location_stuck', { n: loc.ticks, x: loc.x, z: loc.z });
  } else if (loc.kind === 'walking') {
    const key = loc.purpose === 'rest' ? 'ui.crew.location_walking_rest'
      : loc.purpose === 'school' ? 'ui.crew.location_walking_school'
      : 'ui.crew.location_walking';
    location = t(key, { x: loc.x, z: loc.z });
  } else if (loc.kind === 'bench') {
    location = t('ui.crew.location_bench', { bench: loc.bench, x: loc.x, z: loc.z });
  } else {
    location = t('ui.crew.location_coords', { x: loc.x, z: loc.z });
  }

  const wrap = el('div', { attrs: { style: 'display:flex;border-radius:var(--bsx-r-card);background:var(--bsx-well);overflow:hidden' } });
  const col = (label: string, value: string | HTMLElement, grow: number): HTMLElement => el('div', {
    attrs: { style: `flex:${grow};padding:8px 9px;display:flex;flex-direction:column;gap:3px` },
    children: [microLabel(label), typeof value === 'string' ? el('span', { text: value, className: 'bsx-mono', attrs: { style: 'font-size:10px' } }) : monoWrap(value)],
  });
  const hiredCol = col(t('ui.crew.hired'), hired, 1);
  hiredCol.style.borderRight = '1px solid var(--bsx-hairline)';
  wrap.append(hiredCol, col(t('ui.crew.location'), location, 2));
  return wrap;
}

function monoWrap(child: HTMLElement): HTMLElement {
  return el('span', { className: 'bsx-mono', attrs: { style: 'font-size:10px' }, children: [child] });
}

// ── NEEDS ──

export function makeNeedsSection(e: Employee): HTMLElement {
  const wrap = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:7px' } });
  wrap.appendChild(microLabel(t('ui.crew.needs')));
  const rows: Array<[string, number, { low: number; critical: number }]> = [
    [t('ui.crew.need_fatigue'), e.fatigue, NEED_THRESHOLDS.fatigue],
  ];
  for (const [label, value, thresholds] of rows) {
    const row = gauge(label, value, bandColor(value, thresholds.critical, thresholds.low), { thresholdPct: thresholds.low, labelWidth: 52 });
    row.dataset['need'] = label;
    wrap.appendChild(row);
  }
  return wrap;
}

// ── CURRENT TASK ──

export function makeCurrentTaskSection(e: Employee, state: GameState, link?: LinkFactory): HTMLElement {
  const activity = computeEmployeeActivity(e, state.vehicles);
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
  const target = resolveTaskTarget(e, state);
  if (target) {
    children.push(el('span', {
      className: 'bs-task-target',
      attrs: { style: 'font:400 11px/1.3 var(--bsx-font-ui);color:var(--bsx-text-secondary)' },
      children: [linkedSentence('ui.crew.task_target', 'target', targetLabel(target, state), target, link)],
    }));
  }
  const fraction = taskProgressFraction(activity);
  if (fraction !== null) {
    const pct = Math.round(fraction * 100);
    const track = el('div', { attrs: { style: 'height:4px;border-radius:2px;overflow:hidden;background:#242c36' } });
    track.appendChild(el('div', { attrs: { style: `height:100%;background:var(--bsx-amber);width:${Math.max(0, Math.min(100, pct))}%` } }));
    children.push(track);
  }
  const queued = employeeQueueDepth(e);
  if (queued > 0) {
    children.push(el('span', { text: t('ui.crew.queued_tasks', { n: queued }), className: 'bsx-mono bs-task-queue', attrs: { style: 'font-size:10px;color:var(--bsx-text-micro)' } }));
  }
  wrap.appendChild(well(children));
  const injuryHours = injuryHoursRemaining(e);
  if (injuryHours !== null) wrap.appendChild(reasonLine(t('ui.crew.injured_back_in', { hours: injuryHours }), true));
  return wrap;
}

// ── MANAGER EFFECT ──

/** What a manager's management level does for the mine (negotiation odds); null for other roles or no management skill. */
export function makeManagerEffect(e: Employee): HTMLElement | null {
  const level = managementLevelOf(e);
  if (level === null) return null;
  return el('span', {
    className: 'bs-crew-manager-effect',
    text: t('ui.crew.manager_effect', { pct: managerNegotiationBonusPct(level) }),
    attrs: { style: 'font:400 10px/1 var(--bsx-font-ui);color:var(--bsx-positive)' },
  });
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

    const rows = [headRow, xpTrack, effect];
    if (isLicenceSkill(q.category)) {
      rows.push(el('span', { text: t('ui.crew.licence_tier', { tier: q.licenceLevel ?? 1 }), className: 'bsx-mono bs-licence-tier', attrs: { style: 'font-size:10px;color:var(--bsx-text-secondary)' } }));
    }
    wrap.appendChild(well(rows));
  }
  return wrap;
}

// ── PAY ──

export { perHour };

/**
 * A raise costs nothing upfront — giveRaise only raises the ongoing salary
 * and immediately lifts morale — so unlike training there is no affordability
 * gate here; every preset button is always clickable.
 */
export function makePaySection(e: Employee, onRaise: (amount: number) => void): HTMLElement {
  const wrap = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:6px' } });
  wrap.appendChild(microLabel(t('ui.crew.pay')));

  const base = BASE_SALARIES[e.role];
  const bonus = calculateQualificationBonus(e);
  const breakdownRow = el('div', { className: 'bsx-mono', attrs: { style: 'display:flex;font-size:10px;color:var(--bsx-text-muted)' } });
  breakdownRow.append(
    el('span', { text: t('ui.crew.pay_base', { amount: perHour(base) }) }),
    el('span', { text: t('ui.crew.pay_bonus', { amount: perHour(bonus) }), attrs: { style: 'margin-left:8px' } }),
    el('span', { text: t('ui.crew.pay_raises', { amount: perHour(e.raises ?? 0) }), attrs: { style: 'margin-left:8px' } }),
    el('span', { text: t('ui.crew.pay_total', { amount: perHour(e.salary) }), attrs: { style: 'margin-left:auto;color:var(--bsx-text-primary);font-weight:600' } }),
  );

  const raiseRow = el('div', { attrs: { style: 'display:flex;align-items:center;gap:6px' } });
  raiseRow.appendChild(el('span', { text: t('ui.crew.give_raise'), attrs: { style: 'font:400 10px/1 var(--bsx-font-ui);color:var(--bsx-text-micro)' } }));
  for (const amount of RAISE_PRESETS) {
    const btn = button('ghost', t('ui.crew.raise_amount', { amount: perHour(amount) }));
    btn.style.cssText = 'height:26px;padding:0 10px;font:600 10px/1 var(--bsx-font-mono)';
    btn.addEventListener('click', () => onRaise(amount));
    raiseRow.appendChild(btn);
  }

  const note = el('span', { text: t('ui.crew.raise_note'), attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-micro)' } });
  wrap.appendChild(well([breakdownRow, raiseRow, note]));
  return wrap;
}

// ── TRAINING ──

export function makeTrainingSection(e: Employee, state: GameState, onTrain: (skill: SkillCategory, buildingId: number) => void, link?: LinkFactory): HTMLElement {
  const wrap = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:6px' } });
  wrap.appendChild(microLabel(t('ui.crew.training')));

  if (e.trainingState) {
    // Stable class + data-skill mirror the Train button's own bs-train-btn/
    // data-skill marking (below) — this is what the tutorial's doneTarget
    // selectors resolve against once the button they replace is gone (#903).
    // Employee scoping comes from the wrapping [data-employee-id] row
    // (CrewPanel.ts) this section renders inside, same as the button.
    const school = trainingSchool(e);
    wrap.appendChild(well([el('span', {
      className: 'bs-training-active',
      text: t('ui.crew.training_in_progress', { skill: t(`skill.${e.trainingState.skill}`), n: e.trainingState.ticksRemaining }),
      attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-secondary)', 'data-skill': e.trainingState.skill },
    }), ...(link && school ? [linkedSentence('ui.crew.training_at', 'building', buildingLabel(school, state), school, link)] : [])]));
    return wrap;
  }

  if (e.pendingTrainingState) {
    // Walking to the school, not yet enrolled — distinct from the
    // in-progress block above, which only shows once they've actually
    // entered and the course countdown has started (#1203).
    const school = trainingSchool(e);
    wrap.appendChild(well([link && school
      ? linkedSentence('ui.crew.training_walking_to', 'building', buildingLabel(school, state), school, link)
      : el('span', {
        text: t('ui.crew.training_walking'),
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

    const title = t(`course.${skill}`);

    if (!plan) {
      const refusal = trainingRefusal(e, skill, building.tier);
      row.append(trainingInfoBlock(title, refusal.kind === 'top_level'
        ? t('ui.crew.training_top_level')
        : t('ui.crew.training_needs_higher_school', { level: heldCourseLevel(e.qualifications, skill) })));
    } else if (isSchoolFull(state, building)) {
      row.append(
        trainingInfoBlock(title, t('ui.crew.training_school_full')),
        button('locked', t('ui.crew.train'), { disabled: true }),
      );
    } else {
      anyOffered = true;
      const info = trainingInfoBlock(
        title,
        isLicenceSkill(skill)
          ? t('ui.crew.training_licence_offer', { school: t(`building.${building.type}.name`), tier: building.tier, fee: plan.fee, ticks: plan.ticks, level: plan.grantsLevel })
          : t(plan.kind === 'unlock' ? 'ui.crew.training_offer_unlock' : 'ui.crew.training_offer_upgrade', { school: t(`building.${building.type}.name`), tier: building.tier, fee: plan.fee, ticks: plan.ticks, level: plan.grantsLevel, raise: perHour(plan.salaryIncrease) }),
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
  else if (!anyOffered) rows.push(reasonLine(t('ui.crew.training_all_qualified')));

  wrap.appendChild(well(rows));
  return wrap;
}

// ── CONSOLE COMMANDS / CONFIRM (shared by the Crew row and the inspector) ──

export const raiseCommand = (e: Employee, amount: number): string => `employee raise ${e.id} amount:${amount}`;
export const trainCommand = (e: Employee, skill: SkillCategory, buildingId: number): string => `employee train ${e.id} skill:${skill} building:${buildingId}`;
const fireCommand = (e: Employee): string => `employee fire ${e.id}`;

/**
 * Dismissal removes the employee permanently (no severance, no reversal), so every host routes it
 * through the shared confirm overlay; `run` receives the fire command on confirmation.
 */
export function dismissConfirmConfig(e: Employee, run: (command: string) => void): ConfirmModalConfig {
  return {
    icon: 'injured',
    title: t('ui.crew.dismiss_confirm_title'),
    body: t('ui.crew.dismiss_confirm_body', { name: e.name }),
    confirmLabel: t('ui.crew.dismiss'),
    onConfirm: () => run(fireCommand(e)),
  };
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

// ── SHARED BUILDERS (Crew row + inspector, #1762) ──

/** Role-coloured initials chip, shared by the roster card and the identity section. */
export function makeAvatar(e: Employee): HTMLElement {
  return el('div', { text: getInitials(e.name), attrs: { style: `width:30px;height:30px;flex:0 0 30px;border-radius:5px;display:flex;align-items:center;justify-content:center;background:${roleColorHex(e.role)};color:#12161c;font:800 11px/1 var(--bsx-font-ui)` } });
}

/** Morale bar + percentage; the `bs-crew-morale-*` classes are what the Crew panel repaints in place. */
function makeMoraleMeter(e: Employee): HTMLElement[] {
  const color = moraleColor(e.morale);
  const fill = el('div', { className: 'bs-crew-morale-fill', attrs: { style: `height:100%;background:${color};width:${e.morale}%` } });
  const track = el('div', { attrs: { style: 'width:44px;height:4px;border-radius:2px;overflow:hidden;background:#242c36' }, children: [fill] });
  const value = el('span', { className: 'bs-crew-morale-value bsx-mono', text: `${Math.round(e.morale)}%`, attrs: { style: `font-size:11px;color:${color}` } });
  return [track, value];
}

/** Role label followed by the morale meter, shared by the roster card and the identity section. */
export function makeRoleMoraleLine(e: Employee): HTMLElement {
  return el('div', { attrs: { style: 'display:flex;align-items:center;gap:7px' }, children: [
    el('span', { text: t(`role.${e.role}`), attrs: { style: 'font:400 10px/1 var(--bsx-font-ui);color:var(--bsx-text-muted)' } }),
    ...makeMoraleMeter(e),
  ] });
}

/** Avatar, role, morale, status icons and hire day. */
export function makeIdentitySection(e: Employee, state: GameState): HTMLElement {
  const nameCol = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:4px;min-width:0;flex:1' } });
  nameCol.append(
    makeRoleMoraleLine(e),
    el('span', { text: `${t('ui.crew.hired')} ${hiredText(e)}`, className: 'bsx-mono', attrs: { style: 'font-size:10px;color:var(--bsx-text-micro)' } }),
  );
  return el('div', { attrs: { style: 'display:flex;align-items:center;gap:10px' }, children: [makeAvatar(e), nameCol, makeStatusTags(e, state)] });
}

/** True when the employee is resting or walking to rest, i.e. `makeRestSection` renders. */
export function hasRestSection(e: Employee): boolean {
  return e.restTicksRemaining !== null || e.pendingRestDuration !== null;
}

/** Resting at a building with time left, or walking to rest; null when neither. */
export function makeRestSection(e: Employee, state: GameState, link?: LinkFactory): HTMLElement | null {
  if (!hasRestSection(e)) return null;
  let line: HTMLElement;
  if (e.restTicksRemaining !== null) {
    const loc = resolveEmployeeLocation(e, state);
    line = loc.kind === 'inside'
      ? linkedSentence('ui.crew.rest_at', 'building', buildingLabel(loc.building, state), loc.building, link, { n: e.restTicksRemaining })
      : el('span', { text: `${t('ui.crew.task_resting')} · ${t('ui.crew.ticks_left', { n: e.restTicksRemaining })}` });
  } else {
    line = el('span', { text: t('ui.crew.rest_walking') });
  }
  line.style.cssText = 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-secondary)';
  return well([line]);
}

/** Status icon chips (union, injured, collapsed, training, driving), shared by the Crew row and the inspector. */
export function makeStatusTags(e: Employee, state: GameState): HTMLElement {
  const activity = computeEmployeeActivity(e, state.vehicles);
  const wrap = el('div', { className: 'bs-crew-status', attrs: { style: 'display:flex;gap:4px;flex:0 0 auto' } });
  const tags: Array<{ icon: Parameters<typeof iconEl>[0]; color: string; tip: string }> = [];
  if (e.unionized) tags.push({ icon: 'union', color: 'var(--bsx-ore)', tip: t('ui.crew.tag_union') });
  if (e.injured) tags.push({ icon: 'injured', color: 'var(--bsx-critical-text)', tip: t('ui.crew.injured_back_in', { hours: injuryHoursRemaining(e) ?? 0 }) });
  if (e.collapsing) tags.push({ icon: 'collapse', color: 'var(--bsx-critical)', tip: t('ui.crew.tag_collapsed') });
  if (e.trainingState) tags.push({ icon: 'training', color: 'var(--bsx-info)', tip: t('ui.crew.tag_training') });
  if (activity.kind === 'driving') tags.push({ icon: 'drive', color: 'var(--bsx-info)', tip: t('ui.crew.tag_driving') });
  if (activity.kind === 'driving_to_task') tags.push({ icon: 'drive', color: 'var(--bsx-amber)', tip: t('ui.crew.tag_driving_task') });
  for (const tg of tags) {
    wrap.appendChild(el('span', { attrs: { style: `color:${tg.color}`, title: tg.tip }, children: [iconEl(tg.icon, 13)] }));
  }
  return wrap;
}
