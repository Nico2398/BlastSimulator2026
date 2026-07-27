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

/**
 * Walk the card to the final (congratulations) step.
 *
 * The overlay only moves when a step's own condition is satisfied, so a test
 * that wants to reach the end drives the advance directly rather than firing
 * commands that satisfy nothing.
 */
function walkToCongratulations(tut: TutorialOverlay): void {
  const t = tut as unknown as { stepIndex: number; advanceToNextStep(): void };
  while (t.stepIndex < TOTAL_TUTORIAL_STEPS - 1) {
    t.advanceToNextStep();
  }
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
    it('creates the coach-mark card with all child elements', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;

      expect(container.querySelector('.bs-tutorial-overlay')).not.toBeNull();
      expect(container.querySelector('.bs-tutorial-box')).not.toBeNull();
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
      const oe = container.querySelector('.bs-tutorial-overlay') as HTMLElement;
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

  describe('pause handling', () => {
    it('pauses on start so the player can read the opening card', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      const state = createMockState();
      tut.start(state);
      expect(state.isPaused).toBe(true);
    });

    it('resumes the simulation once the first step is done', () => {
      // Survey, drilling, hauling and delivery are queued actions that only
      // resolve on a tick — a permanently paused tutorial can never finish them.
      const tut = new TutorialOverlay(container);
      overlay = tut;
      const state = createMockState();
      tut.start(state);
      expect(state.isPaused).toBe(true);

      state.timeScale = 2;
      tut.onCommandExecuted(state);
      expect(state.isPaused).toBe(false);
    });

    it('stays unpaused across later steps', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const state = createMockState();
      tut.start(state);
      tut.advanceToNextStep();
      tut.advanceToNextStep();
      expect(state.isPaused).toBe(false);
    });
  });

  describe('no escape hatch', () => {
    it('exposes no skip method — the tutorial cannot be abandoned', () => {
      const tut = new TutorialOverlay(container) as unknown as Record<string, unknown>;
      overlay = tut as unknown as TutorialOverlay;
      expect(tut['skip']).toBeUndefined();
    });

    it('finishing deactivates, hides the overlay and unpauses the game', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const state = createMockState();
      tut.start(state);
      tut.finish();

      expect(tut.isActive).toBe(false);
      const oe = container.querySelector('.bs-tutorial-overlay') as HTMLElement;
      expect(oe.style.display).toBe('none');
      expect(state.isPaused).toBe(false);
    });

    it('isCompleted toggles from false to true once the tutorial finishes', () => {
      expect(TutorialOverlay.isCompleted()).toBe(false);
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      tut.start(createMockState());
      tut.finish();
      expect(TutorialOverlay.isCompleted()).toBe(true);
    });

    it('takes the guided class off the body when it finishes', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      tut.start(createMockState());
      expect(document.body.classList.contains('bs-tutorial-guided')).toBe(true);
      tut.finish();
      expect(document.body.classList.contains('bs-tutorial-guided')).toBe(false);
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

    it('finishing clears a pending auto-advance timer', () => {
      // `as any` needed to access private autoAdvanceTimer for verification
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      tut.start(createMockState());
      tut.finish();
      expect(tut.autoAdvanceTimer).toBeNull();
    });

    it('poll timer advances the step once its condition becomes true', () => {
      vi.useFakeTimers();
      const tut = new TutorialOverlay(container);
      overlay = tut;
      const state = createMockState();
      tut.start(state);

      const titleEl = container.querySelector('.bs-panel-title');
      const before = titleEl?.textContent ?? '';

      // Nothing satisfied yet — polling must leave the card where it is.
      vi.advanceTimersByTime(5000);
      expect(titleEl?.textContent).toBe(before);

      // The player raises the speed; the next poll picks it up.
      state.timeScale = 2;
      vi.advanceTimersByTime(2500);
      expect(titleEl?.textContent).not.toBe(before);
      vi.useRealTimers();
    });
  });

  describe('next button and commands hint', () => {
    it('renders NO Skip control — the tutorial cannot be abandoned', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      tut.start(createMockState());

      expect(container.querySelector('.bs-btn-skip')).toBeNull();
    });

    it('renders NO Next control — the only way forward is doing the step', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      tut.start(createMockState());

      expect(container.querySelector('.bs-btn-next')).toBeNull();
    });

    it('the card carries no buttons at all', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      tut.start(createMockState());

      expect(container.querySelectorAll('.bs-tutorial-box button')).toHaveLength(0);
      expect(tut.isActive).toBe(true);
    });

    it('shows commands hint element when step has commands array', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      tut.start(createMockState());

      const hintEl = container.querySelector('.bs-tutorial-commands') as HTMLElement;
      expect(hintEl).not.toBeNull();

      // Step 0 (time-speed) has no commands → hint is hidden
      expect(hintEl.style.display).toBe('none');

      // Advance to step 2 (survey), whose hint is the real console command
      // `as any` needed to set private stepIndex and call private render()
      (tut as any).stepIndex = 2;
      (tut as any).render();

      expect(hintEl.style.display).not.toBe('none');
      expect(hintEl.textContent).toBe('survey seismic x:12 z:12');
    });

    it('never executes a step hint on the player behalf', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const gameConsole = vi.fn();
      tut.setGameConsole(gameConsole);
      tut.start(createMockState());

      // Walk to the survey step — its hint is `survey seismic ...`, which the
      // tutorial must never run itself.
      tut.advanceToNextStep();
      tut.advanceToNextStep();

      const executed = gameConsole.mock.calls.map((c: unknown[]) => c[0]);
      expect(executed).not.toContain('survey seismic x:12 z:12');
      expect(executed).not.toContain('hire employee');
    });
  });

  describe('highlight system', () => {
    it('clearing the rails is safe when nothing is highlighted', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      expect(() => tut.refreshGuide()).not.toThrow();
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

    it('highlight is cleared when the tutorial finishes', () => {
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

      tut.finish();
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

      expect(container.querySelector('.bs-tutorial-overlay')).not.toBeNull();
      tut.dispose();
      overlay = null;
      expect(container.querySelector('.bs-tutorial-overlay')).toBeNull();
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
      walkToCongratulations(tut);
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
      walkToCongratulations(tut);

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

    it('finishing takes effect immediately during the completion message', () => {
      vi.useFakeTimers();
      const tut = new TutorialOverlay(container);
      overlay = tut;
      const state = createMockState();
      tut.start(state);

      // Advance through all steps to the congratulations step
      walkToCongratulations(tut);

      // After change: still active because of the 4s timer
      expect(tut.isActive).toBe(true);

      // finish() must take effect immediately without advancing timers
      tut.finish();
      expect(tut.isActive).toBe(false);

      vi.useRealTimers();
    });

    it('finish() is idempotent — calling it twice does not throw', () => {
      vi.useFakeTimers();
      const tut = new TutorialOverlay(container);
      overlay = tut;
      const state = createMockState();
      tut.start(state);

      // Advance through all steps
      walkToCongratulations(tut);

      tut.finish();
      expect(tut.isActive).toBe(false);

      // A second finish must not throw.
      expect(() => tut.finish()).not.toThrow();
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

      walkToCongratulations(tut);

      // On current code: finish() called during the loop → isCompleted() already true (FAILS)
      // After change: finish() delayed by 4s → isCompleted() still false (PASSES)
      expect(TutorialOverlay.isCompleted()).toBe(false);

      vi.advanceTimersByTime(4000);
      expect(TutorialOverlay.isCompleted()).toBe(true);

      vi.useRealTimers();
    });
  });
});
