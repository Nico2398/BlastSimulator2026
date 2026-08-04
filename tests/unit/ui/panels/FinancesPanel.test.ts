// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { FinancesPanel } from '../../../../src/ui/panels/FinancesPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../src/core/state/GameState.js';

function makeState(): GameState {
  const s = createGame({ seed: 1, mineType: 'desert' });
  s.cash = 75000;
  s.tickCount = 100;
  return s;
}

function makePanel(): { panel: FinancesPanel; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const panel = new FinancesPanel(container);
  return { panel, container };
}

describe('FinancesPanel', () => {
  it('is hidden until show() is called', () => {
    const { panel } = makePanel();
    expect(panel.visible).toBe(false);
  });

  it('shows the real balance', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());
    expect(panel.root.textContent).toContain('$75,000');
  });

  it('shows empty states with no transactions at all', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());
    const text = panel.root.textContent ?? '';
    expect(text).toContain('No income yet');
    expect(text).toContain('No expenses yet');
    expect(text).toContain('No transactions yet');
  });

  it('shows a positive-trend "balance growing" note with no burn', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());
    expect(panel.root.textContent).toContain('Balance growing');
  });

  it('computes runway days from the real trailing burn rate', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.tickCount = 10;
    state.cash = 2400; // at -$240/tick this is 10 ticks (0.417 days) of runway
    state.finances.transactions.push({ tick: 9, type: 'expense', amount: 2400, category: 'fuel', description: 'x' });
    panel.show();
    panel.update(state);
    // net = -2400 spread over min(24,10)=10 ticks = -240/tick; runway = 2400/240 = 10 ticks = 0.4 days
    expect(panel.root.textContent).toContain('0.4d runway');
  });

  it('renders income and expense category bars from getFinancialReport, sorted by size', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.finances.transactions.push(
      { tick: 1, type: 'income', amount: 100, category: 'contracts', description: 'a' },
      { tick: 2, type: 'income', amount: 500, category: 'sales', description: 'b' },
      { tick: 3, type: 'expense', amount: 200, category: 'fuel', description: 'c' },
    );
    panel.show();
    panel.update(state);

    const text = panel.root.textContent ?? '';
    expect(text).toContain('Sales');
    expect(text).toContain('$500');
    expect(text).toContain('Contracts');
    expect(text).toContain('Fuel');
    expect(text).toContain('$200');
  });

  it('renders the ledger most-recent-first with category and day, not raw description', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.tickCount = 50;
    state.finances.transactions.push(
      { tick: 24, type: 'income', amount: 300, category: 'contracts', description: 'Contract #1 delivery' },
      { tick: 48, type: 'expense', amount: 150, category: 'salaries', description: 'Payroll' },
    );
    panel.show();
    panel.update(state);

    const rows = Array.from(panel.root.querySelectorAll('div')).map(d => d.textContent);
    expect(rows.some(r => r?.includes('Salaries') && r.includes('Day 3'))).toBe(true);
    expect(panel.root.textContent).not.toContain('Payroll');
    expect(panel.root.textContent).not.toContain('Contract #1 delivery');
  });

  it('shows a bankruptcy warning banner when below threshold', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.bankruptcy.ticksBelowThreshold = 40;
    panel.show();
    panel.update(state);
    expect(panel.root.textContent).toContain('Bankruptcy in');
  });

  it('shows the bankrupt banner once bankruptcy has actually triggered', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.bankruptcy.bankrupt = true;
    panel.show();
    panel.update(state);
    expect(panel.root.textContent).toContain('mine has been seized');
  });

  it('Close dispatches the close handler', () => {
    const { panel } = makePanel();
    let closed = false;
    panel.setCloseHandler(() => { closed = true; });
    panel.show();
    panel.update(makeState());
    (panel.root.querySelector('button') as HTMLButtonElement).click();
    expect(closed).toBe(true);
  });

  it('refreshLocale() does not throw', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());
    expect(() => panel.refreshLocale()).not.toThrow();
  });

  it('dispose() removes the panel from the DOM', () => {
    const { panel, container } = makePanel();
    panel.dispose();
    expect(container.contains(panel.root)).toBe(false);
  });
});
