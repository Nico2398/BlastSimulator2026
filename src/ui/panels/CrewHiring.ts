// BlastSimulator2026 — Crew panel hiring section (candidate pool cards)

import type { GameState } from '../../core/state/GameState.js';
import type { EmployeeRole } from '../../core/entities/Employee.js';
import { HIRING_COSTS } from '../../core/entities/Employee.js';
import { HIRING_ROLES, candidatesForRole, type HireCandidate } from '../../core/entities/HiringPool.js';
import { ROLE_STARTING_QUALIFICATIONS, UNION_MEMBER_SALARY_DISCOUNT_PCT } from '../../core/config/balance.js';
import { t } from '../../core/i18n/I18n.js';
import { el, explainable, reasonLine } from '../dom.js';
import { salaryExplain, skillLevelExplain, unionExplain } from '../statExplain.js';
import { filterBar, type FilterBarSelection } from '../filterBar.js';
import { HIRING_LEVEL_CHOICES, HIRING_SORT_KEYS, criteriaFromSelection, filterCandidates } from '../hiringFilter.js';
import { perHour, roleColorHex } from '../crewDetailSections.js';
import { cardGrid, entityCard } from '../windowKit.js';
import { portraitEl, rolePortraitSpec } from '../portraits.js';
import { makeCandidateSheet, hireRefusal } from '../candidateSheet.js';

/** "Skill ★level" list of what a hire of `role` arrives qualified for. */
function startingQualificationLabel(role: EmployeeRole): string {
  return ROLE_STARTING_QUALIFICATIONS[role].map(q => `${t(`skill.${q.category}`)} ★${q.proficiencyLevel}`).join(', ');
}

function makeCandidateCard(
  state: GameState,
  c: HireCandidate,
  onHire: (role: EmployeeRole, candidateId: number) => void,
  onOpen?: (candidateId: number) => void,
): HTMLElement {
  const sep = (text: string): Text => document.createTextNode(text);
  const skills = c.qualifications.flatMap((q, i) => [
    ...(i > 0 ? [sep(', ')] : []),
    explainable(el('span', {
      text: t('ui.crew.candidate_skill', { skill: t(`skill.${q.category}`), level: q.proficiencyLevel }),
      attrs: { 'data-candidate-skill': q.category },
    }), skillLevelExplain(q.proficiencyLevel)),
  ]);
  const terms = el('div', { className: 'bsx-ecard-desc bs-candidate-terms', children: [
    explainable(el('span', { text: t('ui.crew.candidate_salary', { salary: perHour(c.salary) }), attrs: { 'data-candidate-salary': '' } }), salaryExplain()),
    sep(' · '), ...skills, sep(' · '),
    explainable(el('span', { text: t(c.unionized ? 'ui.crew.candidate_union' : 'ui.crew.candidate_non_union'), attrs: { 'data-candidate-union': '' } }), unionExplain()),
  ] });
  const lines: HTMLElement[] = [terms];
  if (c.unionized) lines.push(el('div', { className: 'bsx-ecard-desc', text: t('ui.crew.candidate_union_tradeoff', { pct: UNION_MEMBER_SALARY_DISCOUNT_PCT }) }));
  const btn = el('button', {
    className: 'bsx-btn bsx-btn-primary',
    text: t('ui.crew.hire'),
    attrs: { 'data-role': c.role, 'data-candidate-id': String(c.id) },
  });
  const refusal = hireRefusal(state, c);
  btn.disabled = refusal !== null;
  btn.addEventListener('click', ev => { ev.stopPropagation(); onHire(c.role, c.id); });
  const fee = el('span', { text: t('ui.crew.hire_fee', { fee: HIRING_COSTS[c.role] }), className: 'bsx-mono bs-candidate-fee' });
  if (refusal) {
    const reason = reasonLine(refusal, true);
    reason.dataset['hireReason'] = '';
    lines.push(reason);
  }
  const card = entityCard({
    title: c.name, lines, footer: [fee, btn], className: 'bs-candidate-card',
    attrs: { 'data-candidate-card': String(c.id), 'data-clickable': '' },
  });
  card.style.setProperty('--bsx-role-accent', roleColorHex(c.role));
  card.addEventListener('click', () => onOpen?.(c.id));
  return card;
}

/** Filter selection owned by the panel (survives re-renders) and the re-render callback. */
interface HiringFilterView {
  selection: FilterBarSelection;
  onChange: () => void;
  /** Candidate whose sheet is open, owned by the panel. */
  openCandidateId?: number | null;
  onOpenCandidate?: (candidateId: number | null) => void;
}

export { hireRefusal };

export function makeHiringSection(state: GameState, onHire: (role: EmployeeRole, candidateId: number) => void, view?: HiringFilterView): HTMLElement[] {
  const criteria = view ? criteriaFromSelection(view.selection) : null;
  const filtering = view?.selection.isActive() ?? false;
  const bar = view ? hiringFilterBar(state, view) : null;
  const groups = HIRING_ROLES.flatMap(role => {
    const pool = candidatesForRole(state.hiringPool, role);
    const candidates = criteria ? filterCandidates(pool, criteria, state.cash) : pool;
    if (filtering && candidates.length === 0) return [];
    const count = state.employees.employees.filter(e => e.alive && e.role === role).length;
    const head = el('div', { className: 'bs-hiring-head', children: [
      portraitEl(rolePortraitSpec(role, t(`role.${role}`)), 56),
      el('div', { className: 'bsx-ecard-titles', children: [
        el('span', { className: 'bsx-ecard-name', text: t(`role.${role}`) }),
        el('span', { className: 'bsx-ecard-sub', text: t('ui.crew.hire_starts_with', { qual: startingQualificationLabel(role), count }) }),
        role === 'manager' ? el('span', { className: 'bsx-ecard-desc', text: t('ui.crew.manager_effect_hint') }) : null,
      ] }),
    ] });
    const group = el('div', { className: 'bs-hiring-group', attrs: { 'data-hiring-role': role }, children: [head] });
    if (candidates.length === 0) group.append(el('span', { className: 'bsx-ecard-desc', text: t('ui.crew.no_candidates') }));
    const open = candidates.find(c => c.id === view?.openCandidateId);
    if (open) group.append(makeCandidateSheet(state, open, onHire, () => view?.onOpenCandidate?.(null)));
    if (candidates.length > 0) group.append(cardGrid(candidates.map(c => makeCandidateCard(state, c, onHire, id => view?.onOpenCandidate?.(id))), 230));
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
export function hiringSignature(state: GameState, selection?: FilterBarSelection, openCandidateId?: number | null): string {
  const ids = state.hiringPool.candidates.map(c => c.id).join(',');
  const affordable = HIRING_ROLES.map(r => (state.cash < HIRING_COSTS[r] ? '0' : '1')).join('');
  const headcounts = HIRING_ROLES.map(r => state.employees.employees.filter(e => e.alive && e.role === r).length).join(',');
  const picked = selection ? `${selection.filter}|${selection.sort}|${JSON.stringify(selection.groups)}` : '';
  return `${ids}~${affordable}~${headcounts}~${picked}~${openCandidateId ?? ''}`;
}
