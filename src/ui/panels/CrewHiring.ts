// BlastSimulator2026 — Crew panel hiring section (candidate pool cards)

import type { GameState } from '../../core/state/GameState.js';
import type { EmployeeRole } from '../../core/entities/Employee.js';
import { HIRING_COSTS } from '../../core/entities/Employee.js';
import { HIRING_ROLES, candidatesForRole, type HireCandidate } from '../../core/entities/HiringPool.js';
import { ROLE_STARTING_QUALIFICATIONS } from '../../core/config/balance.js';
import { t } from '../../core/i18n/I18n.js';
import { el } from '../dom.js';
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
  const primary = c.qualifications[0];
  const skill = primary
    ? t('ui.crew.candidate_skill', { skill: t(`skill.${primary.category}`), level: primary.proficiencyLevel })
    : '';
  info.append(
    el('span', { text: c.name, attrs: { style: 'font:600 11px/1 var(--bsx-font-ui)' } }),
    el('span', {
      text: `${t('ui.crew.candidate_salary', { salary: perHour(c.salary) })} · ${skill} · ${t(c.unionized ? 'ui.crew.candidate_union' : 'ui.crew.candidate_non_union')}`,
      attrs: { style: 'font:400 10px/1.2 var(--bsx-font-ui);color:var(--bsx-text-micro)' },
    }),
  );
  const btn = el('button', {
    className: 'bsx-btn',
    text: t('ui.crew.hire'),
    attrs: { 'data-role': c.role, 'data-candidate-id': String(c.id) },
  });
  btn.disabled = state.cash < HIRING_COSTS[c.role];
  btn.addEventListener('click', () => onHire(c.role, c.id));
  card.append(info, btn);
  return card;
}

export function makeHiringSection(state: GameState, onHire: (role: EmployeeRole, candidateId: number) => void): HTMLElement[] {
  return HIRING_ROLES.map(role => {
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
    head.append(
      info,
      el('span', { text: t('ui.crew.hire_fee', { fee: HIRING_COSTS[role] }), className: 'bsx-mono', attrs: { style: 'font-size:11px;font-weight:600;color:var(--bsx-amber)' } }),
    );
    group.append(head);
    const candidates = candidatesForRole(state.hiringPool, role);
    if (candidates.length === 0) {
      group.append(el('span', { text: t('ui.crew.no_candidates'), attrs: { style: 'font:400 10px/1 var(--bsx-font-ui);color:var(--bsx-text-micro)' } }));
    }
    for (const c of candidates) group.append(makeCandidateCard(state, c, onHire));
    return group;
  });
}

/** Change-detection signature for the hiring section: candidates, affordability buckets, headcounts (never raw cash). */
export function hiringSignature(state: GameState): string {
  const ids = state.hiringPool.candidates.map(c => c.id).join(',');
  const affordable = HIRING_ROLES.map(r => (state.cash < HIRING_COSTS[r] ? '0' : '1')).join('');
  const headcounts = HIRING_ROLES.map(r => state.employees.employees.filter(e => e.alive && e.role === r).length).join(',');
  return `${ids}~${affordable}~${headcounts}`;
}
