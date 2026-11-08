// @vitest-environment jsdom
//
// Candidate sheet (#2164): the unit builders behind the Crew panel's candidate
// sheet. CrewPanel.test.ts drives the same flow through a mounted panel.

import { describe, it, expect, vi } from 'vitest';
import { makeCandidateSheet } from '../../../src/ui/candidateSheet.js';
import { hireRefusal } from '../../../src/ui/panels/CrewHiring.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { HIRING_COSTS } from '../../../src/core/entities/Employee.js';
import type { HireCandidate } from '../../../src/core/entities/HiringPool.js';
import { t } from '../../../src/core/i18n/I18n.js';
import { perHour } from '../../../src/ui/crewDetailSections.js';
import { salaryExplain, skillLevelExplain, unionExplain } from '../../../src/ui/statExplain.js';

const candidate = (overrides: Partial<HireCandidate> = {}): HireCandidate => ({
  id: 7, role: 'surveyor', name: 'Ada Sheetwell', unionized: false, salary: 520,
  qualifications: [
    { category: 'geology', proficiencyLevel: 3, xp: 0 },
    { category: 'blasting', proficiencyLevel: 1, xp: 0 },
  ],
  ...overrides,
});

function build(c: HireCandidate, cash: number) {
  const state = createGame({ seed: 1, mineType: 'desert' });
  state.cash = cash;
  const onHire = vi.fn();
  const onClose = vi.fn();
  const sheet = makeCandidateSheet(state, c, onHire, onClose);
  document.body.appendChild(sheet);
  const find = <T extends HTMLElement>(sel: string): T | null => (sheet.matches(sel) ? sheet as unknown as T : sheet.querySelector<T>(sel));
  return { sheet, find, onHire, onClose };
}

describe('hireRefusal (#2164)', () => {
  it('is null when cash covers the fee', () => {
    expect(hireRefusal({ cash: HIRING_COSTS.driller + 5000 }, { role: 'driller' })).toBeNull();
  });

  it('is null when cash equals the fee exactly', () => {
    expect(hireRefusal({ cash: HIRING_COSTS.manager }, { role: 'manager' })).toBeNull();
  });

  it('states the missing cash when short by one', () => {
    expect(hireRefusal({ cash: HIRING_COSTS.blaster - 1 }, { role: 'blaster' }))
      .toBe(t('ui.crew.hire_short_cash', { missing: 1 }));
  });

  it('states fee minus cash, per role, when broke', () => {
    expect(hireRefusal({ cash: 0 }, { role: 'surveyor' })).toBe(t('ui.crew.hire_short_cash', { missing: HIRING_COSTS.surveyor }));
    expect(hireRefusal({ cash: 0 }, { role: 'manager' })).toBe(t('ui.crew.hire_short_cash', { missing: HIRING_COSTS.manager }));
  });
});

describe('makeCandidateSheet (#2164)', () => {
  it('is keyed by the candidate id', () => {
    const { find } = build(candidate(), 100000);
    expect(find('[data-candidate-sheet="7"]')).not.toBeNull();
  });

  it('shows name, role label, every qualification, salary, union status and fee', () => {
    const { sheet } = build(candidate(), 100000);
    const text = sheet.textContent!;
    expect(text).toContain('Ada Sheetwell');
    expect(text).toContain(t('role.surveyor'));
    expect(text).toContain(t('skill.geology'));
    expect(text).toContain(t('skill.blasting'));
    expect(text).toContain(t('ui.crew.candidate_salary', { salary: perHour(520) }));
    expect(text).toContain(t('ui.crew.candidate_non_union'));
    expect(text).toContain(t('ui.crew.hire_fee', { fee: HIRING_COSTS.surveyor }));
  });

  it('a candidate with no qualifications still renders a sheet', () => {
    const { sheet } = build(candidate({ qualifications: [] }), 100000);
    expect(sheet.textContent).toContain('Ada Sheetwell');
  });

  it('carries the skill, salary and union explanations', () => {
    const { sheet } = build(candidate(), 100000);
    const explains = [...sheet.querySelectorAll<HTMLElement>('[data-explain]')].map(n => n.getAttribute('data-explain'));
    expect(explains).toContain(skillLevelExplain(3));
    expect(explains).toContain(skillLevelExplain(1));
    expect(explains).toContain(salaryExplain());
    expect(explains).toContain(unionExplain());
  });

  it('shows the union trade-off line only for a unionized candidate', () => {
    const line = t('ui.crew.candidate_union_tradeoff', { pct: 15 });
    expect(build(candidate({ unionized: true }), 100000).sheet.textContent).toContain(line);
    expect(build(candidate({ unionized: true }), 100000).sheet.textContent).toContain(t('ui.crew.candidate_union'));
    expect(build(candidate({ unionized: false }), 100000).sheet.textContent).not.toContain(line);
  });

  it('Hire calls onHire with the candidate role and id when affordable', () => {
    const { find, onHire } = build(candidate(), 100000);
    const hire = find<HTMLButtonElement>('[data-candidate-sheet-hire]')!;
    expect(hire.disabled).toBe(false);
    hire.click();
    expect(onHire).toHaveBeenCalledTimes(1);
    expect(onHire).toHaveBeenCalledWith('surveyor', 7);
  });

  it('Close calls onClose and hires nobody', () => {
    const { find, onHire, onClose } = build(candidate(), 100000);
    find<HTMLButtonElement>('[data-candidate-sheet-close]')!.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onHire).not.toHaveBeenCalled();
  });

  it('short of the fee, Hire is disabled and the reason line equals hireRefusal', () => {
    const cash = HIRING_COSTS.surveyor - 40;
    const { find, onHire } = build(candidate(), cash);
    const hire = find<HTMLButtonElement>('[data-candidate-sheet-hire]')!;
    expect(hire.disabled).toBe(true);
    hire.click();
    expect(onHire).not.toHaveBeenCalled();
    expect(find('[data-hire-reason]')!.textContent).toBe(t('ui.crew.hire_short_cash', { missing: 40 }));
    expect(find('[data-hire-reason]')!.textContent).toBe(hireRefusal({ cash }, { role: 'surveyor' }));
  });

  it('with enough cash there is no reason line', () => {
    const { find } = build(candidate(), HIRING_COSTS.surveyor);
    expect(find('[data-hire-reason]')).toBeNull();
  });
});
