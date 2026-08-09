// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ShadyPanel } from '../../../../src/ui/panels/ShadyPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import { hireEmployee } from '../../../../src/core/entities/Employee.js';
import { Random } from '../../../../src/core/math/Random.js';
import { t, setLocale } from '../../../../src/core/i18n/I18n.js';
import type { ConfirmModalConfig } from '../../../../src/ui/panels/ConfirmModal.js';
import { TARGET_COSTS } from '../../../../src/core/economy/Corruption.js';
import { ACCIDENT_COST, FRAME_COST } from '../../../../src/core/events/MafiaActions.js';

function mount(): { container: HTMLDivElement; panel: ShadyPanel } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return { container, panel: new ShadyPanel(container) };
}

function stateWithMafiaUnlocked(): GameState {
  const s = createGame({ seed: 1, mineType: 'desert' });
  s.corruption.level = 3;
  s.corruption.attempts = [
    { tick: 1, target: 'judge', cost: 50000, success: true },
    { tick: 2, target: 'inspector', cost: 8000, success: false },
    { tick: 3, target: 'witness', cost: 10000, success: true },
  ];
  s.corruption.mafiaUnlocked = true;
  return s;
}

describe('ShadyPanel', () => {
  afterEach(() => { setLocale('en'); vi.useRealTimers(); });

  it('carries a stable root id and is hidden by default', () => {
    const { container, panel } = mount();
    expect(container.querySelector('#bs-shady-panel')).not.toBeNull();
    expect(panel.visible).toBe(false);
    panel.dispose();
  });

  it('show/hide toggle visibility', () => {
    const { panel } = mount();
    panel.show();
    expect(panel.visible).toBe(true);
    panel.hide();
    expect(panel.visible).toBe(false);
    panel.dispose();
  });

  it('shows the real corruption level and all 5 arrangement targets', () => {
    const { container, panel } = mount();
    const state = createGame({ seed: 1, mineType: 'desert' });
    state.corruption.level = 2;
    panel.update(state);
    panel.show();

    const text = container.textContent ?? '';
    expect(text).toContain('2'); // influence level
    for (const key of ['judge', 'union_leader', 'inspector', 'politician', 'witness']) {
      expect(text).toContain(t(`ui.shady.target.${key}`));
    }
    panel.dispose();
  });

  it('shows the locked services teaser before the mafia is unlocked', () => {
    const { container, panel } = mount();
    const state = createGame({ seed: 1, mineType: 'desert' });
    panel.update(state);
    panel.show();
    expect(container.textContent).toContain(t('ui.shady.locked_title'));
    expect(container.textContent).not.toContain(t('ui.shady.smuggling_label'));
    panel.dispose();
  });

  it('shows smuggling, exposure, accident and frame services once the mafia is unlocked', () => {
    const { container, panel } = mount();
    panel.update(stateWithMafiaUnlocked());
    panel.show();

    const text = container.textContent ?? '';
    expect(text).toContain(t('ui.shady.smuggling_label'));
    expect(text).toContain(t('ui.shady.exposure_label'));
    expect(text).toContain(t('ui.shady.accident_label'));
    expect(text).toContain(t('ui.shady.frame_label'));
    expect(text).not.toContain(t('ui.shady.locked_title'));
    panel.dispose();
  });

  it('clicking MAKE THE CALL requests a confirm, and confirming sends the real corrupt command', () => {
    const { container, panel } = mount();
    const state = createGame({ seed: 1, mineType: 'desert' });
    panel.update(state);
    panel.show();

    let requested: ConfirmModalConfig | null = null;
    panel.setConfirmHandler((config) => { requested = config; });
    const calls: string[] = [];
    panel.setGameConsole((cmd) => { calls.push(cmd); return { success: true, output: '' }; });

    const callButtons = Array.from(container.querySelectorAll('button')).filter(b => b.textContent === t('ui.shady.make_the_call'));
    expect(callButtons.length).toBe(5);
    callButtons[0]!.click(); // judge, first target
    expect(requested).not.toBeNull();
    requested!.onConfirm();
    expect(calls).toEqual(['corrupt target:judge']);
    panel.dispose();
  });

  it('the confirm body states the real cost and current success rate, not placeholder numbers', () => {
    const { container, panel } = mount();
    const state = createGame({ seed: 1, mineType: 'desert' });
    // 3 prior attempts lower the success rate from the base BRIBERY_BASE_SUCCESS.
    state.corruption.attempts = [
      { tick: 1, target: 'judge', cost: 50000, success: true },
      { tick: 2, target: 'judge', cost: 50000, success: false },
    ];
    panel.update(state);
    panel.show();

    let requested: ConfirmModalConfig | null = null;
    panel.setConfirmHandler((config) => { requested = config; });
    const callButtons = Array.from(container.querySelectorAll('button')).filter(b => b.textContent === t('ui.shady.make_the_call'));
    callButtons[0]!.click();

    expect(requested!.body).toContain('50,000');
    expect(requested!.body).toMatch(/\d+%/);
    panel.dispose();
  });

  it('smuggling toggle sends the real mafia smuggle command', () => {
    const { container, panel } = mount();
    panel.update(stateWithMafiaUnlocked());
    panel.show();
    const calls: string[] = [];
    panel.setGameConsole((cmd) => { calls.push(cmd); return { success: true, output: '' }; });

    const toggleBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === t('ui.shady.smuggling_start'));
    toggleBtn!.click();
    expect(calls).toEqual(['mafia smuggle']);
    panel.dispose();
  });

  it('shows ACTIVE with the real income once smuggling is running', () => {
    const { container, panel } = mount();
    const state = stateWithMafiaUnlocked();
    state.mafia.smugglingActive = true;
    state.mafia.smugglingIncome = 8000;
    panel.update(state);
    panel.show();
    expect(container.textContent).toContain(t('ui.shady.smuggling_active', { income: 8000 }));
    panel.dispose();
  });

  it('the exposure meter reflects live state.mafia.exposureRisk without needing a structural change', () => {
    const { container, panel } = mount();
    const state = stateWithMafiaUnlocked();
    state.mafia.exposureRisk = 0.2;
    panel.update(state);
    panel.show();
    expect(container.textContent).toContain('20%');

    // Same signature (no roster/frame/level change) — refreshDynamic must still pick this up.
    state.mafia.exposureRisk = 0.45;
    panel.update(state);
    expect(container.textContent).toContain('45%');
    panel.dispose();
  });

  it('arranging an accident against the selected employee sends the real mafia accident command', () => {
    const { container, panel } = mount();
    const state = stateWithMafiaUnlocked();
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
    panel.update(state);
    panel.show();

    let requested: ConfirmModalConfig | null = null;
    panel.setConfirmHandler((config) => { requested = config; });
    const calls: string[] = [];
    panel.setGameConsole((cmd) => { calls.push(cmd); return { success: true, output: '' }; });

    const select = container.querySelector('#bs-shady-panel select') as HTMLSelectElement;
    select.value = String(employee.id);
    const goBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === t('ui.shady.accident_button'));
    goBtn!.click();
    requested!.onConfirm();
    expect(calls).toEqual([`mafia accident employee:${employee.id}`]);
    panel.dispose();
  });

  it('disables the accident control when there is no one left to target', () => {
    const { container, panel } = mount();
    panel.update(stateWithMafiaUnlocked());
    panel.show();
    const goBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === t('ui.shady.accident_button')) as HTMLButtonElement;
    expect(goBtn.disabled).toBe(true);
    panel.dispose();
  });

  it('starting a frame against the selected employee sends the real mafia frame command', () => {
    const { container, panel } = mount();
    const state = stateWithMafiaUnlocked();
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
    panel.update(state);
    panel.show();

    let requested: ConfirmModalConfig | null = null;
    panel.setConfirmHandler((config) => { requested = config; });
    const calls: string[] = [];
    panel.setGameConsole((cmd) => { calls.push(cmd); return { success: true, output: '' }; });

    const selects = container.querySelectorAll('#bs-shady-panel select');
    const frameSelect = selects[selects.length - 1] as HTMLSelectElement;
    frameSelect.value = String(employee.id);
    const startBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === t('ui.shady.frame_start_button'));
    startBtn!.click();
    requested!.onConfirm();
    expect(calls).toEqual([`mafia frame employee:${employee.id}`]);
    panel.dispose();
  });

  it('a pending, not-yet-ready frame shows the real countdown and no action button', () => {
    const { container, panel } = mount();
    const state = stateWithMafiaUnlocked();
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
    state.tickCount = 5;
    state.mafia.pendingFrames = [{ employeeId: employee.id, startTick: 5, readyTick: 15 }];
    panel.update(state);
    panel.show();
    expect(container.textContent).toContain(t('ui.shady.frame_pending', { ticks: 10 }));
    expect(Array.from(container.querySelectorAll('button')).some(b => b.textContent === t('ui.shady.frame_complete_button'))).toBe(false);
    panel.dispose();
  });

  it('a ready pending frame offers USE THE EVIDENCE, which sends the same mafia frame command to complete it', () => {
    const { container, panel } = mount();
    const state = stateWithMafiaUnlocked();
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
    state.tickCount = 20;
    state.mafia.pendingFrames = [{ employeeId: employee.id, startTick: 5, readyTick: 15 }];
    panel.update(state);
    panel.show();

    let requested: ConfirmModalConfig | null = null;
    panel.setConfirmHandler((config) => { requested = config; });
    const calls: string[] = [];
    panel.setGameConsole((cmd) => { calls.push(cmd); return { success: true, output: '' }; });

    const useBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === t('ui.shady.frame_complete_button'));
    useBtn!.click();
    requested!.onConfirm();
    expect(calls).toEqual([`mafia frame employee:${employee.id}`]);
    panel.dispose();
  });

  it('a locale refresh re-renders static chrome and, while visible, the dynamic sections', () => {
    const { container, panel } = mount();
    panel.update(stateWithMafiaUnlocked());
    panel.show();
    expect(container.textContent).toContain('SPECIAL CONTACTS');

    setLocale('fr');
    panel.refreshLocale();

    expect(container.textContent).toContain('CONTACTS SPÉCIAUX');
    expect(container.textContent).toContain(t('ui.shady.smuggling_label'));
    panel.dispose();
  });

  it('dispose removes the panel from the DOM', () => {
    const { container, panel } = mount();
    panel.dispose();
    expect(container.querySelector('#bs-shady-panel')).toBeNull();
  });

  // Every control below was reachable only by button text or an `nth-of-type`
  // position before these attributes existed — both break the moment a label
  // is retranslated or a card is reordered. The selectors asserted here are
  // the ones an interaction-mode scenario is meant to click.
  describe('stable selectors', () => {
    it('each arrangement card is addressable by target id, and its call button by data-action', () => {
      const { container, panel } = mount();
      panel.update(createGame({ seed: 1, mineType: 'desert' }));
      panel.show();

      const calls: string[] = [];
      let requested: ConfirmModalConfig | null = null;
      panel.setConfirmHandler((config) => { requested = config; });
      panel.setGameConsole((cmd) => { calls.push(cmd); return { success: true, output: '' }; });

      for (const id of ['judge', 'union_leader', 'inspector', 'politician', 'witness'] as const) {
        const btn = container.querySelector<HTMLButtonElement>(`#bs-shady-panel [data-target="${id}"] [data-action="corrupt"]`);
        expect(btn, `no corrupt button for target ${id}`).not.toBeNull();
        btn!.click();
        requested!.onConfirm();
      }
      expect(calls).toEqual([
        'corrupt target:judge',
        'corrupt target:union_leader',
        'corrupt target:inspector',
        'corrupt target:politician',
        'corrupt target:witness',
      ]);
      panel.dispose();
    });

    it('[data-action="mafia-smuggle"] resolves to the smuggling toggle in both its states', () => {
      const { container, panel } = mount();
      const state = stateWithMafiaUnlocked();
      panel.update(state);
      panel.show();
      const calls: string[] = [];
      panel.setGameConsole((cmd) => { calls.push(cmd); return { success: true, output: '' }; });

      const startBtn = container.querySelector<HTMLButtonElement>('#bs-shady-panel [data-action="mafia-smuggle"]');
      expect(startBtn!.textContent).toBe(t('ui.shady.smuggling_start'));
      startBtn!.click();

      // The button is rebuilt (label + variant change) once smuggling runs —
      // the selector has to survive that rebuild, not just the first render.
      state.mafia.smugglingActive = true;
      panel.update(state);
      const stopBtn = container.querySelector<HTMLButtonElement>('#bs-shady-panel [data-action="mafia-smuggle"]');
      expect(stopBtn!.textContent).toBe(t('ui.shady.smuggling_stop'));
      stopBtn!.click();

      expect(calls).toEqual(['mafia smuggle', 'mafia smuggle']);
      panel.dispose();
    });

    it('[data-action="mafia-accident"] plus its employee select drive the real accident command', () => {
      const { container, panel } = mount();
      const state = stateWithMafiaUnlocked();
      const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
      panel.update(state);
      panel.show();

      let requested: ConfirmModalConfig | null = null;
      panel.setConfirmHandler((config) => { requested = config; });
      const calls: string[] = [];
      panel.setGameConsole((cmd) => { calls.push(cmd); return { success: true, output: '' }; });

      const select = container.querySelector<HTMLSelectElement>('#bs-shady-panel [data-action="mafia-accident-employee"]');
      expect(select).not.toBeNull();
      select!.value = String(employee.id);
      const goBtn = container.querySelector<HTMLButtonElement>('#bs-shady-panel [data-action="mafia-accident"]');
      goBtn!.click();
      requested!.onConfirm();
      expect(calls).toEqual([`mafia accident employee:${employee.id}`]);
      panel.dispose();
    });

    it('[data-action="mafia-frame-start"] plus its employee select start the frame', () => {
      const { container, panel } = mount();
      const state = stateWithMafiaUnlocked();
      const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
      panel.update(state);
      panel.show();

      let requested: ConfirmModalConfig | null = null;
      panel.setConfirmHandler((config) => { requested = config; });
      const calls: string[] = [];
      panel.setGameConsole((cmd) => { calls.push(cmd); return { success: true, output: '' }; });

      const select = container.querySelector<HTMLSelectElement>('#bs-shady-panel [data-action="mafia-frame-employee"]');
      expect(select).not.toBeNull();
      select!.value = String(employee.id);
      container.querySelector<HTMLButtonElement>('#bs-shady-panel [data-action="mafia-frame-start"]')!.click();
      requested!.onConfirm();
      expect(calls).toEqual([`mafia frame employee:${employee.id}`]);
      panel.dispose();
    });

    it('a ready frame row is addressable by data-frame-id, and completes through data-action', () => {
      const { container, panel } = mount();
      const state = stateWithMafiaUnlocked();
      const a = hireEmployee(state.employees, 'driller', new Random(1)).employee;
      const b = hireEmployee(state.employees, 'driller', new Random(2)).employee;
      state.tickCount = 20;
      state.mafia.pendingFrames = [
        { employeeId: a.id, startTick: 5, readyTick: 30 }, // still pending — no button
        { employeeId: b.id, startTick: 5, readyTick: 15 }, // ready
      ];
      panel.update(state);
      panel.show();

      let requested: ConfirmModalConfig | null = null;
      panel.setConfirmHandler((config) => { requested = config; });
      const calls: string[] = [];
      panel.setGameConsole((cmd) => { calls.push(cmd); return { success: true, output: '' }; });

      expect(container.querySelector(`#bs-shady-panel [data-frame-id="${a.id}"] [data-action="mafia-frame-complete"]`)).toBeNull();
      const useBtn = container.querySelector<HTMLButtonElement>(
        `#bs-shady-panel [data-frame-id="${b.id}"] [data-action="mafia-frame-complete"]`,
      );
      expect(useBtn).not.toBeNull();
      useBtn!.click();
      requested!.onConfirm();
      expect(calls).toEqual([`mafia frame employee:${b.id}`]);
      panel.dispose();
    });
  });

  // The 5 handlers below discard the CommandResult returned by
  // this.gameConsole?.(...) — a refused/failed attempt (e.g. the judge says
  // no) is silent to the player today. These assert the real cmdResult.output
  // lands in #bs-shady-status, matching BuildMenu's setStatus(cmdResult.output) wiring.
  describe('status wiring (#510)', () => {
    it('a successful corrupt attempt surfaces cmdResult.output in the status area', () => {
      const { container, panel } = mount();
      const state = createGame({ seed: 1, mineType: 'desert' });
      panel.update(state);
      panel.show();

      let requested: ConfirmModalConfig | null = null;
      panel.setConfirmHandler((config) => { requested = config; });
      panel.setGameConsole(() => ({ success: true, output: 'Judge takes the bribe. Corruption level rises.' }));

      const btn = container.querySelector<HTMLButtonElement>('#bs-shady-panel [data-target="judge"] [data-action="corrupt"]');
      btn!.click();
      requested!.onConfirm();

      expect(container.querySelector('#bs-shady-status')!.textContent).toBe('Judge takes the bribe. Corruption level rises.');
      panel.dispose();
    });

    it('a failed/refused corrupt attempt also surfaces cmdResult.output in the status area (today silent)', () => {
      const { container, panel } = mount();
      const state = createGame({ seed: 1, mineType: 'desert' });
      panel.update(state);
      panel.show();

      let requested: ConfirmModalConfig | null = null;
      panel.setConfirmHandler((config) => { requested = config; });
      panel.setGameConsole(() => ({ success: false, output: 'The judge refused the bribe.' }));

      const btn = container.querySelector<HTMLButtonElement>('#bs-shady-panel [data-target="judge"] [data-action="corrupt"]');
      btn!.click();
      requested!.onConfirm();

      expect(container.querySelector('#bs-shady-status')!.textContent).toBe('The judge refused the bribe.');
      panel.dispose();
    });

    it('the mafia-smuggle toggle surfaces cmdResult.output in the status area on click', () => {
      const { container, panel } = mount();
      panel.update(stateWithMafiaUnlocked());
      panel.show();
      panel.setGameConsole(() => ({ success: true, output: 'Smuggling operation started.' }));

      const btn = container.querySelector<HTMLButtonElement>('#bs-shady-panel [data-action="mafia-smuggle"]');
      btn!.click();

      expect(container.querySelector('#bs-shady-status')!.textContent).toBe('Smuggling operation started.');
      panel.dispose();
    });

    it('confirming a mafia-accident arrangement surfaces cmdResult.output', () => {
      const { container, panel } = mount();
      const state = stateWithMafiaUnlocked();
      const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
      panel.update(state);
      panel.show();

      let requested: ConfirmModalConfig | null = null;
      panel.setConfirmHandler((config) => { requested = config; });
      panel.setGameConsole(() => ({ success: true, output: 'An unfortunate accident has been arranged.' }));

      const select = container.querySelector<HTMLSelectElement>('#bs-shady-panel [data-action="mafia-accident-employee"]');
      select!.value = String(employee.id);
      const goBtn = container.querySelector<HTMLButtonElement>('#bs-shady-panel [data-action="mafia-accident"]');
      goBtn!.click();
      requested!.onConfirm();

      expect(container.querySelector('#bs-shady-status')!.textContent).toBe('An unfortunate accident has been arranged.');
      panel.dispose();
    });

    it('confirming a mafia-frame start surfaces cmdResult.output', () => {
      const { container, panel } = mount();
      const state = stateWithMafiaUnlocked();
      const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
      panel.update(state);
      panel.show();

      let requested: ConfirmModalConfig | null = null;
      panel.setConfirmHandler((config) => { requested = config; });
      panel.setGameConsole(() => ({ success: true, output: 'Evidence is being planted.' }));

      const select = container.querySelector<HTMLSelectElement>('#bs-shady-panel [data-action="mafia-frame-employee"]');
      select!.value = String(employee.id);
      container.querySelector<HTMLButtonElement>('#bs-shady-panel [data-action="mafia-frame-start"]')!.click();
      requested!.onConfirm();

      expect(container.querySelector('#bs-shady-status')!.textContent).toBe('Evidence is being planted.');
      panel.dispose();
    });

    it('confirming a mafia-frame complete ("use the evidence") surfaces cmdResult.output', () => {
      const { container, panel } = mount();
      const state = stateWithMafiaUnlocked();
      const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
      state.tickCount = 20;
      state.mafia.pendingFrames = [{ employeeId: employee.id, startTick: 5, readyTick: 15 }];
      panel.update(state);
      panel.show();

      let requested: ConfirmModalConfig | null = null;
      panel.setConfirmHandler((config) => { requested = config; });
      panel.setGameConsole(() => ({ success: true, output: 'The frame is complete. The employee is arrested.' }));

      const useBtn = container.querySelector<HTMLButtonElement>(
        `#bs-shady-panel [data-frame-id="${employee.id}"] [data-action="mafia-frame-complete"]`,
      );
      useBtn!.click();
      requested!.onConfirm();

      expect(container.querySelector('#bs-shady-status')!.textContent).toBe('The frame is complete. The employee is arrested.');
      panel.dispose();
    });

    it('setStatus auto-clears after ~3000ms, and a fresher call is not clobbered by a stale timeout', () => {
      vi.useFakeTimers();
      const { container, panel } = mount();
      const statusText = () => container.querySelector('#bs-shady-status')!.textContent;

      panel.setStatus('first message');
      expect(statusText()).toBe('first message');

      vi.advanceTimersByTime(1000);
      panel.setStatus('second message');
      expect(statusText()).toBe('second message');

      // first message's own 3000ms timeout fires here (1000 + 2000 = 3000ms after it
      // was set) — it must recognize the text has moved on and do nothing.
      vi.advanceTimersByTime(2000);
      expect(statusText()).toBe('second message');

      // second message's own timeout, 3000ms after it was set, clears it.
      vi.advanceTimersByTime(1000);
      expect(statusText()).toBe('');

      panel.dispose();
    });
  });

  // Funds-guard parity (issue #511): a control that spends cash must refuse
  // an unaffordable action the same way employee hire / vehicle buy / build
  // already do, on both the console guard and the button's disabled state.
  // These cover the button side; the console side lives in
  // tests/unit/console/insufficient-funds-guards.test.ts.
  describe('affordability guard (#511)', () => {
    // Scoped to `panel.root` rather than `container.querySelector('#bs-shady-panel ...')`:
    // a red-phase assertion failure below skips the trailing `panel.dispose()`,
    // and jsdom resolves id selectors against the whole document rather than
    // the query root (same gotcha BuildMenu.test.ts documents for #462), so a
    // prior test's undisposed panel can shadow this one's #bs-shady-panel.
    // `panel.root` is the exact element, immune to that collision regardless
    // of cleanup order.

    it('disables the corrupt call button when cash is short of the target cost, and re-enables on a cash-only update()', () => {
      const { panel } = mount();
      const state = createGame({ seed: 1, mineType: 'desert' });
      state.cash = TARGET_COSTS.witness - 1;
      panel.update(state);
      panel.show();

      const witnessBtn = panel.root.querySelector<HTMLButtonElement>('[data-target="witness"] [data-action="corrupt"]')!;
      expect(witnessBtn.disabled).toBe(true);

      // Cash-only change: no roster/frame/level/smuggling change, so the
      // signature-gated render() must not need to fire for this to update.
      state.cash = TARGET_COSTS.witness;
      panel.update(state);
      const witnessBtnAfter = panel.root.querySelector<HTMLButtonElement>('[data-target="witness"] [data-action="corrupt"]')!;
      expect(witnessBtnAfter.disabled).toBe(false);
      panel.dispose();
    });

    it('a cheap target stays clickable while an expensive one is disabled at the same balance', () => {
      const { panel } = mount();
      const state = createGame({ seed: 1, mineType: 'desert' });
      state.cash = TARGET_COSTS.judge - 1; // affords every target except judge
      panel.update(state);
      panel.show();

      const judgeBtn = panel.root.querySelector<HTMLButtonElement>('[data-target="judge"] [data-action="corrupt"]')!;
      const witnessBtn = panel.root.querySelector<HTMLButtonElement>('[data-target="witness"] [data-action="corrupt"]')!;
      expect(judgeBtn.disabled).toBe(true);
      expect(witnessBtn.disabled).toBe(false);
      panel.dispose();
    });

    it('disables the accident button when cash is short of the accident cost — distinct from the no-employees disable case', () => {
      const { panel } = mount();
      const state = stateWithMafiaUnlocked();
      hireEmployee(state.employees, 'driller', new Random(1));
      state.cash = ACCIDENT_COST - 1;
      panel.update(state);
      panel.show();

      const goBtn = panel.root.querySelector<HTMLButtonElement>('[data-action="mafia-accident"]')!;
      expect(goBtn.disabled).toBe(true);

      state.cash = ACCIDENT_COST;
      panel.update(state);
      const goBtnAfter = panel.root.querySelector<HTMLButtonElement>('[data-action="mafia-accident"]')!;
      expect(goBtnAfter.disabled).toBe(false);
      panel.dispose();
    });

    it('disables the frame start button when cash is short of the frame cost, and re-enables on a cash-only update()', () => {
      const { panel } = mount();
      const state = stateWithMafiaUnlocked();
      hireEmployee(state.employees, 'driller', new Random(1));
      state.cash = FRAME_COST - 1;
      panel.update(state);
      panel.show();

      const startBtn = panel.root.querySelector<HTMLButtonElement>('[data-action="mafia-frame-start"]')!;
      expect(startBtn.disabled).toBe(true);

      state.cash = FRAME_COST;
      panel.update(state);
      const startBtnAfter = panel.root.querySelector<HTMLButtonElement>('[data-action="mafia-frame-start"]')!;
      expect(startBtnAfter.disabled).toBe(false);
      panel.dispose();
    });

    it('keeps the frame complete button enabled regardless of cash — completing a ready frame is always free', () => {
      const { panel } = mount();
      const state = stateWithMafiaUnlocked();
      const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
      state.tickCount = 20;
      state.mafia.pendingFrames = [{ employeeId: employee.id, startTick: 5, readyTick: 15 }];
      state.cash = 0;
      panel.update(state);
      panel.show();

      const useBtn = panel.root.querySelector<HTMLButtonElement>(
        `[data-frame-id="${employee.id}"] [data-action="mafia-frame-complete"]`,
      )!;
      expect(useBtn.disabled).toBe(false);
      panel.dispose();
    });
  });
});
