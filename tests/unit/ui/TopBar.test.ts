// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { TopBar, formatBalance, netPerTick } from '../../../src/ui/shell/TopBar.js';
import { NotificationCenter } from '../../../src/ui/notify/NotificationCenter.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { createWeatherCycle, setWeather, type WeatherCycleState } from '../../../src/core/weather/WeatherCycle.js';
import { Random } from '../../../src/core/math/Random.js';

function makeWeatherCycle(current: WeatherCycleState['current']): WeatherCycleState {
  const cycle = createWeatherCycle(1);
  setWeather(cycle, current);
  return cycle;
}

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
    topBar.update(makeState(), undefined, undefined, center);
    expect(container.querySelector('.bs-balance')?.textContent).toContain('75');
    topBar.dispose();
  });

  it('renders day from tick count', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    topBar.update(makeState(), undefined, undefined, center);
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
    topBar.update(state, undefined, undefined, center);
    const btn = container.querySelector<HTMLButtonElement>('.bs-speed-btn button[data-speed="4"]');
    expect(btn?.style.background).toContain('--bsx-amber');
    topBar.dispose();
  });

  it('speed button click dispatches the chosen speed', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    topBar.update(makeState(), undefined, undefined, center);
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
    topBar.update(makeState(), undefined, undefined, center);
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
    topBar.update(state, undefined, undefined, center);
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
    topBar.update(state, undefined, undefined, center);
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
    topBar.update(state, undefined, undefined, center);
    expect(container.querySelector('.bs-event-badge')).toBeNull();
    topBar.dispose();
  });

  it('weather icon updates', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    topBar.update(makeState(), makeWeatherCycle('storm'), new Random(1), center);
    expect(container.querySelector('.bs-weather bs-icon')?.getAttribute('name')).toBe('storm');
    topBar.dispose();
  });

  describe('weather popover', () => {
    function setUp(current: WeatherCycleState['current'] = 'sunny') {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const topBar = new TopBar(container);
      const center = new NotificationCenter();
      const state = makeState();
      topBar.update(state, makeWeatherCycle(current), new Random(1), center);
      const weatherBtn = container.querySelector<HTMLButtonElement>('.bs-weather')!;
      return { topBar, container, center, state, weatherBtn };
    }

    it('is closed by default', () => {
      const { topBar, container } = setUp();
      const popover = container.querySelector<HTMLElement>('.bs-weather')!.nextElementSibling as HTMLElement;
      expect(popover.style.display).toBe('none');
      topBar.dispose();
    });

    it('opens on click and shows the current weather name and its real effect', () => {
      const { topBar, weatherBtn } = setUp('heavy_rain');
      weatherBtn.click();
      const popover = weatherBtn.nextElementSibling as HTMLElement;
      expect(popover.style.display).not.toBe('none');
      expect(popover.textContent).toContain('Heavy Rain');
      expect(popover.textContent).toContain('flooding fast');
      topBar.dispose();
    });

    it('closes on a second click of the trigger', () => {
      const { topBar, weatherBtn } = setUp();
      weatherBtn.click();
      weatherBtn.click();
      const popover = weatherBtn.nextElementSibling as HTMLElement;
      expect(popover.style.display).toBe('none');
      topBar.dispose();
    });

    it('closes when clicking outside it', () => {
      const { topBar, weatherBtn } = setUp();
      weatherBtn.click();
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const popover = weatherBtn.nextElementSibling as HTMLElement;
      expect(popover.style.display).toBe('none');
      topBar.dispose();
    });

    it('does not close when clicking inside it', () => {
      const { topBar, weatherBtn } = setUp();
      weatherBtn.click();
      const popover = weatherBtn.nextElementSibling as HTMLElement;
      popover.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(popover.style.display).not.toBe('none');
      topBar.dispose();
    });

    it('shows 14 forecast day cells', () => {
      const { topBar, weatherBtn } = setUp();
      weatherBtn.click();
      const popover = weatherBtn.nextElementSibling as HTMLElement;
      // One bs-icon per day cell, plus the header's own icon and the advisory box's.
      expect(popover.querySelectorAll('bs-icon').length).toBe(16);
      topBar.dispose();
    });

    it('forecast day numbers continue from the current day', () => {
      const { topBar, weatherBtn, state } = setUp();
      state.tickCount = 0; // Day 1
      weatherBtn.click();
      const popover = weatherBtn.nextElementSibling as HTMLElement;
      expect(popover.textContent).toContain('2'); // tomorrow = Day 2
      topBar.dispose();
    });

    it('shows an advisory line grounded in real forecast/wet-hole data', () => {
      const { topBar, weatherBtn } = setUp('sunny');
      weatherBtn.click();
      const popover = weatherBtn.nextElementSibling as HTMLElement;
      expect(popover.textContent).toMatch(/dry|water|rain/i);
      topBar.dispose();
    });

    it('re-renders while open as update() is called again', () => {
      const { topBar, container, weatherBtn, center, state } = setUp('sunny');
      weatherBtn.click();
      topBar.update(state, makeWeatherCycle('storm'), new Random(1), center);
      const popover = container.querySelector<HTMLElement>('.bs-weather')!.nextElementSibling as HTMLElement;
      expect(popover.textContent).toContain('Storm');
      topBar.dispose();
    });

    it('does not throw and shows a fallback when weatherCycle/rng are unavailable', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const topBar = new TopBar(container);
      const center = new NotificationCenter();
      topBar.update(makeState(), undefined, undefined, center);
      const weatherBtn = container.querySelector<HTMLButtonElement>('.bs-weather')!;
      expect(() => weatherBtn.click()).not.toThrow();
      const popover = weatherBtn.nextElementSibling as HTMLElement;
      expect(popover.style.display).not.toBe('none');
      expect(popover.textContent).toContain('unavailable');
      topBar.dispose();
    });

    it('refreshLocale() re-renders the popover while open', () => {
      const { topBar, weatherBtn } = setUp('sunny');
      weatherBtn.click();
      expect(() => topBar.refreshLocale()).not.toThrow();
      const popover = weatherBtn.nextElementSibling as HTMLElement;
      expect(popover.style.display).not.toBe('none');
      topBar.dispose();
    });

    it('dispose() removes the document click listener (no error on a later outside click)', () => {
      const { topBar, weatherBtn } = setUp();
      weatherBtn.click();
      topBar.dispose();
      expect(() => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow();
    });
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
    topBar.update(state, undefined, undefined, center);
    const nav = vi.fn();
    topBar.setNavigateHandler(nav);
    const pip = Array.from(container.querySelectorAll('button')).find(b => b.title.includes('expires'));
    pip?.click();
    expect(nav).toHaveBeenCalledWith('contracts');
    topBar.dispose();
  });

  it('clicking the balance navigates to the finances panel', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    topBar.update(makeState(), undefined, undefined, center);
    const nav = vi.fn();
    topBar.setNavigateHandler(nav);
    container.querySelector<HTMLButtonElement>('[data-action="open-finances"]')?.click();
    expect(nav).toHaveBeenCalledWith('finances');
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
      topBar.update(state, undefined, undefined, center);
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
    topBar.update(createGame({ seed: 1, mineType: 'desert' }), undefined, undefined, center);
    const scoresEl = container.querySelector('#bs-hud-scores');
    expect(scoresEl?.children.length).toBe(4);
    topBar.dispose();
  });
});
