// @vitest-environment jsdom
// BlastSimulator2026 — Tutorial rails, stateful half

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TutorialRails } from '../../../src/ui/tutorialRails.js';
import { ALLOWED_CLASS, HIGHLIGHT_CLASS, DEFAULT_TICK_BUDGET, WORK_GRACE_TICKS } from '../../../src/ui/tutorialGuide.js';
import { TUTORIAL_HIRING_SCRIPT } from '../../../src/core/config/balance.js';
import { t } from '../../../src/core/i18n/I18n.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { getPickerRegion } from '../../../src/ui/tutorialPickerRegion.js';
import { stagesFor, PICKER_CANCEL } from '../../../src/ui/tutorialStages.js';
import { PAUSE_TOGGLE_SELECTOR, SPEED_BUTTON_GROUP, SURVEY_OVERLAY_TOGGLE_TARGET, PANEL_OPEN_SELECTOR, TUTORIAL_EXIT_SELECTOR, SETTINGS_SESSION_SELECTORS } from '../../../src/ui/tutorialStepHelpers.js';
import { PANEL_CLOSE_SELECTOR } from '../../../src/ui/panels/PanelBase.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { GUIDED_CLASS } from '../../../src/ui/tutorialGuide.js';
import { RAILED_CONTROL_SELECTOR, isRailedControl, isControlLive, installActivationGuard } from '../../../src/ui/tutorialActivationGuard.js';
import { injectStyles } from '../../../src/ui/styles.js';

// #903: a stage shaped like train-driller's final one — a `target` that
// disappears (replaced by an "in training" status view, crewDetailSections.ts)
// the instant the player uses it, and a `doneTarget` that takes over once
// `target` itself is unreachable. `stagesFor('fake-train-step', ...)` is
// mocked here rather than reusing the real 'train-driller' entry in
// tutorialStagesTraining.ts, which does not yet carry a doneTarget (that
// file is the implementer's to change, not the test-writer's).
vi.mock('../../../src/ui/tutorialStages.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ui/tutorialStages.js')>();
  const fakeTrainStages = [
    { target: '#open', hintKey: 'a' },
    { target: '#expand', hintKey: 'b' },
    { target: '.bs-train-btn', doneTarget: '.bs-training-active', hintKey: 'c' },
  ];
  return {
    ...actual,
    stagesFor: (stepId: string, highlightTarget?: string) =>
      (stepId === 'fake-train-step' ? fakeTrainStages : actual.stagesFor(stepId, highlightTarget)),
  };
});

function withBox(el: HTMLElement): HTMLElement {
  el.getBoundingClientRect = () => ({
    width: 40, height: 20, top: 0, left: 0, right: 40, bottom: 20, x: 0, y: 0,
    toJSON: () => ({}),
  }) as DOMRect;
  return el;
}

/** Stand in for the toolbar button the hire steps point at first. */
function toolbarCrew(): HTMLElement {
  const bar = document.createElement('div');
  bar.id = 'bs-toolbar';
  const btn = document.createElement('button');
  btn.dataset['panel'] = 'employees';
  bar.appendChild(btn);
  document.body.appendChild(bar);
  return withBox(btn);
}

/** Stand in for the Hire button inside the Crew panel. */
function hireSurveyor(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'bs-employee-panel';
  const btn = document.createElement('button');
  btn.dataset['role'] = 'surveyor';
  btn.dataset['candidateId'] = String(TUTORIAL_HIRING_SCRIPT.find(c => c.role === 'surveyor')!.id);
  panel.appendChild(btn);
  document.body.appendChild(panel);
  return withBox(btn);
}

function state(): GameState {
  return createGame({ seed: 42, mineType: 'desert' });
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('TutorialRails', () => {
  it('points at the panel opener while the panel is closed', () => {
    const open = toolbarCrew();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());

    const view = rails.refresh();
    expect(open.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
    expect(view.stageIndex).toBe(0);
    expect(view.stageTotal).toBe(2);
    expect(view.hint).toContain('(1/2)');
  });

  it('moves to the button inside the panel once it is open', () => {
    const open = toolbarCrew();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());
    rails.refresh();

    const hire = hireSurveyor();
    const view = rails.refresh();

    expect(hire.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
    expect(open.classList.contains(HIGHLIGHT_CLASS)).toBe(false);
    expect(view.stageIndex).toBe(1);
    expect(view.hint).toContain('(2/2)');
  });

  it('omits the counter for a single-stage step', () => {
    // #1015: 'speed-up-for-dig' is gone — 'toggle-survey-overlay' has no
    // entry of its own in TUTORIAL_STAGES, so stagesFor falls back to a
    // single stage built from the step's own highlightTarget, exercising the
    // same one-stage shape.
    const panel = document.createElement('div');
    panel.id = 'bs-survey-panel';
    const btn = document.createElement('button');
    btn.dataset['role'] = 'overlay-toggle';
    panel.appendChild(btn);
    document.body.appendChild(panel);
    withBox(btn);

    const rails = new TutorialRails();
    rails.beginStep({ id: 'toggle-survey-overlay', highlightTarget: SURVEY_OVERLAY_TOGGLE_TARGET }, state());
    expect(rails.refresh().hint).not.toContain('/');
  });

  it('fills the target coordinates into the hint for an exact selection', () => {
    // The drill grid demands one specific rectangle, so the card has to say
    // which one rather than gesturing at the middle of the map.
    const bar = document.createElement('div');
    bar.id = 'bs-toolbar';
    const btn = document.createElement('button');
    btn.dataset['panel'] = 'blast';
    bar.appendChild(btn);
    document.body.appendChild(bar);
    withBox(btn);

    document.body.classList.add('bs-placement-armed');
    const canvas = document.createElement('div');
    canvas.id = 'game-canvas';
    document.body.appendChild(canvas);
    withBox(canvas);

    const rails = new TutorialRails();
    rails.beginStep({ id: 'drill-plan' }, state());
    const hint = rails.refresh().hint;

    expect(hint).not.toContain('{x1}');
    expect(hint).toMatch(/\d+/);
  });

  it('clears the rails for a step with nothing to point at', () => {
    const stray = withBox(document.createElement('button'));
    stray.classList.add(ALLOWED_CLASS);
    document.body.appendChild(stray);

    const rails = new TutorialRails();
    rails.beginStep({ id: 'congratulations' }, state());
    const view = rails.refresh();

    expect(view.hint).toBe('');
    expect(stray.classList.contains(ALLOWED_CLASS)).toBe(false);
  });

  describe('unguided step (#1328)', () => {
    it('clears rails marks and reports no stages', () => {
      const stray = withBox(document.createElement('button'));
      stray.classList.add(ALLOWED_CLASS, HIGHLIGHT_CLASS);
      document.body.appendChild(stray);
      const rails = new TutorialRails();
      rails.beginStep({ id: 'hire-surveyor' }, state());
      rails.beginStep({ id: 'free-play', guided: false }, state());
      const view = rails.refresh(state());
      expect(view.stageTotal).toBe(0);
      expect(view.hint).toBe('');
      expect(stray.classList.contains(ALLOWED_CLASS)).toBe(false);
      expect(stray.classList.contains(HIGHLIGHT_CLASS)).toBe(false);
    });

    it('releases a held clock when the step begins', () => {
      const s = state();
      const rails = new TutorialRails();
      rails.beginStep({ id: 'hire-surveyor' }, s);
      s.tickCount = DEFAULT_TICK_BUDGET;
      rails.updateClock(s);
      expect(s.isPaused).toBe(true);
      rails.beginStep({ id: 'free-play', guided: false }, s);
      expect(s.isPaused).toBe(false);
      expect(rails.clockHeld).toBe(false);
    });

    it('updateClock never pauses afterward, even far past the default budget', () => {
      const s = state();
      const rails = new TutorialRails();
      rails.beginStep({ id: 'free-play', guided: false }, s);
      for (const tick of [DEFAULT_TICK_BUDGET, DEFAULT_TICK_BUDGET * 10, 100000]) {
        s.tickCount = tick;
        expect(rails.updateClock(s)).toBe(false);
        expect(s.isPaused).toBe(false);
      }
    });

    it('a guided step after an unguided one holds the clock again (no leaked flag)', () => {
      const s = state();
      const rails = new TutorialRails();
      rails.beginStep({ id: 'free-play', guided: false }, s);
      rails.beginStep({ id: 'hire-surveyor' }, s);
      s.tickCount = DEFAULT_TICK_BUDGET;
      expect(rails.updateClock(s)).toBe(true);
    });

    it('guided: true behaves as before', () => {
      const s = state();
      const rails = new TutorialRails();
      rails.beginStep({ id: 'hire-surveyor', guided: true }, s);
      s.tickCount = DEFAULT_TICK_BUDGET;
      expect(rails.updateClock(s)).toBe(true);
    });
  });

  it('starts a step with the clock running', () => {
    const s = state();
    s.isPaused = true;
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, s);
    expect(s.isPaused).toBe(false);
  });

  it('holds the clock once the step spends its allowance', () => {
    const s = state();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, s);

    s.tickCount = DEFAULT_TICK_BUDGET;
    expect(rails.updateClock(s)).toBe(true);
    expect(s.isPaused).toBe(true);
    expect(rails.clockHeld).toBe(true);
  });

  it('counts the allowance from the tick the step began', () => {
    const s = state();
    s.tickCount = 500;
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, s);

    s.tickCount = 505;
    expect(rails.updateClock(s)).toBe(false);
    expect(s.isPaused).toBe(false);
  });

  it('honours a step that asks for a longer allowance', () => {
    const s = state();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor', tickBudget: 40 }, s);

    s.tickCount = 30;
    expect(rails.updateClock(s)).toBe(false);
  });

  it('releases a held clock when the step reports clockMustRun (#1336)', () => {
    const s = state();
    const rails = new TutorialRails();
    let mustRun = false;
    rails.beginStep({ id: 'hire-surveyor', waitsOnWork: true, clockMustRun: () => mustRun }, s);
    s.tickCount = DEFAULT_TICK_BUDGET + WORK_GRACE_TICKS * 10;
    expect(rails.updateClock(s)).toBe(true);
    expect(s.isPaused).toBe(true);

    mustRun = true;
    expect(rails.updateClock(s)).toBe(false);
    expect(s.isPaused).toBe(false);
    expect(rails.clockHeld).toBe(false);
  });

  it('never holds while clockMustRun stays true past the allowance (#1336)', () => {
    const s = state();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor', clockMustRun: () => true }, s);
    s.tickCount = DEFAULT_TICK_BUDGET + WORK_GRACE_TICKS * 10;
    expect(rails.updateClock(s)).toBe(false);
    expect(s.isPaused).toBe(false);
  });

  it('lets the clock go again when the step moves on', () => {
    const s = state();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, s);
    s.tickCount = DEFAULT_TICK_BUDGET;
    rails.updateClock(s);
    expect(s.isPaused).toBe(true);

    rails.beginStep({ id: 'survey' }, s);
    expect(s.isPaused).toBe(false);
    expect(rails.clockHeld).toBe(false);
  });

  it('does not touch a game that is not there', () => {
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, null);
    expect(() => rails.updateClock(null)).not.toThrow();
    expect(rails.updateClock(null)).toBe(false);
  });

  // -- #478: the tutorial hung at "buy a hauler and put the hired driver in
  // it" because the flat WORK_GRACE_TICKS window held the clock once
  // vehicle-buy-assign's budget (20 ticks) plus WORK_GRACE_TICKS (40) ran
  // out, even while the driver was still visibly walking to the vehicle.
  // A held clock never lets the walk finish, so the hold never lifted.

  it('never permanently holds while outstanding work keeps signature-changing, well past the old budget+grace cutoff', () => {
    const s = state();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'vehicle-buy-assign', tickBudget: 20, waitsOnWork: true }, s);
    const start = s.tickCount;

    for (let i = 1; i <= 20 + 2 * WORK_GRACE_TICKS; i++) {
      s.tickCount = start + i;
      // A fresh destination every tick — the driver is provably still
      // walking toward the vehicle, never stuck.
      s.employees.employees = [
        { activeActionId: null, pendingDriverVehicleId: 1, destinationX: i, destinationZ: 0 } as never,
      ];
      rails.updateClock(s);
      if (i > 20 + WORK_GRACE_TICKS) {
        expect(s.isPaused).toBe(false);
        expect(rails.clockHeld).toBe(false);
      }
    }
  });

  it('beginStep resets the progress fingerprint, so a new step never inherits a stale one from a held step', () => {
    const s = state();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'vehicle-buy-assign', tickBudget: 5, waitsOnWork: true }, s);

    // Same outstanding worker never moves — this step genuinely stalls.
    const frozenEmployee = {
      activeActionId: null, pendingDriverVehicleId: 1, destinationX: 9, destinationZ: 0,
    } as never;
    s.employees.employees = [frozenEmployee];

    for (let i = 1; i <= 5 + WORK_GRACE_TICKS; i++) {
      s.tickCount = i;
      rails.updateClock(s);
    }
    expect(rails.clockHeld).toBe(true);
    expect(s.isPaused).toBe(true);

    // The same stuck worker is still there — only the step changed. A new
    // step must get its own full budget + grace, not the exhausted one it
    // inherited from the step that just held.
    // A stage-less step id: no player order, so #1626's unissued-order hold
    // cannot apply and only the carried-over fingerprint is under test.
    rails.beginStep({ id: 'no-order-step', tickBudget: 5, waitsOnWork: true }, s);
    expect(s.isPaused).toBe(false);

    const stepStart2 = s.tickCount;
    s.tickCount = stepStart2 + 5; // exactly the new step's own budget
    expect(rails.updateClock(s)).toBe(false);
    expect(s.isPaused).toBe(false);
  });

  it('clear() drops the marks and the stage list', () => {
    const open = toolbarCrew();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());
    rails.refresh();

    rails.clear();

    expect(open.classList.contains(HIGHLIGHT_CLASS)).toBe(false);
    expect(rails.progress.total).toBe(0);
    expect(rails.clockHeld).toBe(false);
  });
});

// #1015: the speed bar is unconditionally player-controlled from the
// tutorial's very first step onward — no step declares it any more.
// TutorialRails bakes SPEED_BUTTON_GROUP into BASE_PERMANENTLY_ALLOWED and
// passes it to every applyRails() call regardless of the active stage.
describe('the speed bar is always allowed, from the first step onward (#1015)', () => {
  /** All four HUD speed buttons, nested inside the .bs-speed-btn group container. */
  function speedButtons(): HTMLButtonElement[] {
    const bar = document.createElement('div');
    bar.id = 'bs-hud-top';
    const group = document.createElement('div');
    group.className = 'bs-speed-btn';
    bar.appendChild(group);
    document.body.appendChild(bar);

    const buttons = ['1', '2', '4', '8'].map((speed) => {
      const btn = document.createElement('button');
      btn.dataset['speed'] = speed;
      group.appendChild(btn);
      return withBox(btn) as HTMLButtonElement;
    });
    return buttons;
  }

  it('marks all four speed buttons allowed immediately after the very first beginStep() call, with no special per-step field', () => {
    const buttons = speedButtons();
    // SPEED_BUTTON_GROUP is the exact selector tutorialRails.ts bakes into
    // BASE_PERMANENTLY_ALLOWED — assert it actually resolves these buttons,
    // not a coincidentally-matching fixture.
    expect(Array.from(document.querySelectorAll(SPEED_BUTTON_GROUP))).toEqual(buttons);
    // Active stage target is the Crew toolbar button — nothing to do with
    // the speed buttons — proving the allowance is independent of the stage.
    toolbarCrew();

    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());
    rails.refresh();

    for (const btn of buttons) {
      expect(btn.classList.contains(ALLOWED_CLASS), `data-speed="${btn.dataset['speed']}" should be allowed`).toBe(true);
    }
  });

  it('the allowance persists across subsequent beginStep() calls to unrelated steps', () => {
    const buttons = speedButtons();

    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());
    rails.refresh();

    rails.beginStep({ id: 'drill-plan' }, state());
    rails.refresh();

    for (const btn of buttons) {
      expect(btn.classList.contains(ALLOWED_CLASS)).toBe(true);
    }
  });

  it('survives clear() followed by a fresh beginStep()', () => {
    const buttons = speedButtons();

    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());
    rails.refresh();
    rails.clear();

    rails.beginStep({ id: 'drill-plan' }, state());
    rails.refresh();

    for (const btn of buttons) {
      expect(btn.classList.contains(ALLOWED_CLASS)).toBe(true);
    }
  });

  it('a non-speed control is still gated normally by the active stage — the one-live-control rule is unchanged', () => {
    speedButtons();
    const open = toolbarCrew();
    const stray = withBox(document.createElement('button'));
    document.body.appendChild(stray);

    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());
    rails.refresh();

    // Stage 0 targets the toolbar opener — a control that belongs to no
    // stage at all (and is not the speed bar) stays gated, exactly as before
    // #1015.
    expect(open.classList.contains(ALLOWED_CLASS)).toBe(true);
    expect(stray.classList.contains(ALLOWED_CLASS)).toBe(false);
  });

  it('a speed button never gets HIGHLIGHT_CLASS applied — it is allowed but never the thing being pointed at', () => {
    const buttons = speedButtons();
    toolbarCrew();

    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());
    rails.refresh();

    for (const btn of buttons) {
      expect(btn.classList.contains(HIGHLIGHT_CLASS)).toBe(false);
    }
  });
});

// #1041: navigation (opening/closing any panel) is allowed unconditionally,
// the same way the speed bar is (#1015) — the tutorial's `ALLOWED_CLASS`
// allowlist used to cover only the active stage's own target/also/modal
// controls, so moving to a panel the current stage doesn't target was blocked
// exactly like a real game-state-changing action. `BASE_PERMANENTLY_ALLOWED`
// (tutorialRails.ts) now also carries `PANEL_OPEN_SELECTOR` ([data-panel])
// and `PANEL_CLOSE_SELECTOR` ([data-panel-close]) — generic over every
// panel's own opener/closer, so no per-panel rails entry is ever needed.
describe('every panel open/close control is always allowed, from the first step onward (#1041)', () => {
  /** A toolbar opener for some OTHER panel than the one the active stage targets. */
  function panelOpener(panelName: string): HTMLButtonElement {
    const bar = document.getElementById('bs-toolbar') ?? (() => {
      const b = document.createElement('div');
      b.id = 'bs-toolbar';
      document.body.appendChild(b);
      return b;
    })();
    const btn = document.createElement('button');
    btn.dataset['panel'] = panelName;
    bar.appendChild(btn);
    return withBox(btn) as HTMLButtonElement;
  }

  /** A panel's own header close control, matching PANEL_CLOSE_SELECTOR. */
  function panelCloser(panelId: string): HTMLButtonElement {
    const panel = document.createElement('div');
    panel.id = panelId;
    document.body.appendChild(panel);
    const btn = document.createElement('button');
    btn.setAttribute('data-panel-close', '');
    panel.appendChild(btn);
    return withBox(btn) as HTMLButtonElement;
  }

  /** A state-changing control that belongs to no stage at all — the negative case. */
  function unrelatedHireButton(): HTMLButtonElement {
    const panel = document.createElement('div');
    panel.id = 'bs-employee-panel';
    const btn = document.createElement('button');
    btn.dataset['role'] = 'driller';
    panel.appendChild(btn);
    document.body.appendChild(panel);
    return withBox(btn) as HTMLButtonElement;
  }

  it('sanity: the fixtures actually match PANEL_OPEN_SELECTOR / PANEL_CLOSE_SELECTOR', () => {
    const opener = panelOpener('vehicles');
    const closer = panelCloser('bs-vehicle-panel');
    expect(opener.matches(PANEL_OPEN_SELECTOR)).toBe(true);
    expect(closer.matches(PANEL_CLOSE_SELECTOR)).toBe(true);
  });

  it('marks a panel opener for a DIFFERENT panel than the active stage\'s own target allowed', () => {
    // Stage 0 of hire-surveyor targets the Crew ([data-panel="employees"])
    // opener. Fleet's own opener belongs to no stage in this step at all.
    toolbarCrew();
    const fleetOpener = panelOpener('vehicles');

    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());
    rails.refresh();

    expect(fleetOpener.classList.contains(ALLOWED_CLASS)).toBe(true);
  });

  it('marks a panel\'s own close control allowed even though no stage targets it', () => {
    toolbarCrew();
    const closer = panelCloser('bs-vehicle-panel');

    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());
    rails.refresh();

    expect(closer.classList.contains(ALLOWED_CLASS)).toBe(true);
  });

  it('never highlights a panel opener/closer — only the active stage\'s own target gets HIGHLIGHT_CLASS', () => {
    const open = toolbarCrew();
    const fleetOpener = panelOpener('vehicles');
    const closer = panelCloser('bs-vehicle-panel');

    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());
    rails.refresh();

    expect(fleetOpener.classList.contains(HIGHLIGHT_CLASS)).toBe(false);
    expect(closer.classList.contains(HIGHLIGHT_CLASS)).toBe(false);
    // Exactly one element on the whole page is highlighted, and it is the stage's own target.
    const highlighted = Array.from(document.querySelectorAll(`.${HIGHLIGHT_CLASS}`));
    expect(highlighted).toEqual([open]);
  });

  it('a state-changing control belonging to no stage at all still stays blocked — navigation allowance does not widen into action allowance', () => {
    toolbarCrew();
    panelOpener('vehicles');
    const stray = unrelatedHireButton();

    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());
    rails.refresh();

    expect(stray.classList.contains(ALLOWED_CLASS)).toBe(false);
  });

  it('the allowance persists across subsequent beginStep() calls to unrelated steps', () => {
    toolbarCrew();
    const fleetOpener = panelOpener('vehicles');
    const closer = panelCloser('bs-vehicle-panel');

    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());
    rails.refresh();
    rails.beginStep({ id: 'drill-plan' }, state());
    rails.refresh();

    expect(fleetOpener.classList.contains(ALLOWED_CLASS)).toBe(true);
    expect(closer.classList.contains(ALLOWED_CLASS)).toBe(true);
  });

  it('survives clear() followed by a fresh beginStep()', () => {
    toolbarCrew();
    const fleetOpener = panelOpener('vehicles');
    const closer = panelCloser('bs-vehicle-panel');

    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());
    rails.refresh();
    rails.clear();

    rails.beginStep({ id: 'drill-plan' }, state());
    rails.refresh();

    expect(fleetOpener.classList.contains(ALLOWED_CLASS)).toBe(true);
    expect(closer.classList.contains(ALLOWED_CLASS)).toBe(true);
  });
});

describe('the region a step publishes is the region the picker enforces (#489)', () => {
  it('publishes the step region on beginStep, before the picker opens', () => {
    // The picker opens on the click that *ends* the previous stage, so the
    // region has to be up before then or that first picker is unconstrained.
    const rails = new TutorialRails();
    rails.beginStep({ id: 'survey' }, state());

    const published = getPickerRegion();
    const stageRegion = stagesFor('survey').find(s => s.region)!.region!;
    expect(published).toEqual(stageRegion);
  });

  it.each(['survey', 'drill-plan', 'box-cut', 'build-storage'])(
    '%s publishes exactly what its picker stage draws',
    (stepId) => {
      const rails = new TutorialRails();
      rails.beginStep({ id: stepId }, state());
      expect(getPickerRegion()).toEqual(stagesFor(stepId).find(s => s.region)!.region!);
    },
  );

  it('lifts the region on a step that places nothing', () => {
    const rails = new TutorialRails();
    rails.beginStep({ id: 'survey' }, state());
    rails.beginStep({ id: 'charge' }, state());
    expect(getPickerRegion()).toBeNull();
  });

  it('lifts the region when the tutorial ends', () => {
    const rails = new TutorialRails();
    rails.beginStep({ id: 'survey' }, state());
    rails.clear();
    expect(getPickerRegion()).toBeNull();
  });
});

describe('a stage whose control is missing or blocked is detected (#489)', () => {
  it('reports the target it is waiting on, so a blocked step can be named', () => {
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());

    // Nothing rendered: the rails fall back to the first stage and still say
    // which control the player is stuck on.
    const view = rails.refresh();
    expect(view.stageTarget).toBe(stagesFor('hire-surveyor')[0]!.target);
    expect(document.querySelector(`.${HIGHLIGHT_CLASS}`)).toBeNull();
  });

  it('advances to the later stage the moment its control becomes reachable', () => {
    const open = toolbarCrew();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());
    expect(rails.refresh().stageIndex).toBe(0);
    expect(open.classList.contains(HIGHLIGHT_CLASS)).toBe(true);

    hireSurveyor();
    expect(rails.refresh().stageIndex).toBe(1);
  });
});

describe('TutorialRails — doneTarget survives at the rails level (#903)', () => {
  // Bug 2's real shape: booking a course replaces the .bs-train-btn row with
  // an in-training status view (crewDetailSections.ts's makeTrainingSection).
  // Before #903's fix, resolveStageIndex's "last reachable stage wins" search
  // found neither the vanished target nor anything later, and fell all the
  // way back to an EARLIER, already-completed stage ("expand the driller's
  // card") — re-instructing a completed action instead of holding at the
  // stage the player just finished.

  function openStage(): HTMLElement {
    const btn = document.createElement('button');
    btn.id = 'open';
    document.body.appendChild(btn);
    return withBox(btn);
  }

  function expandStage(): HTMLElement {
    const btn = document.createElement('button');
    btn.id = 'expand';
    document.body.appendChild(btn);
    return withBox(btn);
  }

  function trainButton(): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'bs-train-btn';
    document.body.appendChild(btn);
    return withBox(btn);
  }

  function trainingActiveStatus(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'bs-training-active';
    document.body.appendChild(div);
    return withBox(div);
  }

  it('resolves to the final stage while its own target (the train button) is still live', () => {
    openStage();
    expandStage();
    trainButton();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'fake-train-step' }, state());

    const view = rails.refresh();
    expect(view.stageIndex).toBe(2);
    expect(view.stageTarget).toBe('.bs-train-btn');
  });

  it('does not drop back to an earlier stage once the train button is replaced by the in-training status view', () => {
    openStage();
    expandStage();
    const trainBtn = trainButton();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'fake-train-step' }, state());
    expect(rails.refresh().stageIndex).toBe(2);

    // Player clicks Train: the crew panel swaps the button row for the
    // status view. The control this stage was pointing at is gone.
    trainBtn.remove();
    trainingActiveStatus();

    const view = rails.refresh();
    expect(view.stageIndex).toBe(2);
    expect(view.stageTarget).toBe('.bs-train-btn');
  });
});

// #1014: once a stage's own order is issued (spentWhen fires), the card
// switches from "click this" to "waiting on the simulation", and the rails
// release the highlight on the spent control without blocking it.
describe('TutorialRails — waiting state (#1014)', () => {
  function toolbarBuild(): HTMLElement {
    const bar = document.createElement('div');
    bar.id = 'bs-toolbar';
    const btn = document.createElement('button');
    btn.dataset['panel'] = 'build';
    bar.appendChild(btn);
    document.body.appendChild(bar);
    return withBox(btn);
  }

  /** Stand in for the Build panel's living_quarters buy button. */
  function buyLivingQuartersButton(): HTMLElement {
    const panel = document.createElement('div');
    panel.id = 'bs-build-panel';
    const wrap = document.createElement('div');
    wrap.setAttribute('data-build-type', 'living_quarters');
    const btn = document.createElement('button');
    btn.className = 'bs-build-buy-btn';
    wrap.appendChild(btn);
    panel.appendChild(wrap);
    document.body.appendChild(panel);
    return withBox(btn);
  }

  it('build-living-quarters (issue\'s own example): reports waiting and releases the buy button\'s highlight once the order lands, leaving it inert', () => {
    toolbarBuild();
    const buyBtn = buyLivingQuartersButton();
    const rails = new TutorialRails();
    const s = state();
    rails.beginStep({ id: 'build-living-quarters' }, s);

    const before = rails.refresh(s);
    expect(before.waiting).toBe(false);
    expect(buyBtn.classList.contains(HIGHLIGHT_CLASS)).toBe(true);

    s.plannedBuildings = [
      { id: 1, buildingId: 1, type: 'living_quarters', tier: 1, x: 29, z: 12, actionId: 1, cost: 100 } as never,
    ];
    const after = rails.refresh(s);

    expect(after.waiting).toBe(true);
    expect(after.waitingHint).toBe(t('tutorial.waiting.building'));
    expect(buyBtn.classList.contains(HIGHLIGHT_CLASS)).toBe(false);
    expect(buyBtn.classList.contains(ALLOWED_CLASS)).toBe(false);
  });

  it('build-living-quarters: waiting clears once the building actually lands (plannedBuildings emptied)', () => {
    toolbarBuild();
    const buyBtn = buyLivingQuartersButton();
    const rails = new TutorialRails();
    const s = state();
    rails.beginStep({ id: 'build-living-quarters' }, s);

    s.plannedBuildings = [
      { id: 1, buildingId: 1, type: 'living_quarters', tier: 1, x: 29, z: 12, actionId: 1, cost: 100 } as never,
    ];
    expect(rails.refresh(s).waiting).toBe(true);

    s.plannedBuildings = [];
    const cleared = rails.refresh(s);
    expect(cleared.waiting).toBe(false);
    expect(cleared.waitingHint).toBe('');
    // Once the order is no longer outstanding, the control the stage
    // resolves to is highlighted normally again — no residual "spent" state.
    expect(buyBtn.classList.contains(ALLOWED_CLASS)).toBe(true);
  });

  it('refresh() called with no state argument stays exactly as it was before this issue (never reports waiting)', () => {
    toolbarBuild();
    buyLivingQuartersButton();
    const rails = new TutorialRails();
    const s = state();
    rails.beginStep({ id: 'build-living-quarters' }, s);
    s.plannedBuildings = [
      { id: 1, buildingId: 1, type: 'living_quarters', tier: 1, x: 29, z: 12, actionId: 1, cost: 100 } as never,
    ];

    const view = rails.refresh();
    expect(view.waiting).toBe(false);
    expect(view.waitingHint).toBe('');
  });

  it('a step whose stages carry no spentWhen (hire-surveyor) never reports waiting, however the state looks', () => {
    const open = toolbarCrew();
    const rails = new TutorialRails();
    const s = state();
    rails.beginStep({ id: 'hire-surveyor' }, s);

    const view = rails.refresh(s);
    expect(view.waiting).toBe(false);
    expect(view.waitingHint).toBe('');
    expect(open.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
  });
});

// #1332: the player can always leave the tutorial and always reach session controls.
describe('exit and Settings session controls are always allowed (#1332)', () => {
  function settingsPanel(): Record<string, HTMLElement> {
    const panel = document.createElement('div');
    panel.id = 'bs-settings-panel';
    const mk = (tag: string, attrs: Record<string, string>) => {
      const e = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      panel.appendChild(withBox(e));
      return e;
    };
    const els = {
      fr: mk('button', { 'data-lang': 'fr' }),
      volume: mk('input', { type: 'range' }),
      saves: mk('button', { 'data-action': 'open-saves' }),
      menu: mk('button', { 'data-action': 'return-to-menu' }),
      replay: mk('button', { 'data-action': 'replay-tutorial' }),
    };
    document.body.appendChild(panel);
    return els;
  }

  function exitButton(): HTMLElement {
    const b = document.createElement('button');
    b.dataset['action'] = 'tutorial-exit';
    document.body.appendChild(b);
    return withBox(b);
  }

  it('the selector constants name the documented controls', () => {
    expect(TUTORIAL_EXIT_SELECTOR).toBe('[data-action="tutorial-exit"]');
    expect(SETTINGS_SESSION_SELECTORS).toEqual([
      '#bs-settings-panel [data-lang]',
      '#bs-settings-panel input[type="range"]',
      '#bs-settings-panel [data-action="open-saves"]',
      '#bs-settings-panel [data-action="return-to-menu"]',
    ]);
  });

  it.each(['hire-surveyor', 'set-early-policy', 'box-cut', 'blast'])('at step %s the exit and session controls are allowed', (id) => {
    toolbarCrew();
    const exit = exitButton();
    const s = settingsPanel();
    const rails = new TutorialRails();
    rails.beginStep({ id }, state());
    rails.refresh();
    expect(exit.classList.contains(ALLOWED_CLASS)).toBe(true);
    expect(s['fr']!.classList.contains(ALLOWED_CLASS)).toBe(true);
    expect(s['volume']!.classList.contains(ALLOWED_CLASS)).toBe(true);
    expect(s['saves']!.classList.contains(ALLOWED_CLASS)).toBe(true);
    expect(s['menu']!.classList.contains(ALLOWED_CLASS)).toBe(true);
  });

  it('replay-tutorial stays gated', () => {
    toolbarCrew();
    const s = settingsPanel();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());
    rails.refresh();
    expect(s['replay']!.classList.contains(ALLOWED_CLASS)).toBe(false);
  });
});

describe('TutorialRails — evacuate-zone waiting for clearance (#1591)', () => {
  function waitingModal(phase: 'evacuating' | 'stranded'): { fire: HTMLElement; cancel: HTMLElement } {
    const toolbar = document.createElement('div');
    toolbar.id = 'bs-toolbar';
    const open = document.createElement('button');
    open.dataset['panel'] = 'blast';
    toolbar.appendChild(open);
    document.body.appendChild(toolbar);
    withBox(open);

    const panel = document.createElement('div');
    panel.id = 'bs-blast-panel';
    const exec = document.createElement('button');
    exec.dataset['action'] = 'execute';
    panel.appendChild(exec);
    document.body.appendChild(panel);
    withBox(exec);

    const overlay = document.createElement('div');
    overlay.className = 'bs-confirm-overlay';
    const waiting = document.createElement('div');
    waiting.dataset['role'] = 'preflight-waiting';
    waiting.dataset['phase'] = phase;
    const cancel = document.createElement('button');
    cancel.dataset['action'] = 'preflight-cancel-detonation';
    const fire = document.createElement('button');
    fire.dataset['action'] = 'preflight-fire-anyway';
    overlay.append(waiting, cancel, fire);
    document.body.appendChild(overlay);
    withBox(waiting); withBox(cancel); withBox(fire);
    return { fire, cancel };
  }

  for (const phase of ['evacuating', 'stranded'] as const) {
    it(`${phase}: Fire anyway is not allowed, Cancel detonation is`, () => {
      const { fire, cancel } = waitingModal(phase);
      const rails = new TutorialRails();
      const s = state();
      rails.beginStep({ id: 'evacuate-zone' }, s);
      rails.refresh(s);
      expect(fire.classList.contains(ALLOWED_CLASS)).toBe(false);
      expect(cancel.classList.contains(ALLOWED_CLASS)).toBe(true);
    });
  }
});

describe('the placement strip cancel is allowed on picker stages only (#1593)', () => {
  function armedPlacement(): HTMLButtonElement {
    document.body.classList.add('bs-placement-armed');
    document.body.appendChild(withBox(Object.assign(document.createElement('canvas'), { id: 'game-canvas' })));
    const bar = document.createElement('div');
    bar.id = 'bs-param-strip-bar';
    const cancel = document.createElement('button');
    cancel.dataset['action'] = 'cancel';
    bar.appendChild(cancel);
    document.body.appendChild(bar);
    return withBox(cancel) as HTMLButtonElement;
  }

  it('sanity: the fixture matches PICKER_CANCEL', () => {
    expect(armedPlacement().matches(PICKER_CANCEL)).toBe(true);
  });

  it.each(['build-storage', 'survey', 'box-cut', 'drill-plan'])('%s: cancel is allowed on the armed picker stage', (stepId) => {
    const cancel = armedPlacement();
    const rails = new TutorialRails();
    rails.beginStep({ id: stepId }, state());
    rails.refresh();
    expect(cancel.classList.contains(ALLOWED_CLASS)).toBe(true);
  });

  it('a non-picker stage does not allow the cancel control', () => {
    const cancel = armedPlacement();
    toolbarCrew();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());
    rails.refresh();
    expect(cancel.classList.contains(ALLOWED_CLASS)).toBe(false);
  });

  it('the picker canvas stage hint tells the player how to cancel', () => {
    armedPlacement();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'build-storage' }, state());
    const tip = t('tutorial.stage.picker_cancel_tip');
    expect(tip).not.toBe('tutorial.stage.picker_cancel_tip');
    expect(rails.refresh().hint).toContain(tip);
  });
});

describe('keyboard cannot bypass the rails (#1597)', () => {
  function railed(tag = 'button'): HTMLElement {
    const el = document.createElement(tag);
    document.body.appendChild(el);
    return el;
  }
  function key(target: EventTarget, code: string, extra: KeyboardEventInit = {}): KeyboardEvent {
    const e = new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true, ...extra });
    target.dispatchEvent(e);
    return e;
  }
  function click(target: EventTarget): MouseEvent {
    const e = new MouseEvent('click', { bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
  });

  describe('isRailedControl', () => {
    it('is true for a guided body and a button without the allowed mark', () => {
      document.body.classList.add(GUIDED_CLASS);
      expect(isRailedControl(railed(), document)).toBe(true);
    });
    it('is false for an allowed button', () => {
      document.body.classList.add(GUIDED_CLASS);
      const b = railed();
      b.classList.add(ALLOWED_CLASS);
      expect(isRailedControl(b, document)).toBe(false);
    });
    it('is false when the body is not guided', () => {
      expect(isRailedControl(railed(), document)).toBe(false);
    });
    it('is true for a child span inside a railed button', () => {
      document.body.classList.add(GUIDED_CLASS);
      const b = railed();
      const span = document.createElement('span');
      b.appendChild(span);
      expect(isRailedControl(span, document)).toBe(true);
    });
    it('uses the nearest control: a child span of an allowed button is not railed', () => {
      document.body.classList.add(GUIDED_CLASS);
      const b = railed();
      b.classList.add(ALLOWED_CLASS);
      const span = document.createElement('span');
      b.appendChild(span);
      expect(isRailedControl(span, document)).toBe(false);
    });
    it('covers select, input, detail toggle and survey method', () => {
      document.body.classList.add(GUIDED_CLASS);
      const els = [railed('select'), railed('input'), railed('div'), railed('div')];
      els[2]!.className = 'bs-detail-toggle';
      els[3]!.className = 'bs-survey-method';
      for (const el of els) expect(isRailedControl(el, document)).toBe(true);
    });
    it('is false for a plain div, a text node, the document and null, without throwing', () => {
      document.body.classList.add(GUIDED_CLASS);
      const div = railed('div');
      expect(isRailedControl(div, document)).toBe(false);
      expect(isRailedControl(document.createTextNode('x'), document)).toBe(false);
      expect(isRailedControl(document, document)).toBe(false);
      expect(isRailedControl(null, document)).toBe(false);
    });
  });

  describe('isControlLive', () => {
    it('is true when not guided', () => {
      railed().dataset['action'] = 'pause-toggle';
      expect(isControlLive('button[data-action="pause-toggle"]', document)).toBe(true);
    });
    it('is true when the element is absent', () => {
      document.body.classList.add(GUIDED_CLASS);
      expect(isControlLive('button[data-action="pause-toggle"]', document)).toBe(true);
    });
    it('is true when the element carries the allowed mark', () => {
      document.body.classList.add(GUIDED_CLASS);
      const b = railed();
      b.dataset['action'] = 'pause-toggle';
      b.classList.add(ALLOWED_CLASS);
      expect(isControlLive('button[data-action="pause-toggle"]', document)).toBe(true);
    });
    it('is false when guided and the element is present without the allowed mark', () => {
      document.body.classList.add(GUIDED_CLASS);
      railed().dataset['action'] = 'pause-toggle';
      expect(isControlLive('button[data-action="pause-toggle"]', document)).toBe(false);
    });
  });

  describe('installActivationGuard', () => {
    it('swallows a click on a railed control before bubble listeners see it', () => {
      document.body.classList.add(GUIDED_CLASS);
      const dispose = installActivationGuard(document);
      const b = railed();
      const seen = vi.fn();
      b.addEventListener('click', seen);
      const e = click(b);
      expect(e.defaultPrevented).toBe(true);
      expect(seen).not.toHaveBeenCalled();
      dispose();
    });
    it('swallows a click on a child span inside a railed button', () => {
      document.body.classList.add(GUIDED_CLASS);
      const dispose = installActivationGuard(document);
      const b = railed();
      const span = document.createElement('span');
      b.appendChild(span);
      const seen = vi.fn();
      b.addEventListener('click', seen);
      click(span);
      expect(seen).not.toHaveBeenCalled();
      dispose();
    });
    it.each(['Enter', 'Space'])('swallows %s on a railed control', (code) => {
      document.body.classList.add(GUIDED_CLASS);
      const dispose = installActivationGuard(document);
      const b = railed();
      const seen = vi.fn();
      b.addEventListener('keydown', seen);
      const e = key(b, code);
      expect(e.defaultPrevented).toBe(true);
      expect(seen).not.toHaveBeenCalled();
      dispose();
    });
    it.each([
      ['Tab', {}], ['Escape', {}], ['ShiftLeft', { shiftKey: true }], ['ControlLeft', { ctrlKey: true }],
      ['AltLeft', { altKey: true }], ['MetaLeft', { metaKey: true }],
    ] as [string, KeyboardEventInit][])('lets %s through on a railed control', (code, init) => {
      document.body.classList.add(GUIDED_CLASS);
      const dispose = installActivationGuard(document);
      const b = railed();
      const seen = vi.fn();
      b.addEventListener('keydown', seen);
      const e = key(b, code, init);
      expect(e.defaultPrevented).toBe(false);
      expect(seen).toHaveBeenCalledOnce();
      dispose();
    });
    it('lets an allowed control be activated', () => {
      document.body.classList.add(GUIDED_CLASS);
      const dispose = installActivationGuard(document);
      const b = railed();
      b.classList.add(ALLOWED_CLASS);
      const clicked = vi.fn();
      const keyed = vi.fn();
      b.addEventListener('click', clicked);
      b.addEventListener('keydown', keyed);
      click(b);
      key(b, 'Enter');
      expect(clicked).toHaveBeenCalledOnce();
      expect(keyed).toHaveBeenCalledOnce();
      dispose();
    });
    it('does nothing when the tutorial is not guiding', () => {
      const dispose = installActivationGuard(document);
      const b = railed();
      const clicked = vi.fn();
      b.addEventListener('click', clicked);
      expect(click(b).defaultPrevented).toBe(false);
      expect(key(b, 'Enter').defaultPrevented).toBe(false);
      expect(clicked).toHaveBeenCalledOnce();
      dispose();
    });
    it('ignores keys on a non-control target', () => {
      document.body.classList.add(GUIDED_CLASS);
      const dispose = installActivationGuard(document);
      expect(key(railed('div'), 'Enter').defaultPrevented).toBe(false);
      dispose();
    });
    it('stops swallowing after the disposer runs', () => {
      document.body.classList.add(GUIDED_CLASS);
      const dispose = installActivationGuard(document);
      dispose();
      const b = railed();
      const clicked = vi.fn();
      b.addEventListener('click', clicked);
      expect(click(b).defaultPrevented).toBe(false);
      expect(key(b, 'Enter').defaultPrevented).toBe(false);
      expect(clicked).toHaveBeenCalledOnce();
    });
  });

  describe('TutorialRails wiring', () => {
    it('beginStep installs the guard: Enter on a railed button is swallowed', () => {
      document.body.classList.add(GUIDED_CLASS);
      const rails = new TutorialRails();
      rails.beginStep({ id: 'hire-surveyor' }, state());
      const b = railed();
      expect(key(b, 'Enter').defaultPrevented).toBe(true);
      rails.clear();
    });
    it('beginStep twice installs one listener set (idempotent)', () => {
      document.body.classList.add(GUIDED_CLASS);
      const addSpy = vi.spyOn(document, 'addEventListener');
      const rails = new TutorialRails();
      rails.beginStep({ id: 'hire-surveyor' }, state());
      const after1 = addSpy.mock.calls.filter(c => c[0] === 'click' || c[0] === 'keydown').length;
      rails.beginStep({ id: 'survey' }, state());
      const after2 = addSpy.mock.calls.filter(c => c[0] === 'click' || c[0] === 'keydown').length;
      expect(after1).toBeGreaterThan(0);
      expect(after2).toBe(after1);
      addSpy.mockRestore();
      rails.clear();
    });
    it('clear disposes the guard', () => {
      document.body.classList.add(GUIDED_CLASS);
      const rails = new TutorialRails();
      rails.beginStep({ id: 'hire-surveyor' }, state());
      rails.clear();
      document.body.classList.add(GUIDED_CLASS);
      const b = railed();
      expect(key(b, 'Enter').defaultPrevented).toBe(false);
      expect(click(b).defaultPrevented).toBe(false);
    });
  });

  describe('selector parity with the CSS rail rule', () => {
    injectStyles();
    const css = Array.from(document.head.querySelectorAll('style')).map(el => el.textContent).join('\n');
    for (const part of RAILED_CONTROL_SELECTOR.split(',').map(p => p.trim())) {
      it(`styles.ts rails "${part}"`, () => {
        expect(css).toContain(`body.${GUIDED_CLASS} ${part}:not(.${ALLOWED_CLASS})`);
      });
    }
  });
});

// #1626: an unissued step order holds the clock after the budget, whatever
// unrelated work is in flight; the step's own order releases the grace.
describe('TutorialRails — unissued order holds the clock (#1626)', () => {
  const pending = (): GameState['pendingActions'][number] =>
    ({ id: 1, type: 'haul_debris', status: 'queued', payload: {} }) as unknown as GameState['pendingActions'][number];

  function busy(): GameState {
    const s = state();
    s.pendingActions = Array.from({ length: 50 }, pending);
    s.employees.employees = [
      { activeActionId: null, pendingDriverVehicleId: null, destinationX: 3, destinationZ: 4, qualifications: [], trainingState: null } as never,
    ];
    return s;
  }

  const planned = (type: string) =>
    [{ id: 1, buildingId: 1, type, tier: 1, x: 1, z: 1, actionId: 1, cost: 1 } as never];

  const cases: Array<{
    id: string; budget: number; issue: (s: GameState) => void;
  }> = [
    { id: 'build-driving-center', budget: 60, issue: (s) => { s.plannedBuildings = planned('driving_center'); } },
    { id: 'build-storage', budget: 60, issue: (s) => { s.plannedBuildings = planned('freight_warehouse'); } },
    {
      id: 'train-fragmenter', budget: 25,
      issue: (s) => {
        s.employees.employees = [
          ...s.employees.employees,
          { activeActionId: null, pendingDriverVehicleId: null, destinationX: null, qualifications: [],
            trainingState: { buildingId: 1, skill: 'driving.rock_fragmenter', ticksRemaining: 90, fee: 1 } } as never,
        ];
      },
    },
    {
      id: 'sell-ore', budget: 40,
      issue: (s) => { s.contracts.active = [{ id: 1, type: 'ore_sale', completed: false } as never]; },
    },
  ];

  for (const c of cases) {
    it(`${c.id}: holds after the budget with unrelated work in flight while the order is not issued`, () => {
      const s = busy();
      const rails = new TutorialRails();
      rails.beginStep({ id: c.id, tickBudget: c.budget, waitsOnWork: true }, s);
      s.tickCount = c.budget + 10;
      expect(rails.updateClock(s)).toBe(true);
      expect(s.isPaused).toBe(true);
    });

    it(`${c.id}: releases the clock once the order is issued`, () => {
      const s = busy();
      const rails = new TutorialRails();
      rails.beginStep({ id: c.id, tickBudget: c.budget, waitsOnWork: true }, s);
      s.tickCount = c.budget + 10;
      expect(rails.updateClock(s)).toBe(true);
      c.issue(s);
      expect(rails.updateClock(s)).toBe(false);
      expect(s.isPaused).toBe(false);
    });

    it(`${c.id}: does not hold inside the budget while the order is not issued`, () => {
      const s = busy();
      const rails = new TutorialRails();
      rails.beginStep({ id: c.id, tickBudget: c.budget, waitsOnWork: true }, s);
      s.tickCount = c.budget - 1;
      expect(rails.updateClock(s)).toBe(false);
    });
  }

  it('haul-debris keeps running past the budget with work in flight (no player order)', () => {
    const s = busy();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'haul-debris', tickBudget: 30, waitsOnWork: true }, s);
    s.tickCount = 40;
    expect(rails.updateClock(s)).toBe(false);
  });
});

describe('play/pause control stays allowed under the rails (#1627)', () => {
  function pauseButton(): HTMLButtonElement {
    const bar = document.createElement('div');
    bar.id = 'bs-hud-top';
    const btn = document.createElement('button');
    btn.dataset['action'] = 'pause-toggle';
    bar.appendChild(btn);
    document.body.appendChild(bar);
    return withBox(btn) as HTMLButtonElement;
  }

  it('marks the pause toggle allowed on a stage that does not target it', () => {
    const btn = pauseButton();
    expect(Array.from(document.querySelectorAll(PAUSE_TOGGLE_SELECTOR))).toEqual([btn]);
    toolbarCrew();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());
    rails.refresh();
    expect(btn.classList.contains(ALLOWED_CLASS)).toBe(true);
  });

  it('keeps it allowed on a later step and after clear() + beginStep()', () => {
    const btn = pauseButton();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'drill-plan' }, state());
    rails.refresh();
    expect(btn.classList.contains(ALLOWED_CLASS)).toBe(true);
    rails.clear();
    rails.beginStep({ id: 'hire-surveyor' }, state());
    rails.refresh();
    expect(btn.classList.contains(ALLOWED_CLASS)).toBe(true);
  });

  it('never highlights it', () => {
    const btn = pauseButton();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, state());
    rails.refresh();
    expect(btn.classList.contains(HIGHLIGHT_CLASS)).toBe(false);
  });
});

describe('TutorialRails.settleClockAfterResume (#1627)', () => {
  const inFlightTraining = (s: GameState): void => {
    s.employees.employees = [
      { activeActionId: null, pendingDriverVehicleId: null, destinationX: null, qualifications: [],
        trainingState: { buildingId: 1, skill: 'driving.rock_fragmenter', ticksRemaining: 90, fee: 1 } } as never,
    ];
  };

  it('unpauses a waits-on-work step whose order is already issued (training active)', () => {
    const s = state();
    s.isPaused = true;
    const rails = new TutorialRails();
    rails.beginStep({ id: 'train-fragmenter', tickBudget: 25, waitsOnWork: true }, s);
    s.isPaused = true;
    inFlightTraining(s);
    rails.settleClockAfterResume(s);
    expect(s.isPaused).toBe(false);
  });

  it('unpauses while a detonation is pending (no training in flight)', () => {
    const s = state();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'blast', waitsOnWork: true }, s);
    s.isPaused = true;
    s.pendingDetonation = {} as never;
    rails.settleClockAfterResume(s);
    expect(s.isPaused).toBe(false);
  });

  it('unpauses a waits-on-work step with no player order (self-dispatching haul)', () => {
    const s = state();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'haul-debris', tickBudget: 30, waitsOnWork: true }, s);
    s.isPaused = true;
    rails.settleClockAfterResume(s);
    expect(s.isPaused).toBe(false);
  });

  it('stays paused when the step has no order in flight yet', () => {
    const s = state();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'train-fragmenter', tickBudget: 25, waitsOnWork: true }, s);
    rails.settleClockAfterResume(s);
    expect(s.isPaused).toBe(true);
  });

  it('pauses a non-waits-on-work step', () => {
    const s = state();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor' }, s);
    rails.settleClockAfterResume(s);
    expect(s.isPaused).toBe(true);
  });

  it('the pause is the player\'s: updateClock does not release it', () => {
    const s = state();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor', tickBudget: 25 }, s);
    rails.settleClockAfterResume(s);
    expect(s.isPaused).toBe(true);
    expect(rails.updateClock(s)).toBe(false);
    expect(s.isPaused).toBe(true);
    expect(rails.clockHeld).toBe(false);
  });

  it('the player\'s unpause sticks while the step has budget left', () => {
    const s = state();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor', tickBudget: 25 }, s);
    rails.settleClockAfterResume(s);
    s.isPaused = false;
    rails.updateClock(s);
    expect(s.isPaused).toBe(false);
  });

  it('under a rails hold the unpause is re-paused and the clock still reports held', () => {
    const s = state();
    const rails = new TutorialRails();
    rails.beginStep({ id: 'hire-surveyor', tickBudget: 25 }, s);
    s.tickCount = 100;
    rails.settleClockAfterResume(s);
    expect(s.isPaused).toBe(true);
    s.isPaused = false;
    expect(rails.updateClock(s)).toBe(true);
    expect(s.isPaused).toBe(true);
    expect(rails.clockHeld).toBe(true);
  });
});

// #1629: a stage's target can sit inside a panel's scrolling body, below the
// fold. The rails scroll it into view once per stage activation — never again
// while the player scrolls away, never on a re-rendered copy of the target.
describe('TutorialRails — scrolls an off-screen target into view once per stage activation (#1629)', () => {
  type Box = { top: number; bottom: number };
  const SCROLLER_BOX: Box = { top: 0, bottom: 200 };
  const VISIBLE: Box = { top: 50, bottom: 80 };
  const BELOW_FOLD: Box = { top: 400, bottom: 430 };

  function setBox(el: HTMLElement, box: Box): void {
    el.getBoundingClientRect = () => ({
      width: 40, height: box.bottom - box.top, top: box.top, bottom: box.bottom,
      left: 0, right: 40, x: 0, y: box.top, toJSON: () => ({}),
    }) as DOMRect;
  }

  /** A hire button inside a vertically scrolling body, as the Crew panel lays it out. */
  function scrolledHireButton(box: Box, host?: HTMLElement): { btn: HTMLElement; scrollIntoView: ReturnType<typeof vi.fn> } {
    const panel = host ?? document.createElement('div');
    if (!host) {
      panel.id = 'bs-employee-panel';
      // The panel itself scrolls (overflow auto) and spans the viewport, so it never clips.
      setBox(panel, { top: 0, bottom: 768 });
      document.body.appendChild(panel);
    }
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    setBox(scroller, SCROLLER_BOX);
    const btn = document.createElement('button');
    btn.dataset['role'] = 'surveyor';
    btn.dataset['candidateId'] = String(TUTORIAL_HIRING_SCRIPT.find(c => c.role === 'surveyor')!.id);
    setBox(btn, box);
    const scrollIntoView = vi.fn();
    (btn as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollIntoView;
    scroller.appendChild(btn);
    panel.appendChild(scroller);
    return { btn, scrollIntoView };
  }

  function railsForHire(): { rails: TutorialRails; s: GameState } {
    const rails = new TutorialRails();
    const s = state();
    rails.beginStep({ id: 'hire-surveyor' }, s);
    return { rails, s };
  }

  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
  });

  it('scrolls a target clipped by its scroller into view with nearest alignment', () => {
    const { btn, scrollIntoView } = scrolledHireButton(BELOW_FOLD);
    const { rails } = railsForHire();
    rails.refresh();
    expect(btn.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });

  it('does not scroll again on later refreshes of the same stage', () => {
    const { scrollIntoView } = scrolledHireButton(BELOW_FOLD);
    const { rails } = railsForHire();
    rails.refresh();
    rails.refresh();
    rails.refresh();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('does not scroll a re-rendered replacement of the target for the same stage', () => {
    const first = scrolledHireButton(BELOW_FOLD);
    const { rails } = railsForHire();
    rails.refresh();
    expect(first.scrollIntoView).toHaveBeenCalledTimes(1);

    const panel = document.getElementById('bs-employee-panel')!;
    panel.innerHTML = '';
    const second = scrolledHireButton(BELOW_FOLD, panel);
    rails.refresh();
    expect(second.scrollIntoView).not.toHaveBeenCalled();
  });

  it('does not scroll a target that is already visible, and a later clip is left alone', () => {
    const { btn, scrollIntoView } = scrolledHireButton(VISIBLE);
    const { rails } = railsForHire();
    rails.refresh();
    expect(scrollIntoView).not.toHaveBeenCalled();

    // The player scrolls it out of view: the activation is already consumed.
    setBox(btn, BELOW_FOLD);
    rails.refresh();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('scrolls a target that sits below the viewport even without a scrolling ancestor', () => {
    const panel = document.createElement('div');
    panel.id = 'bs-employee-panel';
    document.body.appendChild(panel);
    const btn = document.createElement('button');
    btn.dataset['role'] = 'surveyor';
    btn.dataset['candidateId'] = String(TUTORIAL_HIRING_SCRIPT.find(c => c.role === 'surveyor')!.id);
    setBox(btn, { top: 900, bottom: 930 });
    const scrollIntoView = vi.fn();
    (btn as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollIntoView;
    panel.appendChild(btn);

    const { rails } = railsForHire();
    rails.refresh();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('keeps retrying while the target is absent, then scrolls once when it appears', () => {
    const { rails } = railsForHire();
    expect(() => rails.refresh()).not.toThrow();
    rails.refresh();

    const { scrollIntoView } = scrolledHireButton(BELOW_FOLD);
    rails.refresh();
    rails.refresh();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('keeps retrying while the target is unreachable (display none), then scrolls once when shown', () => {
    const { btn, scrollIntoView } = scrolledHireButton(BELOW_FOLD);
    btn.style.display = 'none';
    const { rails } = railsForHire();
    rails.refresh();
    expect(scrollIntoView).not.toHaveBeenCalled();

    btn.style.display = '';
    rails.refresh();
    rails.refresh();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('a stage advance gives the new stage its own single scroll, leaving the earlier target alone', () => {
    const open = toolbarCrew();
    setBox(open, { top: 700, bottom: 720 }); // inside the viewport, no scroller
    const openScroll = vi.fn();
    (open as unknown as { scrollIntoView: unknown }).scrollIntoView = openScroll;
    const { rails } = railsForHire();
    rails.refresh();
    expect(rails.progress.index).toBe(0);
    expect(openScroll).not.toHaveBeenCalled();

    const { scrollIntoView } = scrolledHireButton(BELOW_FOLD);
    rails.refresh();
    expect(rails.progress.index).toBe(1);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    rails.refresh();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(openScroll).not.toHaveBeenCalled();
  });

  it('beginStep resets the activation so the same stage scrolls again on a new step run', () => {
    const { scrollIntoView } = scrolledHireButton(BELOW_FOLD);
    const { rails, s } = railsForHire();
    rails.refresh();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    rails.beginStep({ id: 'hire-surveyor' }, s);
    rails.refresh();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('clear resets the activation', () => {
    const { scrollIntoView } = scrolledHireButton(BELOW_FOLD);
    const { rails, s } = railsForHire();
    rails.refresh();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    rails.clear();
    rails.refresh();
    expect(scrollIntoView).toHaveBeenCalledTimes(1); // nothing staged after clear
    rails.beginStep({ id: 'hire-surveyor' }, s);
    rails.refresh();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('does not scroll while the stage is waiting on the simulation, and scrolls once the wait ends', () => {
    const bar = document.createElement('div');
    bar.id = 'bs-toolbar';
    const open = document.createElement('button');
    open.dataset['panel'] = 'build';
    bar.appendChild(open);
    document.body.appendChild(bar);
    withBox(open);

    const panel = document.createElement('div');
    panel.id = 'bs-build-panel';
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    setBox(scroller, SCROLLER_BOX);
    const wrap = document.createElement('div');
    wrap.setAttribute('data-build-type', 'living_quarters');
    const buy = document.createElement('button');
    buy.className = 'bs-build-buy-btn';
    setBox(buy, BELOW_FOLD);
    const scrollIntoView = vi.fn();
    (buy as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollIntoView;
    wrap.appendChild(buy);
    scroller.appendChild(wrap);
    panel.appendChild(scroller);
    document.body.appendChild(panel);

    const rails = new TutorialRails();
    const s = state();
    rails.beginStep({ id: 'build-living-quarters' }, s);
    s.plannedBuildings = [
      { id: 1, buildingId: 1, type: 'living_quarters', tier: 1, x: 29, z: 12, actionId: 1, cost: 100 } as never,
    ];
    expect(rails.refresh(s).waiting).toBe(true);
    expect(scrollIntoView).not.toHaveBeenCalled();

    s.plannedBuildings = [];
    expect(rails.refresh(s).waiting).toBe(false);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('never clicks the target on the player\'s behalf', () => {
    const { btn } = scrolledHireButton(BELOW_FOLD);
    const click = vi.fn();
    btn.addEventListener('click', click);
    const { rails } = railsForHire();
    rails.refresh();
    expect(click).not.toHaveBeenCalled();
  });

  it('tolerates a host without scrollIntoView', () => {
    const { btn } = scrolledHireButton(BELOW_FOLD);
    delete (btn as unknown as { scrollIntoView?: unknown }).scrollIntoView;
    const { rails } = railsForHire();
    expect(() => rails.refresh()).not.toThrow();
  });
});
