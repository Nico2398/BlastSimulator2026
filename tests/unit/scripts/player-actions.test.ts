// BlastSimulator2026 — Unit tests: the probe's console-run helpers

import { describe, it, expect } from 'vitest';
import {
  clearBlastZone, cheapestEventOption, outcomeCostsCrew, resolvePendingEvent, playTick, type Run,
} from '../../../scripts/shared/player-actions.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { registerEvents, type EventDef } from '../../../src/core/events/EventPool.js';

/** A runner that records each command and accepts it. */
function recorder(): { run: Run; cmds: string[] } {
  const cmds: string[] = [];
  return { cmds, run: (cmd: string) => { cmds.push(cmd); return { success: true, output: '' }; } };
}

describe('cheapestEventOption (#2117)', () => {
  it('picks the highest cashDelta', () => {
    expect(cheapestEventOption([{ cashDelta: -500 }, { cashDelta: -50 }, { cashDelta: -900 }])).toBe(1);
    expect(cheapestEventOption([{ cashDelta: 10 }, { cashDelta: 300 }, { cashDelta: 20 }])).toBe(1);
  });

  it('treats a missing cashDelta as 0', () => {
    expect(cheapestEventOption([{ cashDelta: -100 }, {}])).toBe(1);
    expect(cheapestEventOption([{ cashDelta: -100 }, { cashDelta: -200 }, {}])).toBe(2);
    expect(cheapestEventOption([{}, { cashDelta: -1 }])).toBe(0);
    expect(cheapestEventOption([{}, { cashDelta: 5 }])).toBe(1);
  });

  it('takes the lowest index on ties', () => {
    expect(cheapestEventOption([{ cashDelta: -10 }, { cashDelta: -10 }])).toBe(0);
    expect(cheapestEventOption([{ cashDelta: -20 }, { cashDelta: 7 }, { cashDelta: 7 }])).toBe(1);
    expect(cheapestEventOption([{}, {}, {}])).toBe(0);
  });

  it('is 0 for an empty list and for one option', () => {
    expect(cheapestEventOption([])).toBe(0);
    expect(cheapestEventOption([{ cashDelta: -3 }])).toBe(0);
  });
});

describe('cheapestEventOption keeps the crew (#2126)', () => {
  const quits = { effects: [{ type: 'employee_leaves' }] };

  it('passes over a free option that makes an employee quit', () => {
    expect(cheapestEventOption([{ cashDelta: -4000 }, { ...quits }, { cashDelta: -1500 }])).toBe(2);
  });

  it('passes over an option whose fallback makes an employee quit', () => {
    expect(cheapestEventOption([{ altConsequence: { ...quits } }, { cashDelta: -800 }])).toBe(1);
  });

  it('reads other effects as harmless', () => {
    expect(cheapestEventOption([{ cashDelta: -200 }, { effects: [{ type: 'work_stoppage' }] }])).toBe(1);
  });

  it('falls back to the cheapest of all when every option costs crew', () => {
    expect(cheapestEventOption([{ cashDelta: -10, ...quits }, { cashDelta: 5, ...quits }])).toBe(1);
  });
});

describe('outcomeCostsCrew (#2126)', () => {
  it('is true for an employee_leaves effect, directly or in the fallback', () => {
    expect(outcomeCostsCrew({ effects: [{ type: 'employee_leaves' }] })).toBe(true);
    expect(outcomeCostsCrew({ altConsequence: { altConsequence: { effects: [{ type: 'employee_leaves' }] } } })).toBe(true);
  });

  it('is false without one, and for no outcome', () => {
    expect(outcomeCostsCrew({ cashDelta: -5, effects: [{ type: 'employee_injured' }] })).toBe(false);
    expect(outcomeCostsCrew(undefined)).toBe(false);
  });
});

/** A two-or-more option event whose option 0 is the costly one, registered under a test-only id. */
function registerEvent(id: string, consequences: EventDef['consequences']): void {
  registerEvents([{
    id,
    category: 'politics',
    titleKey: `${id}.title`,
    descKey: `${id}.desc`,
    options: consequences.map((_, i) => ({ labelKey: `${id}.o${i}`, resultKey: `${id}.r${i}` })),
    consequences,
    weightCoeff: () => 1,
    canFire: () => false,
  }]);
}

/** The slice of GameState the event helpers read. */
function withPending(eventId: string | null): GameState {
  return { events: { pendingEvent: eventId === null ? null : { eventId } } } as unknown as GameState;
}

describe('resolvePendingEvent with a policy (#2117)', () => {
  registerEvent('t2117_costly_first', [{ cashDelta: -5000 }, { cashDelta: -200 }, { cashDelta: -800 }]);
  registerEvent('t2117_free_option', [{ cashDelta: -100 }, { effectTag: 'nothing' }]);

  it('first answers with option 0', () => {
    const { run, cmds } = recorder();
    resolvePendingEvent(run, withPending('t2117_costly_first'), 'first');
    expect(cmds).toEqual(['event choose 0']);
  });

  it('defaults to first', () => {
    const { run, cmds } = recorder();
    resolvePendingEvent(run, withPending('t2117_costly_first'));
    expect(cmds).toEqual(['event choose 0']);
  });

  it('cheapest answers with the option of the highest cashDelta', () => {
    const { run, cmds } = recorder();
    resolvePendingEvent(run, withPending('t2117_costly_first'), 'cheapest');
    expect(cmds).toEqual(['event choose 1']);
  });

  it('cheapest counts a consequence without cashDelta as 0', () => {
    const { run, cmds } = recorder();
    resolvePendingEvent(run, withPending('t2117_free_option'), 'cheapest');
    expect(cmds).toEqual(['event choose 1']);
  });

  it('sends no command when no event is pending, whatever the policy', () => {
    for (const policy of ['first', 'cheapest'] as const) {
      const { run, cmds } = recorder();
      resolvePendingEvent(run, withPending(null), policy);
      expect(cmds).toEqual([]);
    }
  });
});

describe('playTick with a policy (#2117)', () => {
  registerEvent('t2117_tick_event', [{ cashDelta: -9000 }, { cashDelta: -1 }]);

  it('answers a pending event by policy, then ticks', () => {
    const { run, cmds } = recorder();
    playTick(run, withPending('t2117_tick_event'), 'cheapest');
    expect(cmds).toEqual(['event choose 1', 'tick 1']);
  });

  it('defaults to first', () => {
    const { run, cmds } = recorder();
    playTick(run, withPending('t2117_tick_event'));
    expect(cmds).toEqual(['event choose 0', 'tick 1']);
  });

  it('only ticks when nothing is pending', () => {
    const { run, cmds } = recorder();
    playTick(run, withPending(null), 'cheapest');
    expect(cmds).toEqual(['tick 1']);
  });
});

/** A site with no buildings yet, an event pending and a building order the next tick raises. */
function bareSiteWithEvent(eventId: string): GameState {
  const state = {
    buildings: { buildings: [] }, navGrid: { width: 16, height: 16 }, plannedBuildings: [], drillHoles: [{ x: 20, z: 30 }],
    events: { pendingEvent: { eventId } },
  } as unknown as GameState;
  return state;
}

/** A runner that accepts every command, raises an ordered building on its first tick and reads the zone clear after one tick. */
function siteRunner(state: GameState): { run: Run; cmds: string[] } {
  const cmds: string[] = [];
  let ticks = 0;
  const run: Run = (cmd: string) => {
    cmds.push(cmd);
    if (cmd.startsWith('build ')) state.plannedBuildings.push({} as GameState['plannedBuildings'][number]);
    if (cmd === 'tick 1') { ticks++; state.plannedBuildings.length = 0; }
    return { success: true, output: cmd === 'zone status' ? (ticks > 0 ? 'Zone CLEAR' : 'Zone NOT CLEAR') : '' };
  };
  return { run, cmds };
}

describe('the waits inside an action answer events by the run policy (#2126)', () => {
  registerEvent('t2126_wait_event', [{ cashDelta: -40000, effects: [{ type: 'employee_leaves', pick: 'random' }] }, { cashDelta: -3000 }]);

  it('clearBlastZone answers with the policy while the zone empties', () => {
    const state = bareSiteWithEvent('t2126_wait_event');
    const { run, cmds } = siteRunner(state);
    clearBlastZone(run, state, 'cheapest');
    expect(cmds).toEqual(['zone clear x1:4 y1:14 x2:36 y2:46', 'zone status', 'event choose 1', 'tick 1', 'zone status']);
  });

  it('clearBlastZone defaults to first', () => {
    const state = bareSiteWithEvent('t2126_wait_event');
    const { run, cmds } = siteRunner(state);
    clearBlastZone(run, state);
    expect(cmds).toContain('event choose 0');
  });

  it('clearBlastZone sends nothing without a drilled hole, whatever the policy', () => {
    const state = bareSiteWithEvent('t2126_wait_event');
    state.drillHoles.length = 0;
    const { run, cmds } = siteRunner(state);
    clearBlastZone(run, state, 'cheapest');
    expect(cmds).toEqual([]);
  });
});
