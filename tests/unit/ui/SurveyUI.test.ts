// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { SurveyUI } from '../../../src/ui/SurveyUI.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import { SURVEY_COSTS } from '../../../src/core/config/balance.js';
import type { PlacementKit } from '../../../src/ui/scene/PlacementKit.js';
import type { PlacementSelection } from '../../../src/ui/scene/PlacementController.js';

function mount(): { container: HTMLDivElement; ui: SurveyUI } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const ui = new SurveyUI(container);
  ui.show();
  return { container, ui };
}

/**
 * Stand-in placement kit — the real controller drives clicks/drags on the 3D
 * canvas, which jsdom cannot render. Captures the confirm handler the panel
 * registers on arm() so a test can drive it directly, same idea as the old
 * TileSelectOverlay tests' `tileSelect.open = (cfg) => cfg.onConfirm(...)`.
 */
function makeFakeKit(): { kit: PlacementKit; confirm: (sel: PlacementSelection) => void } {
  let confirmHandler: ((sel: PlacementSelection) => void) | null = null;
  const controller = {
    isArmed: false,
    currentPhase: 'idle',
    canConfirm: true,
    selection: null,
    activeRegion: null,
    setConfirmHandler: (cb: (sel: PlacementSelection) => void) => { confirmHandler = cb; },
    setCancelHandler: () => {},
    setChangeHandler: () => {},
    arm: () => {},
  };
  const overlay = { update: () => {}, clear: () => {}, flashConfirm: () => {} };
  const strip = { show: () => {}, hide: () => {} };
  return {
    kit: { controller, overlay, strip } as unknown as PlacementKit,
    confirm: (sel) => confirmHandler?.(sel),
  };
}

function makeSurveyor(overrides?: Partial<Employee>): Employee {
  return {
    id: 1,
    name: 'Kurt Pickaxe',
    role: 'surveyor',
    salary: 500,
    morale: 70,
    unionized: false,
    injured: false,
    alive: true,
    x: 5,
    z: 5,
    qualifications: [{ category: 'geology', proficiencyLevel: 3, xp: 0 }],
    trainingState: null,
    activeActionId: null,
    hunger: 100,
    fatigue: 100,
    breakNeed: 100,
    collapsing: false,
    ...overrides,
  } as unknown as Employee;
}

function makeState(overrides?: { cash?: number; withSurveyor?: boolean }): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.cash = overrides?.cash ?? 50_000;
  s.world = { sizeX: 24, sizeY: 12, sizeZ: 24, gridReady: true };
  if (overrides?.withSurveyor !== false) {
    s.employees.employees = [makeSurveyor()];
  }
  return s;
}

describe('SurveyUI', () => {
  describe('the panel can actually run a survey', () => {
    it('offers every survey method as a selectable row', () => {
      // Regression: the panel used to show only a "Survey Mode" button that
      // fired `survey mode`, which the console rejects — there was no way to
      // pick a method or a target, so a survey could not be performed at all.
      const { container, ui } = mount();
      const methods = container.querySelectorAll('.bs-survey-method');
      expect(methods.length).toBe(3);
      const ids = [...methods].map(m => (m as HTMLElement).dataset['method']);
      expect(ids).toContain('seismic');
      expect(ids).toContain('core_sample');
      expect(ids).toContain('aerial');
      ui.dispose();
      container.remove();
    });

    it('has a run control that reaches the target picker', () => {
      const { container, ui } = mount();
      expect(container.querySelector('#bs-survey-run')).not.toBeNull();
      ui.dispose();
      container.remove();
    });

    it('never emits the `survey mode` the console rejects', () => {
      const { container, ui } = mount();
      const gameConsole = vi.fn().mockReturnValue({ success: true, output: '' });
      ui.setGameConsole(gameConsole);
      ui.update(makeState());

      container.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.click());
      const emitted = gameConsole.mock.calls.map(c => String(c[0]));
      expect(emitted).not.toContain('survey mode');

      ui.dispose();
      container.remove();
    });

    it('selecting a method marks it and reports it back', () => {
      const { container, ui } = mount();
      const row = container.querySelector('[data-method="core_sample"]') as HTMLElement;
      row.click();
      expect(row.classList.contains('selected')).toBe(true);
      expect(ui.getSelectedMethod()).toBe('core_sample');
      ui.dispose();
      container.remove();
    });

    it('emits a valid survey command for the chosen method and target', () => {
      const { container, ui } = mount();
      const gameConsole = vi.fn().mockReturnValue({ success: true, output: 'queued' });
      ui.setGameConsole(gameConsole);
      ui.update(makeState());

      // Drive the placement tool's confirm directly — the real controller
      // reads clicks/drags off the 3D canvas, which jsdom cannot render.
      const { kit, confirm } = makeFakeKit();
      ui.setPlacementKit(kit);

      (container.querySelector('[data-method="seismic"]') as HTMLElement).click();
      (container.querySelector('#bs-survey-run') as HTMLButtonElement).click();
      confirm({ x1: 12, z1: 9, x2: 12, z2: 9 });
      expect(gameConsole).toHaveBeenCalledWith('survey seismic x:12 z:9');

      ui.dispose();
      container.remove();
    });

    it('reports the selection through onMethodSelected', () => {
      const { container, ui } = mount();
      ui.setGameConsole(vi.fn().mockReturnValue({ success: true, output: '' }));
      const seen: unknown[] = [];
      ui.onMethodSelected(sel => seen.push(sel));

      const { kit, confirm } = makeFakeKit();
      ui.setPlacementKit(kit);
      (container.querySelector('#bs-survey-run') as HTMLButtonElement).click();
      confirm({ x1: 3, z1: 4, x2: 3, z2: 4 });

      expect(seen).toEqual([{ method: 'seismic', targetX: 3, targetZ: 4 }]);
      ui.dispose();
      container.remove();
    });
  });

  describe('requirements are explained rather than silently blocking', () => {
    it('disables the run control and says why when no surveyor is hired', () => {
      const { container, ui } = mount();
      ui.update(makeState({ withSurveyor: false }));

      const runBtn = container.querySelector('#bs-survey-run') as HTMLButtonElement;
      expect(runBtn.disabled).toBe(true);
      expect(container.querySelector('.bs-survey-status')?.textContent).toContain('surveyor');

      ui.dispose();
      container.remove();
    });

    it('disables the run control and names the cost when cash is short', () => {
      const { container, ui } = mount();
      ui.update(makeState({ cash: 10 }));

      const runBtn = container.querySelector('#bs-survey-run') as HTMLButtonElement;
      expect(runBtn.disabled).toBe(true);
      expect(container.querySelector('.bs-survey-status')?.textContent)
        .toContain(String(SURVEY_COSTS.seismic));

      ui.dispose();
      container.remove();
    });

    it('enables the run control once a surveyor is hired and cash covers it', () => {
      const { container, ui } = mount();
      ui.update(makeState());

      const runBtn = container.querySelector('#bs-survey-run') as HTMLButtonElement;
      expect(runBtn.disabled).toBe(false);

      ui.dispose();
      container.remove();
    });
  });

  describe('results readout', () => {
    it('says so when nothing has been surveyed yet', () => {
      const { container, ui } = mount();
      ui.update(makeState());
      expect(container.querySelector('#bs-survey-results')?.textContent).toBeTruthy();
      ui.dispose();
      container.remove();
    });

    it('lists a finished survey with its confidence and richest ore', () => {
      const { container, ui } = mount();
      const state = makeState();
      state.surveyResults = [{
        id: 1,
        method: 'seismic',
        centerX: 12,
        centerZ: 12,
        completedTick: 9,
        surveyorId: 1,
        confidence: 0.85,
        estimates: { '12,12': { craktonite: 0.4 }, '13,12': { craktonite: 0.65 } },
      }];
      ui.update(state);

      const text = container.querySelector('#bs-survey-results')?.textContent ?? '';
      expect(text).toContain('85%');
      expect(text).toContain('65%');

      ui.dispose();
      container.remove();
    });

    it('shows in-progress count while a survey is queued', () => {
      const { container, ui } = mount();
      const state = makeState();
      state.pendingActions = [{
        id: 1, type: 'survey', requiredSkill: 'geology', requiredVehicleRole: null,
        targetX: 12, targetZ: 12, targetY: 0, payload: {}, targetEmployeeId: null,
      }] as unknown as GameState['pendingActions'];
      ui.update(state);

      expect(container.querySelector('.bs-survey-status')?.textContent).toContain('1');

      ui.dispose();
      container.remove();
    });
  });
});
