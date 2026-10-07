// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TutorialOverlay } from '../../../src/ui/TutorialOverlay.js';
import { TUTORIAL_STEPS, TOTAL_TUTORIAL_STEPS } from '../../../src/ui/tutorialSteps.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { addIncome } from '../../../src/core/economy/Finance.js';
import { Random } from '../../../src/core/math/Random.js';
import { buildTutorialCard } from '../../../src/ui/tutorialOverlayDom.js';
import type { ConfirmModalConfig } from '../../../src/ui/panels/ConfirmModal.js';

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
    it('exposes no skip method — leaving goes through exit(), never skip() (#1332)', () => {
      const tut = new TutorialOverlay(container) as unknown as Record<string, unknown>;
      overlay = tut as unknown as TutorialOverlay;
      expect(tut['skip']).toBeUndefined();
      expect(typeof tut['exit']).toBe('function');
      expect(typeof tut['requestExit']).toBe('function');
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

    it('abandon() deactivates, removes the guided class and does not record completion (#1315)', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      tut.start(createMockState());
      expect(tut.isActive).toBe(true);
      expect(document.body.classList.contains('bs-tutorial-guided')).toBe(true);
      tut.abandon();
      expect(tut.isActive).toBe(false);
      expect(document.body.classList.contains('bs-tutorial-guided')).toBe(false);
      expect(localStorage.getItem('bs_tutorial_done')).toBeNull();
      expect(TutorialOverlay.isCompleted()).toBe(false);
    });

    it('abandon() hides the overlay and is safe when never started (#1315)', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      tut.start(createMockState());
      tut.abandon();
      expect((container.querySelector('.bs-tutorial-overlay') as HTMLElement).style.display).toBe('none');
      expect(() => tut.abandon()).not.toThrow();
      expect(localStorage.getItem('bs_tutorial_done')).toBeNull();
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
    it('shows step counter "1 / 28" at step 0 and has progress bar fill', () => {
      // Total comes from TUTORIAL_STEPS (28 today); update the literal when a step is added or removed.
      const tut = new TutorialOverlay(container);
      overlay = tut;
      tut.start(createMockState());

      const els = Array.from(container.querySelectorAll('*'));
      const ctr = els.find(el => /\d\s*\/\s*\d/.test(el.textContent ?? ''));
      expect(ctr).toBeDefined();
      expect(ctr?.textContent).toMatch(/1\s*\/\s*28/);
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

  describe('UI-action steps and congratulations timer', () => {
    it.each(['scores', 'finances', 'needs'])('%s step does not advance after 60s of fake time, only after the player acts (#1334)', (stepId) => {
      vi.useFakeTimers();
      const hud = document.createElement('div');
      hud.id = 'bs-hud-scores';
      document.body.appendChild(hud);
      try {
        const idx = TUTORIAL_STEPS.findIndex(s => s.id === stepId);
        expect(idx).toBeGreaterThanOrEqual(0);
        const tut = new TutorialOverlay(container) as any;
        overlay = tut;
        tut.start(createMockState());
        tut.landOnStep(idx);
        expect(tut.stepIndex).toBe(idx);

        vi.advanceTimersByTime(60_000);
        expect(tut.stepIndex).toBe(idx);

        // The player's own action: inspect the scores HUD, or open the panel.
        if (stepId === 'scores') {
          hud.dataset['inspectCount'] = '1';
        } else {
          const panel = document.createElement('div');
          panel.id = stepId === 'finances' ? 'bs-finances-panel' : 'bs-employee-panel';
          panel.style.display = 'block';
          document.body.appendChild(panel);
        }
        vi.advanceTimersByTime(5_000);
        expect(tut.stepIndex).toBe(idx + 1);
      } finally {
        hud.remove();
        document.getElementById('bs-finances-panel')?.remove();
        document.getElementById('bs-employee-panel')?.remove();
        vi.useRealTimers();
      }
    });

    it('finishing clears a pending congratulations timer', () => {
      // `as any` needed to access private congratulationsTimer for verification
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      tut.start(createMockState());
      tut.jumpToLastStep();
      expect(tut.congratulationsTimer).not.toBeNull();
      tut.finish();
      expect(tut.congratulationsTimer).toBeNull();
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
    it('renders NO Skip control — leaving is the Exit control only (#1332)', () => {
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

    it('the card carries exactly one button, the exit one (#1332)', () => {
      const tut = new TutorialOverlay(container);
      overlay = tut;
      tut.start(createMockState());

      const buttons = container.querySelectorAll('.bs-tutorial-box button');
      expect(buttons).toHaveLength(1);
      expect((buttons[0] as HTMLElement).dataset['action']).toBe('tutorial-exit');
      expect(container.querySelector('.bs-btn-skip')).toBeNull();
      expect(container.querySelector('.bs-btn-next')).toBeNull();
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
      // Money figures ("5,000", "12,500,000" on the victory card) are not pairs: drop them first.
      const withoutMoney = (text: string): string => text.replace(/\d{1,3}(?:,\d{3})+\b/g, '');

      for (let i = 0; i < TUTORIAL_STEPS.length; i++) {
        (tut as any).stepIndex = i;
        (tut as any).render();
        const id = TUTORIAL_STEPS[i]!.id;
        expect(COORD_PAIR.test(withoutMoney(textEl.textContent ?? '')), `step ${id} body prints coordinates`).toBe(false);
        expect(COORD_PAIR.test(withoutMoney(stageEl.textContent ?? '')), `step ${id} instruction prints coordinates`).toBe(false);
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
      // congratulations (last step) has no highlightTarget. Last index is
      // computed rather than hand-counted.
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const congratsIdx = TUTORIAL_STEPS.findIndex((s) => s.id === 'congratulations');
      expect(congratsIdx).toBe(TUTORIAL_STEPS.length - 1);
      tut.stepIndex = congratsIdx;
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
      // (index 17/18 in the current 29-length array: #553's tutorial fix
      // added three drill-rig-licensing steps, #555 added two more
      // rock-digger-licensing steps, #681 added
      // build-living-quarters/set-early-policy earlier in the sequence, #557
      // inserted evacuate-zone right before blast, #905 inserted
      // toggle-survey-overlay right after survey, #923 had inserted
      // speed-up-for-dig/speed-normal-after-dig inside the box-cut wait, and
      // #1015 removed that pair again — the speed bar needs no step of its
      // own any more).
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

      // Index 13 is 'charge' in the current 29-length array (#1015 removed
      // speed-up-for-dig/speed-normal-after-dig, shifting everything from
      // drill-plan onward down by 2).
      tut.stepIndex = 13;
      expect(() => tut.advanceToNextStep()).not.toThrow();
      expect(tut.stepIndex).toBe(14);
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

      // Directly set to congratulations step (last step, index 27 of 28).
      tut.stepIndex = 27;
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

  describe('defeat short-circuit (#959)', () => {
    // shortCircuitOnDefeat()/jumpToLastStep() and the titleKeyFor/textKeyFor
    // resolution wired into render() are otherwise only exercised at the
    // pure step-object level (tutorialStepsClosing.test.ts) — these drive a
    // real TutorialOverlay instance through a bankruptcy to confirm the
    // overlay itself lands on the closing card with the right DOM text.
    it('jumps straight to the closing card with defeat copy when onCommandExecuted sees a non-completed levelEndReason', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const state = createMockState();
      tut.start(state);

      // Mid-tutorial, well before the closing sequence.
      tut.stepIndex = 5;

      state.levelEnded = true;
      state.levelEndReason = 'bankruptcy';
      tut.onCommandExecuted(state);

      expect(tut.stepIndex).toBe(TOTAL_TUTORIAL_STEPS - 1);
      const titleEl = container.querySelector('.bs-panel-title') as HTMLElement;
      const textEl = container.querySelector('.bs-panel-text') as HTMLElement;
      expect(titleEl.textContent).toBe('The Bank Foreclosed');
      expect(textEl.textContent).toBe(
        "Your cash ran dry before the mine turned a profit. Sell ore as soon as it's hauled in — the bank doesn't offer grace periods.",
      );
    });

    it('also fires from the guide-tick poll, not only onCommandExecuted', () => {
      vi.useFakeTimers();
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const state = createMockState();
      tut.start(state);
      tut.stepIndex = 5;

      state.levelEnded = true;
      state.levelEndReason = 'arrest';
      vi.advanceTimersByTime(250);

      expect(tut.stepIndex).toBe(TOTAL_TUTORIAL_STEPS - 1);
      const titleEl = container.querySelector('.bs-panel-title') as HTMLElement;
      expect(titleEl.textContent).toBe('Busted');
      vi.useRealTimers();
    });

    it('does not short-circuit a genuine win — the completed reason still reaches the success copy', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const state = createMockState();
      tut.start(state);
      tut.stepIndex = 5;

      state.levelEnded = true;
      state.levelEndReason = 'completed';
      tut.onCommandExecuted(state);

      // 'completed' is not a defeat reason, so shortCircuitOnDefeat leaves
      // the step wherever normal completion checks put it.
      expect(tut.stepIndex).not.toBe(TOTAL_TUTORIAL_STEPS - 1);
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
      tut.start(state);
      // Step 0 is 'hire-surveyor' (#904 reorder); advance to step 1
      // ('survey', 'tutorial.step3.title' / 'tutorial.step3'), rendered
      // in EN, to exercise the same locale-re-application behaviour this
      // test has always targeted. #923: step 1 is no longer 'time-speed' —
      // that standalone step is gone, and hire-surveyor now advances
      // straight into 'survey'.
      (tut as unknown as { advanceToNextStep(): void }).advanceToNextStep();

      const titleEl = container.querySelector('.bs-panel-title') as HTMLElement;
      const textEl = container.querySelector('.bs-panel-text') as HTMLElement;
      expect(titleEl.textContent).toBe('Survey Terrain');

      setLocale('fr');
      tut.refreshLocale();

      expect(titleEl.textContent).toBe('Étude du Terrain');
      expect(textEl.textContent).toBe(
        'Effectuez maintenant un sondage sismique pour révéler les emplacements de minerai souterrains.',
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

  describe('free-play card live figures (#1329/#1328)', () => {
    it('refreshes the body text on a guide tick when net profit changes', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const state = createMockState();
      tut.start(state);
      for (let i = 0; i < TUTORIAL_STEPS.length && TUTORIAL_STEPS[tut.stepIndex]!.id !== 'free-play'; i++) tut.advanceToNextStep();
      expect(TUTORIAL_STEPS[tut.stepIndex]!.id).toBe('free-play');

      const textEl = container.querySelector('.bs-panel-text') as HTMLElement;
      const before = textEl.textContent;

      addIncome(state.finances, 1234, 'contracts', 'test income', 1);
      tut.tickGuide();

      expect(textEl.textContent).not.toBe(before);
      expect(textEl.textContent).toContain('1,234');
    });
  });

  describe('free play lifts the rails and shows the goal chip (#1328)', () => {
    const chip = (): HTMLElement | null => document.querySelector('.bs-tutorial-goal');
    const chipShown = (): boolean => !!chip() && chip()!.style.display !== 'none';
    function advanceTo(tut: any, id: string): void {
      for (let i = 0; i < TUTORIAL_STEPS.length && TUTORIAL_STEPS[tut.stepIndex]!.id !== id; i++) tut.advanceToNextStep();
      expect(TUTORIAL_STEPS[tut.stepIndex]!.id).toBe(id);
    }

    it('body keeps bs-tutorial-guided on guided steps and drops it on free-play', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      tut.start(createMockState());
      advanceTo(tut, 'sell-ore');
      expect(document.body.classList.contains('bs-tutorial-guided')).toBe(true);
      tut.advanceToNextStep();
      expect(TUTORIAL_STEPS[tut.stepIndex]!.id).toBe('free-play');
      expect(document.body.classList.contains('bs-tutorial-guided')).toBe(false);
    });

    it('goal chip is hidden on guided steps', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      tut.start(createMockState());
      expect(chipShown()).toBe(false);
      advanceTo(tut, 'sell-ore');
      expect(chipShown()).toBe(false);
    });

    it('goal chip shows profit and target on free-play', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const state = createMockState();
      tut.start(state);
      advanceTo(tut, 'free-play');
      addIncome(state.finances, 1234, 'contracts', 'test income', 1);
      tut.tickGuide();
      expect(chipShown()).toBe(true);
      expect(chip()!.textContent).toContain('1,234');
      expect(chip()!.textContent).toContain('5,000');
    });

    it('goal chip is hidden again on the closing card', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      tut.start(createMockState());
      advanceTo(tut, 'free-play');
      tut.advanceToNextStep();
      expect(TUTORIAL_STEPS[tut.stepIndex]!.id).toBe('congratulations');
      expect(chipShown()).toBe(false);
    });

    it('does not hold the clock on free-play however many ticks pass', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const state = createMockState();
      tut.start(state);
      advanceTo(tut, 'free-play');
      for (let i = 0; i < 5; i++) {
        state.tickCount += 200;
        tut.tickGuide();
        expect(state.isPaused).toBe(false);
      }
    });

    it('a defeat on free-play still jumps to the closing card with the chip hidden', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const state = createMockState();
      tut.start(state);
      advanceTo(tut, 'free-play');
      state.levelEnded = true;
      state.levelEndReason = 'bankruptcy';
      tut.onCommandExecuted(state);
      expect(tut.stepIndex).toBe(TOTAL_TUTORIAL_STEPS - 1);
      expect(chipShown()).toBe(false);
    });

    it('a win on free-play advances to congratulations', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const state = createMockState();
      tut.start(state);
      advanceTo(tut, 'free-play');
      state.levelEnded = true;
      state.levelEndReason = 'completed';
      tut.onCommandExecuted(state);
      expect(TUTORIAL_STEPS[tut.stepIndex]!.id).toBe('congratulations');
    });

    it('teardown hides the chip', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      tut.start(createMockState());
      advanceTo(tut, 'free-play');
      expect(chipShown()).toBe(true);
      tut.abandon();
      expect(chipShown()).toBe(false);
    });
  });

  describe('waiting state (#1014)', () => {
    /** Drive the (private) advanceToNextStep forward until the given step id is showing. */
    function advanceToStep(tut: any, id: string): void {
      while (TUTORIAL_STEPS[tut.stepIndex]!.id !== id) {
        tut.advanceToNextStep();
      }
    }

    it('shows the WAITING chip and swaps the stage line to the waiting sentence once the buy order lands (build-living-quarters)', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const state = createMockState();
      tut.start(state);
      advanceToStep(tut, 'build-living-quarters');

      state.plannedBuildings = [
        { id: 1, buildingId: 1, type: 'living_quarters', tier: 1, x: 29, z: 12, actionId: 1, cost: 100 },
      ];
      tut.refreshGuide();

      const waitingChip = container.querySelector('.bs-tutorial-waiting') as HTMLElement;
      const stageEl = container.querySelector('.bs-tutorial-stage') as HTMLElement;
      expect(waitingChip.style.display).not.toBe('none');
      expect(stageEl.textContent).toBe(t('tutorial.waiting.building'));
    });

    it('keeps the WAITING chip hidden and the click instruction showing before the order is issued', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const state = createMockState();
      tut.start(state);
      advanceToStep(tut, 'build-living-quarters');

      tut.refreshGuide();

      const waitingChip = container.querySelector('.bs-tutorial-waiting') as HTMLElement;
      const stageEl = container.querySelector('.bs-tutorial-stage') as HTMLElement;
      expect(waitingChip.style.display).toBe('none');
      expect(stageEl.textContent).not.toBe(t('tutorial.waiting.building'));
      expect(stageEl.textContent).not.toBe('');
    });

    it('hides the WAITING chip again once the order clears (building lands, plannedBuildings emptied)', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const state = createMockState();
      tut.start(state);
      advanceToStep(tut, 'build-living-quarters');

      state.plannedBuildings = [
        { id: 1, buildingId: 1, type: 'living_quarters', tier: 1, x: 29, z: 12, actionId: 1, cost: 100 },
      ];
      tut.refreshGuide();
      const waitingChip = container.querySelector('.bs-tutorial-waiting') as HTMLElement;
      expect(waitingChip.style.display).not.toBe('none');

      state.plannedBuildings = [];
      tut.refreshGuide();
      expect(waitingChip.style.display).toBe('none');
    });

    it('never shows the WAITING chip on a genuinely one-click step (vehicle-buy-assign), whatever the state holds', () => {
      const tut = new TutorialOverlay(container) as any;
      overlay = tut;
      const state = createMockState();
      tut.start(state);
      advanceToStep(tut, 'vehicle-buy-assign');

      // Every "spent" domain lit up at once — vehicle-buy-assign's stages carry
      // no spentWhen at all, so none of this should matter.
      state.plannedDrillHoles = [{} as never];
      state.plannedChargesByHole = { '1': {} as never };
      state.plannedRamps = [{} as never];
      state.plannedBuildings = [
        { id: 1, buildingId: 1, type: 'living_quarters', tier: 1, x: 0, z: 0, actionId: 1, cost: 100 },
      ];
      tut.refreshGuide();

      const waitingChip = container.querySelector('.bs-tutorial-waiting') as HTMLElement;
      expect(waitingChip.style.display).toBe('none');
    });
  });
});

describe('TutorialOverlay exit (#1332)', () => {
  let container: HTMLDivElement;
  let tut: TutorialOverlay;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    try { localStorage.removeItem('bs_tutorial_done'); } catch { /* ignore */ }
    tut = new TutorialOverlay(container);
  });

  afterEach(() => {
    tut.dispose();
    container.remove();
    setLocale('en');
  });

  const exitBtn = () => container.querySelector('.bs-tutorial-box [data-action="tutorial-exit"]') as HTMLButtonElement | null;
  const cardHidden = () => (container.querySelector('.bs-tutorial-overlay') as HTMLElement).style.display === 'none';

  it('renders the exit button inside the card with the localised label', () => {
    tut.start(createMockState());
    expect(exitBtn()).not.toBeNull();
    expect(exitBtn()!.textContent).toContain(t('tutorial.exit'));
    expect(t('tutorial.exit')).not.toBe('tutorial.exit');
  });

  it('exposes the button as exitBtn on the card elements', () => {
    const host = document.createElement('div');
    const { exitBtn: found } = buildTutorialCard(host);
    expect(found).toBeInstanceOf(HTMLButtonElement);
    expect(found.getAttribute('data-action')).toBe('tutorial-exit');
    expect(host.contains(found)).toBe(true);
  });

  it('exit label differs between en and fr, and keys exist', () => {
    const keys = ['tutorial.exit', 'tutorial.exit_tooltip', 'tutorial.exit_confirm_title', 'tutorial.exit_confirm_body', 'tutorial.exit_confirm_button'];
    const en = keys.map(k => t(k));
    setLocale('fr');
    const fr = keys.map(k => t(k));
    keys.forEach((k, i) => {
      expect(en[i], `${k} en`).not.toBe(k);
      expect(fr[i], `${k} fr`).not.toBe(k);
      expect(fr[i], `${k} differs`).not.toBe(en[i]);
    });
  });

  it('exit() is a no-op while inactive and does not record completion', () => {
    expect(() => tut.exit()).not.toThrow();
    expect(tut.isActive).toBe(false);
    expect(localStorage.getItem('bs_tutorial_done')).toBeNull();
  });

  it('exit() tears down: inactive, card hidden, guided class off, clock released', () => {
    const state = createMockState();
    tut.start(state);
    state.isPaused = true;
    tut.exit();
    expect(tut.isActive).toBe(false);
    expect(cardHidden()).toBe(true);
    expect(document.body.classList.contains('bs-tutorial-guided')).toBe(false);
    expect(state.isPaused).toBe(false);
  });

  it('exit() marks the tutorial completed so it never auto-starts again', () => {
    tut.start(createMockState());
    tut.exit();
    expect(localStorage.getItem('bs_tutorial_done')).toBe('1');
    expect(TutorialOverlay.isCompleted()).toBe(true);
  });

  it('start() works again after exit (Replay Tutorial)', () => {
    tut.start(createMockState());
    tut.exit();
    tut.start(createMockState());
    expect(tut.isActive).toBe(true);
    expect(cardHidden()).toBe(false);
  });

  it('requestExit() without a handler exits directly', () => {
    tut.start(createMockState());
    tut.requestExit();
    expect(tut.isActive).toBe(false);
    expect(TutorialOverlay.isCompleted()).toBe(true);
  });

  it('requestExit() with a handler opens a confirm and keeps the tutorial running', () => {
    const configs: ConfirmModalConfig[] = [];
    tut.setConfirmHandler(c => configs.push(c));
    tut.start(createMockState());
    tut.requestExit();
    expect(configs).toHaveLength(1);
    expect(configs[0]!.title).toBe(t('tutorial.exit_confirm_title'));
    expect(configs[0]!.body).toBe(t('tutorial.exit_confirm_body'));
    expect(configs[0]!.confirmLabel).toBe(t('tutorial.exit_confirm_button'));
    expect(tut.isActive).toBe(true);
    expect(TutorialOverlay.isCompleted()).toBe(false);
  });

  it('confirming exits the tutorial', () => {
    let cfg: ConfirmModalConfig | null = null;
    tut.setConfirmHandler(c => { cfg = c; });
    tut.start(createMockState());
    tut.requestExit();
    cfg!.onConfirm();
    expect(tut.isActive).toBe(false);
    expect(TutorialOverlay.isCompleted()).toBe(true);
  });

  it('cancelling (never calling onConfirm) leaves the tutorial active', () => {
    tut.setConfirmHandler(() => { /* player pressed Cancel */ });
    tut.start(createMockState());
    tut.requestExit();
    expect(tut.isActive).toBe(true);
    expect(cardHidden()).toBe(false);
  });

  it('clicking the exit button routes through the confirm handler', () => {
    const configs: ConfirmModalConfig[] = [];
    tut.setConfirmHandler(c => configs.push(c));
    tut.start(createMockState());
    exitBtn()!.click();
    expect(configs).toHaveLength(1);
    expect(tut.isActive).toBe(true);
  });

  it('clicking the exit button with no handler exits', () => {
    tut.start(createMockState());
    exitBtn()!.click();
    expect(tut.isActive).toBe(false);
  });
});
