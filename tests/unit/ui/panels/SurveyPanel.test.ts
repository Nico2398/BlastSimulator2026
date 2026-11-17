// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SurveyPanel } from '../../../../src/ui/panels/SurveyPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import type { Employee } from '../../../../src/core/entities/Employee.js';
import { SURVEY_DEPTH_BELOW_SURFACE } from '../../../../src/core/config/balance.js';
import type { SurveyResult } from '../../../../src/core/mining/SurveyCalc.js';
import { SURVEY_COVERAGE_RADIUS, SURVEY_COSTS } from '../../../../src/core/config/balance.js';
import { t } from '../../../../src/core/i18n/I18n.js';
import type { PlacementKit } from '../../../../src/ui/scene/PlacementKit.js';
import type { NotifyInput } from '../../../../src/ui/notify/NotificationCenter.js';
import { createGradeState } from '../../../../src/core/economy/MineGrade.js';

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

  it('renders all five methods with real cost and accuracy', () => {
    const { panel } = makePanel();
    panel.update(makeState({ employees: { employees: [makeSurveyor()], nextId: 2 } as GameState['employees'] }));
    const text = panel.root.textContent!;
    expect(text).toContain('$3,000'); // seismic
    expect(text).toContain('$800'); // core_sample
    expect(text).toContain('$1,500'); // aerial
    expect(text).toContain(`$${SURVEY_COSTS.prospection.toLocaleString('en-US')}`); // prospection
    expect(text).toContain(`$${SURVEY_COSTS.meteorite_detector.toLocaleString('en-US')}`); // meteorite detector
    expect(panel.root.querySelectorAll('[data-method]').length).toBe(5);
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
        estimates: { '21,21': { sparkium: 0.6, rustite: 0.3 } },
        depthProfile: { '21,21': [
          { fromM: 5, toM: 10, ores: { sparkium: 0.4 } },
          { fromM: 10, toM: 15, ores: { sparkium: 0.6, rustite: 0.3 } },
        ] },
      })] }));
      const text = cardAt(panel, '(21, 21)');
      expect(text).toContain('5-15 m'); // sparkium: first band start to last band end
      expect(text).toContain('10-15 m'); // rustite
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

    it('a sparse patch (ore in ~10% of the disc) reads ~10% of area, not 100%', () => {
      const estimates: Record<string, Record<string, number>> = {};
      for (const key of Object.keys(discEstimates())) {
        const [x, z] = key.split(',').map(Number) as [number, number];
        if ((x * 7 + z * 3) % 10 === 0) estimates[key] = { rustite: 0.4 };
      }
      const { text } = renderCard({ estimates });
      const m = /(\d+)% of area/.exec(text);
      expect(m, 'a "N% of area" line').not.toBeNull();
      expect(Number(m![1])).toBeGreaterThanOrEqual(5);
      expect(Number(m![1])).toBeLessThanOrEqual(15);
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
      const { text } = renderCard({});
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
      .find(b => !['overlay-toggle', 'wall-overlay-toggle'].includes(b.getAttribute('data-role') ?? ''))!;
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

// ── Method click arms the target pick; blocked state is loud (#1771) ────────

function makeKit() {
  const controller = {
    isArmed: false,
    currentPhase: 'armed',
    selection: { x1: 20, z1: 20, x2: 20, z2: 20 },
    canConfirm: true,
    refusalReason: null,
    footprintInvalid: false,
    refusedTile: null,
    setConfirmHandler: vi.fn(),
    setChangeHandler: vi.fn(),
    cancel: vi.fn(() => { controller.isArmed = false; }),
    arm: vi.fn(() => { controller.isArmed = true; }),
  };
  const overlay = { update: vi.fn(), clear: vi.fn(), flashConfirm: vi.fn() };
  const strip = { show: vi.fn(), hide: vi.fn() };
  return { kit: { controller, overlay, strip } as unknown as PlacementKit, controller, overlay, strip };
}

function surveyorState(cash?: number): GameState {
  const state = makeState({ employees: { employees: [makeSurveyor()], nextId: 2 } as GameState['employees'] });
  if (cash !== undefined) state.cash = cash;
  return state;
}

function noSurveyorState(): GameState {
  return makeState({ employees: { employees: [], nextId: 1, ticksSincePayday: 0 } as GameState['employees'] });
}

function method(panel: SurveyPanel, m: string): HTMLElement {
  return panel.root.querySelector<HTMLElement>(`[data-method="${m}"]`)!;
}

function lastStripSubtitle(strip: { show: ReturnType<typeof vi.fn> }): string {
  const calls = strip.show.mock.calls;
  return (calls[calls.length - 1]![0] as { subtitle: string }).subtitle;
}

describe('SurveyPanel — method click arms the target pick (#1771)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const c of liveContainers) c.remove();
    liveContainers.length = 0;
  });

  it('constructing, updating and showing the panel never arms the pick', () => {
    const { panel } = makePanel();
    const { kit, controller } = makeKit();
    panel.setPlacementKit(kit);
    panel.show();
    panel.update(surveyorState());
    panel.update(surveyorState());
    expect(controller.arm).not.toHaveBeenCalled();
  });

  it('clicking a method with a geology surveyor arms the point pick with that method\'s subtitle', () => {
    const { panel } = makePanel();
    const { kit, controller, strip } = makeKit();
    panel.setPlacementKit(kit);
    panel.update(surveyorState());
    method(panel, 'core_sample').click();
    expect(controller.arm).toHaveBeenCalledTimes(1);
    expect(controller.arm).toHaveBeenCalledWith(expect.objectContaining({ shape: 'point' }));
    expect(lastStripSubtitle(strip)).toBe(t('survey.core_sample'));
  });

  it('the marker radius is the clicked method\'s coverage radius', () => {
    const { panel } = makePanel();
    const { kit, overlay } = makeKit();
    panel.setPlacementKit(kit);
    panel.update(surveyorState());
    method(panel, 'seismic').click();
    const upd = overlay.update.mock.calls.at(-1)![0] as { radius?: number; tone?: string };
    expect(upd.radius).toBe(SURVEY_COVERAGE_RADIUS.seismic);
    expect(upd.tone).toBe('survey');
  });

  it('a core sample marker carries no radius (point only)', () => {
    const { panel } = makePanel();
    const { kit, overlay } = makeKit();
    panel.setPlacementKit(kit);
    panel.update(surveyorState());
    method(panel, 'core_sample').click();
    const upd = overlay.update.mock.calls.at(-1)![0] as { radius?: number };
    expect(upd.radius).toBeUndefined();
  });

  it('clicking another method while armed re-arms for the new method', () => {
    const { panel } = makePanel();
    const { kit, controller, strip } = makeKit();
    panel.setPlacementKit(kit);
    panel.update(surveyorState());
    method(panel, 'core_sample').click();
    method(panel, 'aerial').click();
    expect(controller.arm).toHaveBeenCalledTimes(2);
    expect(controller.isArmed).toBe(true);
    expect(lastStripSubtitle(strip)).toBe(t('survey.aerial'));
    expect(method(panel, 'aerial').classList.contains('selected')).toBe(true);
  });

  it('the confirm handler dispatches the survey of the latest clicked method', () => {
    const { panel } = makePanel();
    const { kit, controller } = makeKit();
    const gameConsole = vi.fn(() => ({ success: true, output: 'ok' }));
    panel.setGameConsole(gameConsole as never);
    panel.setPlacementKit(kit);
    panel.update(surveyorState());
    method(panel, 'core_sample').click();
    method(panel, 'aerial').click();
    const confirm = controller.setConfirmHandler.mock.calls.at(-1)![0] as (s: unknown) => void;
    confirm({ x1: 7, z1: 9, x2: 7, z2: 9 });
    expect(gameConsole).toHaveBeenCalledWith('survey aerial x:7 z:9');
  });

  it('a method click with no placement kit does not throw', () => {
    const { panel } = makePanel();
    panel.update(surveyorState());
    expect(() => method(panel, 'seismic').click()).not.toThrow();
  });

  it('a method click with no kit while blocked does not throw either', () => {
    const { panel } = makePanel();
    panel.update(noSurveyorState());
    expect(() => method(panel, 'seismic').click()).not.toThrow();
  });

  it('keeps the load-bearing selectors', () => {
    const { panel } = makePanel();
    panel.update(surveyorState());
    expect(panel.root.querySelector('#bs-survey-run')).not.toBeNull();
    expect(panel.root.querySelector('.bs-survey-status')).not.toBeNull();
    expect(panel.root.querySelectorAll('[data-method]').length).toBe(5);
  });

  it('Pick Target in Scene while already armed leaves the pick armed (no toggle-cancel)', () => {
    const { panel } = makePanel();
    const { kit, controller } = makeKit();
    panel.setPlacementKit(kit);
    panel.update(surveyorState());
    method(panel, 'seismic').click();
    expect(controller.isArmed).toBe(true);
    panel.root.querySelector<HTMLButtonElement>('#bs-survey-run')!.click();
    expect(controller.isArmed).toBe(true);
  });

  it('Pick Target in Scene still arms the pick when idle', () => {
    const { panel } = makePanel();
    const { kit, controller } = makeKit();
    panel.setPlacementKit(kit);
    panel.update(surveyorState());
    panel.root.querySelector<HTMLButtonElement>('#bs-survey-run')!.click();
    expect(controller.arm).toHaveBeenCalledTimes(1);
  });
});

describe('SurveyPanel — no surveyor blocker (#1771)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const c of liveContainers) c.remove();
    liveContainers.length = 0;
  });

  function visible(node: Element | null): boolean {
    return !!node && (node as HTMLElement).style.display !== 'none' && !(node as HTMLElement).hidden;
  }

  it('shows a prominent blocker with the reason and a hire button', () => {
    const { panel } = makePanel();
    panel.update(noSurveyorState());
    const blocker = panel.root.querySelector('.bs-survey-blocker');
    expect(visible(blocker)).toBe(true);
    expect(blocker!.textContent).toContain(t('ui.survey.no_surveyor'));
    expect(blocker!.querySelector('#bs-survey-hire')).not.toBeNull();
  });

  it('the hire button calls the hire handler exactly once per click', () => {
    const { panel } = makePanel();
    const hire = vi.fn();
    panel.setHireSurveyorHandler(hire);
    panel.update(noSurveyorState());
    panel.root.querySelector<HTMLElement>('#bs-survey-hire')!.click();
    expect(hire).toHaveBeenCalledTimes(1);
  });

  it('the hire button without a handler does not throw', () => {
    const { panel } = makePanel();
    panel.update(noSurveyorState());
    expect(() => panel.root.querySelector<HTMLElement>('#bs-survey-hire')!.click()).not.toThrow();
  });

  it('a method click does not arm and notifies once with a warn carrying the reason', () => {
    const { panel } = makePanel();
    const { kit, controller } = makeKit();
    const notify = vi.fn<[NotifyInput], void>();
    panel.setPlacementKit(kit);
    panel.setNotifyHandler(notify);
    panel.update(noSurveyorState());
    method(panel, 'seismic').click();
    expect(controller.arm).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    const n = notify.mock.calls[0]![0];
    expect(n.severity).toBe('warn');
    expect(`${n.title} ${n.body}`).toContain(t('ui.survey.no_surveyor'));
  });

  it('a method click without a notify handler does not throw', () => {
    const { panel } = makePanel();
    panel.update(noSurveyorState());
    expect(() => method(panel, 'aerial').click()).not.toThrow();
  });

  it('a surveyor with a non-geology qualification is still blocked', () => {
    const { panel } = makePanel();
    const emp = makeEmployee({ qualifications: [{ category: 'drilling', proficiencyLevel: 1, xp: 0 }] as unknown as Employee['qualifications'] });
    panel.update(makeState({ employees: { employees: [emp], nextId: 2 } as GameState['employees'] }));
    expect(visible(panel.root.querySelector('.bs-survey-blocker'))).toBe(true);
  });

  it('the blocker is hidden or absent with a geology employee', () => {
    const { panel } = makePanel();
    panel.update(surveyorState());
    expect(visible(panel.root.querySelector('.bs-survey-blocker'))).toBe(false);
  });

  it('the blocker disappears once a surveyor appears on a later update', () => {
    const { panel } = makePanel();
    panel.update(noSurveyorState());
    expect(visible(panel.root.querySelector('.bs-survey-blocker'))).toBe(true);
    panel.update(surveyorState());
    expect(visible(panel.root.querySelector('.bs-survey-blocker'))).toBe(false);
  });

  it('Pick Target in Scene is disabled while blocked and the status line still states why', () => {
    const { panel } = makePanel();
    panel.update(noSurveyorState());
    expect(panel.root.querySelector<HTMLButtonElement>('#bs-survey-run')!.disabled).toBe(true);
    expect(panel.root.querySelector('.bs-survey-status')!.textContent).toContain('surveyor');
  });

  it('opening the panel while blocked does not notify', () => {
    const { panel } = makePanel();
    const notify = vi.fn();
    panel.setNotifyHandler(notify);
    panel.show();
    panel.update(noSurveyorState());
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('SurveyPanel — unaffordable method click (#1771)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const c of liveContainers) c.remove();
    liveContainers.length = 0;
  });

  it('does not arm and notifies with the funds reason', () => {
    const { panel } = makePanel();
    const { kit, controller } = makeKit();
    const notify = vi.fn<[NotifyInput], void>();
    panel.setPlacementKit(kit);
    panel.setNotifyHandler(notify);
    panel.update(surveyorState(0));
    method(panel, 'seismic').click();
    expect(controller.arm).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    const n = notify.mock.calls[0]![0];
    expect(n.severity).toBe('warn');
    expect(`${n.title} ${n.body}`).toContain('Not enough cash');
  });

  it('shows no surveyor blocker for a funds shortage', () => {
    const { panel } = makePanel();
    panel.update(surveyorState(0));
    const blocker = panel.root.querySelector<HTMLElement>('.bs-survey-blocker');
    expect(blocker === null || blocker.style.display === 'none' || blocker.hidden).toBe(true);
  });
});

// ── Survey results filter bar (#2162) ───────────────────────────────────────

describe('SurveyPanel — results filter bar (#2162)', () => {
  afterEach(() => {
    for (const c of liveContainers) c.remove();
    liveContainers.length = 0;
  });

  /**
   * 1 core_sample sparkium, 2 seismic rustite+sparkium, 3 aerial rustite,
   * 4 core_sample dirtite (sparkium at zero), 5 seismic barren.
   */
  function fixture(): SurveyResult[] {
    return [
      makeSurveyResult({ id: 1, method: 'core_sample', centerX: 1, centerZ: 1, estimates: { '1,1': { sparkium: 0.5 } } }),
      makeSurveyResult({ id: 2, method: 'seismic', centerX: 2, centerZ: 2, estimates: { '2,2': { rustite: 0.3, sparkium: 0.4 } } }),
      makeSurveyResult({ id: 3, method: 'aerial', centerX: 3, centerZ: 3, estimates: { '3,3': { rustite: 0.2 } } }),
      makeSurveyResult({ id: 4, method: 'core_sample', centerX: 4, centerZ: 4, estimates: { '4,4': { dirtite: 0.1, sparkium: 0 } } }),
      makeSurveyResult({ id: 5, method: 'seismic', centerX: 5, centerZ: 5, estimates: {} }),
    ];
  }

  function setup(results: SurveyResult[] = fixture()): { panel: SurveyPanel; state: GameState } {
    const { panel } = makePanel();
    const state = makeState({ surveyResults: results });
    panel.update(state);
    return { panel, state };
  }

  const bar = (panel: SurveyPanel): HTMLElement => panel.root.querySelector<HTMLElement>('.bs-filter-bar')!;
  const click = (panel: SurveyPanel, selector: string): void => (bar(panel).querySelector(selector) as HTMLButtonElement).click();
  const oreBtn = (ore: string): string => `.bs-filter-row:not([data-filter-group]) [data-filter-value="${ore}"]`;
  const methodBtn = (method: string): string => `[data-filter-group="method"] [data-filter-value="${method}"]`;
  const shown = (panel: SurveyPanel): number[] =>
    [...panel.root.querySelectorAll<HTMLElement>('[data-survey-id]')].map(c => Number(c.dataset['surveyId']));

  it('shows the shared filter bar with the results', () => {
    const { panel } = setup();
    expect(panel.root.querySelectorAll('.bs-filter-bar')).toHaveLength(1);
  });

  it('offers the ores found with density above zero, each once', () => {
    const { panel } = setup();
    const ores = [...bar(panel).querySelectorAll<HTMLElement>('.bs-filter-row:not([data-filter-group]) [data-filter-value]')]
      .map(b => b.dataset['filterValue']).sort();
    expect(ores).toEqual(['dirtite', 'rustite', 'sparkium']);
    expect(bar(panel).querySelector('[data-filter-all]')).not.toBeNull();
  });

  it('offers the three survey methods', () => {
    const { panel } = setup();
    const methods = [...bar(panel).querySelectorAll<HTMLElement>('[data-filter-group="method"] [data-filter-value]')]
      .map(b => b.dataset['filterValue']).sort();
    expect(methods).toEqual(['aerial', 'core_sample', 'seismic']);
  });

  it('labels the bar with the localized survey keys, never raw keys', () => {
    const { panel } = setup();
    const text = bar(panel).textContent ?? '';
    for (const key of ['ui.survey.filter_ore', 'ui.survey.filter_method']) {
      expect(t(key)).not.toBe(key);
      expect(text).toContain(t(key));
    }
    expect(text).not.toContain('ui.survey.filter_');
  });

  it('lists the 4 newest results first with nothing selected', () => {
    const { panel } = setup();
    expect(shown(panel)).toEqual([5, 4, 3, 2]);
  });

  it('an ore filter lists the results estimating that ore, newest first', () => {
    const { panel } = setup();
    click(panel, oreBtn('sparkium'));
    expect(shown(panel)).toEqual([2, 1]);
    click(panel, oreBtn('rustite'));
    expect(shown(panel)).toEqual([3, 2]);
  });

  it('a result with the ore at zero density does not match', () => {
    const { panel } = setup();
    click(panel, oreBtn('sparkium'));
    expect(shown(panel)).not.toContain(4);
  });

  it('a method filter lists only that method', () => {
    const { panel } = setup();
    click(panel, methodBtn('seismic'));
    expect(shown(panel)).toEqual([5, 2]);
    click(panel, methodBtn('core_sample'));
    expect(shown(panel)).toEqual([4, 1]);
  });

  it('ore and method combine (AND)', () => {
    const { panel } = setup();
    click(panel, oreBtn('sparkium'));
    click(panel, methodBtn('seismic'));
    expect(shown(panel)).toEqual([2]);
  });

  it('the filter applies before the 4-newest cap', () => {
    const results = [
      makeSurveyResult({ id: 1, centerX: 1, centerZ: 1, estimates: { '1,1': { sparkium: 0.5 } } }),
      ...[2, 3, 4, 5, 6].map(id => makeSurveyResult({ id, centerX: id, centerZ: id, estimates: { [`${id},${id}`]: { rustite: 0.3 } } })),
    ];
    const { panel } = setup(results);
    expect(shown(panel)).toEqual([6, 5, 4, 3]);
    click(panel, oreBtn('sparkium'));
    expect(shown(panel)).toEqual([1]);
  });

  it('a filter matching more than 4 results still lists only the 4 newest', () => {
    const results = [1, 2, 3, 4, 5, 6].map(id => makeSurveyResult({ id, centerX: id, centerZ: id, estimates: { [`${id},${id}`]: { rustite: 0.3 } } }));
    const { panel } = setup(results);
    click(panel, oreBtn('rustite'));
    expect(shown(panel)).toEqual([6, 5, 4, 3]);
  });

  it('clicking the pressed choice again removes the filter', () => {
    const { panel } = setup();
    click(panel, methodBtn('aerial'));
    expect(shown(panel)).toEqual([3]);
    click(panel, methodBtn('aerial'));
    expect(shown(panel)).toEqual([5, 4, 3, 2]);
  });

  it('the All button and Clear filter restore the unfiltered list', () => {
    const { panel } = setup();
    click(panel, oreBtn('dirtite'));
    click(panel, '[data-filter-all]');
    expect(shown(panel)).toEqual([5, 4, 3, 2]);
    click(panel, methodBtn('seismic'));
    click(panel, '.bs-filter-clear');
    expect(shown(panel)).toEqual([5, 4, 3, 2]);
    expect(bar(panel).querySelector('.bs-filter-clear')).toBeNull();
  });

  it('marks the pressed choices', () => {
    const { panel } = setup();
    click(panel, oreBtn('rustite'));
    expect(bar(panel).querySelector(oreBtn('rustite'))!.getAttribute('aria-pressed')).toBe('true');
    expect(bar(panel).querySelector(oreBtn('dirtite'))!.getAttribute('aria-pressed')).not.toBe('true');
  });

  describe('no match', () => {
    function noMatch(): SurveyPanel {
      const { panel } = setup();
      click(panel, oreBtn('rustite'));
      click(panel, methodBtn('core_sample'));
      return panel;
    }

    it('shows the no-match line instead of cards', () => {
      const panel = noMatch();
      expect(shown(panel)).toEqual([]);
      const line = t('ui.survey.filter_no_match');
      expect(line).not.toBe('ui.survey.filter_no_match');
      expect(panel.root.textContent).toContain(line);
      expect(panel.root.textContent).not.toContain(t('ui.survey.results_none'));
    });

    it('keeps the bar so the filter can be changed', () => {
      const panel = noMatch();
      expect(panel.root.querySelectorAll('.bs-filter-bar')).toHaveLength(1);
      click(panel, methodBtn('core_sample'));
      expect(shown(panel)).toEqual([3, 2]);
      expect(panel.root.textContent).not.toContain(t('ui.survey.filter_no_match'));
    });

    it('no surveys at all keeps the no-surveys line, not the no-match one', () => {
      const { panel } = setup([]);
      expect(panel.root.textContent).toContain(t('ui.survey.results_none'));
      expect(panel.root.textContent).not.toContain(t('ui.survey.filter_no_match'));
    });
  });

  describe('selection survives re-renders', () => {
    it('re-renders at once on a click, without waiting for the next update', () => {
      const { panel } = setup();
      click(panel, methodBtn('aerial'));
      expect(shown(panel)).toEqual([3]);
    });

    it('keeps the filter when a new survey completes and lists it if it matches', () => {
      const { panel, state } = setup();
      click(panel, oreBtn('sparkium'));
      state.surveyResults.push(
        makeSurveyResult({ id: 6, method: 'aerial', centerX: 6, centerZ: 6, estimates: { '6,6': { sparkium: 0.2 } } }),
        makeSurveyResult({ id: 7, method: 'aerial', centerX: 7, centerZ: 7, estimates: { '7,7': { dirtite: 0.2 } } }),
      );
      panel.update(state);
      expect(shown(panel)).toEqual([6, 2, 1]);
      expect(bar(panel).querySelector(oreBtn('sparkium'))!.getAttribute('aria-pressed')).toBe('true');
    });

    it('offers an ore that is found later', () => {
      const { panel, state } = setup();
      expect(bar(panel).querySelector(oreBtn('glimmerite'))).toBeNull();
      state.surveyResults.push(makeSurveyResult({ id: 6, centerX: 6, centerZ: 6, estimates: { '6,6': { glimmerite: 0.2 } } }));
      panel.update(state);
      expect(bar(panel).querySelector(oreBtn('glimmerite'))).not.toBeNull();
    });
  });
});

// ── Method cards gated by mine grade (#2279) ────────────────────────────────

function gradedState(grade: number | undefined, cash?: number): GameState {
  const state = surveyorState(cash);
  if (grade !== undefined) state.grade = { ...createGradeState(), grade };
  return state;
}

describe('SurveyPanel — grade-gated method cards (#2279)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const c of liveContainers) c.remove();
    liveContainers.length = 0;
  });

  it('at grade 0 the core sample card is locked and disabled for assistive tech', () => {
    const { panel } = makePanel();
    panel.update(gradedState(0));
    const card = method(panel, 'core_sample');
    expect(card.getAttribute('data-locked')).toBe('true');
    expect(card.getAttribute('aria-disabled')).toBe('true');
  });

  it('at grade 0 the locked card states what opens it', () => {
    const { panel } = makePanel();
    panel.update(gradedState(0));
    const text = method(panel, 'core_sample').textContent!;
    expect(text).toContain('opens at G1');
    expect(text).toContain('Depth');
  });

  it('at grade 0 aerial and seismic stay open and carry no lock text', () => {
    const { panel } = makePanel();
    panel.update(gradedState(0));
    for (const m of ['aerial', 'seismic']) {
      const card = method(panel, m);
      expect(card.getAttribute('data-locked')).not.toBe('true');
      expect(card.getAttribute('aria-disabled')).not.toBe('true');
      expect(card.textContent).not.toContain('opens at');
    }
  });

  it('clicking the locked card does not select it', () => {
    const { panel } = makePanel();
    panel.update(gradedState(0));
    method(panel, 'core_sample').click();
    expect(method(panel, 'core_sample').classList.contains('selected')).toBe(false);
  });

  it('clicking the locked card does not arm the target pick or send a survey', () => {
    const { panel } = makePanel();
    const { kit, controller } = makeKit();
    const gameConsole = vi.fn(() => ({ success: true, output: 'ok' }));
    panel.setGameConsole(gameConsole as never);
    panel.setPlacementKit(kit);
    panel.update(gradedState(0));
    method(panel, 'core_sample').click();
    expect(controller.arm).not.toHaveBeenCalled();
    expect(gameConsole).not.toHaveBeenCalled();
  });

  it('clicking the locked card leaves the previously selected method selected', () => {
    const { panel } = makePanel();
    panel.update(gradedState(0));
    method(panel, 'aerial').click();
    method(panel, 'core_sample').click();
    expect(method(panel, 'aerial').classList.contains('selected')).toBe(true);
    expect(method(panel, 'core_sample').classList.contains('selected')).toBe(false);
  });

  it('an open card at grade 0 still arms the pick when clicked', () => {
    const { panel } = makePanel();
    const { kit, controller } = makeKit();
    panel.setPlacementKit(kit);
    panel.update(gradedState(0));
    method(panel, 'seismic').click();
    expect(controller.arm).toHaveBeenCalledTimes(1);
  });

  it('at grade 1 the core sample card is enabled and selectable', () => {
    const { panel } = makePanel();
    const { kit, controller } = makeKit();
    panel.setPlacementKit(kit);
    panel.update(gradedState(1));
    const card = method(panel, 'core_sample');
    expect(card.getAttribute('data-locked')).not.toBe('true');
    expect(card.getAttribute('aria-disabled')).not.toBe('true');
    expect(card.textContent).not.toContain('opens at');
    card.click();
    expect(controller.arm).toHaveBeenCalledTimes(1);
    expect(method(panel, 'core_sample').classList.contains('selected')).toBe(true);
  });

  it('a site with no grade locks nothing', () => {
    const { panel } = makePanel();
    panel.update(gradedState(undefined));
    for (const m of ['aerial', 'seismic', 'core_sample']) {
      expect(method(panel, m).getAttribute('data-locked')).not.toBe('true');
      expect(method(panel, m).getAttribute('aria-disabled')).not.toBe('true');
    }
  });

  it('the lock follows the grade across updates of the same panel', () => {
    const { panel } = makePanel();
    panel.update(gradedState(0));
    expect(method(panel, 'core_sample').getAttribute('data-locked')).toBe('true');
    panel.update(gradedState(1));
    expect(method(panel, 'core_sample').getAttribute('data-locked')).not.toBe('true');
    expect(method(panel, 'core_sample').textContent).not.toContain('opens at');
  });

  it('a locked card is still one of the five method cards', () => {
    const { panel } = makePanel();
    panel.update(gradedState(0));
    expect(panel.root.querySelectorAll('[data-method]').length).toBe(5);
  });

  describe('depth shown per card follows the grade', () => {
    it('grade 0: aerial 2 m, seismic 8 m', () => {
      const { panel } = makePanel();
      panel.update(gradedState(0));
      expect(method(panel, 'aerial').textContent).toContain('2 m deep');
      expect(method(panel, 'seismic').textContent).toContain('8 m deep');
      expect(method(panel, 'seismic').textContent).not.toContain('25 m deep');
    });

    it('grade 1: aerial 2 m, seismic 25 m, core sample 40 m', () => {
      const { panel } = makePanel();
      panel.update(gradedState(1));
      expect(method(panel, 'aerial').textContent).toContain('2 m deep');
      expect(method(panel, 'seismic').textContent).toContain('25 m deep');
      expect(method(panel, 'core_sample').textContent).toContain('40 m deep');
    });

    it('no grade: full depths on every card', () => {
      const { panel } = makePanel();
      panel.update(gradedState(undefined));
      expect(method(panel, 'aerial').textContent).toContain('2 m deep');
      expect(method(panel, 'seismic').textContent).toContain('25 m deep');
      expect(method(panel, 'core_sample').textContent).toContain('40 m deep');
    });

    it('the seismic depth grows when the grade does, on the same panel', () => {
      const { panel } = makePanel();
      panel.update(gradedState(0));
      expect(method(panel, 'seismic').textContent).toContain('8 m deep');
      panel.update(gradedState(1));
      expect(method(panel, 'seismic').textContent).toContain('25 m deep');
    });
  });
});

// ── Long-range prospection card, run and result (#2286) ─────────────────────

describe('SurveyPanel — prospection (#2286)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { __cameraFocus?: unknown }).__cameraFocus;
    for (const c of liveContainers) c.remove();
    liveContainers.length = 0;
  });

  const runBtn = (panel: SurveyPanel): HTMLButtonElement => panel.root.querySelector<HTMLButtonElement>('#bs-survey-run')!;

  describe('method card', () => {
    it('exists as a method card with its cost', () => {
      const { panel } = makePanel();
      panel.update(gradedState(2));
      const card = method(panel, 'prospection');
      expect(card).not.toBeNull();
      expect(card.textContent).toContain(`$${SURVEY_COSTS.prospection.toLocaleString('en-US')}`);
    });

    it.each([0, 1])('is locked below G2 (grade %i) and says G2 opens it', (grade) => {
      const { panel } = makePanel();
      panel.update(gradedState(grade));
      const card = method(panel, 'prospection');
      expect(card.getAttribute('data-locked')).toBe('true');
      expect(card.getAttribute('aria-disabled')).toBe('true');
      expect(card.querySelector('.bs-survey-method-lock')!.textContent).toContain('G2');
    });

    it('is open at G2, with no lock text', () => {
      const { panel } = makePanel();
      panel.update(gradedState(2));
      const card = method(panel, 'prospection');
      expect(card.getAttribute('data-locked')).not.toBe('true');
      expect(card.getAttribute('aria-disabled')).not.toBe('true');
      expect(card.querySelector('.bs-survey-method-lock')).toBeNull();
    });

    it('is open on a site with no grade', () => {
      const { panel } = makePanel();
      panel.update(gradedState(undefined));
      expect(method(panel, 'prospection').getAttribute('data-locked')).not.toBe('true');
    });

    it('opens when the grade rises on the same panel', () => {
      const { panel } = makePanel();
      panel.update(gradedState(1));
      expect(method(panel, 'prospection').getAttribute('data-locked')).toBe('true');
      panel.update(gradedState(2));
      expect(method(panel, 'prospection').getAttribute('data-locked')).not.toBe('true');
    });

    it('clicking it at G2 selects it', () => {
      const { panel } = makePanel();
      panel.update(gradedState(2));
      method(panel, 'prospection').click();
      expect(method(panel, 'prospection').classList.contains('selected')).toBe(true);
    });

    it('clicking it below G2 does not select it, run it or arm a pick', () => {
      const { panel } = makePanel();
      const { kit, controller } = makeKit();
      const gameConsole = vi.fn(() => ({ success: true, output: 'ok' }));
      panel.setGameConsole(gameConsole as never);
      panel.setPlacementKit(kit);
      panel.update(gradedState(1));
      method(panel, 'prospection').click();
      expect(method(panel, 'prospection').classList.contains('selected')).toBe(false);
      expect(controller.arm).not.toHaveBeenCalled();
      expect(gameConsole).not.toHaveBeenCalled();
    });
  });

  describe('running it', () => {
    it('runs "survey prospection" straight through the game console, with no kit and no point pick', () => {
      const { panel } = makePanel();
      const gameConsole = vi.fn(() => ({ success: true, output: 'ok' }));
      panel.setGameConsole(gameConsole as never);
      panel.update(gradedState(2));
      method(panel, 'prospection').click();
      runBtn(panel).click();
      expect(gameConsole).toHaveBeenCalledTimes(1);
      expect(gameConsole).toHaveBeenCalledWith('survey prospection');
    });

    it('with a placement kit present, still arms no pick and still runs the command', () => {
      const { panel } = makePanel();
      const { kit, controller } = makeKit();
      const gameConsole = vi.fn(() => ({ success: true, output: 'ok' }));
      panel.setGameConsole(gameConsole as never);
      panel.setPlacementKit(kit);
      panel.update(gradedState(2));
      method(panel, 'prospection').click();
      runBtn(panel).click();
      expect(controller.arm).not.toHaveBeenCalled();
      expect(gameConsole).toHaveBeenCalledWith('survey prospection');
    });

    it('selecting another method afterwards puts the pick back', () => {
      const { panel } = makePanel();
      const { kit, controller } = makeKit();
      panel.setGameConsole(vi.fn(() => ({ success: true, output: 'ok' })) as never);
      panel.setPlacementKit(kit);
      panel.update(gradedState(2));
      method(panel, 'prospection').click();
      method(panel, 'aerial').click();
      expect(controller.arm).toHaveBeenCalledTimes(1);
      runBtn(panel).click();
      expect(controller.arm).toHaveBeenCalledTimes(1);
    });

    it('the Run button is disabled with no surveyor', () => {
      const { panel } = makePanel();
      const state = noSurveyorState();
      state.grade = { ...createGradeState(), grade: 2 };
      panel.update(state);
      method(panel, 'prospection').click();
      expect(runBtn(panel).disabled).toBe(true);
    });

    it('the Run button is disabled when prospection is unaffordable', () => {
      const { panel } = makePanel();
      panel.update(gradedState(2, SURVEY_COSTS.prospection - 1));
      method(panel, 'prospection').click();
      expect(runBtn(panel).disabled).toBe(true);
    });

    it('the Run button is enabled with a surveyor and the cash', () => {
      const { panel } = makePanel();
      panel.update(gradedState(2, SURVEY_COSTS.prospection));
      method(panel, 'prospection').click();
      expect(runBtn(panel).disabled).toBe(false);
    });
  });

  describe('result card', () => {
    const ISLANDS = [
      { x: 301, z: 62, radius: 16, oreId: 'craktonite' },
      { x: -247, z: 71, radius: 24, oreId: 'absurdium' },
      { x: 18, z: -283, radius: 8, oreId: 'craktonite' },
    ];
    const prospectionResult = (islands = ISLANDS): SurveyResult => makeSurveyResult({
      id: 9, method: 'prospection', centerX: 32, centerZ: 32, estimates: {}, islands, confidence: 0.8,
    });
    const cardOf = (panel: SurveyPanel): HTMLElement => panel.root.querySelector<HTMLElement>('[data-survey-id="9"]')!;
    const rowsOf = (panel: SurveyPanel): HTMLElement[] => [...cardOf(panel).querySelectorAll<HTMLElement>('[data-island]')];

    function panelWith(results: SurveyResult[]): SurveyPanel {
      const { panel } = makePanel();
      panel.update(makeState({ surveyResults: results }));
      return panel;
    }

    it('lists one row per island', () => {
      expect(rowsOf(panelWith([prospectionResult()]))).toHaveLength(ISLANDS.length);
    });

    it('each row shows the ore name and the coordinates', () => {
      const rows = rowsOf(panelWith([prospectionResult()]));
      ISLANDS.forEach((island, i) => {
        const text = rows[i]!.textContent!;
        expect(text).toContain(t(`ore.${island.oreId}.name`));
        expect(text).toContain(String(island.x));
        expect(text).toContain(String(island.z));
      });
    });

    it('shows no ore bars and no "no ore" message', () => {
      const card = cardOf(panelWith([prospectionResult()]));
      expect(card.querySelector('.bsx-progress')).toBeNull();
      expect(card.textContent).not.toContain(t('ui.survey.no_ore'));
    });

    it('still shows the method and the confidence', () => {
      const text = cardOf(panelWith([prospectionResult()])).textContent!;
      expect(text).toContain(t('survey.prospection'));
      expect(text).toContain('80%');
    });

    it('a result with no island has a card and no island row', () => {
      const panel = panelWith([prospectionResult([])]);
      expect(cardOf(panel)).not.toBeNull();
      expect(rowsOf(panel)).toHaveLength(0);
    });

    it('other methods have no island rows', () => {
      const { panel } = makePanel();
      panel.update(makeState({ surveyResults: [makeSurveyResult()] }));
      expect(panel.root.querySelectorAll('[data-island]')).toHaveLength(0);
    });

    it('clicking a row focuses the camera on that island', () => {
      const focus = vi.fn();
      (window as unknown as { __cameraFocus: typeof focus }).__cameraFocus = focus;
      const rows = rowsOf(panelWith([prospectionResult()]));
      rows[1]!.click();
      expect(focus).toHaveBeenCalledTimes(1);
      expect(focus.mock.calls[0]![0]).toBe(ISLANDS[1]!.x);
      expect(focus.mock.calls[0]![1]).toBe(ISLANDS[1]!.z);
    });

    it('each row focuses its own island', () => {
      const focus = vi.fn();
      (window as unknown as { __cameraFocus: typeof focus }).__cameraFocus = focus;
      const rows = rowsOf(panelWith([prospectionResult()]));
      for (const row of rows) row.click();
      expect(focus.mock.calls.map(c => [c[0], c[1]])).toEqual(ISLANDS.map(i => [i.x, i.z]));
    });
  });
});

// ── Meteorite detector card, run and readings (#2291) ───────────────────────

describe('SurveyPanel — meteorite detector (#2291)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const c of liveContainers) c.remove();
    liveContainers.length = 0;
  });

  const DEG = Math.PI / 180;
  const runBtn = (panel: SurveyPanel): HTMLButtonElement => panel.root.querySelector<HTMLButtonElement>('#bs-survey-run')!;

  describe('method card', () => {
    it('is listed right after prospection', () => {
      const { panel } = makePanel();
      panel.update(gradedState(3));
      const order = [...panel.root.querySelectorAll('[data-method]')].map(e => e.getAttribute('data-method'));
      expect(order.indexOf('meteorite_detector')).toBe(order.indexOf('prospection') + 1);
    });

    it('shows its name, its cost and its note', () => {
      const { panel } = makePanel();
      panel.update(gradedState(3));
      const card = method(panel, 'meteorite_detector');
      expect(card.textContent).toContain(t('survey.meteorite_detector'));
      expect(card.textContent).toContain(`$${SURVEY_COSTS.meteorite_detector.toLocaleString('en-US')}`);
      expect(card.textContent).toContain(t('ui.survey.note_meteorite_detector'));
    });

    it.each([0, 1, 2])('is locked below G3 (grade %i) and says G3 opens it', (grade) => {
      const { panel } = makePanel();
      panel.update(gradedState(grade));
      const card = method(panel, 'meteorite_detector');
      expect(card.getAttribute('data-locked')).toBe('true');
      expect(card.getAttribute('aria-disabled')).toBe('true');
      expect(card.querySelector('.bs-survey-method-lock')!.textContent).toContain('G3');
    });

    it('is open at G3, with no lock text', () => {
      const { panel } = makePanel();
      panel.update(gradedState(3));
      const card = method(panel, 'meteorite_detector');
      expect(card.getAttribute('data-locked')).not.toBe('true');
      expect(card.getAttribute('aria-disabled')).not.toBe('true');
      expect(card.querySelector('.bs-survey-method-lock')).toBeNull();
    });

    it('is open on a site with no grade', () => {
      const { panel } = makePanel();
      panel.update(gradedState(undefined));
      expect(method(panel, 'meteorite_detector').getAttribute('data-locked')).not.toBe('true');
    });

    it('opens when the grade rises on the same panel', () => {
      const { panel } = makePanel();
      panel.update(gradedState(2));
      expect(method(panel, 'meteorite_detector').getAttribute('data-locked')).toBe('true');
      panel.update(gradedState(3));
      expect(method(panel, 'meteorite_detector').getAttribute('data-locked')).not.toBe('true');
    });

    it('clicking it at G3 selects it', () => {
      const { panel } = makePanel();
      panel.update(gradedState(3));
      method(panel, 'meteorite_detector').click();
      expect(method(panel, 'meteorite_detector').classList.contains('selected')).toBe(true);
    });

    it('clicking it at G2 does not select it, run it or arm a pick', () => {
      const { panel } = makePanel();
      const { kit, controller } = makeKit();
      const gameConsole = vi.fn(() => ({ success: true, output: 'ok' }));
      panel.setGameConsole(gameConsole as never);
      panel.setPlacementKit(kit);
      panel.update(gradedState(2));
      method(panel, 'meteorite_detector').click();
      expect(method(panel, 'meteorite_detector').classList.contains('selected')).toBe(false);
      expect(controller.arm).not.toHaveBeenCalled();
      expect(gameConsole).not.toHaveBeenCalled();
    });
  });

  describe('running it', () => {
    it('selecting it arms the point pick: a reading is taken at a point', () => {
      const { panel } = makePanel();
      const { kit, controller } = makeKit();
      panel.setGameConsole(vi.fn(() => ({ success: true, output: 'ok' })) as never);
      panel.setPlacementKit(kit);
      panel.update(gradedState(3));
      method(panel, 'meteorite_detector').click();
      expect(controller.arm).toHaveBeenCalledTimes(1);
    });

    it('confirming the picked point queues the survey at that point through the game console', () => {
      const { panel } = makePanel();
      const { kit, controller } = makeKit();
      const gameConsole = vi.fn(() => ({ success: true, output: 'ok' }));
      panel.setGameConsole(gameConsole as never);
      panel.setPlacementKit(kit);
      panel.update(gradedState(3));
      method(panel, 'meteorite_detector').click();
      const confirm = controller.setConfirmHandler.mock.calls.at(-1)![0] as (s: unknown) => void;
      confirm({ x1: 140, z1: 10, x2: 140, z2: 10 });
      expect(gameConsole).toHaveBeenCalledTimes(1);
      expect(gameConsole).toHaveBeenCalledWith('survey meteorite_detector x:140 z:10');
    });

    it('the Run button re-arms the pick for the detector, never running a pickless command', () => {
      const { panel } = makePanel();
      const { kit, controller } = makeKit();
      const gameConsole = vi.fn(() => ({ success: true, output: 'ok' }));
      panel.setGameConsole(gameConsole as never);
      panel.setPlacementKit(kit);
      panel.update(gradedState(3));
      method(panel, 'meteorite_detector').click();
      controller.isArmed = false;
      runBtn(panel).click();
      expect(controller.arm).toHaveBeenCalledTimes(2);
      expect(gameConsole).not.toHaveBeenCalled();
    });

    it('the Run button is disabled with no surveyor', () => {
      const { panel } = makePanel();
      const state = noSurveyorState();
      state.grade = { ...createGradeState(), grade: 3 };
      panel.update(state);
      method(panel, 'meteorite_detector').click();
      expect(runBtn(panel).disabled).toBe(true);
    });

    it('the Run button is disabled when the detector is unaffordable', () => {
      const { panel } = makePanel();
      panel.update(gradedState(3, SURVEY_COSTS.meteorite_detector - 1));
      method(panel, 'meteorite_detector').click();
      expect(runBtn(panel).disabled).toBe(true);
    });

    it('the Run button is enabled with a surveyor and the cash', () => {
      const { panel } = makePanel();
      panel.update(gradedState(3, SURVEY_COSTS.meteorite_detector));
      method(panel, 'meteorite_detector').click();
      expect(runBtn(panel).disabled).toBe(false);
    });
  });

  describe('result card', () => {
    const READING = { bearing: 30 * DEG, halfAngle: 12 * DEG, minDistance: 410, maxDistance: 560 };
    const detectorResult = (id: number, reading?: typeof READING): SurveyResult => makeSurveyResult({
      id, method: 'meteorite_detector', centerX: 40, centerZ: 30, estimates: {}, confidence: 0.8,
      ...(reading ? { reading } : {}),
    });
    const cardOf = (panel: SurveyPanel, id: number): HTMLElement => panel.root.querySelector<HTMLElement>(`[data-survey-id="${id}"]`)!;
    const rowsOf = (panel: SurveyPanel): HTMLElement[] => [...panel.root.querySelectorAll<HTMLElement>('[data-reading]')];

    function panelWith(results: SurveyResult[]): SurveyPanel {
      const { panel } = makePanel();
      panel.update(makeState({ surveyResults: results }));
      return panel;
    }

    it('lists one reading row for a result with a reading', () => {
      expect(rowsOf(panelWith([detectorResult(9, READING)]))).toHaveLength(1);
    });

    it('the row shows the bearing in degrees with its error, and the distance band', () => {
      const text = rowsOf(panelWith([detectorResult(9, READING)]))[0]!.textContent!;
      expect(text).toContain('30');
      expect(text).toContain('12');
      expect(text).toContain('410');
      expect(text).toContain('560');
      expect(text).not.toMatch(/0\.5\d*\s*rad/);
    });

    it('lists one row per reading across results, in their own cards', () => {
      const panel = panelWith([detectorResult(9, READING), detectorResult(10, { ...READING, bearing: 100 * DEG, minDistance: 250, maxDistance: 400 })]);
      expect(rowsOf(panel)).toHaveLength(2);
      expect(cardOf(panel, 9).querySelectorAll('[data-reading]')).toHaveLength(1);
      expect(cardOf(panel, 10).querySelectorAll('[data-reading]')).toHaveLength(1);
      expect(cardOf(panel, 10).textContent).toContain('250');
      expect(cardOf(panel, 10).textContent).toContain('400');
    });

    it('still shows the method name and the confidence', () => {
      const text = cardOf(panelWith([detectorResult(9, READING)]), 9).textContent!;
      expect(text).toContain(t('survey.meteorite_detector'));
      expect(text).toContain('80%');
    });

    it('shows no ore bars and no "no ore" message', () => {
      const card = cardOf(panelWith([detectorResult(9, READING)]), 9);
      expect(card.querySelector('.bsx-progress')).toBeNull();
      expect(card.textContent).not.toContain(t('ui.survey.no_ore'));
    });

    it('a result with no crater has a card with a nothing-detected line and no reading row', () => {
      const panel = panelWith([detectorResult(9)]);
      expect(cardOf(panel, 9)).not.toBeNull();
      expect(rowsOf(panel)).toHaveLength(0);
      expect(cardOf(panel, 9).textContent).toMatch(/nothing detected/i);
    });

    it('a result with a reading has no nothing-detected line', () => {
      expect(cardOf(panelWith([detectorResult(9, READING)]), 9).textContent).not.toMatch(/nothing detected/i);
    });

    it('other methods have no reading rows', () => {
      const { panel } = makePanel();
      panel.update(makeState({ surveyResults: [makeSurveyResult()] }));
      expect(panel.root.querySelectorAll('[data-reading]')).toHaveLength(0);
    });

    it('the row text follows the locale', () => {
      const row = rowsOf(panelWith([detectorResult(9, READING)]))[0]!;
      expect(row.textContent!.trim().length).toBeGreaterThan(0);
      expect(row.textContent).not.toMatch(/ui\.survey\./);
    });
  });
});
