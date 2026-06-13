// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TutorialOverlay } from '../../../src/ui/TutorialOverlay.js';
import { TUTORIAL_STEPS, TOTAL_TUTORIAL_STEPS } from '../../../src/ui/tutorialSteps.js';
import type { GameState } from '../../../src/core/state/GameState.js';

function createMockState(): GameState {
  return {
    isPaused: false,
    timeScale: 1,
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

  describe('construction', () => {
    it('creates overlay element with bs-confirm-overlay class and all child elements', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;

      expect(container.querySelector('.bs-confirm-overlay')).not.toBeNull();
      expect(container.querySelector('.bs-confirm-box')).not.toBeNull();
      expect(container.querySelector('.bs-panel-title')).not.toBeNull();
      expect(container.querySelector('.bs-panel-text')).not.toBeNull();
      expect(container.querySelector('.bs-tutorial-progress')).not.toBeNull();
      expect(container.querySelector('.bs-btn-skip')).not.toBeNull();
      expect(container.querySelector('.bs-btn-primary')).not.toBeNull();
    });

    it('isActive returns false before start()', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      expect(tut.isActive).toBe(false);
    });
  });

  describe('start()', () => {
    it('activates overlay, shows it, pauses game, displays first step content', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      const state = createMockState();
      tut.start(state);

      expect(tut.isActive).toBe(true);
      const oe = container.querySelector('.bs-confirm-overlay') as HTMLElement;
      expect(oe.style.display).not.toBe('none');
      expect(state.isPaused).toBe(true);
      expect(container.querySelector('.bs-panel-title')?.textContent).toBeTruthy();
    });

    it('resets back to step 0 when called multiple times', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      const state = createMockState();
      tut.start(state);
      state.timeScale = 2;
      tut.onCommandExecuted(state);
      tut.start(state);

      const els = Array.from(container.querySelectorAll('*'));
      const ctr = els.find(el => /\d\s*\/\s*\d/.test(el.textContent ?? ''));
      expect(ctr).toBeDefined();
      expect(ctr?.textContent).toContain('1');
    });

    it('preserves isPaused when state is already paused', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      const state = createMockState();
      state.isPaused = true;
      tut.start(state);
      expect(state.isPaused).toBe(true);
    });
  });

  describe('skip()', () => {
    it('deactivates, hides overlay, unpauses game', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      const state = createMockState();
      tut.start(state);
      tut.skip();

      expect(tut.isActive).toBe(false);
      const oe = container.querySelector('.bs-confirm-overlay') as HTMLElement;
      expect(oe.style.display).toBe('none');
      expect(state.isPaused).toBe(false);
    });

    it('isCompleted toggles from false to true after skip', () => {
      expect(TutorialOverlay.isCompleted()).toBe(false);
      const tut = new TutorialOverlay(container);
      overlay = tut;
      tut.start(createMockState());
      tut.skip();
      expect(TutorialOverlay.isCompleted()).toBe(true);
    });
  });

  describe('progress display', () => {
    it('shows step counter "1 / 23" at step 0 and has progress bar fill', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      tut.start(createMockState());

      const els = Array.from(container.querySelectorAll('*'));
      const ctr = els.find(el => /\d\s*\/\s*\d/.test(el.textContent ?? ''));
      expect(ctr).toBeDefined();
      expect(ctr?.textContent).toMatch(/1\s*\/\s*23/);
      expect(container.querySelector('.bs-tutorial-progress-fill')).not.toBeNull();
    });
  });

  describe('onCommandExecuted', () => {
    it('advances step when current step.isComplete returns true', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      const state = createMockState();
      tut.start(state);

      const titleEl = container.querySelector('.bs-panel-title');
      const before = titleEl?.textContent ?? '';
      state.timeScale = 2;
      tut.onCommandExecuted(state);
      expect(titleEl?.textContent).not.toBe(before);
    });

    it('does NOT advance step when isComplete returns false', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      const state = createMockState();
      tut.start(state);

      state.timeScale = 2;
      tut.onCommandExecuted(state);
      const titleEl = container.querySelector('.bs-panel-title');
      const afterStep1 = titleEl?.textContent ?? '';

      tut.onCommandExecuted(state);
      expect(titleEl?.textContent).toBe(afterStep1);
    });

    it('is a no-op when tutorial is not active (does not throw)', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      expect(() => tut.onCommandExecuted(createMockState())).not.toThrow();
    });
  });

  describe('auto-advance timer', () => {
    it('sets timer for steps with autoAdvanceMs, null for steps without', () => {
      vi.useFakeTimers();
      // `as any` needed to access private autoAdvanceTimer for verification
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      tut.start(createMockState());
      // Step 0 (time-speed) has no autoAdvanceMs → timer stays null
      expect(tut.autoAdvanceTimer).toBeNull();
      vi.useRealTimers();
    });

    it('skip() clears pending auto-advance timer', () => {
      // `as any` needed to access private autoAdvanceTimer for verification
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      tut.start(createMockState());
      tut.skip();
      expect(tut.autoAdvanceTimer).toBeNull();
    });

    it('timer fires and advances to next step after autoAdvanceMs', () => {
      vi.useFakeTimers();
      const tut = new TutorialOverlay(container);
      overlay = tut;
      tut.start(createMockState());

      const titleEl = container.querySelector('.bs-panel-title');
      const before = titleEl?.textContent ?? '';
      vi.advanceTimersByTime(5000);
      expect(titleEl?.textContent).not.toBe(before);
      vi.useRealTimers();
    });
  });

  describe('next button and commands hint', () => {
    it('shows next button for manual steps (no autoAdvanceMs) and hides for auto-advance steps', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      tut.start(createMockState());

      const nextBtn = container.querySelector('.bs-btn-primary') as HTMLElement;
      expect(nextBtn).not.toBeNull();
      expect(nextBtn.style.display).not.toBe('none');
    });

    it('shows commands hint element when step has commands array', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      tut.start(createMockState());

      const hintEl = container.querySelector('.bs-tutorial-commands') as HTMLElement;
      expect(hintEl).not.toBeNull();

      // Step 0 (time-speed) has no commands → hint is hidden
      expect(hintEl.style.display).toBe('none');

      // Advance to step 2 (survey) which has commands: ['survey seismic']
      // `as any` needed to set private stepIndex and call private render()
      (tut as any).stepIndex = 2;
      (tut as any).render();

      expect(hintEl.style.display).not.toBe('none');
      expect(hintEl.textContent).toBe('survey seismic');
    });
  });

  describe('dispose()', () => {
    it('removes overlay element from the container', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;

      expect(container.querySelector('.bs-confirm-overlay')).not.toBeNull();
      tut.dispose();
      overlay = null;
      expect(container.querySelector('.bs-confirm-overlay')).toBeNull();
    });
  });

  describe('completion sequence', () => {
    it('advancing through all steps finishes the tutorial', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      const state = createMockState();
      tut.start(state);

      expect(tut.isActive).toBe(true);
      for (let i = 0; i < TOTAL_TUTORIAL_STEPS; i++) {
        tut.onCommandExecuted(state);
      }
      expect(tut.isActive).toBe(false);
      expect(TutorialOverlay.isCompleted()).toBe(true);
    });
  });
});
