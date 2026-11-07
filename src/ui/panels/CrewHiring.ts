// BlastSimulator2026 — Crew panel hiring section (candidate pool cards)

import type { GameState } from '../../core/state/GameState.js';
import type { EmployeeRole } from '../../core/entities/Employee.js';
import { HIRING_COSTS } from '../../core/entities/Employee.js';
import { HIRING_ROLES, candidatesForRole, type HireCandidate } from '../../core/entities/HiringPool.js';
import { ROLE_STARTING_QUALIFICATIONS, UNION_MEMBER_SALARY_DISCOUNT_PCT } from '../../core/config/balance.js';
import { t } from '../../core/i18n/I18n.js';
import { el } from '../dom.js';
import { filterBar, type FilterBarSelection } from '../filterBar.js';
import { HIRING_LEVEL_CHOICES, HIRING_SORT_KEYS, criteriaFromSelection, filterCandidates } from '../hiringFilter.js';
import { perHour } from '../crewDetailSections.js';

/** "Skill ★level" list of what a hire of `role` arrives qualified for. */
function startingQualificationLabel(role: EmployeeRole): string {
  return ROLE_STARTING_QUALIFICATIONS[role].map(q => `${t(`skill.${q.category}`)} ★${q.proficiencyLevel}`).join(', ');
}

function makeCandidateCard(
  state: GameState,
  c: HireCandidate,
  onHire: (role: EmployeeRole, candidateId: number) => void,
): HTMLElement {
  const card = el('div', { attrs: { 'data-candidate-card': String(c.id), style: 'display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--bsx-hairline);border-radius:5px' } });
  const info = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:0' } });
  const skill = c.qualifications
    .map(q => t('ui.crew.candidate_skill', { skill: t(`skill.${q.category}`), level: q.proficiencyLevel }))
    .join(', ');
  info.append(
    el('span', { text: c.name, attrs: { style: 'font:600 11px/1 var(--bsx-font-ui)' } }),
    el('span', {
      text: `${t('ui.crew.candidate_salary', { salary: perHour(c.salary) })} · ${skill} · ${t(c.unionized ? 'ui.crew.candidate_union' : 'ui.crew.candidate_non_union')}`,
      attrs: { style: 'font:400 10px/1.2 var(--bsx-font-ui);color:var(--bsx-text-micro)' },
    }),
  );
  if (c.unionized) {
    info.append(el('span', {
      text: t('ui.crew.candidate_union_tradeoff', { pct: UNION_MEMBER_SALARY_DISCOUNT_PCT }),
      attrs: { style: 'font:400 10px/1.2 var(--bsx-font-ui);color:var(--bsx-text-micro)' },
    }));
  }
  const btn = el('button', {
    className: 'bsx-btn',
    text: t('ui.crew.hire'),
    attrs: { 'data-role': c.role, 'data-candidate-id': String(c.id) },
  });
  btn.disabled = state.cash < HIRING_COSTS[c.role];
  btn.addEventListener('click', () => onHire(c.role, c.id));
  const fee = el('span', { text: t('ui.crew.hire_fee', { fee: HIRING_COSTS[c.role] }), className: 'bsx-mono', attrs: { style: 'font-size:11px;font-weight:600;color:var(--bsx-amber)' } });
  card.append(info, fee, btn);
  return card;
}

/** Filter selection owned by the panel (survives re-renders) and the re-render callback. */
interface HiringFilterView {
  selection: FilterBarSelection;
  onChange: () => void;
}

export function makeHiringSection(state: GameState, onHire: (role: EmployeeRole, candidateId: number) => void, view?: HiringFilterView): HTMLElement[] {
  const criteria = view ? criteriaFromSelection(view.selection) : null;
  const filtering = view?.selection.isActive() ?? false;
  const bar = view ? hiringFilterBar(state, view) : null;
  const groups = HIRING_ROLES.flatMap(role => {
    const pool = candidatesForRole(state.hiringPool, role);
    const candidates = criteria ? filterCandidates(pool, criteria, state.cash) : pool;
    if (filtering && candidates.length === 0) return [];
    const count = state.employees.employees.filter(e => e.alive && e.role === role).length;
    const group = el('div', { attrs: { 'data-hiring-role': role, style: 'display:flex;flex-direction:column;gap:6px;padding:9px 11px;border:1px solid var(--bsx-hairline);border-radius:5px;background:var(--bsx-card)' } });
    const head = el('div', { attrs: { style: 'display:flex;align-items:center;gap:10px' } });
    const info = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:0' } });
    info.append(
      el('span', { text: t(`role.${role}`), attrs: { style: 'font:600 11px/1 var(--bsx-font-ui)' } }),
      el('span', {
        text: t('ui.crew.hire_starts_with', { qual: startingQualificationLabel(role), count }),
        attrs: { style: 'font:400 10px/1 var(--bsx-font-ui);color:var(--bsx-text-micro)' },
      }),
    );
    if (role === 'manager') {
      info.append(el('span', {
        text: t('ui.crew.manager_effect_hint'),
        attrs: { style: 'font:400 10px/1.3 var(--bsx-font-ui);color:var(--bsx-text-micro)' },
      }));
    }
    head.append(info);
    group.append(head);
    if (candidates.length === 0) {
      group.append(el('span', { text: t('ui.crew.no_candidates'), attrs: { style: 'font:400 10px/1 var(--bsx-font-ui);color:var(--bsx-text-micro)' } }));
    }
    for (const c of candidates) group.append(makeCandidateCard(state, c, onHire));
    return [group];
  });
  if (filtering && groups.length === 0) {
    const none = el('span', { text: t('ui.crew.hiring_filter_no_match'), attrs: { style: 'font:400 10px/1 var(--bsx-font-ui);color:var(--bsx-text-micro)' } });
    none.dataset['hiringNoMatch'] = '';
    return [bar, none].filter((n): n is HTMLElement => n !== null);
  }
  return [bar, ...groups].filter((n): n is HTMLElement => n !== null);
}

/** The shared bar: role, skill, minimum level, union, affordability, and the two sorts. */
function hiringFilterBar(state: GameState, view: HiringFilterView): HTMLElement {
  const skills = [...new Set(state.hiringPool.candidates.flatMap(c => c.qualifications.map(q => q.category)))];
  return filterBar(view.selection, {
    choices: HIRING_ROLES.map(role => ({ value: role, label: t(`role.${role}`) })),
    groups: [
      { id: 'skill', label: t('ui.crew.hiring_filter_skill'), choices: skills.map(value => ({ value, label: t(`skill.${value}`) })) },
      { id: 'level', label: t('ui.crew.hiring_filter_level'), choices: HIRING_LEVEL_CHOICES.map(n => ({ value: String(n), label: t('ui.crew.hiring_filter_level_choice', { level: n }) })) },
      { id: 'union', label: t('ui.crew.hiring_filter_union'), choices: [
        { value: 'union', label: t('ui.crew.hiring_filter_union_yes') },
        { value: 'non_union', label: t('ui.crew.hiring_filter_union_no') },
      ] },
      { id: 'affordable', label: t('ui.crew.hiring_filter_affordable'), choices: [{ value: 'yes', label: t('ui.crew.hiring_filter_affordable_yes') }] },
    ],
    sorts: HIRING_SORT_KEYS.map(key => ({ key, label: t(`ui.crew.hiring_sort_${key}`) })),
    onChange: view.onChange,
    filterLabel: t('ui.crew.hiring_filter_role'), sortLabel: t('ui.filter.sort'),
    allLabel: t('ui.filter.all'), clearLabel: t('ui.filter.clear'),
  });
}

/** Change-detection signature for the hiring section: candidates, affordability buckets, headcounts (never raw cash). */
export function hiringSignature(state: GameState, selection?: FilterBarSelection): string {
  const ids = state.hiringPool.candidates.map(c => c.id).join(',');
  const affordable = HIRING_ROLES.map(r => (state.cash < HIRING_COSTS[r] ? '0' : '1')).join('');
  const headcounts = HIRING_ROLES.map(r => state.employees.employees.filter(e => e.alive && e.role === r).length).join(',');
  const picked = selection ? `${selection.filter}|${selection.sort}|${JSON.stringify(selection.groups)}` : '';
  return `${ids}~${affordable}~${headcounts}~${picked}`;
}
