// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { ContractUI, formatPricePerKg } from '../../../src/ui/ContractUI.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { Contract } from '../../../src/core/economy/Contract.js';

function makeState(): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.cash = 50_000;
  return s;
}

function makeContract(overrides?: Partial<Contract>): Contract {
  return {
    id: 1,
    oreId: 'gravelite',
    quantityKg: 5000,
    pricePerKg: 4,
    deadlineTicks: 200,
    acceptedAtTick: 0,
    deliveredKg: 0,
    description: 'Gravelite for the ring road',
    ...overrides,
  } as Contract;
}

function mount(): { container: HTMLDivElement; ui: ContractUI } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const ui = new ContractUI(container);
  ui.show();
  return { container, ui };
}

describe('ContractUI', () => {
  it('renders an Accept button for each available contract', () => {
    const { container, ui } = mount();
    const state = makeState();
    state.contracts.available = [makeContract()];

    ui.update(state);
    expect(container.querySelectorAll('.bs-contract-row').length).toBe(1);
    expect(container.querySelector('.bs-btn-primary')).not.toBeNull();

    ui.dispose();
    container.remove();
  });

  describe('per-frame rebuild guard', () => {
    it('keeps the same Accept button node when nothing changed', () => {
      // UIManager.update runs on every rendered frame. Rebuilding the rows each
      // time detached the Accept button out from under an in-flight click.
      const { container, ui } = mount();
      const state = makeState();
      state.contracts.available = [makeContract()];

      ui.update(state);
      const firstBtn = container.querySelector('.bs-btn-primary');
      ui.update(state);
      ui.update(state);
      expect(container.querySelector('.bs-btn-primary')).toBe(firstBtn);

      ui.dispose();
      container.remove();
    });

    it('rebuilds when a new contract is offered', () => {
      const { container, ui } = mount();
      const state = makeState();
      state.contracts.available = [makeContract()];

      ui.update(state);
      state.contracts.available = [makeContract(), makeContract({ id: 2 })];
      ui.update(state);
      expect(container.querySelectorAll('.bs-contract-row').length).toBe(2);

      ui.dispose();
      container.remove();
    });

    it('rebuilds when delivered tonnage moves the progress bar', () => {
      const { container, ui } = mount();
      const state = makeState();
      state.contracts.active = [makeContract({ deliveredKg: 0 })];

      ui.update(state);
      state.contracts.active = [makeContract({ deliveredKg: 2500 })];
      ui.update(state);
      expect(container.textContent).toContain('50%');

      ui.dispose();
      container.remove();
    });

    it('refreshes the countdown in place without replacing the row', () => {
      // The countdown moves every tick. Rebuilding for it detached the Accept
      // buttons ~2x a second, which is enough to lose a real click.
      const { container, ui } = mount();
      const state = makeState();
      state.contracts.active = [makeContract({ deadlineTicks: 100 })];

      ui.update(state);
      const row = container.querySelector('.bs-contract-active');
      state.tickCount = 40;
      ui.update(state);

      expect(container.querySelector('.bs-contract-active')).toBe(row);
      expect(container.textContent).toContain('60t left');

      ui.dispose();
      container.remove();
    });

    it('keeps the deadline countdown current across ticks', () => {
      const { container, ui } = mount();
      const state = makeState();
      state.contracts.active = [makeContract({ deadlineTicks: 100 })];

      ui.update(state);
      const before = container.textContent ?? '';
      state.tickCount = 40;
      ui.update(state);
      expect(container.textContent).not.toBe(before);

      ui.dispose();
      container.remove();
    });
  });
});

describe('formatPricePerKg', () => {
  it('trims the generator float instead of printing all of it', () => {
    // The offer generator produces raw floats; the panel used to render
    // "$542.4273477250244/kg".
    expect(formatPricePerKg(542.4273477250244)).toBe('542.43');
  });

  it('keeps three decimals below a dollar so cheap contracts do not read $0.00', () => {
    expect(formatPricePerKg(0.6273750268155709)).toBe('0.627');
  });

  it('adds thousands separators for high-value ore', () => {
    expect(formatPricePerKg(2975.6365069188178)).toBe('2,975.64');
  });
});
