// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { EventDialog } from '../../../src/ui/EventDialog.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { setupEvents } from '../../../src/core/events/index.js';

// The event pool is a runtime registry — nothing resolves by id until it's built.
setupEvents();

function mount(): { container: HTMLDivElement; dialog: EventDialog } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return { container, dialog: new EventDialog(container) };
}

function stateWithPendingEvent(): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.events.pendingEvent = {
    eventId: 'tutorial_synergy_consultant',
    firedAtTick: 3,
  } as GameState['events']['pendingEvent'];
  return s;
}

describe('EventDialog', () => {
  it('carries the bs-event-dialog id the stylesheet targets', () => {
    // #bs-event-dialog rules exist in styles.ts; without the id they are dead
    // and nothing can select the dialog — not the tutorial, not a UI test.
    const { container, dialog } = mount();
    expect(container.querySelector('#bs-event-dialog')).not.toBeNull();
    dialog.dispose();
    container.remove();
  });

  it('is hidden until shown', () => {
    const { container, dialog } = mount();
    const el = container.querySelector('#bs-event-dialog') as HTMLElement;
    expect(el.style.display).toBe('none');
    expect(dialog.visible).toBe(false);
    dialog.dispose();
    container.remove();
  });

  it('renders one choice button per option when an event is pending', () => {
    const { container, dialog } = mount();
    dialog.setGameConsole(vi.fn().mockReturnValue({ success: true, output: '' }));
    dialog.update(stateWithPendingEvent());
    dialog.show();

    const choices = container.querySelectorAll('#bs-event-dialog .bs-event-choice');
    expect(choices.length).toBeGreaterThan(0);
    expect(dialog.visible).toBe(true);

    dialog.dispose();
    container.remove();
  });

  it('routes a choice click to the console', () => {
    const { container, dialog } = mount();
    const gameConsole = vi.fn().mockReturnValue({ success: true, output: '' });
    dialog.setGameConsole(gameConsole);
    dialog.update(stateWithPendingEvent());
    dialog.show();

    (container.querySelector('#bs-event-dialog .bs-event-choice') as HTMLButtonElement).click();
    expect(gameConsole).toHaveBeenCalled();
    expect(String(gameConsole.mock.calls[0]?.[0])).toContain('event choose');

    dialog.dispose();
    container.remove();
  });

  it('dispose removes the dialog from the DOM', () => {
    const { container, dialog } = mount();
    dialog.dispose();
    expect(container.querySelector('#bs-event-dialog')).toBeNull();
    container.remove();
  });

  it('swaps the choices for an outcome headline sentence plus numeric effects, and a Dismiss button', () => {
    const { container, dialog } = mount();
    // Real shape of "event choose" output post-#421: the resolved outcome
    // sentence sits between "Event resolved: <id>" and "Consequences:", with
    // the numeric bullet effects following it. The dialog must surface the
    // sentence as a distinct headline — not fold it silently into the
    // existing numeric-effects readout.
    dialog.setGameConsole(vi.fn().mockReturnValue({
      success: true,
      output: 'Event resolved: tutorial_synergy_consultant\n'
        + "The consultant's slideshow induces mass narcolepsy across the whole crew.\n"
        + 'Consequences:\n'
        + '  • Lost $3000\n'
        + '  • wellBeing +15',
    }));
    dialog.update(stateWithPendingEvent());
    dialog.show();

    (container.querySelector('#bs-event-dialog .bs-event-choice') as HTMLButtonElement).click();

    const dismiss = container.querySelector('#bs-event-dialog .bs-event-dismiss') as HTMLElement;
    expect(dismiss.style.display).not.toBe('none');

    // The satirical outcome sentence gets its own headline element.
    const headline = container.querySelector('.bs-event-outcome-headline');
    expect(headline).not.toBeNull();
    expect(headline!.textContent).toContain(
      "The consultant's slideshow induces mass narcolepsy across the whole crew.",
    );

    // The numeric effects stay visible too, in a separate small-print element —
    // the sentence itself must not leak into the numbers-only readout.
    const numbers = container.querySelector('.bs-event-outcome');
    expect(numbers).not.toBeNull();
    expect(numbers!.textContent).toContain('Lost $3000');
    expect(numbers!.textContent).toContain('wellBeing +15');
    expect(numbers!.textContent).not.toContain('mass narcolepsy');

    dismiss.click();
    expect(dialog.visible).toBe(false);

    dialog.dispose();
    container.remove();
  });
});
