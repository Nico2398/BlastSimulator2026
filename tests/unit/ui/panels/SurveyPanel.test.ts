// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SurveyPanel } from '../../../../src/ui/panels/SurveyPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import type { Employee } from '../../../../src/core/entities/Employee.js';
import { SURVEY_DEPTH_BELOW_SURFACE } from '../../../../src/core/config/balance.js';
import type { SurveyResult } from '../../../../src/core/mining/SurveyCalc.js';

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 1, name: 'Marguerite Pell', role: 'surveyor', salary: 400, morale: 60,
    unionized: false, injured: false, alive: true, x: 0, z: 0,
    qualifications: [], trainingState: null, activeActionId: null,
    fatigue: 100, collapsing: false,
    interruptedActionPayload: null, ticksWorked: 0,
    restTicksRemaining: null, restNeedKey: null, taskTicksRemaining: null,
    activeTaskSkill: null, destinationX: null, destinationZ: null,
    moveConsecutiveFailures: 0, isMoveStuck: false,
    pendingRestDuration: null, pendingRestNeedKey: null,
    pendingTaskDuration: null, pendingActionType: null,
    pendingActionPayload: null, pendingDriverVehicleId: null,
    taskQueue: [],
    locomotion: { kind: 'on_foot' },
    itinerary: null,
    vehicleWaitingTicks: 0,
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

  it('#1676: each method row shows its reach in metres, taken from SURVEY_DEPTH_BELOW_SURFACE', () => {
    const { panel } = makePanel();
    panel.update(makeState());
    for (const method of ['aerial', 'seismic', 'core_sample'] as const) {
      const card = panel.root.querySelector(`[data-method="${method}"]`)!;
      expect(card.textContent).toContain(`${SURVEY_DEPTH_BELOW_SURFACE[method]} m deep`);
    }
    expect(panel.root.querySelector('[data-method="aerial"]')!.textContent).toContain('2 m deep');
    expect(panel.root.querySelector('[data-method="seismic"]')!.textContent).toContain('25 m deep');
    expect(panel.root.querySelector('[data-method="core_sample"]')!.textContent).toContain('40 m deep');
  });

  it('#1676: no method row says "full depth" or "surface only"', () => {
    const { panel } = makePanel();
    panel.update(makeState());
    for (const method of ['aerial', 'seismic', 'core_sample'] as const) {
      const text = panel.root.querySelector(`[data-method="${method}"]`)!.textContent!;
      expect(text).not.toContain('full depth');
      expect(text).not.toContain('surface only');
    }
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
    panel.update(makeState({ employees: { employees: [], nextId: 1, ticksSincePayday: 0 } as GameState['employees'] }));
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

  it('flags a survey carrying the stale flag as stale, and an unflagged one as not (#1356)', () => {
    const { panel: stalePanel } = makePanel();
    const staleState = makeState({ tickCount: 5, surveyResults: [makeSurveyResult({ completedTick: 0, stale: true })] });
    stalePanel.update(staleState);
    expect(stalePanel.root.textContent).toContain('Stale');

    const { panel: freshPanel } = makePanel();
    const freshState = makeState({ tickCount: 5, surveyResults: [makeSurveyResult({ completedTick: 0 })] });
    freshPanel.update(freshState);
    expect(freshPanel.root.textContent).not.toContain('Stale');
  });

  it('an old survey with no blast stays fresh however many ticks passed (#1356)', () => {
    const { panel } = makePanel();
    const state = makeState({ tickCount: 1_000_000, surveyResults: [makeSurveyResult({ completedTick: 0 })] });
    panel.update(state);
    expect(panel.root.textContent).not.toContain('Stale');
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

  describe('depth-resolved result cards (#1683)', () => {
    function cardAt(panel: SurveyPanel, coords: string): string {
      const card = [...panel.root.querySelectorAll('.bsx-card')].find(c => c.textContent?.includes(coords));
      expect(card).toBeDefined();
      return card!.textContent!;
    }

    it('shows the depth range of each reported ore on a seismic card', () => {
      const { panel } = makePanel();
      panel.update(makeState({ surveyResults: [makeSurveyResult({
        centerX: 21, centerZ: 21,
        estimates: { '21,21': { sparkium: 0.6, grumpite: 0.3 } },
        depthProfile: { '21,21': [
          { fromM: 5, toM: 10, ores: { sparkium: 0.4 } },
          { fromM: 10, toM: 15, ores: { sparkium: 0.6, grumpite: 0.3 } },
        ] },
      })] }));
      const text = cardAt(panel, '(21, 21)');
      expect(text).toContain('5-15 m'); // sparkium: first band start to last band end
      expect(text).toContain('10-15 m'); // grumpite
    });

    it('aerial card says the ore is at the surface', () => {
      const { panel } = makePanel();
      panel.update(makeState({ surveyResults: [makeSurveyResult({ method: 'aerial', centerX: 22, centerZ: 22, estimates: { '22,22': { sparkium: 0.6 } } })] }));
      const text = cardAt(panel, '(22, 22)');
      expect(text).toContain('surface');
      expect(text).not.toMatch(/\d+-\d+ m/);
    });

    it('core sample card shows the depth log heading and its bands', () => {
      const { panel } = makePanel();
      panel.update(makeState({ surveyResults: [makeSurveyResult({
        method: 'core_sample', centerX: 23, centerZ: 23,
        estimates: { '23,23': { sparkium: 0.5 } },
        depthProfile: { '23,23': [
          { fromM: 10, toM: 11, ores: { sparkium: 0.5 } },
          { fromM: 11, toM: 12, ores: { sparkium: 0.5 } },
        ] },
      })] }));
      const text = cardAt(panel, '(23, 23)');
      expect(text).toContain('Depth log');
      expect(text).toContain('10-11 m');
      expect(text).toContain('11-12 m');
    });

    it('a legacy result with no depthProfile renders without a depth line', () => {
      const { panel } = makePanel();
      panel.update(makeState({ surveyResults: [makeSurveyResult({ method: 'core_sample', centerX: 25, centerZ: 25, estimates: { '25,25': { sparkium: 0.5 } } })] }));
      const text = cardAt(panel, '(25, 25)');
      expect(text).toContain('50%');
      expect(text).not.toContain('Depth log');
      expect(text).not.toMatch(/\d+-\d+ m/);
    });
  });

  describe('ore area summary on the result card (#1684)', () => {
    /**
     * Seismic disc (radius 20) around (32,32): dirtite 0.15 in every column,
     * 1.0 in the centre one, and every 10th column carries rustite only, so
     * dirtite covers ~90% of the area and "100% of area" never appears.
     */
    function discEstimates(): Record<string, Record<string, number>> {
      const estimates: Record<string, Record<string, number>> = {};
      let i = 0;
      for (let x = 12; x <= 52; x++) {
        for (let z = 12; z <= 52; z++) {
          if (Math.hypot(x - 32, z - 32) > 20) continue;
          i++;
          estimates[`${x},${z}`] = i % 10 === 0 ? { rustite: 0.3 } : { dirtite: 0.15 };
        }
      }
      estimates['32,32'] = { dirtite: 1.0 };
      return estimates;
    }

    function renderCard(overrides: Partial<SurveyResult> = {}): { text: string; card: Element } {
      const { panel } = makePanel();
      panel.update(makeState({ surveyResults: [makeSurveyResult({
        centerX: 32, centerZ: 32, confidence: 0.85, estimates: discEstimates(), ...overrides,
      })] }));
      const card = [...panel.root.querySelectorAll('.bsx-card')].find(c => c.textContent?.includes('(32, 32)'))!;
      expect(card).toBeDefined();
      return { text: card.textContent!, card };
    }

    it('shows a typical grade near the common value, not the peak', () => {
      const { text } = renderCard();
      const m = /Typical grade (\d+)%/.exec(text);
      expect(m, 'a "Typical grade N%" line').not.toBeNull();
      expect(Math.abs(Number(m![1]) - 15)).toBeLessThanOrEqual(2);
    });

    it('shows coverage as a share of the area', () => {
      const { text } = renderCard();
      const m = /(\d+)% of area/.exec(text);
      expect(m, 'a "N% of area" line').not.toBeNull();
      expect(Number(m![1])).toBeGreaterThanOrEqual(80);
      expect(Number(m![1])).toBeLessThan(100);
    });

    it('labels the 1.0 estimate as a peak', () => {
      const { text } = renderCard();
      expect(text).toContain('Peak grade 100%');
    });

    it('never shows an unlabelled 100%', () => {
      const { text } = renderCard();
      const bare = [...text.matchAll(/100%/g)].filter(m => !text.slice(0, m.index).endsWith('Peak grade '));
      expect(bare).toHaveLength(0);
    });

    it('draws each ore bar at its typical grade, not its peak', () => {
      const { card } = renderCard();
      const widths = [...card.querySelectorAll<HTMLElement>('.bsx-progress-fill')].map(f => parseFloat(f.style.width));
      expect(widths.some(w => Math.abs(w - 15) <= 2)).toBe(true);
      expect(widths.some(w => w >= 99)).toBe(false);
    });

    it('shows tonnes, value and the estimates note', () => {
      const { text } = renderCard();
      expect(text).toMatch(/~[^,]+ t, ~\$/);
      expect(text).toContain('Estimates only');
    });

    it('lists ores by estimated value, richer-priced ore first', () => {
      // Rustite ($8/kg) outweighs dirtite ($2/kg) even though dirtite covers more ground.
      const { text } = renderCard({
        estimates: { '32,32': { dirtite: 0.2, rustite: 0.2 } },
        method: 'core_sample',
      });
      expect(text.indexOf('Rustite')).toBeGreaterThanOrEqual(0);
      expect(text.indexOf('Rustite')).toBeLessThan(text.indexOf('Dirtite'));
    });

    it('a survey without depthProfile still renders the summary', () => {
      const { text } = renderCard({ depthProfile: undefined });
      expect(text).toContain('Typical grade');
      expect(text).not.toContain('Depth log');
    });

    it('a core sample card reports its single column as full coverage', () => {
      const { text } = renderCard({ method: 'core_sample', estimates: { '32,32': { rustite: 0.2 } } });
      expect(text).toContain('100% of area');
      expect(text).toContain('Typical grade 20%');
    });

    it('empty estimates still show "No ore detected" and no summary lines', () => {
      const { text } = renderCard({ estimates: {} });
      expect(text).toContain('No ore detected');
      expect(text).not.toContain('Typical grade');
      expect(text).not.toContain('Estimates only');
    });
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
    // The header's first button is now the overlay-visibility toggle (#496)
    // — skip it and click the first button that isn't it.
    const closeBtn = [...panel.root.querySelectorAll('button')]
      .find(b => b.getAttribute('data-role') !== 'overlay-toggle')!;
    closeBtn.click();
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

// ── Survey confidence overlay toggle (#496) ─────────────────────────────────
//
// The header's overlay-visibility toggle button drives GameRenderer's
// player-facing preference via setOverlayToggleHandler/setOverlayVisible.
// Bug: the click handler is currently a no-op, so the button exists but does
// nothing — neither firing the registered callback nor reflecting an
// externally-set (e.g. keyboard-shortcut-driven) visibility state.
describe('SurveyPanel — overlay visibility toggle (#496)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const c of liveContainers) c.remove();
    liveContainers.length = 0;
  });

  it('renders the overlay-toggle button in the header', () => {
    const { panel } = makePanel();
    panel.update(makeState());
    const btn = panel.root.querySelector<HTMLButtonElement>('[data-role="overlay-toggle"]');
    expect(btn).not.toBeNull();
    expect(btn!.tagName).toBe('BUTTON');
  });

  it('clicking the toggle button calls the registered handler with false, then true, starting from the default-visible state', () => {
    const { panel } = makePanel();
    panel.update(makeState());
    const cb = vi.fn();
    panel.setOverlayToggleHandler(cb);
    const btn = panel.root.querySelector<HTMLButtonElement>('[data-role="overlay-toggle"]')!;

    btn.click();
    expect(cb).toHaveBeenNthCalledWith(1, false);

    btn.click();
    expect(cb).toHaveBeenNthCalledWith(2, true);
  });

  it('setOverlayVisible(false) called externally updates the button state without invoking the toggle handler', () => {
    const { panel } = makePanel();
    panel.update(makeState());
    const cb = vi.fn();
    panel.setOverlayToggleHandler(cb);
    const btn = panel.root.querySelector<HTMLButtonElement>('[data-role="overlay-toggle"]')!;
    const beforeHtml = btn.outerHTML;

    panel.setOverlayVisible(false);

    expect(cb).not.toHaveBeenCalled();
    expect(btn.outerHTML).not.toBe(beforeHtml);
  });

  it('update(state) with changed surveyResults does not reset the toggle back to visible', () => {
    const { panel } = makePanel();
    panel.update(makeState());
    panel.setOverlayVisible(false);
    const cb = vi.fn();
    panel.setOverlayToggleHandler(cb);

    panel.update(makeState({ surveyResults: [makeSurveyResult()] }));

    const btn = panel.root.querySelector<HTMLButtonElement>('[data-role="overlay-toggle"]')!;
    btn.click();
    // If update() silently reset the toggle's tracked visibility to true, this
    // click would report `false` (turning an already-visible overlay off)
    // instead of `true` (turning the still-hidden overlay back on).
    expect(cb).toHaveBeenCalledWith(true);
  });
});
