// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { ShadyPanel } from '../../../../src/ui/panels/ShadyPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import { hireEmployee } from '../../../../src/core/entities/Employee.js';
import { Random } from '../../../../src/core/math/Random.js';
import { t, setLocale } from '../../../../src/core/i18n/I18n.js';
import type { ConfirmModalConfig } from '../../../../src/ui/panels/ConfirmModal.js';

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
  afterEach(() => { setLocale('en'); });

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
});
