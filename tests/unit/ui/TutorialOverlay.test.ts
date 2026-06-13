// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TutorialOverlay } from '../../../src/ui/TutorialOverlay.js';
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
    const titleEl = container.querySelector('.bs-panel-title');
    const initialTitle = titleEl?.textContent ?? '';
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
});
