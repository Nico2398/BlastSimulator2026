// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SurveyPanel } from '../../../../src/ui/panels/SurveyPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import type { Employee } from '../../../../src/core/entities/Employee.js';
import type { SurveyResult } from '../../../../src/core/mining/SurveyCalc.js';
import { SURVEY_STALE_TICKS } from '../../../../src/core/config/balance.js';

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 1, name: 'Marguerite Pell', role: 'surveyor', salary: 400, morale: 60,
    unionized: false, injured: false, alive: true, x: 0, z: 0,
    qualifications: [], trainingState: null, activeActionId: null,
    hunger: 100, fatigue: 100, breakNeed: 100, collapsing: false,
    interruptedActionPayload: null, ticksWorked: 0,
    restTicksRemaining: null, restNeedKey: null, taskTicksRemaining: null,
    activeTaskSkill: null, destinationX: null, destinationZ: null,
    moveConsecutiveFailures: 0, isMoveStuck: false,
    pendingRestDuration: null, pendingRestNeedKey: null,
    pendingTaskDuration: null, pendingActionType: null,
    pendingActionPayload: null, pendingDriverVehicleId: null,
    ...overrides,
  };
}

function makeSurveyor(): Employee {
  return makeEmployee({ qualifications: [{ category: 'geology', proficiencyLevel: 1, xp: 0 }] });
}

function makeSurveyResult(overrides: Partial<SurveyResult> = {}): SurveyResult {
  return {
    id: 1, method: 'seismic', centerX: 20, centerZ: 20, completedTick: 0,
    surveyorId: 1, estimates: { '20,20': { sparkium: 0.6 } }, confidence: 0.85,
    ...overrides,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  const state = createGame({ seed: 1, mineType: 'desert' });
  Object.assign(state, overrides);
  return state;
}

const liveContainers: HTMLElement[] = [];

function makePanel(): { panel: SurveyPanel; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  liveContainers.push(container);
  const panel = new SurveyPanel(container);
  return { panel, container };
}

describe('SurveyPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Every panel hard-codes the same legacy ids (#bs-survey-run etc.) for
    // tutorial/probe compatibility — leaving prior tests' panels attached
    // makes those ids non-unique in the document, which jsdom's ID-selector
    // fast path resolves unreliably even for a properly scoped querySelector.
    for (const c of liveContainers) c.remove();
    liveContainers.length = 0;
  });

  it('renders all three methods with real cost and accuracy', () => {
    const { panel } = makePanel();
    panel.update(makeState({ employees: { employees: [makeSurveyor()], nextId: 2 } as GameState['employees'] }));
    const text = panel.root.textContent!;
    expect(text).toContain('$3,000'); // seismic
    expect(text).toContain('$800'); // core_sample
    expect(text).toContain('$1,500'); // aerial
    expect(panel.root.querySelectorAll('[data-method]').length).toBe(3);
  });

  it('core_sample shows point-only radius, not a cell count', () => {
    const { panel } = makePanel();
    panel.update(makeState());
    const coreSampleCard = panel.root.querySelector('[data-method="core_sample"]')!;
    expect(coreSampleCard.textContent).toContain('point only');
  });

  it('seismic note states the real damage radius and HP', () => {
    const { panel } = makePanel();
    panel.update(makeState());
    const seismicCard = panel.root.querySelector('[data-method="seismic"]')!;
    expect(seismicCard.textContent).toContain('5 cells');
    expect(seismicCard.textContent).toContain('10 HP');
  });

  it('clicking a method card selects it', () => {
    const { panel } = makePanel();
    panel.update(makeState());
    const aerialCard = panel.root.querySelector<HTMLElement>('[data-method="aerial"]')!;
    aerialCard.click();
    expect(panel.root.querySelector('[data-method="aerial"]')!.classList.contains('selected')).toBe(true);
  });

  it('Run button is disabled with no geology-qualified surveyor', () => {
    const { panel } = makePanel();
    panel.update(makeState({ employees: { employees: [], nextId: 1 } as GameState['employees'] }));
    const runBtn = panel.root.querySelector<HTMLButtonElement>('#bs-survey-run')!;
    expect(runBtn.disabled).toBe(true);
    expect(panel.root.querySelector('.bs-survey-status')!.textContent).toContain('surveyor');
  });

  it('Run button is disabled when the selected method is unaffordable', () => {
    const { panel } = makePanel();
    const state = makeState({ employees: { employees: [makeSurveyor()], nextId: 2 } as GameState['employees'] });
    state.cash = 0;
    panel.update(state);
    const runBtn = panel.root.querySelector<HTMLButtonElement>('#bs-survey-run')!;
    expect(runBtn.disabled).toBe(true);
    expect(panel.root.querySelector('.bs-survey-status')!.textContent).toContain('Not enough cash');
  });

  it('Run button enables once a surveyor is hired and the method is affordable', () => {
    const { panel } = makePanel();
    const state = makeState({ employees: { employees: [makeSurveyor()], nextId: 2 } as GameState['employees'] });
    panel.update(state);
    expect(panel.root.querySelector<HTMLButtonElement>('#bs-survey-run')!.disabled).toBe(false);
  });

  it('shows an empty state with no survey results', () => {
    const { panel } = makePanel();
    panel.update(makeState());
    expect(panel.root.textContent).toContain('No surveys yet');
  });

  it('renders a real result with method, coordinates, and confidence', () => {
    const { panel } = makePanel();
    const state = makeState({ surveyResults: [makeSurveyResult({ centerX: 23, centerZ: 23, confidence: 0.85 })] });
    panel.update(state);
    const text = panel.root.textContent!;
    expect(text).toContain('(23, 23)');
    expect(text).toContain('85% confidence');
  });

  it('shows ore bars ranked by richest density first', () => {
    const { panel } = makePanel();
    const state = makeState({
      surveyResults: [makeSurveyResult({ estimates: { '20,20': { rustite: 0.3, sparkium: 0.7 } } })],
    });
    panel.update(state);
    const text = panel.root.textContent!;
    expect(text).toContain('Sparkium');
    expect(text).toContain('Rustite');
    expect(text.indexOf('Sparkium')).toBeLessThan(text.indexOf('Rustite'));
  });

  it('flags a survey older than SURVEY_STALE_TICKS as stale, and a fresh one as not', () => {
    const { panel: stalePanel } = makePanel();
    const staleState = makeState({ tickCount: SURVEY_STALE_TICKS + 1, surveyResults: [makeSurveyResult({ completedTick: 0 })] });
    stalePanel.update(staleState);
    expect(stalePanel.root.textContent).toContain('Stale');

    const { panel: freshPanel } = makePanel();
    const freshState = makeState({ tickCount: 5, surveyResults: [makeSurveyResult({ completedTick: 0 })] });
    freshPanel.update(freshState);
    expect(freshPanel.root.textContent).not.toContain('Stale');
  });

  it('locate button calls window.__cameraFocus with the real survey coordinates', () => {
    const focusSpy = vi.fn();
    window.__cameraFocus = focusSpy;
    const { panel } = makePanel();
    panel.update(makeState({ surveyResults: [makeSurveyResult({ centerX: 31, centerZ: 9 })] }));

    // The result card is the only .bsx-card once results render; its locate
    // button is the only icon-only button inside it (no text span).
    const resultCard = panel.root.querySelector('.bsx-card')!;
    const locateBtn = [...resultCard.querySelectorAll('button')].find(b => b.querySelector('bs-icon'))!;
    locateBtn.click();

    expect(focusSpy).toHaveBeenCalledWith(31, 9, 15);
  });

  it('shows "No ore detected" for a barren survey', () => {
    const { panel } = makePanel();
    panel.update(makeState({ surveyResults: [makeSurveyResult({ estimates: {} })] }));
    expect(panel.root.textContent).toContain('No ore detected');
  });

  it('only shows the most recent 4 results, newest first', () => {
    const { panel } = makePanel();
    const results = [1, 2, 3, 4, 5].map(id => makeSurveyResult({ id, centerX: id, centerZ: id }));
    panel.update(makeState({ surveyResults: results }));
    const coordTexts = [...panel.root.querySelectorAll('.bsx-card')].map(c => c.textContent).filter(t => t?.includes('('));
    expect(coordTexts.length).toBe(4);
    expect(coordTexts[0]).toContain('(5, 5)');
    expect(coordTexts[3]).toContain('(2, 2)');
  });

  it('refreshLocale() re-renders the title and method cards without throwing', () => {
    const { panel } = makePanel();
    panel.update(makeState());
    expect(() => panel.refreshLocale()).not.toThrow();
    expect(panel.root.textContent).toContain('Survey');
  });

  it('close button dispatches the close handler', () => {
    const { panel } = makePanel();
    let closed = false;
    panel.setCloseHandler(() => { closed = true; });
    panel.update(makeState());
    panel.root.querySelector('button')!.click();
    expect(closed).toBe(true);
  });

  it('show/hide toggle visibility', () => {
    const { panel } = makePanel();
    expect(panel.visible).toBe(false);
    panel.show();
    expect(panel.visible).toBe(true);
    panel.hide();
    expect(panel.visible).toBe(false);
  });

  it('dispose() removes the panel from the DOM', () => {
    const { panel, container } = makePanel();
    panel.dispose();
    expect(container.contains(panel.root)).toBe(false);
  });
});
