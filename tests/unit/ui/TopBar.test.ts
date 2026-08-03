// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { TopBar, formatBalance, netPerTick } from '../../../src/ui/shell/TopBar.js';
import { NotificationCenter } from '../../../src/ui/notify/NotificationCenter.js';
import { createGame } from '../../../src/core/state/GameState.js';

function makeState() {
  const s = createGame({ seed: 1, mineType: 'desert' });
  s.cash = 75000;
  s.tickCount = 50;
  s.timeScale = 2;
  return s;
}

describe('TopBar (redesign P1)', () => {
  it('renders balance from GameState', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    topBar.update(makeState(), undefined, center);
    expect(container.querySelector('.bs-balance')?.textContent).toContain('75');
    topBar.dispose();
  });

  it('renders day from tick count', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    topBar.update(makeState(), undefined, center);
    // Day 3 (50/24 = 2.08 → day 3)
    expect(container.querySelector('#bs-hud-top')?.textContent).toContain('3');
    topBar.dispose();
  });

  it('speed segment for the current timeScale is highlighted', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    const state = makeState();
    state.timeScale = 4;
    topBar.update(state, undefined, center);
    const btn = container.querySelector<HTMLButtonElement>('.bs-speed-btn button[data-speed="4"]');
    expect(btn?.style.background).toContain('--bsx-amber');
    topBar.dispose();
  });

  it('speed button click dispatches the chosen speed', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    topBar.update(makeState(), undefined, center);
    const callback = vi.fn();
    topBar.setSpeedChangeHandler(callback);
    container.querySelector<HTMLButtonElement>('.bs-speed-btn button[data-speed="8"]')?.click();
    expect(callback).toHaveBeenCalledWith(8);
    topBar.dispose();
  });

  it('pause toggle click fires the handler', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    topBar.update(makeState(), undefined, center);
    const callback = vi.fn();
    topBar.setTogglePauseHandler(callback);
    container.querySelector<HTMLButtonElement>('.bs-speed-btn button:first-child')?.click();
    expect(callback).toHaveBeenCalledOnce();
    topBar.dispose();
  });

  it('score bars reflect GameState scores', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    const state = makeState();
    state.scores.safety = 80;
    topBar.update(state, undefined, center);
    const scores = container.querySelector('#bs-hud-scores');
    expect(scores?.textContent).toContain('80');
    topBar.dispose();
  });

  it('event alert pip appears when an event is pending', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    const state = makeState();
    state.events.pendingEvent = { eventId: 'test_event', firedAtTick: 1 };
    topBar.update(state, undefined, center);
    expect(container.querySelector('.bs-event-badge')).not.toBeNull();
    topBar.dispose();
  });

  it('no event alert pip when nothing pending', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    const state = makeState();
    state.events.pendingEvent = null;
    topBar.update(state, undefined, center);
    expect(container.querySelector('.bs-event-badge')).toBeNull();
    topBar.dispose();
  });

  it('weather icon updates', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    topBar.update(makeState(), 'storm', center);
    expect(container.querySelector('.bs-weather bs-icon')?.getAttribute('name')).toBe('storm');
    topBar.dispose();
  });

  it('clicking the contract alert pip navigates to the contracts panel', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    const state = makeState();
    state.contracts.active.push({
      id: 1, type: 'ore_sale', materialId: 'grumpite', description: 'test',
      quantityKg: 100, deliveredKg: 0, pricePerKg: 1, deadlineTicks: 5,
      acceptedAtTick: 50, penaltyAmount: 10, earlyBonus: 0, completed: false, expired: false,
    });
    state.tickCount = 52; // 5 remaining ticks
    topBar.update(state, undefined, center);
    const nav = vi.fn();
    topBar.setNavigateHandler(nav);
    const pip = Array.from(container.querySelectorAll('button')).find(b => b.title.includes('expires'));
    pip?.click();
    expect(nav).toHaveBeenCalledWith('contracts');
    topBar.dispose();
  });

  describe('balance formatting', () => {
    it('prints whole dollars with thousands separators', () => {
      expect(formatBalance(75000)).toBe('$75,000');
    });

    it('drops the float rounding tail instead of printing cents', () => {
      expect(formatBalance(-37799.853)).toBe('-$37,800');
    });

    it('puts the minus sign in front of the currency symbol', () => {
      expect(formatBalance(-1234)).toBe('-$1,234');
    });

    it('renders zero without a sign', () => {
      expect(formatBalance(0)).toBe('$0');
    });

    it('colours a negative balance red', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const topBar = new TopBar(container);
      const center = new NotificationCenter();
      const state = makeState();
      state.cash = -500.4;
      topBar.update(state, undefined, center);
      const balEl = container.querySelector('.bs-balance') as HTMLElement;
      expect(balEl.textContent).toBe('-$500');
      expect(balEl.style.color).not.toBe('');
      topBar.dispose();
    });
  });

  describe('netPerTick', () => {
    it('is zero with no transactions', () => {
      const state = makeState();
      state.tickCount = 10;
      expect(netPerTick(state)).toBe(0);
    });

    it('averages income over the window', () => {
      const state = makeState();
      state.tickCount = 10;
      state.finances.transactions.push({ tick: 9, type: 'income', amount: 240, category: 'contracts', description: 'x' });
      // 240 income spread over min(24, 10) = 10 ticks → 24/tick
      expect(netPerTick(state)).toBeCloseTo(24, 5);
    });

    it('nets expenses against income', () => {
      const state = makeState();
      state.tickCount = 10;
      state.finances.transactions.push({ tick: 9, type: 'income', amount: 100, category: 'contracts', description: 'x' });
      state.finances.transactions.push({ tick: 9, type: 'expense', amount: 40, category: 'fuel', description: 'y' });
      expect(netPerTick(state)).toBeCloseTo(6, 5);
    });

    it('ignores transactions outside the trailing window', () => {
      const state = makeState();
      state.tickCount = 100;
      state.finances.transactions.push({ tick: 1, type: 'income', amount: 100000, category: 'contracts', description: 'old' });
      expect(netPerTick(state)).toBe(0);
    });
  });

  it('renders exactly 4 score columns', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    topBar.update(createGame({ seed: 1, mineType: 'desert' }), undefined, center);
    const scoresEl = container.querySelector('#bs-hud-scores');
    expect(scoresEl?.children.length).toBe(4);
    topBar.dispose();
  });
});
