// @vitest-environment jsdom
// Order inspector content (#2266): what a pending order is, who holds it, and how to cancel it.
import { describe, it, expect, vi } from 'vitest';
import { orderContent, orderControls, isEngineOwnedAction } from '../../../../../src/ui/panels/inspector/orderContent.js';
import { contentFor, type InspectorLinks, type InspectorView } from '../../../../../src/ui/panels/inspector/InspectorContent.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import type { ActionType, GameState, PendingAction } from '../../../../../src/core/state/GameState.js';
import type { Employee } from '../../../../../src/core/entities/Employee.js';
import { formatMoney } from '../../../../../src/core/economy/formatMoney.js';
import { setLocale } from '../../../../../src/core/i18n/I18n.js';

const CANCEL = '[data-order-cancel]';
const CANCEL_ALL = '[data-order-cancel-all]';
const MANAGED = '[data-order-managed]';

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 1, name: 'Walt Diggins', role: 'driller', salary: 1000, morale: 60,
    unionized: false, injured: false, alive: true, x: 5, z: 5,
    qualifications: [], trainingState: null, activeActionId: null, fatigue: 100, collapsing: false,
    interruptedActionPayload: null, ticksWorked: 0, restTicksRemaining: null, restNeedKey: null,
    taskTicksRemaining: null, activeTaskSkill: null, destinationX: null, destinationZ: null,
    moveConsecutiveFailures: 0, isMoveStuck: false, pendingRestDuration: null, pendingRestNeedKey: null,
    pendingTaskDuration: null, pendingActionType: null, pendingActionPayload: null,
    pendingDriverVehicleId: null, taskQueue: [], locomotion: { kind: 'on_foot' }, itinerary: null,
    vehicleWaitingTicks: 0, hiredAtTick: 24,
    ...overrides,
  } as Employee;
}

function makeAction(id: number, type: ActionType, overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    id, type, requiredSkill: null, requiredVehicleRole: null,
    targetX: 37, targetZ: 52, targetY: 4, payload: {},
    targetEmployeeId: null, status: 'queued', holderId: null, queuedAtTick: 0,
    ...overrides,
  };
}

function makeState(actions: PendingAction[], employees: Employee[] = []): GameState {
  setLocale('en');
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.pendingActions = actions;
  s.employees.employees = employees;
  return s;
}

function makeLinks() {
  const run = vi.fn();
  const links: InspectorLinks = { select: vi.fn(), run, confirm: vi.fn() };
  return { links, run };
}

function mountView(state: GameState, id: number, links: InspectorLinks = makeLinks().links): { view: InspectorView; root: HTMLElement } {
  const view = orderContent.view({ kind: 'order', id }, state, links)!;
  const root = document.createElement('div');
  root.append(...view.sections);
  document.body.append(root);
  return { view, root };
}

function textOf(state: GameState, id: number): string {
  const { root, view } = mountView(state, id);
  return `${view.title} ${view.sub} ${view.status} ${root.textContent ?? ''}`;
}

function click(root: HTMLElement, selector: string): void {
  root.querySelector<HTMLElement>(selector)!.click();
}

describe('contentFor(order)', () => {
  it('is the order content', () => {
    expect(contentFor('order')).toBe(orderContent);
  });
});

describe('isEngineOwnedAction', () => {
  it('is true for rest and the auto-generated debris orders', () => {
    expect(isEngineOwnedAction(makeAction(1, 'rest'))).toBe(true);
    expect(isEngineOwnedAction(makeAction(2, 'haul_debris'))).toBe(true);
    expect(isEngineOwnedAction(makeAction(3, 'fragment_debris'))).toBe(true);
  });

  it('is false for orders a player places', () => {
    for (const type of ['drill_hole', 'charge_hole', 'dig_ramp_segment', 'place_building', 'demolish_building', 'level_ground', 'survey'] as const) {
      expect(isEngineOwnedAction(makeAction(1, type))).toBe(false);
    }
  });
});

describe('order inspector — view', () => {
  it('is null when the order is gone', () => {
    const s = makeState([makeAction(51, 'drill_hole')]);
    expect(orderContent.view({ kind: 'order', id: 999 }, s, makeLinks().links)).toBeNull();
  });

  it('is null once the action completed and left the pool', () => {
    const s = makeState([makeAction(51, 'drill_hole')]);
    expect(orderContent.view({ kind: 'order', id: 51 }, s, makeLinks().links)).not.toBeNull();
    s.pendingActions = [];
    expect(orderContent.view({ kind: 'order', id: 51 }, s, makeLinks().links)).toBeNull();
  });

  it('names the kind of action: different orders read differently', () => {
    const s = makeState([makeAction(51, 'drill_hole'), makeAction(52, 'place_building', { payload: { cost: 100 } })]);
    const drill = mountView(s, 51).view;
    const build = mountView(s, 52).view;
    expect(drill.title.length).toBeGreaterThan(0);
    expect(build.title.length).toBeGreaterThan(0);
    expect(drill.title).not.toBe(build.title);
    expect(drill.title).not.toMatch(/drill_hole/);
  });

  it('shows the location coordinates', () => {
    const text = textOf(makeState([makeAction(51, 'drill_hole', { targetX: 37, targetZ: 52 })]), 51);
    expect(text).toContain('37');
    expect(text).toContain('52');
  });

  it('reads queued for a waiting order', () => {
    expect(textOf(makeState([makeAction(51, 'drill_hole', { status: 'queued' })]), 51)).toMatch(/queued/i);
  });

  it('reads walking for an order whose holder is on the way', () => {
    const s = makeState([makeAction(51, 'drill_hole', { status: 'assigned', holderId: 1 })], [makeEmployee()]);
    expect(textOf(s, 51)).toMatch(/walking/i);
  });

  it('reads working for an order in progress', () => {
    const s = makeState([makeAction(51, 'drill_hole', { status: 'in_progress', holderId: 1 })], [makeEmployee()]);
    expect(textOf(s, 51)).toMatch(/working/i);
  });

  it('reads blocked for a queued order carrying a blocked reason', () => {
    const s = makeState([makeAction(51, 'drill_hole', { blockedReason: 'no_qualified_employee' })]);
    expect(textOf(s, 51)).toMatch(/blocked/i);
  });

  it('a different blocked reason reads differently', () => {
    const a = textOf(makeState([makeAction(51, 'drill_hole', { blockedReason: 'no_qualified_employee' })]), 51);
    const b = textOf(makeState([makeAction(51, 'drill_hole', { blockedReason: 'explosives_unaffordable' })]), 51);
    expect(a).not.toBe(b);
  });

  it('reads out of reach for an order nobody can path to', () => {
    const s = makeState([makeAction(51, 'drill_hole', { blockedReason: 'target_unreachable' })]);
    s.ghostPreviews = [{ id: 51, type: 'drill_hole', targetX: 37, targetZ: 52, targetY: 4, claimed: false, unreachable: true, blocked: true }];
    expect(textOf(s, 51)).toMatch(/out of reach/i);
  });

  it('names the holder', () => {
    const s = makeState([makeAction(51, 'drill_hole', { status: 'assigned', holderId: 1 })], [makeEmployee({ name: 'Walt Diggins' })]);
    expect(textOf(s, 51)).toContain('Walt Diggins');
  });

  it('says unclaimed when nobody holds the order', () => {
    const s = makeState([makeAction(51, 'drill_hole')], [makeEmployee({ name: 'Walt Diggins' })]);
    const text = textOf(s, 51);
    expect(text).toMatch(/unclaimed/i);
    expect(text).not.toContain('Walt Diggins');
  });

  it('shows the refund a cancel pays, formatted as money', () => {
    const s = makeState([makeAction(51, 'place_building', { payload: { cost: 12345 } })]);
    expect(textOf(s, 51)).toContain(formatMoney(12345));
  });

  it('sums the refund over every ramp segment a cancel removes', () => {
    const s = makeState([
      makeAction(51, 'dig_ramp_segment', { payload: { rampId: 9, segmentCost: 1000 } }),
      makeAction(52, 'dig_ramp_segment', { payload: { rampId: 9, segmentCost: 2500 } }),
      makeAction(53, 'dig_ramp_segment', { payload: { rampId: 9, segmentCost: 4000 } }),
      makeAction(54, 'dig_ramp_segment', { payload: { rampId: 10, segmentCost: 333 } }),
    ]);
    expect(textOf(s, 51)).toContain(formatMoney(7500));
  });

  it('sync leaves the built sections intact', () => {
    const s = makeState([makeAction(51, 'place_building', { payload: { cost: 100 } })]);
    const { view, root } = mountView(s, 51);
    expect(() => view.sync(root)).not.toThrow();
    expect(root.querySelector(CANCEL)).not.toBeNull();
  });
});

describe('order inspector — Cancel', () => {
  it('a plain order has one Cancel button, running employee cancel <id>', () => {
    const s = makeState([makeAction(51, 'place_building', { payload: { cost: 100 } })]);
    const { links, run } = makeLinks();
    const { root } = mountView(s, 51, links);
    expect(root.querySelectorAll(CANCEL)).toHaveLength(1);
    expect(root.querySelector(CANCEL_ALL)).toBeNull();
    click(root, CANCEL);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('employee cancel 51');
  });

  it('a lone drill order has no Cancel all', () => {
    const s = makeState([makeAction(51, 'drill_hole')]);
    const { root } = mountView(s, 51);
    expect(root.querySelectorAll(CANCEL)).toHaveLength(1);
    expect(root.querySelector(CANCEL_ALL)).toBeNull();
  });

  it('with several drill orders outstanding, offers Cancel all N next to Cancel', () => {
    const s = makeState([makeAction(51, 'drill_hole'), makeAction(52, 'drill_hole'), makeAction(53, 'drill_hole')]);
    const { links, run } = makeLinks();
    const { root } = mountView(s, 52, links);
    expect(root.querySelectorAll(CANCEL)).toHaveLength(1);
    const all = root.querySelectorAll<HTMLElement>(CANCEL_ALL);
    expect(all).toHaveLength(1);
    expect(all[0]!.textContent).toContain('Cancel all 3');

    click(root, CANCEL);
    expect(run).toHaveBeenLastCalledWith('employee cancel 52');
    click(root, CANCEL_ALL);
    expect(run).toHaveBeenLastCalledWith('employee cancel 52 all');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('with several charge orders outstanding, counts them in Cancel all', () => {
    const s = makeState([makeAction(61, 'charge_hole'), makeAction(62, 'charge_hole')]);
    const { root } = mountView(s, 61);
    expect(root.querySelector(CANCEL_ALL)!.textContent).toContain('Cancel all 2');
  });

  it('other kinds of order do not count towards Cancel all', () => {
    const s = makeState([makeAction(51, 'drill_hole'), makeAction(52, 'charge_hole'), makeAction(53, 'place_building', { payload: { cost: 1 } })]);
    const { root } = mountView(s, 51);
    expect(root.querySelector(CANCEL_ALL)).toBeNull();
  });

  it('a whole ramp is cancelled with one button running employee cancel <id> all', () => {
    const s = makeState([
      makeAction(51, 'dig_ramp_segment', { payload: { rampId: 9, segmentCost: 100 } }),
      makeAction(52, 'dig_ramp_segment', { payload: { rampId: 9, segmentCost: 100 } }),
      makeAction(53, 'dig_ramp_segment', { payload: { rampId: 9, segmentCost: 100 } }),
    ]);
    const { links, run } = makeLinks();
    const { root } = mountView(s, 52, links);
    expect(root.querySelectorAll(CANCEL)).toHaveLength(1);
    expect(root.querySelector(CANCEL_ALL)).toBeNull();
    click(root, CANCEL);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('employee cancel 52 all');
  });

  it('a ramp with one segment left still cancels whole, through one button', () => {
    const s = makeState([makeAction(51, 'dig_ramp_segment', { payload: { rampId: 9, segmentCost: 100 } })]);
    const { links, run } = makeLinks();
    const { root } = mountView(s, 51, links);
    expect(root.querySelectorAll(CANCEL)).toHaveLength(1);
    expect(root.querySelector(CANCEL_ALL)).toBeNull();
    click(root, CANCEL);
    expect(run).toHaveBeenCalledWith('employee cancel 51 all');
  });

  it('the ramp button words a whole-order cancel, not the plain Cancel', () => {
    const ramp = makeState([makeAction(51, 'dig_ramp_segment', { payload: { rampId: 9, segmentCost: 100 } })]);
    const plain = makeState([makeAction(51, 'place_building', { payload: { cost: 100 } })]);
    const rampLabel = mountView(ramp, 51).root.querySelector(CANCEL)!.textContent;
    const plainLabel = mountView(plain, 51).root.querySelector(CANCEL)!.textContent;
    expect(rampLabel).not.toBe(plainLabel);
  });
});

describe('order inspector — engine-owned orders', () => {
  for (const type of ['rest', 'haul_debris', 'fragment_debris'] as const) {
    it(`${type} shows no cancel controls and says it is managed automatically`, () => {
      const s = makeState([makeAction(51, type)]);
      const { root } = mountView(s, 51);
      expect(root.querySelector(CANCEL)).toBeNull();
      expect(root.querySelector(CANCEL_ALL)).toBeNull();
      const note = root.querySelector(MANAGED);
      expect(note).not.toBeNull();
      expect(note!.textContent).toMatch(/automatic/i);
    });
  }

  it('several debris orders do not turn into a Cancel all', () => {
    const s = makeState([makeAction(51, 'haul_debris'), makeAction(52, 'haul_debris')]);
    expect(mountView(s, 51).root.querySelector(CANCEL_ALL)).toBeNull();
  });

  it('a player order carries no managed note', () => {
    const s = makeState([makeAction(51, 'drill_hole')]);
    expect(mountView(s, 51).root.querySelector(MANAGED)).toBeNull();
  });
});

describe('orderControls', () => {
  function controls(s: GameState, id: number, links: InspectorLinks = makeLinks().links): HTMLElement {
    const action = s.pendingActions.find(a => a.id === id)!;
    const host = document.createElement('div');
    host.append(...orderControls(action, s, links));
    document.body.append(host);
    return host;
  }

  it('gives a plain order its Cancel button, wired to the command', () => {
    const s = makeState([makeAction(51, 'place_building', { payload: { cost: 1 } })]);
    const { links, run } = makeLinks();
    const host = controls(s, 51, links);
    expect(host.querySelectorAll(CANCEL)).toHaveLength(1);
    click(host, CANCEL);
    expect(run).toHaveBeenCalledWith('employee cancel 51');
  });

  it('gives Cancel all N for a linked order and the managed note for an engine-owned one', () => {
    const s = makeState([makeAction(51, 'drill_hole'), makeAction(52, 'drill_hole'), makeAction(53, 'rest')]);
    expect(controls(s, 51).querySelector(CANCEL_ALL)!.textContent).toContain('Cancel all 2');
    const rest = controls(s, 53);
    expect(rest.querySelector(CANCEL)).toBeNull();
    expect(rest.querySelector(MANAGED)).not.toBeNull();
  });
});
