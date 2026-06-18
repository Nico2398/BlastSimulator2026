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
    it('does NOT render skip or next buttons for any step', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      tut.start(createMockState());

      expect(container.querySelector('.bs-btn-skip')).toBeNull();
      expect(container.querySelector('.bs-btn-primary')).toBeNull();
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

  describe('highlight system', () => {
    it('clearHighlight safely handles null highlightedEl', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      expect(() => tut.clearHighlight()).not.toThrow();
    });

    it('render() applies highlight class to element matching highlightTarget', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      // Create a target element matching the highlight target for step 0
      const target = document.createElement('div');
      target.className = 'bs-speed-btn';
      const hudTop = document.createElement('div');
      hudTop.id = 'bs-hud-top';
      hudTop.appendChild(target);
      document.body.appendChild(hudTop);

      tut.start(createMockState());
      // Step 0 (time-speed) has highlightTarget '#bs-hud-top .bs-speed-btn'
      expect(target.classList.contains('bs-tutorial-highlight')).toBe(true);
      hudTop.remove();
    });

    it('highlight is cleared when advancing to next step', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const target = document.createElement('div');
      target.className = 'bs-speed-btn';
      const hudTop = document.createElement('div');
      hudTop.id = 'bs-hud-top';
      hudTop.appendChild(target);
      document.body.appendChild(hudTop);

      tut.start(createMockState());
      expect(target.classList.contains('bs-tutorial-highlight')).toBe(true);

      // Advance by completing step 0 (time-speed: increase timeScale)
      const state = createMockState();
      state.timeScale = 2;
      tut.onCommandExecuted(state);
      // After advancing, highlight should be removed from old element
      // (and new highlight may be applied if new step has target)
      expect(target.classList.contains('bs-tutorial-highlight')).toBe(false);
      hudTop.remove();
    });

    it('highlight is cleared on tutorial skip/finish', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const target = document.createElement('div');
      target.className = 'bs-speed-btn';
      const hudTop = document.createElement('div');
      hudTop.id = 'bs-hud-top';
      hudTop.appendChild(target);
      document.body.appendChild(hudTop);

      tut.start(createMockState());
      expect(target.classList.contains('bs-tutorial-highlight')).toBe(true);

      tut.skip();
      expect(target.classList.contains('bs-tutorial-highlight')).toBe(false);
      hudTop.remove();
    });

    it('highlight is cleared on dispose', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const target = document.createElement('div');
      target.className = 'bs-speed-btn';
      const hudTop = document.createElement('div');
      hudTop.id = 'bs-hud-top';
      hudTop.appendChild(target);
      document.body.appendChild(hudTop);

      tut.start(createMockState());
      expect(target.classList.contains('bs-tutorial-highlight')).toBe(true);

      tut.dispose();
      overlay = null;
      expect(target.classList.contains('bs-tutorial-highlight')).toBe(false);
      hudTop.remove();
    });

    it('highlightTarget with undefined selector does not throw', () => {
      // Step 22 (congratulations) has no highlightTarget
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      tut.stepIndex = 22;
      expect(() => tut.render()).not.toThrow();
    });

    it('highlightTarget pointing to non-existent element does not throw', () => {
      // Create a step whose highlightTarget won't be in DOM
      (TUTORIAL_STEPS[0] as any).highlightTarget = '#non-existent-element';
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      expect(() => tut.render()).not.toThrow();
      // Restore
      delete (TUTORIAL_STEPS[0] as any).highlightTarget;
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

  describe('setGameConsole', () => {
    it('stores the function and does not throw', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      const fn = vi.fn();
      expect(() => tut.setGameConsole(fn)).not.toThrow();
    });
  });

  describe('step 9 command execution and auto-fire', () => {
    it('advancing to step 9 via advanceToNextStep executes tick 3 command', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const state = createMockState();
      const gameConsole = vi.fn();
      tut.setGameConsole(gameConsole);
      tut.start(state);

      // Set to step 8 (scores) so advanceToNextStep goes to step 9 (event-fire-resolve)
      tut.stepIndex = 8;
      tut.advanceToNextStep();

      expect(tut.stepIndex).toBe(9);
      expect(gameConsole).toHaveBeenCalledWith('tick 3');
    });

    it('auto-fires tutorial_synergy_consultant when pendingEvent is null after step 9 commands', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const state = createMockState();
      const gameConsole = vi.fn();
      tut.setGameConsole(gameConsole);
      tut.start(state);

      // createMockState does not include events → pendingEvent is undefined (== null)
      tut.stepIndex = 8;
      tut.advanceToNextStep();

      expect(gameConsole).toHaveBeenCalledWith('event fire tutorial_synergy_consultant');
    });

    it('advanceOneStep handles null gameConsole without crashing', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const state = createMockState();
      tut.start(state);
      // Do NOT call setGameConsole — gameConsole stays null

      tut.stepIndex = 8;
      expect(() => tut.advanceToNextStep()).not.toThrow();
      expect(tut.stepIndex).toBe(9);
    });
  });

  describe('completion sequence', () => {
    it('advancing through all steps finishes the tutorial after completion delay', () => {
      vi.useFakeTimers();
      const tut = new TutorialOverlay(container);
      overlay = tut;
      const state = createMockState();
      tut.start(state);

      expect(tut.isActive).toBe(true);
      for (let i = 0; i < TOTAL_TUTORIAL_STEPS; i++) {
        tut.onCommandExecuted(state);
      }
      // After the implementation change: finish() is delayed by 4s
      // so isActive remains true until the timer fires.
      // On current code: finish() is called immediately → isActive becomes false.
      expect(tut.isActive).toBe(true);

      vi.advanceTimersByTime(4000);
      expect(tut.isActive).toBe(false);
      expect(TutorialOverlay.isCompleted()).toBe(true);
      vi.useRealTimers();
    });

    it('completion message shows Tutorial Complete! title and text', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      tut.start(createMockState());

      // Directly set to congratulations step (index 22) and render
      tut.stepIndex = 22;
      tut.render();

      const titleEl = container.querySelector('.bs-panel-title') as HTMLElement;
      const textEl = container.querySelector('.bs-panel-text') as HTMLElement;
      // After implementation: keys changed to tutorial.complete_title / tutorial.complete_text
      // which translate to "Tutorial Complete!" and the completion text.
      expect(titleEl.textContent).toBe('Tutorial Complete!');
      expect(textEl.textContent).toBe("You've completed the tutorial. You're ready to run this mine!");
    });

    it('completion message is visible for at least 4 seconds before auto-dismiss', () => {
      vi.useFakeTimers();
      const tut = new TutorialOverlay(container);
      overlay = tut;
      const state = createMockState();
      tut.start(state);

      // Advance through all steps to trigger the congratulations guard
      for (let i = 0; i < TOTAL_TUTORIAL_STEPS; i++) {
        tut.onCommandExecuted(state);
      }

      // After change: 4s timer set, still active
      expect(tut.isActive).toBe(true);

      // Just before the 4s mark — still visible
      vi.advanceTimersByTime(3500);
      expect(tut.isActive).toBe(true);

      // Past the 4s mark — timer fired and finished
      vi.advanceTimersByTime(1000);
      expect(tut.isActive).toBe(false);

      vi.useRealTimers();
    });

    it('skip() immediately finishes even during completion message', () => {
      vi.useFakeTimers();
      const tut = new TutorialOverlay(container);
      overlay = tut;
      const state = createMockState();
      tut.start(state);

      // Advance through all steps to the congratulations step
      for (let i = 0; i < TOTAL_TUTORIAL_STEPS; i++) {
        tut.onCommandExecuted(state);
      }

      // After change: still active because of the 4s timer
      expect(tut.isActive).toBe(true);

      // skip() must finish immediately without advancing timers
      tut.skip();
      expect(tut.isActive).toBe(false);

      vi.useRealTimers();
    });

    it('finish() is idempotent — calling skip() multiple times does not throw', () => {
      vi.useFakeTimers();
      const tut = new TutorialOverlay(container);
      overlay = tut;
      const state = createMockState();
      tut.start(state);

      // Advance through all steps
      for (let i = 0; i < TOTAL_TUTORIAL_STEPS; i++) {
        tut.onCommandExecuted(state);
      }

      tut.skip();
      expect(tut.isActive).toBe(false);

      // Second skip must not throw (isActive check in skip returns early)
      expect(() => tut.skip()).not.toThrow();
      expect(tut.isActive).toBe(false);

      vi.useRealTimers();
    });

    it('isCompleted returns true only after tutorial fully completes', () => {
      vi.useFakeTimers();
      try { localStorage.removeItem('bs_tutorial_done'); } catch { /* ignore */ }
      expect(TutorialOverlay.isCompleted()).toBe(false);

      const tut = new TutorialOverlay(container);
      overlay = tut;
      const state = createMockState();
      tut.start(state);

      for (let i = 0; i < TOTAL_TUTORIAL_STEPS; i++) {
        tut.onCommandExecuted(state);
      }

      // On current code: finish() called during the loop → isCompleted() already true (FAILS)
      // After change: finish() delayed by 4s → isCompleted() still false (PASSES)
      expect(TutorialOverlay.isCompleted()).toBe(false);

      vi.advanceTimersByTime(4000);
      expect(TutorialOverlay.isCompleted()).toBe(true);

      vi.useRealTimers();
    });
  });
});
