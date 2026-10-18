// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventModal } from '../../../../src/ui/panels/EventModal.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import { setupEvents } from '../../../../src/core/events/index.js';
import { registerEvents, clearEvents, getEventById, type EventDef } from '../../../../src/core/events/EventPool.js';
import type { EventEffect } from '../../../../src/core/events/EventSystem.js';
import { effectChips, effectChipText } from '../../../../src/core/events/EventEffectText.js';
import { hireEmployee } from '../../../../src/core/entities/Employee.js';
import { Random } from '../../../../src/core/math/Random.js';
import { t } from '../../../../src/core/i18n/I18n.js';
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

  it('shows the leaver\'s name on an employee_leaves option before the choice (#1908)', () => {
    const { container, modal } = mount();
    const state = createGame({ seed: 42, mineType: 'desert' });
    clearEvents();
    setupEvents();
    const hired = hireEmployee(state.employees, 'manager', new Random(1), 5, 5, 0);
    const doomed = state.employees.employees.find(e => e.id === (hired as { id?: number }).id) ?? state.employees.employees[state.employees.employees.length - 1]!;
    state.events.pendingEvent = { eventId: 'mafia_informant', firedAtTick: 3, leavers: [{ optionIndex: 1, employeeId: doomed.id }] };
    modal.update(state);

    const choices = container.querySelectorAll('#bs-event-dialog .bs-event-choice');
    expect(choices[1]!.textContent).toContain(doomed.name);
    expect(choices[1]!.textContent).toContain('quits the crew');
    expect(choices[0]!.textContent).not.toContain(doomed.name);
    modal.dispose();
    container.remove();
  });

  it("says nobody quits when the option's stored leaver is null (#1908)", () => {
    const { container, modal } = mount();
    const state = createGame({ seed: 42, mineType: 'desert' });
    clearEvents();
    setupEvents();
    state.events.pendingEvent = { eventId: 'mafia_informant', firedAtTick: 3, leavers: [{ optionIndex: 1, employeeId: null }] };
    modal.update(state);

    const choices = container.querySelectorAll('#bs-event-dialog .bs-event-choice');
    expect(choices[1]!.textContent).toContain('Nobody is left to quit.');
    modal.dispose();
    container.remove();
  });

  it('keeps the generic chip on a pending event without stored leavers (#1908)', () => {
    const { container, modal } = mount();
    const state = createGame({ seed: 42, mineType: 'desert' });
    clearEvents();
    setupEvents();
    state.events.pendingEvent = { eventId: 'mafia_informant', firedAtTick: 3 };
    modal.update(state);

    const choices = container.querySelectorAll('#bs-event-dialog .bs-event-choice');
    expect(choices[1]!.textContent).toContain('An employee leaves the crew');
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

describe('EventModal hint chip amounts (#1893)', () => {
  function choiceChips(container: HTMLElement, index: number): string[] {
    const choice = container.querySelectorAll('#bs-event-dialog .bs-event-choice')[index]!;
    return Array.from(choice.querySelectorAll('.bsx-chip')).map(c => c.textContent ?? '');
  }

  afterEach(() => {
    clearEvents();
    setupEvents();
    setLocale('en');
  });

  it('Coffee Uprising option 0 shows -$8,000 Cash and +12 WELL, formatted like outcome chips', () => {
    const { container, modal } = mount();
    modal.update(stateWithPendingEvent('union_coffee_uprising'));
    const chips = choiceChips(container, 0);
    expect(chips).toContain('-$8,000 Cash');
    expect(chips).toContain('+12 WELL');
    modal.dispose();
    container.remove();
  });

  it('Coffee Uprising option 2 shows -$2,000 Cash and +3 WELL', () => {
    const { container, modal } = mount();
    modal.update(stateWithPendingEvent('union_coffee_uprising'));
    const chips = choiceChips(container, 2);
    expect(chips).toContain('-$2,000 Cash');
    expect(chips).toContain('+3 WELL');
    modal.dispose();
    container.remove();
  });

  it('a certain lasting effect chip text equals the effectChipText sentence', () => {
    const { container, modal } = mount();
    modal.update(stateWithPendingEvent('union_coffee_uprising'));
    const def = getEventById('union_coffee_uprising')!;
    const spec = def.consequences[0]!.effects![0]!;
    const sentence = effectChipText(effectChips([spec])[0]!)!;
    expect(sentence.length).toBeGreaterThan(0);
    expect(choiceChips(container, 0)).toContain(sentence);
    modal.dispose();
    container.remove();
  });

  describe('risky options', () => {
    beforeEach(() => {
      clearEvents();
      registerEvents([{
        id: 'test_risky_amounts',
        category: 'mafia',
        titleKey: 'event.test.title',
        descKey: 'event.test.desc',
        options: [
          { labelKey: 'event.test.opt0', resultKey: 'event.test.res0' },
          { labelKey: 'event.test.opt1', resultKey: 'event.test.res1' },
        ],
        consequences: [
          { cashDelta: -9000, scoreDelta: { safety: 7 }, probability: 0.5, altConsequence: { cashDelta: -100 } },
          { effects: [{ type: 'work_stoppage', hours: 4 }], probability: 0.5 },
        ],
        weightCoeff: () => 1,
        canFire: () => true,
      }]);
    });

    it('a risky option chip shows "?" and no digits', () => {
      const { container, modal } = mount();
      modal.update(stateWithPendingEvent('test_risky_amounts'));
      const chips = choiceChips(container, 0);
      expect(chips.length).toBeGreaterThan(0);
      for (const c of chips) {
        expect(c).toContain('?');
        expect(c).not.toMatch(/\d/);
      }
      modal.dispose();
      container.remove();
    });

    it('a risky lasting effect renders the generic "Lasting effect?" chip', () => {
      const { container, modal } = mount();
      modal.update(stateWithPendingEvent('test_risky_amounts'));
      const label = t('ui.event.effect_lasting');
      expect(label).not.toBe('ui.event.effect_lasting');
      const chips = choiceChips(container, 1);
      expect(chips.some(c => c.includes(label) && c.includes('?'))).toBe(true);
      modal.dispose();
      container.remove();
    });
  });

  it('amountLabel formats cash with $ and grouping, scores plain, with sign', async () => {
    const { amountLabel } = await import('../../../../src/ui/panels/EventModal.js');
    expect(amountLabel('cash', 'cash', -8000)).toBe('-$8,000 Cash');
    expect(amountLabel('cash', 'cash', 2000)).toBe('+$2,000 Cash');
    expect(amountLabel('score', 'wellBeing', 12)).toBe('+12 WELL');
    expect(amountLabel('score', 'safety', -3)).toBe('-3 SAFE');
  });
});
