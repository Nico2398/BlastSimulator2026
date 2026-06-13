// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TutorialOverlay } from '../../../src/ui/TutorialOverlay.js';
import { TUTORIAL_STEPS } from '../../../src/ui/tutorialSteps.js';
import type { GameState } from '../../../src/core/state/GameState.js';

function createMockState(): GameState {
  return {
    isPaused: false,
    time: 0,
    tickCount: 0,
    seed: 42,
    version: 5,
    mineType: 'tutorial',
    world: null,
    navGrid: null,
    surveyResults: [],
    drillHoles: [],
    pendingActions: [],
    employees: [] as unknown as GameState['employees'],
    vehicles: [] as unknown as GameState['vehicles'],
    buildings: {} as GameState['buildings'],
  } as GameState;
}

describe('TutorialOverlay (12.4)', () => {
  let container: HTMLDivElement;
  let overlay: TutorialOverlay | null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    overlay = null;
    try { localStorage.removeItem('bs_tutorial_done'); } catch { /* ignore */ }
  });

  afterEach(() => {
    overlay?.dispose();
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  // ── 1 ────────────────────────────────────────────────────────────────────
  it('creates overlay element with bs-confirm-overlay class', () => {
    const tut = new TutorialOverlay(container);
    overlay = tut;
    const el = container.querySelector('.bs-confirm-overlay');
    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(HTMLElement);
  });

  // ── 2 ────────────────────────────────────────────────────────────────────
  it('creates box element with bs-confirm-box class', () => {
    const tut = new TutorialOverlay(container);
    overlay = tut;
    const el = container.querySelector('.bs-confirm-box');
    expect(el).not.toBeNull();
    expect(el).toBeInstanceOf(HTMLElement);
  });

  // ── 3 ────────────────────────────────────────────────────────────────────
  it('isActive returns false before start()', () => {
    const tut = new TutorialOverlay(container);
    overlay = tut;
    expect(tut.isActive).toBe(false);
  });

  // ── 4 ────────────────────────────────────────────────────────────────────
  it('start(state) sets isActive to true', () => {
    const tut = new TutorialOverlay(container);
    overlay = tut;
    const state = createMockState();
    tut.start(state);
    expect(tut.isActive).toBe(true);
  });

  // ── 5 ────────────────────────────────────────────────────────────────────
  it('start(state) pauses the game', () => {
    const tut = new TutorialOverlay(container);
    overlay = tut;
    const state = createMockState();
    state.isPaused = false;
    tut.start(state);
    expect(state.isPaused).toBe(true);
  });

  // ── 6 ────────────────────────────────────────────────────────────────────
  it('skip() sets isActive to false', () => {
    const tut = new TutorialOverlay(container);
    overlay = tut;
    const state = createMockState();
    tut.start(state);
    tut.skip();
    expect(tut.isActive).toBe(false);
  });

  // ── 7 ────────────────────────────────────────────────────────────────────
  it('skip() unpauses the game', () => {
    const tut = new TutorialOverlay(container);
    overlay = tut;
    const state = createMockState();
    state.isPaused = true;
    tut.start(state);
    tut.skip();
    expect(state.isPaused).toBe(false);
  });

  // ── 8 ────────────────────────────────────────────────────────────────────
  it('skip() persists completion to localStorage', () => {
    const tut = new TutorialOverlay(container);
    overlay = tut;
    const state = createMockState();
    tut.start(state);
    tut.skip();
    expect(TutorialOverlay.isCompleted()).toBe(true);
  });

  // ── 9 ────────────────────────────────────────────────────────────────────
  it('isCompleted() returns false before tutorial is skipped', () => {
    expect(TutorialOverlay.isCompleted()).toBe(false);
  });

  // ── 10 ───────────────────────────────────────────────────────────────────
  it('dispose() removes overlay element from the DOM', () => {
    const tut = new TutorialOverlay(container);
    overlay = tut;
    tut.dispose();
    overlay = null; // prevent double-dispose
    expect(container.querySelector('.bs-confirm-overlay')).toBeNull();
  });

  // ── 11 ───────────────────────────────────────────────────────────────────
  it('shows step counter with "1 / 23" at step 0', () => {
    const tut = new TutorialOverlay(container);
    overlay = tut;
    const state = createMockState();
    tut.start(state);
    const allEls = Array.from(container.querySelectorAll('*'));
    const counter = allEls.find(el => /\d\s*\/\s*\d/.test(el.textContent ?? ''));
    expect(counter).toBeDefined();
    expect(counter?.textContent).toContain('1');
    expect(counter?.textContent).toContain('23');
  });

  // ── 12 ───────────────────────────────────────────────────────────────────
  it('onCommandExecuted advances step when current step.isComplete returns true', () => {
    const tut = new TutorialOverlay(container);
    overlay = tut;
    const state = createMockState();
    tut.start(state);
    const titleEl = container.querySelector('.bs-panel-title');
    const initialTitle = titleEl?.textContent ?? '';
    // Simulate that the current step's isComplete condition is met
    tut.onCommandExecuted(state);
    const newTitle = titleEl?.textContent ?? '';
    // The title should have changed to reflect the next step
    expect(newTitle).not.toBe(initialTitle);
  });

  // ── 13 ───────────────────────────────────────────────────────────────────
  it('onCommandExecuted does NOT advance when step.isComplete returns false', () => {
    const tut = new TutorialOverlay(container);
    overlay = tut;
    const state = createMockState();
    tut.start(state);
    // Advance past welcome (step 0, isComplete: () => true) to survey step (step 1)
    tut.onCommandExecuted(state);
    const titleEl = container.querySelector('.bs-panel-title');
    const initialTitle = titleEl?.textContent ?? '';
    // Step 1 (survey) requires surveyResults.length > 0, but mock has empty []
    tut.onCommandExecuted(state);
    // Title should remain unchanged because the step is not yet complete
    expect(titleEl?.textContent).toBe(initialTitle);
  });

  // ── 14 ───────────────────────────────────────────────────────────────────
  it('creates a skip button inside the overlay', () => {
    const tut = new TutorialOverlay(container);
    overlay = tut;
    const btn = container.querySelector('.bs-confirm-box button');
    expect(btn).not.toBeNull();
  });

  // ── 15 ───────────────────────────────────────────────────────────────────
  it('start() makes the overlay visible (display is not none)', () => {
    const tut = new TutorialOverlay(container);
    overlay = tut;
    const state = createMockState();
    tut.start(state);
    const overlayEl = container.querySelector('.bs-confirm-overlay') as HTMLElement;
    expect(overlayEl).not.toBeNull();
    expect(overlayEl.style.display).not.toBe('none');
  });

  // ── 16 ───────────────────────────────────────────────────────────────────
  it('skip() hides the overlay (display becomes none)', () => {
    const tut = new TutorialOverlay(container);
    overlay = tut;
    const state = createMockState();
    tut.start(state);
    tut.skip();
    const overlayEl = container.querySelector('.bs-confirm-overlay') as HTMLElement;
    expect(overlayEl).not.toBeNull();
    expect(overlayEl.style.display).toBe('none');
  });

  // ── 17 ───────────────────────────────────────────────────────────────────
  it('calling start() multiple times resets back to step 0', () => {
    const tut = new TutorialOverlay(container);
    overlay = tut;
    const state = createMockState();
    tut.start(state);
    // First start shows step 0 → "1 / 23"
    tut.start(state);
    // After second start, should still show step 0
    const allEls = Array.from(container.querySelectorAll('*'));
    const counter = allEls.find(el => /\d\s*\/\s*\d/.test(el.textContent ?? ''));
    expect(counter).toBeDefined();
    expect(counter?.textContent).toContain('1');
  });

  // ── 18 ───────────────────────────────────────────────────────────────────
  it('start() with a pre-paused state keeps isPaused true', () => {
    const tut = new TutorialOverlay(container);
    overlay = tut;
    const state = createMockState();
    state.isPaused = true;
    tut.start(state);
    expect(state.isPaused).toBe(true);
  });

  // ── 19 ───────────────────────────────────────────────────────────────────
  it('onCommandExecuted when tutorial is not active is a no-op', () => {
    const tut = new TutorialOverlay(container);
    overlay = tut;
    const state = createMockState();
    // Do NOT call start() — tutorial is inactive
    expect(() => tut.onCommandExecuted(state)).not.toThrow();
  });

  // ── 20 ───────────────────────────────────────────────────────────────────
  it('dispose() removes all overlay elements from the container', () => {
    const tut = new TutorialOverlay(container);
    overlay = tut;
    // Before dispose the overlay exists
    expect(container.querySelector('.bs-confirm-overlay')).not.toBeNull();
    tut.dispose();
    overlay = null;
    // After dispose the container has no overlay
    expect(container.querySelector('.bs-confirm-overlay')).toBeNull();
  });

  // ── 21 ───────────────────────────────────────────────────────────────────
  it('captureSnapshotForCurrentStep stores snapshot for step 0 with timeScale data', () => {
    const tut = new TutorialOverlay(container) as any;
    const state = createMockState();
    state.timeScale = 2;
    tut.start(state);
    // Step 0 (time-speed) captureSnapshot should capture timeScale from game state
    expect(tut.stepSnapshots[0]).toBeDefined();
    expect(tut.stepSnapshots[0].timeScale).toBe(2);
  });

  // ── 22 ───────────────────────────────────────────────────────────────────
  it('TUTORIAL_STEPS[0].captureSnapshot is defined and captures timeScale', () => {
    const step0 = TUTORIAL_STEPS[0];
    expect(step0.captureSnapshot).toBeDefined();
    const state = { timeScale: 1 } as GameState;
    const snap = step0.captureSnapshot!(state);
    expect(snap.timeScale).toBeDefined();
    expect(snap.timeScale).toBe(1);
  });

  // ── 23 ───────────────────────────────────────────────────────────────────
  it('start() sets autoAdvanceTimer for step 0 (time-speed auto-advance)', () => {
    const tut = new TutorialOverlay(container) as any;
    const state = createMockState();
    tut.start(state);
    // Step 0 (time-speed) has autoAdvanceMs=2000, so timer should be set
    expect(tut.autoAdvanceTimer).not.toBeNull();
  });

  // ── 24 ───────────────────────────────────────────────────────────────────
  it('skip() clears autoAdvanceTimer when timer is active', () => {
    const tut = new TutorialOverlay(container) as any;
    const state = createMockState();
    tut.start(state);
    // Step 0 is auto-advance, so timer should have been set
    expect(tut.autoAdvanceTimer).not.toBeNull();
    const timerBefore = tut.autoAdvanceTimer;
    tut.skip();
    // After skip, timer should be cleared
    expect(tut.autoAdvanceTimer).toBeNull();
    // The old timer should be distinct from the cleared state
    expect(timerBefore).not.toBe(tut.autoAdvanceTimer);
  });

  // ── 25 ───────────────────────────────────────────────────────────────────
  it('finish() clears stepSnapshots and autoAdvanceTimer', () => {
    const tut = new TutorialOverlay(container) as any;
    const state = createMockState();
    tut.start(state);
    // After start, stepSnapshots should have at least one entry and timer should be set
    expect(tut.stepSnapshots.length).toBeGreaterThanOrEqual(1);
    expect(tut.autoAdvanceTimer).not.toBeNull();
    tut.skip(); // calls finish() internally
    expect(tut.stepSnapshots.length).toBe(0);
    expect(tut.autoAdvanceTimer).toBeNull();
  });

  // ── 26 ───────────────────────────────────────────────────────────────────
  it('render() hides next button for auto-advance step 0', () => {
    const tut = new TutorialOverlay(container);
    const state = createMockState();
    tut.start(state);
    const buttons = Array.from(container.querySelectorAll('button'));
    const nextBtn = buttons.find(b => b.className.includes('bs-btn-primary'));
    expect(nextBtn).toBeDefined();
    // For auto-advance step (step 0 in new sequence), next button should be hidden
    expect(nextBtn!.style.display).toBe('none');
  });

  // ── 27 ───────────────────────────────────────────────────────────────────
  it('advancing from step 0 captures snapshot for step 1 with meaningful data', () => {
    const tut = new TutorialOverlay(container) as any;
    const state = createMockState();
    tut.start(state);
    // Step 0 (welcome currently) isComplete returns true immediately
    tut.onCommandExecuted(state);
    // After advancing to step 1, its snapshot should be captured
    expect(tut.stepSnapshots[1]).toBeDefined();
    // Step 1 (hire-surveyor) should capture snapshot data about current employees
    const snap1 = tut.stepSnapshots[1];
    expect(typeof snap1).toBe('object');
    // It should contain meaningful data, not just an empty object
    expect(Object.keys(snap1).length).toBeGreaterThan(0);
  });
});
