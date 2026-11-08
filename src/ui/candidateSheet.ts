// BlastSimulator2026 — Candidate sheet: a hiring candidate's full character sheet (#2164)
// Reads like the employee detail: the same skills section and stat explanations, only what HireCandidate holds.

import type { GameState } from '../core/state/GameState.js';
import type { EmployeeRole } from '../core/entities/Employee.js';
import { HIRING_COSTS } from '../core/entities/Employee.js';
import type { HireCandidate } from '../core/entities/HiringPool.js';
import { t } from '../core/i18n/I18n.js';
import { el, explainable, button, reasonLine } from './dom.js';
import { salaryExplain, unionExplain } from './statExplain.js';
import { makeSkillsSection, makeUnionTradeoffLine, perHour } from './crewDetailSections.js';
import { hireRefusal } from './panels/CrewHiring.js';

const MICRO = 'font:400 10px/1.2 var(--bsx-font-ui);color:var(--bsx-text-micro)';

/** Sheet for `c`: role, every qualification, pay, union status and trade-off, fee, Hire button with refusal reason. */
export function makeCandidateSheet(
  state: GameState,
  c: HireCandidate,
  onHire: (role: EmployeeRole, candidateId: number) => void,
  onClose: () => void,
): HTMLElement {
  const sheet = el('div', { attrs: { 'data-candidate-sheet': String(c.id), style: 'display:flex;flex-direction:column;gap:8px;padding:9px 11px;border:1px solid var(--bsx-amber);border-radius:5px;background:var(--bsx-card)' } });

  const close = button('ghost', t('ui.crew.candidate_sheet_close'));
  close.dataset['candidateSheetClose'] = '';
  close.addEventListener('click', onClose);
  const head = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px' }, children: [
    el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:0' }, children: [
      el('span', { text: c.name, attrs: { style: 'font:600 12px/1 var(--bsx-font-ui)' } }),
      el('span', { text: t(`role.${c.role}`), attrs: { style: MICRO } }),
    ] }),
    close,
  ] });

  const union = explainable(el('span', { text: t(c.unionized ? 'ui.crew.candidate_union' : 'ui.crew.candidate_non_union'), attrs: { style: 'font:400 11px/1.3 var(--bsx-font-ui)' } }), unionExplain());
  const pay = el('div', { attrs: { style: 'display:flex;align-items:center;gap:10px' }, children: [
    explainable(el('span', { text: t('ui.crew.candidate_salary', { salary: perHour(c.salary) }), className: 'bsx-mono', attrs: { style: 'font-size:11px;font-weight:600' } }), salaryExplain()),
    union,
  ] });
  const tradeoff = makeUnionTradeoffLine(c);

  const refusal = hireRefusal(state, c);
  const hire = button('primary', t('ui.crew.hire'));
  hire.dataset['candidateSheetHire'] = '';
  hire.disabled = refusal !== null;
  hire.addEventListener('click', () => onHire(c.role, c.id));
  const fee = el('span', { text: t('ui.crew.hire_fee', { fee: HIRING_COSTS[c.role] }), className: 'bsx-mono', attrs: { style: 'font-size:11px;font-weight:600;color:var(--bsx-amber)' } });
  const footer = el('div', { attrs: { style: 'display:flex;align-items:center;gap:10px;justify-content:flex-end' }, children: [fee, hire] });

  sheet.append(head, makeSkillsSection(c), pay);
  if (tradeoff) sheet.append(tradeoff);
  sheet.append(footer);
  if (refusal) {
    const reason = reasonLine(refusal, true);
    reason.dataset['hireReason'] = '';
    sheet.append(reason);
  }
  return sheet;
}
