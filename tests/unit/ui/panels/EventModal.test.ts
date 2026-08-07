// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventModal } from '../../../../src/ui/panels/EventModal.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import { setupEvents } from '../../../../src/core/events/index.js';
import { registerEvents, clearEvents, type EventDef } from '../../../../src/core/events/EventPool.js';
import type { EventEffect } from '../../../../src/core/events/EventSystem.js';
import { setLocale } from '../../../../src/core/i18n/I18n.js';

setupEvents();

function mount(): { container: HTMLDivElement; modal: EventModal } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return { container, modal: new EventModal(container) };
}

function stateWithPendingEvent(eventId = 'tutorial_synergy_consultant'): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.events.pendingEvent = { eventId, firedAtTick: 3 };
  return s;
}

/** Mock console that mirrors resolveEvent's real side effects: clears pendingEvent, sets lastOutcome. */
function fakeConsole(state: GameState, effects: EventEffect[]) {
  return vi.fn((cmd: string) => {
    if (cmd.startsWith('event choose')) {
      const eventId = state.events.pendingEvent!.eventId;
      state.events.pendingEvent = null;
      state.events.lastOutcome = { eventId, resultKey: `event.${eventId}.res0`, effects };
    } else if (cmd === 'event dismiss') {
      state.events.lastOutcome = null;
    }
    return { success: true, output: '' };
  });
}

describe('EventModal', () => {
  afterEach(() => {
    setLocale('en');
  });

  it('carries the bs-event-dialog id tutorialStages.ts and uiActionProbe target', () => {
    const { container, modal } = mount();
    expect(container.querySelector('#bs-event-dialog')).not.toBeNull();
    modal.dispose();
    container.remove();
  });

  it('is hidden until an event makes it show', () => {
    const { container, modal } = mount();
    const root = container.querySelector('#bs-event-dialog') as HTMLElement;
    expect(root.style.display).toBe('none');
    expect(modal.visible).toBe(false);
    modal.dispose();
    container.remove();
  });

  it('renders a category icon for the pending event', () => {
    const { container, modal } = mount();
    modal.update(stateWithPendingEvent());

    const iconChip = container.querySelector('#bs-event-dialog bs-icon');
    expect(iconChip).not.toBeNull();
    modal.dispose();
    container.remove();
  });

  it('renders one choice button per option', () => {
    const { container, modal } = mount();
    modal.update(stateWithPendingEvent());

    const choices = container.querySelectorAll('#bs-event-dialog .bs-event-choice');
    expect(choices.length).toBe(3); // tutorial_synergy_consultant has 3 options
    expect(modal.visible).toBe(true);
    modal.dispose();
    container.remove();
  });

  it('renders consequence-hint chips on an option whose consequence carries cashDelta + scoreDelta', () => {
    const { container, modal } = mount();
    modal.update(stateWithPendingEvent());

    // Option 0: { cashDelta: -3000, scoreDelta: { wellBeing: 15 } } — 2 hints.
    const firstChoice = container.querySelectorAll('#bs-event-dialog .bs-event-choice')[0]!;
    const hintChips = firstChoice.querySelectorAll('.bsx-chip');
    expect(hintChips.length).toBe(2);
    modal.dispose();
    container.remove();
  });

  it('routes a choice click to the console as "event choose <index>"', () => {
    const { container, modal } = mount();
    const state = stateWithPendingEvent();
    const gameConsole = fakeConsole(state, []);
    modal.setGameConsole(gameConsole);
    modal.update(state);

    (container.querySelector('#bs-event-dialog .bs-event-choice') as HTMLButtonElement).click();
    expect(gameConsole).toHaveBeenCalled();
    expect(String(gameConsole.mock.calls[0]?.[0])).toBe('event choose 0');
    modal.dispose();
    container.remove();
  });

  it('CLOCK HELD is visible while a choice is pending and the game is paused', () => {
    const { container, modal } = mount();
    const state = stateWithPendingEvent();
    state.isPaused = true;
    modal.update(state);

    const chips = Array.from(container.querySelectorAll('#bs-event-dialog .bsx-chip-warn'));
    const clockChip = chips.find(c => c.textContent === 'CLOCK HELD');
    expect(clockChip).toBeDefined();
    expect((clockChip as HTMLElement).style.display).not.toBe('none');
    modal.dispose();
    container.remove();
  });

  it('CLOCK HELD hides once the game resumes (not paused)', () => {
    const { container, modal } = mount();
    const state = stateWithPendingEvent();
    state.isPaused = false;
    modal.update(state);

    const chips = Array.from(container.querySelectorAll('#bs-event-dialog .bsx-chip-warn'));
    const clockChip = chips.find(c => c.textContent === 'CLOCK HELD');
    expect((clockChip as HTMLElement).style.display).toBe('none');
    modal.dispose();
    container.remove();
  });

  it('after choosing, hides the choose-phase controls and shows a visible Dismiss button', () => {
    const { container, modal } = mount();
    const state = stateWithPendingEvent();
    modal.setGameConsole(fakeConsole(state, [
      { kind: 'cash', key: 'cash', delta: -3000 },
      { kind: 'score', key: 'wellBeing', delta: 15 },
    ]));
    modal.update(state);

    (container.querySelector('#bs-event-dialog .bs-event-choice') as HTMLButtonElement).click();

    const dismiss = container.querySelector('#bs-event-dialog .bs-event-dismiss') as HTMLElement;
    expect(dismiss.style.display).not.toBe('none');
    const choicesContainer = container.querySelector('.bs-event-choices') as HTMLElement;
    expect(choicesContainer.style.display).toBe('none');
    modal.dispose();
    container.remove();
  });

  it('outcome effect chips carry the real resolved magnitude, not just direction', () => {
    const { container, modal } = mount();
    const state = stateWithPendingEvent();
    modal.setGameConsole(fakeConsole(state, [
      { kind: 'cash', key: 'cash', delta: -3000 },
      { kind: 'score', key: 'wellBeing', delta: 15 },
    ]));
    modal.update(state);
    (container.querySelector('#bs-event-dialog .bs-event-choice') as HTMLButtonElement).click();

    const text = container.querySelector('#bs-event-dialog')!.textContent!;
    expect(text).toContain('3,000');
    expect(text).toContain('15');
    modal.dispose();
    container.remove();
  });

  it('an effect with a textKey renders as a note line, not a numeric chip', () => {
    const { container, modal } = mount();
    const state = stateWithPendingEvent();
    modal.setGameConsole(fakeConsole(state, [
      { kind: 'other', key: 'followUp', delta: 0, textKey: 'ui.event.follow_up_developing' },
    ]));
    modal.update(state);
    (container.querySelector('#bs-event-dialog .bs-event-choice') as HTMLButtonElement).click();

    expect(container.querySelector('#bs-event-dialog')!.textContent).toContain('follow-up situation is developing');
    modal.dispose();
    container.remove();
  });

  it('dismiss calls "event dismiss" on the console and hides the modal', () => {
    const { container, modal } = mount();
    const state = stateWithPendingEvent();
    const gameConsole = fakeConsole(state, []);
    modal.setGameConsole(gameConsole);
    modal.update(state);
    (container.querySelector('#bs-event-dialog .bs-event-choice') as HTMLButtonElement).click();

    (container.querySelector('#bs-event-dialog .bs-event-dismiss') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenLastCalledWith('event dismiss');
    expect(modal.visible).toBe(false);
    modal.dispose();
    container.remove();
  });

  it('a locale refresh while the outcome phase is showing re-renders the category label (not just static locale-bound chrome)', () => {
    const { container, modal } = mount();
    const state = stateWithPendingEvent(); // category 'tutorial'
    modal.setGameConsole(fakeConsole(state, []));
    modal.update(state);
    (container.querySelector('#bs-event-dialog .bs-event-choice') as HTMLButtonElement).click();

    const categoryEl = container.querySelector('.bs-event-category') as HTMLElement;
    const english = categoryEl.textContent;
    expect(english).toBe('Tutorial');

    setLocale('fr');
    modal.refreshLocale();
    modal.update(state);

    // categoryLabelEl.textContent is set only inside update()'s eventId-changed
    // rebuild, gated the same way as the choose phase — if that gate never
    // re-fires while showingOutcome is true, this stays stuck in English.
    expect(categoryEl.textContent).toBe('Tutoriel');
    modal.dispose();
    container.remove();
  });

  it('a locale refresh re-applies the CLOCK HELD chip text (built with raw t() at construction, never registered with this.locale — issue #492 section 3)', () => {
    const { container, modal } = mount();
    const state = stateWithPendingEvent();
    state.isPaused = true;
    modal.update(state);

    const clockChip = Array.from(container.querySelectorAll('#bs-event-dialog .bsx-chip-warn'))
      .find(c => c.textContent === 'CLOCK HELD') as HTMLElement;
    expect(clockChip).toBeDefined();

    setLocale('fr');
    modal.refreshLocale();
    modal.update(state);

    expect(clockChip.textContent).toBe('HORLOGE ARRÊTÉE');
    modal.dispose();
    container.remove();
  });

  it('dispose removes the modal from the DOM', () => {
    const { container, modal } = mount();
    modal.dispose();
    expect(container.querySelector('#bs-event-dialog')).toBeNull();
    container.remove();
  });

  // ── Synthetic event: precise control over consequence shape ──────────────

  describe('with a synthetic probabilistic-option event', () => {
    let container: HTMLDivElement;
    let modal: EventModal;

    beforeEach(() => {
      clearEvents();
      const def: EventDef = {
        id: 'test_risky_event',
        category: 'mafia',
        titleKey: 'event.test.title',
        descKey: 'event.test.desc',
        options: [
          { labelKey: 'event.test.opt0', resultKey: 'event.test.res0' },
          { labelKey: 'event.test.opt1', resultKey: 'event.test.res1' },
        ],
        consequences: [
          { cashDelta: 500, probability: 0.5, altConsequence: { cashDelta: -100 } },
          {},
        ],
        weightCoeff: () => 1,
        canFire: () => true,
      };
      registerEvents([def]);
      const mounted = mount();
      container = mounted.container;
      modal = mounted.modal;
    });

    afterEach(() => {
      modal.dispose();
      container.remove();
      clearEvents();
      setupEvents();
    });

    it('marks a probabilistic option\'s hint chip with the warn tone and a "?" suffix', () => {
      modal.update(stateWithPendingEvent('test_risky_event'));
      const firstChoice = container.querySelectorAll('#bs-event-dialog .bs-event-choice')[0]!;
      const hint = firstChoice.querySelector('.bsx-chip-warn');
      expect(hint).not.toBeNull();
      expect(hint!.textContent).toContain('?');
    });

    it('an option with an empty consequence renders label-only — no chip row', () => {
      modal.update(stateWithPendingEvent('test_risky_event'));
      const secondChoice = container.querySelectorAll('#bs-event-dialog .bs-event-choice')[1]!;
      expect(secondChoice.querySelectorAll('.bsx-chip').length).toBe(0);
    });

    it('uses the mafia category\'s color identity (bsx-ore), distinct from the tutorial category\'s positive color', () => {
      modal.update(stateWithPendingEvent('test_risky_event'));
      expect(container.innerHTML).toContain('--bsx-ore');
    });
  });
});
