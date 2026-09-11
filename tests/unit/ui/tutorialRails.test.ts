// @vitest-environment jsdom
// BlastSimulator2026 — Tutorial rails, stateful half

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TutorialRails } from '../../../src/ui/tutorialRails.js';
import { ALLOWED_CLASS, HIGHLIGHT_CLASS, DEFAULT_TICK_BUDGET, WORK_GRACE_TICKS } from '../../../src/ui/tutorialGuide.js';
import { t } from '../../../src/core/i18n/I18n.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { getPickerRegion } from '../../../src/ui/tutorialPickerRegion.js';
import { stagesFor } from '../../../src/ui/tutorialStages.js';
import { SPEED_BUTTON_GROUP, SURVEY_OVERLAY_TOGGLE_TARGET } from '../../../src/ui/tutorialStepHelpers.js';
import type { GameState } from '../../../src/core/state/GameState.js';

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
    rails.beginStep({ id: 'survey', tickBudget: 5, waitsOnWork: true }, s);
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

  it('build-living-quarters (issue\'s own example): reports waiting and releases the buy button\'s highlight once the order lands, keeping it clickable', () => {
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
    expect(buyBtn.classList.contains(ALLOWED_CLASS)).toBe(true);
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
