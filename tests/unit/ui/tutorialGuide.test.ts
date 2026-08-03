// @vitest-environment jsdom
// BlastSimulator2026 — Tutorial guide rails
//
// The rails are what make the tutorial impossible to lose: one control live at
// a time, resolved by reachability, and a clock that cannot outrun the step.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  isReachable,
  resolveStageIndex,
  allowedSelectors,
  applyRails,
  clearRails,
  decideClock,
  ALLOWED_CLASS,
  HIGHLIGHT_CLASS,
  DEFAULT_TICK_BUDGET,
  WORK_GRACE_TICKS,
} from '../../../src/ui/tutorialGuide.js';
import type { TutorialStage } from '../../../src/ui/tutorialStages.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';

/**
 * jsdom reports every element as zero-size, so `isReachable`'s size check would
 * reject everything. Give each element a box the way a real layout would.
 */
function withBox(el: HTMLElement, w = 40, h = 20): HTMLElement {
  el.getBoundingClientRect = () => ({
    width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0,
    toJSON: () => ({}),
  }) as DOMRect;
  return el;
}

function button(id: string, parent: HTMLElement = document.body): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = id;
  parent.appendChild(btn);
  return withBox(btn) as HTMLButtonElement;
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('isReachable', () => {
  it('accepts a visible, enabled, sized control', () => {
    button('a');
    expect(isReachable('#a')).toBe(true);
  });

  it('rejects a control that is not in the DOM', () => {
    expect(isReachable('#missing')).toBe(false);
  });

  it('rejects a disabled control', () => {
    button('a').disabled = true;
    expect(isReachable('#a')).toBe(false);
  });

  it('rejects a control inside a hidden panel', () => {
    const panel = document.createElement('div');
    panel.style.display = 'none';
    document.body.appendChild(panel);
    button('a', panel);
    expect(isReachable('#a')).toBe(false);
  });

  it('rejects a zero-size control', () => {
    const btn = document.createElement('button');
    btn.id = 'a';
    document.body.appendChild(btn);
    expect(isReachable('#a')).toBe(false);
  });

  it('ignores pointer-events, which the rails themselves set', () => {
    // Reachability decides what to un-block. Reading the property the guide
    // writes would make the answer depend on itself, and every stage would
    // resolve to the first one forever.
    const btn = button('a');
    btn.style.pointerEvents = 'none';
    expect(isReachable('#a')).toBe(true);
  });
});

describe('resolveStageIndex', () => {
  const stages: TutorialStage[] = [
    { target: '#open', hintKey: 'a' },
    { target: '#inside', hintKey: 'b' },
    { target: '#confirm', hintKey: 'c' },
  ];

  it('stays on the first stage while nothing later is reachable', () => {
    button('open');
    expect(resolveStageIndex(stages)).toBe(0);
  });

  it('moves on as soon as a later control appears', () => {
    button('open');
    button('inside');
    expect(resolveStageIndex(stages)).toBe(1);
  });

  it('takes the last reachable stage, not the first', () => {
    button('open');
    button('inside');
    button('confirm');
    expect(resolveStageIndex(stages)).toBe(2);
  });

  it('holds at the earlier stage while the later control is disabled', () => {
    // A picker's Confirm exists but is disabled until a tile is chosen.
    // Highlighting it then would point the player at a dead button.
    button('open');
    button('inside');
    button('confirm').disabled = true;
    expect(resolveStageIndex(stages)).toBe(1);
  });

  it('falls back to the first stage when the player closes the panel', () => {
    button('open');
    const inside = button('inside');
    expect(resolveStageIndex(stages)).toBe(1);
    inside.remove();
    expect(resolveStageIndex(stages)).toBe(0);
  });

  it('returns 0 when nothing at all is reachable', () => {
    expect(resolveStageIndex(stages)).toBe(0);
  });

  it('returns 0 for an empty stage list', () => {
    expect(resolveStageIndex([])).toBe(0);
  });
});

describe('allowedSelectors', () => {
  it('is just the target when a stage has no helpers', () => {
    expect(allowedSelectors({ target: '#a', hintKey: 'k' })).toEqual(['#a']);
  });

  it('includes the helpers a multi-control action needs', () => {
    // Typing an amount before pressing Deliver is one action, two controls.
    expect(allowedSelectors({ target: '#deliver', hintKey: 'k', also: ['#amount'] }))
      .toEqual(['#deliver', '#amount']);
  });

  it('is empty when there is no stage', () => {
    expect(allowedSelectors(undefined)).toEqual([]);
  });
});

describe('applyRails', () => {
  it('marks the target allowed and highlighted', () => {
    button('a');
    applyRails({ target: '#a', hintKey: 'k' });
    const el = document.querySelector('#a')!;
    expect(el.classList.contains(ALLOWED_CLASS)).toBe(true);
    expect(el.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
  });

  it('marks helpers allowed but does not highlight them', () => {
    button('deliver');
    button('amount');
    applyRails({ target: '#deliver', hintKey: 'k', also: ['#amount'] });
    const amount = document.querySelector('#amount')!;
    expect(amount.classList.contains(ALLOWED_CLASS)).toBe(true);
    expect(amount.classList.contains(HIGHLIGHT_CLASS)).toBe(false);
  });

  it('leaves every other control unmarked, so the CSS blocks it', () => {
    button('a');
    button('other');
    applyRails({ target: '#a', hintKey: 'k' });
    expect(document.querySelector('#other')!.classList.contains(ALLOWED_CLASS)).toBe(false);
  });

  it('moves the marks when the stage changes', () => {
    button('a');
    button('b');
    applyRails({ target: '#a', hintKey: 'k' });
    applyRails({ target: '#b', hintKey: 'k' });
    expect(document.querySelector('#a')!.classList.contains(ALLOWED_CLASS)).toBe(false);
    expect(document.querySelector('#b')!.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
  });

  it('clearRails takes every mark off', () => {
    button('a');
    applyRails({ target: '#a', hintKey: 'k' });
    clearRails();
    const el = document.querySelector('#a')!;
    expect(el.classList.contains(ALLOWED_CLASS)).toBe(false);
    expect(el.classList.contains(HIGHLIGHT_CLASS)).toBe(false);
  });

  it('does not throw when the stage target is not on screen yet', () => {
    expect(() => applyRails({ target: '#nope', hintKey: 'k' })).not.toThrow();
  });

  it('keeps an open modal operable whatever the stage is', () => {
    // A modal covers the screen. Blocking its own buttons would seal the game
    // behind it, and there is no Skip button left to escape with.
    const modal = document.createElement('div');
    modal.className = 'bs-confirm-overlay';
    document.body.appendChild(modal);
    const dismiss = button('dismiss', modal);
    button('elsewhere');

    applyRails({ target: '#elsewhere', hintKey: 'k' });

    expect(dismiss.classList.contains(ALLOWED_CLASS)).toBe(true);
    // Still not the thing being pointed at.
    expect(dismiss.classList.contains(HIGHLIGHT_CLASS)).toBe(false);
  });

  it('does not free a modal that is hidden', () => {
    const modal = document.createElement('div');
    modal.className = 'bs-confirm-overlay';
    modal.style.display = 'none';
    document.body.appendChild(modal);
    const dismiss = button('dismiss', modal);
    button('elsewhere');

    applyRails({ target: '#elsewhere', hintKey: 'k' });

    expect(dismiss.classList.contains(ALLOWED_CLASS)).toBe(false);
  });
});

describe('decideClock', () => {
  function state(overrides: Partial<GameState> = {}): GameState {
    const s = createGame({ seed: 42, mineType: 'desert' });
    return Object.assign(s, overrides);
  }

  it('lets the clock run while the step still has allowance', () => {
    const s = state();
    s.tickCount = 5;
    expect(decideClock(s, 0, DEFAULT_TICK_BUDGET).hold).toBe(false);
  });

  it('holds the clock once the allowance is spent and nothing is in flight', () => {
    const s = state();
    s.tickCount = DEFAULT_TICK_BUDGET;
    expect(decideClock(s, 0, DEFAULT_TICK_BUDGET).hold).toBe(true);
  });

  it('keeps running past the allowance while a work-waiting step has work outstanding', () => {
    // Pausing here would deadlock: the step is waiting on a surveyor, and a
    // paused surveyor never finishes.
    const s = state();
    s.tickCount = DEFAULT_TICK_BUDGET + 5;
    s.pendingActions = [{ id: 1 } as unknown as GameState['pendingActions'][number]];
    expect(decideClock(s, 0, DEFAULT_TICK_BUDGET, true).hold).toBe(false);
  });

  it('keeps running while an employee is mid-task on a work-waiting step', () => {
    const s = state();
    s.tickCount = DEFAULT_TICK_BUDGET + 5;
    s.employees.employees = [{ activeActionId: 7 } as never];
    expect(decideClock(s, 0, DEFAULT_TICK_BUDGET, true).hold).toBe(false);
  });

  it('keeps running while a driver walks to board, which carries no action at all', () => {
    // The tutorial's vehicle step deadlocked on exactly this. Assigning a
    // driver only records the intent and a destination — ArrivalGate seats
    // them once they arrive — so counting actions alone left the walk
    // invisible, the clock held mid-stride, and the driver never arrived.
    const s = state();
    s.tickCount = DEFAULT_TICK_BUDGET + 5;
    s.employees.employees = [
      { activeActionId: null, pendingDriverVehicleId: 1, destinationX: 12, destinationZ: 8 } as never,
    ];
    expect(decideClock(s, 0, DEFAULT_TICK_BUDGET, true).hold).toBe(false);
  });

  it('keeps running while an employee walks anywhere on a work-waiting step', () => {
    const s = state();
    s.tickCount = DEFAULT_TICK_BUDGET + 5;
    s.employees.employees = [
      { activeActionId: null, pendingDriverVehicleId: null, destinationX: 4, destinationZ: 9 } as never,
    ];
    expect(decideClock(s, 0, DEFAULT_TICK_BUDGET, true).hold).toBe(false);
  });

  it('still holds once the walk finishes and nothing else is outstanding', () => {
    const s = state();
    s.tickCount = DEFAULT_TICK_BUDGET + 5;
    s.employees.employees = [
      { activeActionId: null, pendingDriverVehicleId: null, destinationX: null, destinationZ: null } as never,
    ];
    expect(decideClock(s, 0, DEFAULT_TICK_BUDGET, true).hold).toBe(true);
  });

  it('holds a step that only waits on a click, even with work in flight', () => {
    // Contract offers are regenerated on a timer and the oldest is dropped, so
    // letting the clock run while the player picks an offer pulls the row out
    // from under them. Only steps that need the simulation get the grace.
    const s = state();
    s.tickCount = DEFAULT_TICK_BUDGET + 5;
    s.pendingActions = [{ id: 1 } as unknown as GameState['pendingActions'][number]];
    expect(decideClock(s, 0, DEFAULT_TICK_BUDGET).hold).toBe(true);
  });

  it('stops even outstanding work at the grace cap, so a stuck queue cannot run forever', () => {
    const s = state();
    s.tickCount = DEFAULT_TICK_BUDGET + WORK_GRACE_TICKS;
    s.pendingActions = [{ id: 1 } as unknown as GameState['pendingActions'][number]];
    expect(decideClock(s, 0, DEFAULT_TICK_BUDGET, true).hold).toBe(true);
  });

  it('counts from the tick the step started, not from zero', () => {
    const s = state();
    s.tickCount = 100;
    expect(decideClock(s, 95, DEFAULT_TICK_BUDGET).hold).toBe(false);
    expect(decideClock(s, 95, DEFAULT_TICK_BUDGET).spent).toBe(5);
  });

  it('honours a larger allowance set by the step', () => {
    const s = state();
    s.tickCount = 20;
    expect(decideClock(s, 0, 10).hold).toBe(true);
    expect(decideClock(s, 0, 30).hold).toBe(false);
  });

  it('never reports negative spend if the tick counter is reset under it', () => {
    const s = state();
    s.tickCount = 2;
    expect(decideClock(s, 50, DEFAULT_TICK_BUDGET).spent).toBe(0);
  });
});
