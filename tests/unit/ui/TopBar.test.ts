// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TopBar, formatBalance } from '../../../src/ui/shell/TopBar.js';
import { NotificationCenter } from '../../../src/ui/notify/NotificationCenter.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { createWeatherCycle, setWeather, type WeatherCycleState } from '../../../src/core/weather/WeatherCycle.js';
import { hireEmployee, PAY_CYCLE_TICKS } from '../../../src/core/entities/Employee.js';
import { addIncome, addExpense } from '../../../src/core/economy/Finance.js';
import { Random } from '../../../src/core/math/Random.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import { formatDollars } from '../../../src/core/economy/formatMoney.js';
import * as TopBarModule from '../../../src/ui/shell/TopBar.js';
import { createBoardState } from '../../../src/core/economy/Board.js';
import { createGradeState, gradeDef } from '../../../src/core/economy/MineGrade.js';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';

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
    topBar.update(makeState(), center);
    expect(container.querySelector('.bs-balance')?.textContent).toContain('75');
    topBar.dispose();
  });

  it('renders day from tick count', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    topBar.update(makeState(), center);
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
    topBar.update(state, center);
    const btn = container.querySelector<HTMLButtonElement>('.bs-speed-btn button[data-speed="4"]');
    expect(btn?.style.background).toContain('--bsx-amber');
    topBar.dispose();
  });

  it('speed button click dispatches the chosen speed', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    topBar.update(makeState(), center);
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
    topBar.update(makeState(), center);
    const callback = vi.fn();
    topBar.setTogglePauseHandler(callback);
    container.querySelector<HTMLButtonElement>('.bs-speed-btn button:first-child')?.click();
    expect(callback).toHaveBeenCalledOnce();
    topBar.dispose();
  });

  describe('pause as a segment of the speed group (#1751)', () => {
    function setup(configure: (s: ReturnType<typeof makeState>) => void) {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const topBar = new TopBar(container);
      const state = makeState();
      configure(state);
      topBar.update(state, new NotificationCenter());
      const pauseBtn = container.querySelector<HTMLButtonElement>('button[data-action="pause-toggle"]')!;
      const speedBtns = Array.from(container.querySelectorAll<HTMLButtonElement>('button[data-speed]'));
      return { container, topBar, state, pauseBtn, speedBtns };
    }
    const lit = (b: HTMLElement) => b.style.background.includes('--bsx-amber');

    it('paused: the pause segment is amber and no speed segment is', () => {
      const { topBar, pauseBtn, speedBtns } = setup(s => { s.isPaused = true; });
      expect(lit(pauseBtn)).toBe(true);
      expect(speedBtns.length).toBe(4);
      expect(speedBtns.filter(lit)).toHaveLength(0);
      topBar.dispose();
    });

    it('running at 4x: only the 4x segment is amber, pause is not', () => {
      const { topBar, pauseBtn, speedBtns } = setup(s => { s.isPaused = false; s.timeScale = 4; });
      expect(lit(pauseBtn)).toBe(false);
      expect(speedBtns.filter(lit).map(b => b.dataset['speed'])).toEqual(['4']);
      topBar.dispose();
    });

    it('the first update() on a fresh running game lights 1x', () => {
      const { topBar, pauseBtn, speedBtns } = setup(s => { s.isPaused = false; s.timeScale = 1; });
      expect(speedBtns.filter(lit).map(b => b.dataset['speed'])).toEqual(['1']);
      expect(lit(pauseBtn)).toBe(false);
      topBar.dispose();
    });

    it('the first update() on a paused game lights pause', () => {
      const { topBar, pauseBtn, speedBtns } = setup(s => { s.isPaused = true; s.timeScale = 1; });
      expect(lit(pauseBtn)).toBe(true);
      expect(speedBtns.filter(lit)).toHaveLength(0);
      topBar.dispose();
    });

    it('the highlight moves from pause to a speed when the game resumes', () => {
      const { topBar, state, pauseBtn, speedBtns } = setup(s => { s.isPaused = true; s.timeScale = 2; });
      state.isPaused = false;
      topBar.update(state, new NotificationCenter());
      expect(lit(pauseBtn)).toBe(false);
      expect(speedBtns.filter(lit).map(b => b.dataset['speed'])).toEqual(['2']);
      topBar.dispose();
    });

    it('a paused top bar shows no Paused chip or text', () => {
      const { container, topBar } = setup(s => { s.isPaused = true; });
      const bar = container.querySelector('#bs-hud-top');
      expect(bar).not.toBeNull();
      const text = bar!.textContent ?? '';
      expect(text).not.toMatch(/paused|en pause/i);
      expect(bar!.querySelector('[data-chip="paused"], .bs-paused-chip, [data-testid="paused-chip"]')).toBeNull();
      topBar.dispose();
    });

    it('clicking pause fires the pause handler and not the speed handler', () => {
      const { topBar, pauseBtn } = setup(() => {});
      const onPause = vi.fn();
      const onSpeed = vi.fn();
      topBar.setTogglePauseHandler(onPause);
      topBar.setSpeedChangeHandler(onSpeed);
      pauseBtn.click();
      expect(onPause).toHaveBeenCalledOnce();
      expect(onSpeed).not.toHaveBeenCalled();
      topBar.dispose();
    });

    it('clicking a speed fires the speed handler and not the pause handler, also while paused', () => {
      const { topBar, speedBtns } = setup(s => { s.isPaused = true; });
      const onPause = vi.fn();
      const onSpeed = vi.fn();
      topBar.setTogglePauseHandler(onPause);
      topBar.setSpeedChangeHandler(onSpeed);
      speedBtns.find(b => b.dataset['speed'] === '2')!.click();
      expect(onSpeed).toHaveBeenCalledWith(2);
      expect(onPause).not.toHaveBeenCalled();
      topBar.dispose();
    });
  });

  it('score bars reflect GameState scores', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    const state = makeState();
    state.scores.safety = 80;
    topBar.update(state, center);
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
    topBar.update(state, center);
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
    topBar.update(state, center);
    expect(container.querySelector('.bs-event-badge')).toBeNull();
    topBar.dispose();
  });

  it('weather icon updates', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    topBar.update({ ...makeState(), weather: makeWeatherCycle('storm') }, center);
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
      topBar.update({ ...state, weather: makeWeatherCycle(current) }, center);
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

    it('shows the no-data fallback when opened before any update()', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const topBar = new TopBar(container);
      const weatherBtn = container.querySelector<HTMLButtonElement>('.bs-weather')!;
      weatherBtn.click();
      const popover = weatherBtn.nextElementSibling as HTMLElement;
      expect(popover.style.display).not.toBe('none');
      expect(popover.textContent).toContain(t('ui.weather.no_data'));
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
      topBar.update({ ...state, weather: makeWeatherCycle('storm') }, center);
      const popover = container.querySelector<HTMLElement>('.bs-weather')!.nextElementSibling as HTMLElement;
      expect(popover.textContent).toContain('Storm');
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
    topBar.update(state, center);
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
    topBar.update(makeState(), center);
    const nav = vi.fn();
    topBar.setNavigateHandler(nav);
    container.querySelector<HTMLButtonElement>('[data-action="open-finances"]')?.click();
    expect(nav).toHaveBeenCalledWith('finances');
    topBar.dispose();
  });

  // #1041: the tutorial rails allow every panel-opening control generically
  // via [data-panel] (PANEL_OPEN_SELECTOR, tutorialStepHelpers.ts) — the same
  // attribute ToolRail's toolbar buttons already carry. The balance display
  // opens Finances exactly like a toolbar button opens its panel, so it needs
  // the same marker to be included in that generic allowance.
  it('the balance control carries data-panel="finances" alongside its existing data-action (#1041)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    try {
      const center = new NotificationCenter();
      topBar.update(makeState(), center);
      const balanceBtn = container.querySelector<HTMLButtonElement>('[data-action="open-finances"]');
      expect(balanceBtn).not.toBeNull();
      expect(balanceBtn?.dataset['panel']).toBe('finances');
      // Existing data-action must survive — other code (scripts/ui-diagnostic.ts,
      // the money-surfaces-visual scenario) still resolves this control by it.
      expect(balanceBtn?.dataset['action']).toBe('open-finances');
    } finally {
      topBar.dispose();
    }
  });

  describe('level objective chip (#1374)', () => {
    const CHIP = '[data-action="open-objective"]';
    function setup(levelId: string | null) {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const topBar = new TopBar(container);
      const center = new NotificationCenter();
      const state = makeState();
      state.campaign.activeLevelId = levelId;
      return { container, topBar, center, state };
    }

    it('shows profit / target text in a campaign level', () => {
      const { container, topBar, center, state } = setup('dusty_hollow');
      try {
        addIncome(state.finances, 20000, 'sales', 'ore', 1);
        topBar.update(state, center);
        const chip = container.querySelector<HTMLElement>(CHIP);
        expect(chip).not.toBeNull();
        expect(chip!.style.display).not.toBe('none');
        expect(chip!.textContent).toContain(t('shell.topbar.objective', { profit: '$20,000', target: '$80,000' }));
        expect(chip!.textContent).toContain('$20,000 / $80,000');
      } finally { topBar.dispose(); }
    });

    it('carries data-panel="finances"', () => {
      const { container, topBar, center, state } = setup('dusty_hollow');
      try {
        topBar.update(state, center);
        expect(container.querySelector<HTMLElement>(CHIP)?.dataset['panel']).toBe('finances');
      } finally { topBar.dispose(); }
    });

    it('prints negative profit with a minus sign', () => {
      const { container, topBar, center, state } = setup('dusty_hollow');
      try {
        addExpense(state.finances, 1500, 'salaries', 'x', 1);
        topBar.update(state, center);
        const text = container.querySelector(CHIP)?.textContent ?? '';
        expect(text).toContain('-$');
        expect(text).toContain('/ $80,000');
      } finally { topBar.dispose(); }
    });

    it('progress bar width is the rounded percentage', () => {
      const { container, topBar, center, state } = setup('dusty_hollow');
      try {
        addIncome(state.finances, 20000, 'sales', 'ore', 1);
        topBar.update(state, center);
        const bar = Array.from(container.querySelectorAll<HTMLElement>(`${CHIP} *`)).find((e) => e.style.width.endsWith('%'));
        expect(bar).toBeDefined();
        expect(bar!.style.width).toBe('25%');
      } finally { topBar.dispose(); }
    });

    it('progress bar is 0% at negative profit and 100% over target', () => {
      const { container, topBar, center, state } = setup('dusty_hollow');
      try {
        const width = () => Array.from(container.querySelectorAll<HTMLElement>(`${CHIP} *`)).find((e) => e.style.width.endsWith('%'))?.style.width;
        addExpense(state.finances, 1000, 'salaries', 'x', 1);
        topBar.update(state, center);
        expect(width()).toBe('0%');
        addIncome(state.finances, 500000, 'sales', 'ore', 2);
        topBar.update(state, center);
        expect(width()).toBe('100%');
      } finally { topBar.dispose(); }
    });

    it('text updates after income is recorded', () => {
      const { container, topBar, center, state } = setup('dusty_hollow');
      try {
        topBar.update(state, center);
        expect(container.querySelector(CHIP)?.textContent).toContain('$0 / $80,000');
        addIncome(state.finances, 40000, 'sales', 'ore', 2);
        topBar.update(state, center);
        expect(container.querySelector(CHIP)?.textContent).toContain('$40,000 / $80,000');
      } finally { topBar.dispose(); }
    });

    it('is hidden in sandbox', () => {
      const { container, topBar, center, state } = setup('sandbox');
      try {
        topBar.update(state, center);
        const chip = container.querySelector<HTMLElement>(CHIP);
        expect(chip === null || chip.style.display === 'none').toBe(true);
      } finally { topBar.dispose(); }
    });

    it('is hidden with no active level', () => {
      const { container, topBar, center, state } = setup(null);
      try {
        topBar.update(state, center);
        const chip = container.querySelector<HTMLElement>(CHIP);
        expect(chip === null || chip.style.display === 'none').toBe(true);
      } finally { topBar.dispose(); }
    });

    it('reappears when returning from sandbox to a campaign level', () => {
      const { container, topBar, center, state } = setup('sandbox');
      try {
        topBar.update(state, center);
        state.campaign.activeLevelId = 'dusty_hollow';
        topBar.update(state, center);
        const chip = container.querySelector<HTMLElement>(CHIP);
        expect(chip).not.toBeNull();
        expect(chip!.style.display).not.toBe('none');
      } finally { topBar.dispose(); }
    });

    it('click navigates to finances', () => {
      const { container, topBar, center, state } = setup('dusty_hollow');
      try {
        topBar.update(state, center);
        const nav = vi.fn();
        topBar.setNavigateHandler(nav);
        container.querySelector<HTMLElement>(CHIP)?.click();
        expect(nav).toHaveBeenCalledWith('finances');
      } finally { topBar.dispose(); }
    });
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
      topBar.update(state, center);
      const balEl = container.querySelector('.bs-balance') as HTMLElement;
      expect(balEl.textContent).toBe('-$500');
      expect(balEl.style.color).not.toBe('');
      topBar.dispose();
    });
  });

  describe('operating trend (#1375)', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    function mount(state: ReturnType<typeof makeState>) {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const topBar = new TopBar(container);
      topBar.update(state, new NotificationCenter());
      return { container, topBar };
    }

    it('shows a zero trend with no operating flows', () => {
      const { container, topBar } = mount(makeState());
      expect(container.textContent).toContain('+$0/h');
      topBar.dispose();
    });

    it('is not moved by a one-off equipment purchase', () => {
      const state = makeState();
      state.finances.transactions.push({ tick: 49, type: 'expense', amount: 35000, category: 'equipment', description: 'rig' });
      const { container, topBar } = mount(state);
      expect(container.textContent).toContain('+$0/h');
      topBar.dispose();
    });

    it('shows operating income per hour over the operating window', () => {
      const state = makeState();
      // 72-tick window, game is 50 ticks old -> span 50: 5000 / 50 = 100/h
      state.finances.transactions.push({ tick: 40, type: 'income', amount: 5000, category: 'contracts', description: 'x' });
      const { container, topBar } = mount(state);
      expect(container.textContent).toContain('+$100/h');
      topBar.dispose();
    });

    it('trend is operating net: income minus payroll per hour', () => {
      const state = makeState();
      hireEmployee(state.employees, 'manager', new Random(3));
      const salaryPerHour = state.employees.employees[0]!.salary / PAY_CYCLE_TICKS;
      const { container, topBar } = mount(state);
      const trend = `-$${Math.round(salaryPerHour).toLocaleString('en-US')}/h`;
      expect(container.textContent).toContain(trend);
      topBar.dispose();
    });

    it('tooltip shows the operating cost per hour', () => {
      const state = makeState();
      hireEmployee(state.employees, 'manager', new Random(3));
      const salaryPerHour = Math.round(state.employees.employees[0]!.salary / PAY_CYCLE_TICKS);
      const { container, topBar } = mount(state);
      const titles = Array.from(container.querySelectorAll('[title]')).map(e => e.getAttribute('title') ?? '');
      expect(titles).toContain(t('ui.finances.operating_cost_tip', { cost: formatDollars(salaryPerHour) }));
      topBar.dispose();
    });
  });

  it('en and fr define the operating-cost tooltip key (#1375)', () => {
    expect((en as Record<string, string>)['ui.finances.operating_cost_tip']).toBeTruthy();
    expect((fr as Record<string, string>)['ui.finances.operating_cost_tip']).toBeTruthy();
  });

  it('renders exactly 4 score columns', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    topBar.update(createGame({ seed: 1, mineType: 'desert' }), center);
    const scoresEl = container.querySelector('#bs-hud-scores');
    expect(scoresEl?.children.length).toBe(4);
    topBar.dispose();
  });

  describe('score pill tooltips (#1416)', () => {
    const ECO_EN = 'Ecology — dust, water contamination, waste… — reaching 0 ends the level';

    function mount() {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const topBar = new TopBar(container);
      const center = new NotificationCenter();
      const state = createGame({ seed: 1, mineType: 'desert' });
      topBar.update(state, center);
      const titles = () =>
        Array.from(container.querySelector('#bs-hud-scores')!.children).map(c => c.getAttribute('title') ?? '');
      return { topBar, center, state, titles };
    }

    it('every pill has a non-empty title in en', () => {
      setLocale('en');
      const { topBar, titles } = mount();
      const t = titles();
      expect(t).toHaveLength(4);
      for (const title of t) expect(title.length).toBeGreaterThan(0);
      topBar.dispose();
    });

    it('every pill has a non-empty title in fr, different from en', () => {
      setLocale('en');
      const a = mount();
      const enTitles = a.titles();
      a.topBar.dispose();
      setLocale('fr');
      try {
        const b = mount();
        const frTitles = b.titles();
        expect(frTitles).toHaveLength(4);
        frTitles.forEach((title, i) => {
          expect(title.length).toBeGreaterThan(0);
          expect(title).not.toBe(enTitles[i]);
        });
        b.topBar.dispose();
      } finally {
        setLocale('en');
      }
    });

    it('en ECO title is exact', () => {
      setLocale('en');
      const { topBar, titles } = mount();
      expect(titles()[2]).toBe(ECO_EN);
      topBar.dispose();
    });

    it('only WELL and ECO mention the level-ending threshold (en)', () => {
      setLocale('en');
      const { topBar, titles } = mount();
      const [well, safe, eco, nuis] = titles();
      expect(well).toContain('reaching 0 ends the level');
      expect(eco).toContain('reaching 0 ends the level');
      expect(safe).not.toContain('reaching 0 ends the level');
      expect(nuis).not.toContain('reaching 0 ends the level');
      topBar.dispose();
    });

    it('only WELL and ECO mention the level-ending threshold (fr)', () => {
      setLocale('fr');
      try {
        const { topBar, titles } = mount();
        const [well, safe, eco, nuis] = titles();
        expect(well).toContain('met fin au niveau');
        expect(eco).toContain('met fin au niveau');
        expect(safe).not.toContain('met fin au niveau');
        expect(nuis).not.toContain('met fin au niveau');
        topBar.dispose();
      } finally {
        setLocale('en');
      }
    });

    it('the SAFE tooltip names buildings and accidents, not equipment investment or PPE (#1977)', () => {
      setLocale('en');
      const { topBar, titles } = mount();
      try {
        const safe = titles()[1]!.toLowerCase();
        expect(safe).toContain('building');
        expect(safe).toContain('accident');
        expect(safe).not.toContain('equipment investment');
        expect(safe).not.toContain('ppe');
      } finally {
        topBar.dispose();
      }
    });

    it('the SAFE tooltip in fr no longer cites equipment investment or EPI (#1977)', () => {
      setLocale('fr');
      const { topBar, titles } = mount();
      try {
        const safe = titles()[1]!.toLowerCase();
        expect(safe).not.toContain('investissement en équipement');
        expect(safe).not.toContain('epi');
        expect(safe).toContain('accident');
      } finally {
        topBar.dispose();
        setLocale('en');
      }
    });

    it('refreshLocale() switches titles to fr without a score change', () => {
      setLocale('en');
      const { topBar, titles } = mount();
      const enTitles = titles();
      setLocale('fr');
      try {
        topBar.refreshLocale();
        const frTitles = titles();
        frTitles.forEach((title, i) => {
          expect(title.length).toBeGreaterThan(0);
          expect(title).not.toBe(enTitles[i]);
        });
        expect(frTitles[2]).toContain('met fin au niveau');
      } finally {
        setLocale('en');
      }
      topBar.dispose();
    });

    it('titles persist after a score change', () => {
      setLocale('en');
      const { topBar, center, state, titles } = mount();
      const before = titles();
      state.scores.safety = 33;
      state.scores.ecology = 12;
      topBar.update(state, center);
      expect(titles()).toEqual(before);
      expect(titles()[2]).toBe(ECO_EN);
      topBar.dispose();
    });

    it('en.json and fr.json define all four score tooltip keys', () => {
      const keys = ['score_well_tip', 'score_safe_tip', 'score_eco_tip', 'score_nuis_tip'].map(k => `shell.topbar.${k}`);
      for (const k of keys) {
        expect((en as Record<string, string>)[k], `en ${k}`).toBeTruthy();
        expect((fr as Record<string, string>)[k], `fr ${k}`).toBeTruthy();
      }
    });
  });

  describe('scores inspect counter (#1334)', () => {
    function mount() {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const topBar = new TopBar(container);
      topBar.update(makeState(), new NotificationCenter());
      const hud = container.querySelector('#bs-hud-scores') as HTMLElement;
      return { topBar, hud, container };
    }

    it('starts with no inspections', () => {
      const { topBar, hud } = mount();
      expect(Number(hud.dataset['inspectCount'] ?? 0)).toBe(0);
      topBar.dispose();
    });

    it('pointerenter on #bs-hud-scores does NOT count as an inspection (#1595)', () => {
      const { topBar, hud } = mount();
      hud.dispatchEvent(new Event('pointerenter'));
      hud.dispatchEvent(new Event('pointerenter'));
      expect(hud.dataset['inspectCount']).toBe('0');
      topBar.dispose();
    });

    it('click on #bs-hud-scores increments dataset.inspectCount', () => {
      const { topBar, hud } = mount();
      hud.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(hud.dataset['inspectCount']).toBe('1');
      topBar.dispose();
    });

    it('survives a repaint of the scores', () => {
      const { topBar, hud } = mount();
      hud.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      topBar.update(makeState(), new NotificationCenter());
      expect(hud.dataset['inspectCount']).toBe('1');
      topBar.dispose();
    });
  });
});

describe('TopBar grade chip (#1924)', () => {
  function mountBar() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    const onNavigate = vi.fn();
    topBar.setNavigateHandler(onNavigate);
    const chip = () => container.querySelector<HTMLElement>('[data-action="open-permits"]');
    return { topBar, center, onNavigate, chip, container };
  }
  function gradeState() {
    const s = makeState();
    s.grade = createGradeState();
    return s;
  }
  afterEach(() => { vi.useRealTimers(); setLocale('en'); });

  it('is hidden without state.grade', () => {
    setLocale('en');
    const { topBar, center, chip } = mountBar();
    topBar.update(makeState(), center);
    const el = chip();
    expect(el === null || el.style.display === 'none').toBe(true);
    topBar.dispose();
  });

  it('is visible with a grade, showing the grade name', () => {
    setLocale('en');
    const { topBar, center, chip } = mountBar();
    topBar.update(gradeState(), center);
    expect(chip()).not.toBeNull();
    expect(chip()!.style.display).not.toBe('none');
    expect(chip()!.textContent).toContain(t(gradeDef(0).nameKey));
    topBar.dispose();
  });

  it('click navigates to permits', () => {
    const { topBar, center, onNavigate, chip } = mountBar();
    topBar.update(gradeState(), center);
    chip()!.click();
    expect(onNavigate).toHaveBeenCalledWith('permits');
    topBar.dispose();
  });

  it('pulses on the not-met to all-met transition, then clears after GRADE_CHIP_PULSE_MS', () => {
    vi.useFakeTimers();
    const pulseMs = (TopBarModule as Record<string, unknown>)['GRADE_CHIP_PULSE_MS'] as number;
    const { topBar, center, chip } = mountBar();
    const s = gradeState();
    topBar.update(s, center);
    expect(chip()!.dataset['pulse']).not.toBe('true');
    s.grade!.oreDeliveredKg = 5_000;
    topBar.update(s, center);
    expect(chip()!.dataset['pulse']).not.toBe('true'); // one target still unmet
    s.grade!.blastsFired = 2;
    topBar.update(s, center);
    expect(chip()!.dataset['pulse']).toBe('true');
    vi.advanceTimersByTime(pulseMs - 1);
    expect(chip()!.dataset['pulse']).toBe('true');
    vi.advanceTimersByTime(1);
    expect(chip()!.dataset['pulse']).not.toBe('true');
    topBar.dispose();
  });

  it('does not pulse again on later updates while targets stay met', () => {
    vi.useFakeTimers();
    const pulseMs = (TopBarModule as Record<string, unknown>)['GRADE_CHIP_PULSE_MS'] as number;
    const { topBar, center, chip } = mountBar();
    const s = gradeState();
    topBar.update(s, center);
    s.grade!.oreDeliveredKg = 5_000;
    s.grade!.blastsFired = 2;
    topBar.update(s, center);
    vi.advanceTimersByTime(pulseMs);
    topBar.update(s, center);
    topBar.update(s, center);
    expect(chip()!.dataset['pulse']).not.toBe('true');
    topBar.dispose();
  });

  it('does not pulse when the targets become met while an application is pending', () => {
    const { topBar, center, chip } = mountBar();
    const s = gradeState();
    s.grade!.pending = { toGrade: 1, ticksLeft: 10 };
    topBar.update(s, center);
    s.grade!.oreDeliveredKg = 5_000;
    s.grade!.blastsFired = 2;
    topBar.update(s, center);
    expect(chip()!.dataset['pulse']).not.toBe('true');
    topBar.dispose();
  });
});

describe('TopBar board chip (#1946)', () => {
  const CHIP = '[data-action="open-board"]';
  function mountBar() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const topBar = new TopBar(container);
    const center = new NotificationCenter();
    const chip = () => container.querySelector<HTMLElement>(CHIP);
    return { topBar, center, chip, container };
  }
  /** Quarter 2 of a 720-tick quarter with 12 days (288 ticks) left, confidence 75. */
  function boardState() {
    const s = makeState();
    s.board = createBoardState({ quarterTicks: 720, oreTargetT: 20, profitTarget: 5000 }, 0);
    s.board.quarter = 2;
    s.board.confidence = 75;
    s.tickCount = 720 - 288;
    return s;
  }
  afterEach(() => { setLocale('en'); document.body.innerHTML = ''; });

  it('is hidden without a board', () => {
    setLocale('en');
    const { topBar, center, chip } = mountBar();
    topBar.update(makeState(), center);
    const el = chip();
    expect(el === null || el.style.display === 'none').toBe(true);
    topBar.dispose();
  });

  it('shows the quarter, the days left and the confidence', () => {
    setLocale('en');
    const { topBar, center, chip } = mountBar();
    topBar.update(boardState(), center);
    expect(chip()).not.toBeNull();
    expect(chip()!.style.display).not.toBe('none');
    expect(chip()!.textContent).toContain('Q2 · 12d · 75%');
    topBar.dispose();
  });

  it('follows the board as the quarter advances', () => {
    setLocale('en');
    const { topBar, center, chip } = mountBar();
    const s = boardState();
    topBar.update(s, center);
    s.tickCount += 24 * 2;
    s.board!.confidence = 50;
    topBar.update(s, center);
    expect(chip()!.textContent).toContain('Q2 · 10d · 50%');
    topBar.dispose();
  });

  it('hides again when the board is gone (keep playing)', () => {
    setLocale('en');
    const { topBar, center, chip } = mountBar();
    const s = boardState();
    topBar.update(s, center);
    delete s.board;
    topBar.update(s, center);
    const el = chip();
    expect(el === null || el.style.display === 'none').toBe(true);
    topBar.dispose();
  });

  it('has the shell.topbar.board key in both locales', () => {
    expect(Object.keys(en)).toContain('shell.topbar.board');
    expect(Object.keys(fr)).toContain('shell.topbar.board');
  });
});
