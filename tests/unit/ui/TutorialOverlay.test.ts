// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TutorialOverlay } from '../../../src/ui/TutorialOverlay.js';
import { TUTORIAL_STEPS, TOTAL_TUTORIAL_STEPS } from '../../../src/ui/tutorialSteps.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';

function createMockState(): GameState {
  return createGame({ seed: 42, mineType: 'tutorial' });
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
    setLocale('en');
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

      // Step 0 (hire-surveyor, #904 reorder) completes on a genuine new
      // hire, not a speed change — its own completion check is
      // tick-independent so it must be satisfiable while the clock is
      // still held.
      hireEmployee(state.employees, 'surveyor', new Random(1));
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
    it('shows step counter "1 / 32" at step 0 and has progress bar fill', () => {
      // 32, not 24: #553 inserts build-driving-center/train-driller/
      // buy-drill-rig-assign right after hire-driller, #555 inserts
      // train-digger/buy-rock-digger-assign right after that trio, #681
      // inserts build-living-quarters/set-early-policy right after
      // hire-driller too, and #557 inserts evacuate-zone right before blast.
      const tut = new TutorialOverlay(container);
      overlay = tut;
      tut.start(createMockState());

      const els = Array.from(container.querySelectorAll('*'));
      const ctr = els.find(el => /\d\s*\/\s*\d/.test(el.textContent ?? ''));
      expect(ctr).toBeDefined();
      expect(ctr?.textContent).toMatch(/1\s*\/\s*32/);
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
      // Step 0 (hire-surveyor, #904 reorder) completes on a genuine new hire.
      hireEmployee(state.employees, 'surveyor', new Random(1));
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

      // The player hires a surveyor (step 0, hire-surveyor, #904 reorder);
      // the next poll picks it up.
      hireEmployee(state.employees, 'surveyor', new Random(1));
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

    it('never puts the console equivalent on the card, on any step (#489)', () => {
      // The console line reads as an instruction, and the ones carrying tile
      // coordinates read as coordinates the player must reproduce by hand —
      // which no control in the game accepts. The scene outline is the hint.
      const tut = new TutorialOverlay(container);
      overlay = tut;
      tut.start(createMockState());

      const hintEl = container.querySelector('.bs-tutorial-commands') as HTMLElement;
      const labelEl = container.querySelector('.bs-tutorial-commands-label') as HTMLElement;
      expect(hintEl).not.toBeNull();

      for (let i = 0; i < TUTORIAL_STEPS.length; i++) {
        // `as any` needed to set private stepIndex and call private render()
        (tut as any).stepIndex = i;
        (tut as any).render();
        expect(hintEl.style.display, `step ${TUTORIAL_STEPS[i]!.id} shows a console hint`).toBe('none');
        expect(labelEl.style.display).toBe('none');
        expect(hintEl.textContent).toBe('');
      }
    });

    it('no step card text anywhere prints raw tile coordinates (#489)', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      tut.start(createMockState());

      const textEl = container.querySelector('.bs-panel-text') as HTMLElement;
      const stageEl = container.querySelector('.bs-tutorial-stage') as HTMLElement;
      // "(12, 8)" / "16,19" — a pair of numbers the player is expected to aim at.
      const COORD_PAIR = /\(?\d+\s*,\s*\d+\)?/;

      for (let i = 0; i < TUTORIAL_STEPS.length; i++) {
        (tut as any).stepIndex = i;
        (tut as any).render();
        const id = TUTORIAL_STEPS[i]!.id;
        expect(COORD_PAIR.test(textEl.textContent ?? ''), `step ${id} body prints coordinates`).toBe(false);
        expect(COORD_PAIR.test(stageEl.textContent ?? ''), `step ${id} instruction prints coordinates`).toBe(false);
      }
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
      expect(executed).not.toContain('survey seismic x:23 z:23');
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
      // Step 0 is now hire-surveyor (#904 reorder), whose highlightTarget
      // (createHireStep's default, TOOLBAR_TARGET.employees) is the Crew/
      // employees toolbar button, '#bs-toolbar [data-panel="employees"]' —
      // not the speed button.
      const toolbar = document.createElement('div');
      toolbar.id = 'bs-toolbar';
      const employeesBtn = document.createElement('button');
      employeesBtn.dataset['panel'] = 'employees';
      toolbar.appendChild(employeesBtn);
      document.body.appendChild(toolbar);

      tut.start(createMockState());
      expect(employeesBtn.classList.contains('bsx-highlight')).toBe(true);
      toolbar.remove();
    });

    it('highlight is cleared when advancing to next step', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const toolbar = document.createElement('div');
      toolbar.id = 'bs-toolbar';
      const employeesBtn = document.createElement('button');
      employeesBtn.dataset['panel'] = 'employees';
      toolbar.appendChild(employeesBtn);
      document.body.appendChild(toolbar);

      const state = createMockState();
      tut.start(state);
      expect(employeesBtn.classList.contains('bsx-highlight')).toBe(true);

      // Advance by completing step 0 (hire-surveyor, #904 reorder): hire a
      // new surveyor — no longer completed by raising timeScale.
      hireEmployee(state.employees, 'surveyor', new Random(1));
      tut.onCommandExecuted(state);
      // After advancing, highlight should be removed from old element
      // (and new highlight may be applied if new step has target)
      expect(employeesBtn.classList.contains('bsx-highlight')).toBe(false);
      toolbar.remove();
    });

    it('highlight is cleared when the tutorial finishes', () => {
      // Using step 0's own real target (employees toolbar button, #904
      // reorder) rather than advancing to the speed-button step first:
      // finish() clearing whatever is currently highlighted is the
      // behaviour under test, not which step happens to be first.
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const toolbar = document.createElement('div');
      toolbar.id = 'bs-toolbar';
      const employeesBtn = document.createElement('button');
      employeesBtn.dataset['panel'] = 'employees';
      toolbar.appendChild(employeesBtn);
      document.body.appendChild(toolbar);

      tut.start(createMockState());
      expect(employeesBtn.classList.contains('bsx-highlight')).toBe(true);

      tut.finish();
      expect(employeesBtn.classList.contains('bsx-highlight')).toBe(false);
      toolbar.remove();
    });

    it('highlight is cleared on dispose', () => {
      // Same choice as the "finishes" test above: step 0's own real target.
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const toolbar = document.createElement('div');
      toolbar.id = 'bs-toolbar';
      const employeesBtn = document.createElement('button');
      employeesBtn.dataset['panel'] = 'employees';
      toolbar.appendChild(employeesBtn);
      document.body.appendChild(toolbar);

      tut.start(createMockState());
      expect(employeesBtn.classList.contains('bsx-highlight')).toBe(true);

      tut.dispose();
      overlay = null;
      expect(employeesBtn.classList.contains('bsx-highlight')).toBe(false);
      toolbar.remove();
    });

    it('highlightTarget with undefined selector does not throw', () => {
      // congratulations (last step, index 30 after #553's tutorial fix added
      // three drill-rig-licensing steps, #555 added two more
      // rock-digger-licensing steps, and #681 added
      // build-living-quarters/set-early-policy) has no highlightTarget
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      tut.stepIndex = 30;
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

      // Set to the scores step so advanceToNextStep goes to event-fire-resolve
      // (index 17/18 after #553's tutorial fix added three drill-rig-licensing
      // steps, #555 added two more rock-digger-licensing steps, #681 added
      // build-living-quarters/set-early-policy earlier in the sequence, and
      // #557 inserted evacuate-zone right before blast).
      tut.stepIndex = 17;
      tut.advanceToNextStep();

      expect(tut.stepIndex).toBe(18);
      expect(gameConsole).toHaveBeenCalledWith('tick 3');
    });

    it('auto-fires tutorial_synergy_consultant when pendingEvent is null after step 9 commands', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const state = createMockState();
      const gameConsole = vi.fn();
      tut.setGameConsole(gameConsole);
      tut.start(state);

      // createGame() defaults events.pendingEvent to null
      tut.stepIndex = 17;
      tut.advanceToNextStep();

      expect(gameConsole).toHaveBeenCalledWith('event fire tutorial_synergy_consultant');
    });

    it('advanceOneStep handles null gameConsole without crashing', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const state = createMockState();
      tut.start(state);
      // Do NOT call setGameConsole — gameConsole stays null

      tut.stepIndex = 15;
      expect(() => tut.advanceToNextStep()).not.toThrow();
      expect(tut.stepIndex).toBe(16);
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

      // Directly set to congratulations step (last step, index 31 after
      // #553's tutorial fix added three drill-rig-licensing steps, #555
      // added two more rock-digger-licensing steps, #681 added
      // build-living-quarters/set-early-policy, and #557 inserted
      // evacuate-zone right before blast) and render
      tut.stepIndex = 31;
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
      const tut = new TutorialOverlay(container) as any;
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
      const tut = new TutorialOverlay(container) as any;
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

  describe('refreshLocale() (issue #492 section 3 — "clock held" text survives a language switch)', () => {
    it('re-applies the CLOCK HELD tooltip (pausedEl.title) to the active locale', () => {
      const tut = new TutorialOverlay(container) as unknown as { pausedEl: HTMLElement };
      overlay = tut as unknown as TutorialOverlay;

      // Baked in English at construction time.
      expect(tut.pausedEl.title).toBe(
        'Time is paused until you do this — the tutorial holds the clock so the site cannot drift ahead of you.',
      );

      setLocale('fr');
      (overlay as TutorialOverlay).refreshLocale();

      expect(tut.pausedEl.title).toBe(
        "Le temps est en pause jusqu'à cette action — le tutoriel retient l'horloge pour que le site ne prenne pas d'avance sur vous.",
      );
    });

    it('re-applies the CLOCK HELD chip label (pausedChipEl.textContent) to the active locale', () => {
      const tut = new TutorialOverlay(container) as unknown as { pausedChipEl: HTMLElement };
      overlay = tut as unknown as TutorialOverlay;

      expect(tut.pausedChipEl.textContent).toBe('CLOCK HELD');

      setLocale('fr');
      (overlay as TutorialOverlay).refreshLocale();

      expect(tut.pausedChipEl.textContent).toBe('HORLOGE EN PAUSE');
    });

    it('re-applies the current step title/text in the new locale', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      const state = createMockState();
      tut.start(state); // step 0 ('tutorial.step1.title' / 'tutorial.step1'), rendered in EN

      const titleEl = container.querySelector('.bs-panel-title') as HTMLElement;
      const textEl = container.querySelector('.bs-panel-text') as HTMLElement;
      expect(titleEl.textContent).toBe('Game Speed');

      setLocale('fr');
      tut.refreshLocale();

      expect(titleEl.textContent).toBe('Vitesse de Jeu');
      expect(textEl.textContent).toBe(
        'Utilisez les contrôles de vitesse sur la gauche de la barre du haut pour accélérer le jeu. Essayez la vitesse 2× ou 4× !',
      );
    });

    it('re-applies the console-hint label ("Console equivalent" / "Équivalent console")', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;

      const label = container.querySelector('.bs-tutorial-commands-label') as HTMLElement;
      expect(label.textContent).toBe('Console equivalent');

      setLocale('fr');
      tut.refreshLocale();

      expect(label.textContent).toBe('Équivalent console');
    });

    it('is a no-op-safe call when the tutorial has not been started (no gameState yet)', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      setLocale('fr');
      expect(() => tut.refreshLocale()).not.toThrow();
    });
  });
});
