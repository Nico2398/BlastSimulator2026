// @vitest-environment jsdom
// Drill hole inspector content (#1769): depth, diameter, state, charge, ground.
import { describe, it, expect, vi } from 'vitest';
import { holeContent } from '../../../../../src/ui/panels/inspector/holeContent.js';
import type { InspectorLinks, InspectorView } from '../../../../../src/ui/panels/inspector/InspectorContent.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import type { ActionType, GameState, PendingAction } from '../../../../../src/core/state/GameState.js';
import { addHole, holeNumericId } from '../../../../../src/core/mining/DrillPlan.js';
import { t, setLocale } from '../../../../../src/core/i18n/I18n.js';

const links = { select: () => {}, run: () => {}, confirm: () => {} } as InspectorLinks;

function makeState(): GameState {
  setLocale('en');
  return createGame({ seed: 1, mineType: 'desert' });
}

function drilled(s: GameState, depth = 8, diameter = 0.15) {
  return addHole({ nextHoleId: 1 }, s.drillHoles, 10, 10, depth, diameter);
}

function viewOf(s: GameState, holeId: string): InspectorView {
  return holeContent.view({ kind: 'hole', id: holeNumericId(holeId) }, s, links)!;
}

function mount(view: InspectorView): HTMLElement {
  const root = document.createElement('div');
  root.append(...view.sections);
  document.body.append(root);
  return root;
}

describe('hole inspector', () => {
  it('returns null for an unknown hole', () => {
    expect(holeContent.view({ kind: 'hole', id: 9999 }, makeState(), links)).toBeNull();
  });

  it('titles with the hole id, has no actions', () => {
    const s = makeState();
    const hole = drilled(s);
    const view = viewOf(s, hole.id);
    expect(view.title).toBe(hole.id);
    expect(view.actions).toEqual([]);
  });

  it('marks a drilled hole and shows depth and diameter', () => {
    const s = makeState();
    const hole = drilled(s, 8, 0.15);
    const root = mount(viewOf(s, hole.id));
    expect(root.querySelector('[data-hole-state="drilled"]')).not.toBeNull();
    expect(root.textContent).toContain('8');
    expect(root.textContent).toContain('0.15');
  });

  it('marks an ordered hole found only in plannedDrillHoles', () => {
    const s = makeState();
    const hole = addHole({ nextHoleId: 1 }, s.plannedDrillHoles, 12, 12, 6, 0.1);
    const root = mount(viewOf(s, hole.id));
    expect(root.querySelector('[data-hole-state="ordered"]')).not.toBeNull();
    expect(root.querySelector('[data-hole-state="drilled"]')).toBeNull();
  });

  it('says uncharged when no charge exists', () => {
    const s = makeState();
    const hole = drilled(s);
    const root = mount(viewOf(s, hole.id));
    const charge = root.querySelector('[data-hole-charge="none"]')!;
    expect(charge).not.toBeNull();
    expect(charge.textContent).toMatch(/uncharged/i);
  });

  it('shows explosive name, kg and stemming for a charged hole', () => {
    const s = makeState();
    const hole = drilled(s);
    s.chargesByHole[hole.id] = { explosiveId: 'boomite', amountKg: 6, stemmingM: 2 };
    const root = mount(viewOf(s, hole.id));
    const charge = root.querySelector('[data-hole-charge="charged"]')!;
    expect(charge).not.toBeNull();
    expect(charge.textContent).toContain(t('explosive.boomite.name'));
    expect(charge.textContent).toContain('6');
    expect(charge.textContent).toContain('2');
  });

  it('marks a charge order that is not loaded yet as ordered', () => {
    const s = makeState();
    const hole = drilled(s);
    s.plannedChargesByHole[hole.id] = { explosiveId: 'boomite', amountKg: 5, stemmingM: 1 };
    const root = mount(viewOf(s, hole.id));
    const charge = root.querySelector('[data-hole-charge="ordered"]')!;
    expect(charge.textContent).toContain(t('explosive.boomite.name'));
    expect(root.querySelector('[data-hole-charge="none"]')).toBeNull();
  });

  it('reads dry, wet and tubed ground', () => {
    const s = makeState();
    const hole = drilled(s);
    expect(mount(viewOf(s, hole.id)).querySelector('[data-hole-ground="dry"]')).not.toBeNull();
    s.holeWater[hole.id] = { level: 1, porosity: 0.5 } as GameState['holeWater'][string];
    expect(mount(viewOf(s, hole.id)).querySelector('[data-hole-ground="wet"]')).not.toBeNull();
    s.tubingState.installedHoles.add(hole.id);
    expect(mount(viewOf(s, hole.id)).querySelector('[data-hole-ground="tubed"]')).not.toBeNull();
  });

  it('points to the Blast Workshop for editing', () => {
    const s = makeState();
    const hole = drilled(s);
    expect(mount(viewOf(s, hole.id)).textContent).toContain('Blast Workshop');
  });

  it('has no delay row', () => {
    const s = makeState();
    const hole = drilled(s);
    expect(mount(viewOf(s, hole.id)).textContent?.toLowerCase()).not.toContain('delay');
  });

  it('signature changes when the hole gets charged', () => {
    const s = makeState();
    const hole = drilled(s);
    const before = viewOf(s, hole.id).signature;
    s.chargesByHole[hole.id] = { explosiveId: 'boomite', amountKg: 6, stemmingM: 2 };
    expect(viewOf(s, hole.id).signature).not.toBe(before);
  });
});

// ── #2267: a wet untubed hole links to the Charge step's water section ──

describe('hole inspector water link (#2267)', () => {
  const OPEN = '[data-action="water-open"]';
  const GROUND = '[data-hole-ground]';

  function linksWith(openWater: () => void): InspectorLinks {
    return { select: () => {}, run: () => {}, confirm: () => {}, openWater } as InspectorLinks;
  }

  function viewWith(s: GameState, holeId: string, l: InspectorLinks): InspectorView {
    return holeContent.view({ kind: 'hole', id: holeNumericId(holeId) }, s, l)!;
  }

  function wetHole() {
    const s = makeState();
    const hole = drilled(s);
    s.holeWater[hole.id] = { level: 1, porosity: 0.5 } as GameState['holeWater'][string];
    return { s, hole };
  }

  it('the ground row of a wet untubed hole carries the link', () => {
    const { s, hole } = wetHole();
    const root = mount(viewWith(s, hole.id, linksWith(() => {})));
    const ground = root.querySelector(GROUND)!;
    expect(ground.getAttribute('data-hole-ground')).toBe('wet');
    expect(ground.querySelector(OPEN)).not.toBeNull();
  });

  it('clicking the link calls openWater once', () => {
    const { s, hole } = wetHole();
    const openWater = vi.fn();
    const root = mount(viewWith(s, hole.id, linksWith(openWater)));
    root.querySelector<HTMLElement>(`${GROUND} ${OPEN}`)!.click();
    expect(openWater).toHaveBeenCalledTimes(1);
  });

  it('a dry hole has no link', () => {
    const s = makeState();
    const hole = drilled(s);
    const root = mount(viewWith(s, hole.id, linksWith(() => {})));
    expect(root.querySelector('[data-hole-ground="dry"]')).not.toBeNull();
    expect(root.querySelector(OPEN)).toBeNull();
  });

  it('a tubed hole has no link, even while it still holds water', () => {
    const { s, hole } = wetHole();
    s.tubingState.installedHoles.add(hole.id);
    const root = mount(viewWith(s, hole.id, linksWith(() => {})));
    expect(root.querySelector('[data-hole-ground="tubed"]')).not.toBeNull();
    expect(root.querySelector(OPEN)).toBeNull();
  });

  it('an ordered hole that is not drilled yet has no link', () => {
    const s = makeState();
    const hole = addHole({ nextHoleId: 1 }, s.plannedDrillHoles, 12, 12, 6, 0.1);
    const root = mount(viewWith(s, hole.id, linksWith(() => {})));
    expect(root.querySelector(OPEN)).toBeNull();
  });

  it('the inspector stays facts-only: no drain or tube action, no actions list', () => {
    const { s, hole } = wetHole();
    const view = viewWith(s, hole.id, linksWith(() => {}));
    const root = mount(view);
    expect(view.actions).toEqual([]);
    expect(root.querySelector('[data-action="water-drain"], [data-action="water-tube"], [data-action="water-buy-tubing"]')).toBeNull();
    expect(root.querySelector('[data-action="drain-holes"], [data-action="tubing-install"]')).toBeNull();
  });

  it('building the view for a wet hole without an openWater link does not throw', () => {
    const { s, hole } = wetHole();
    expect(() => mount(viewOf(s, hole.id))).not.toThrow();
  });

  it('sync adds the link when a dry hole turns wet, and removes it once tubed', () => {
    const s = makeState();
    const hole = drilled(s);
    const view = viewWith(s, hole.id, linksWith(() => {}));
    const root = mount(view);
    expect(root.querySelector(OPEN)).toBeNull();

    s.holeWater[hole.id] = { level: 1, porosity: 0.5 } as GameState['holeWater'][string];
    view.sync(root);
    expect(root.querySelector(`${GROUND} ${OPEN}`)).not.toBeNull();

    s.tubingState.installedHoles.add(hole.id);
    view.sync(root);
    expect(root.querySelector(OPEN)).toBeNull();
  });
});

// ── #2266: the outstanding orders of a hole carry their cancel controls ──

describe('hole inspector orders (#2266)', () => {
  const ORDERS = '[data-hole-orders]';
  const CANCEL = '[data-order-cancel]';
  const CANCEL_ALL = '[data-order-cancel-all]';

  function order(id: number, type: ActionType, holeId: string): PendingAction {
    return {
      id, type, requiredSkill: null, requiredVehicleRole: null,
      targetX: 10, targetZ: 10, targetY: 0, payload: { holeId },
      targetEmployeeId: null, status: 'queued', holderId: null, queuedAtTick: 0,
    };
  }

  function mountWith(s: GameState, holeId: string, run: (c: string) => void = () => {}): HTMLElement {
    const l = { select: () => {}, run, confirm: () => {} } as InspectorLinks;
    return mount(holeContent.view({ kind: 'hole', id: holeNumericId(holeId) }, s, l)!);
  }

  function orderedHole(s: GameState) {
    return addHole({ nextHoleId: 1 }, s.plannedDrillHoles, 12, 12, 6, 0.1);
  }

  it('a plain drilled hole without orders shows no orders section and no cancel buttons', () => {
    const s = makeState();
    s.pendingActions = [];
    const hole = drilled(s);
    const root = mountWith(s, hole.id);
    expect(root.querySelector(ORDERS)).toBeNull();
    expect(root.querySelector(CANCEL)).toBeNull();
    expect(root.querySelector(CANCEL_ALL)).toBeNull();
  });

  it('an ordered hole shows its drill order with a Cancel button running the command', () => {
    const s = makeState();
    const hole = orderedHole(s);
    s.pendingActions = [order(71, 'drill_hole', hole.id)];
    const run = vi.fn();
    const root = mountWith(s, hole.id, run);
    const section = root.querySelector(ORDERS)!;
    expect(section).not.toBeNull();
    expect(section.querySelectorAll(CANCEL)).toHaveLength(1);
    expect(section.querySelector(CANCEL_ALL)).toBeNull();
    section.querySelector<HTMLElement>(CANCEL)!.click();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('employee cancel 71');
  });

  it('a charge order on a drilled hole shows the same controls', () => {
    const s = makeState();
    const hole = drilled(s);
    s.plannedChargesByHole[hole.id] = { explosiveId: 'boomite', amountKg: 5, stemmingM: 1 };
    s.pendingActions = [order(72, 'charge_hole', hole.id)];
    const run = vi.fn();
    const root = mountWith(s, hole.id, run);
    const section = root.querySelector(ORDERS)!;
    expect(section).not.toBeNull();
    expect(section.querySelectorAll(CANCEL)).toHaveLength(1);
    section.querySelector<HTMLElement>(CANCEL)!.click();
    expect(run).toHaveBeenCalledWith('employee cancel 72');
  });

  it('a hole with a drill order and a charge order shows controls for each', () => {
    const s = makeState();
    const hole = orderedHole(s);
    s.plannedChargesByHole[hole.id] = { explosiveId: 'boomite', amountKg: 5, stemmingM: 1 };
    s.pendingActions = [order(71, 'drill_hole', hole.id), order(72, 'charge_hole', hole.id)];
    const run = vi.fn();
    const root = mountWith(s, hole.id, run);
    const buttons = Array.from(root.querySelector(ORDERS)!.querySelectorAll<HTMLElement>(CANCEL));
    expect(buttons).toHaveLength(2);
    for (const b of buttons) b.click();
    expect(run.mock.calls.map(c => c[0]).sort()).toEqual(['employee cancel 71', 'employee cancel 72']);
  });

  it('offers Cancel all N when other holes have outstanding orders of the same kind', () => {
    const s = makeState();
    const hole = orderedHole(s);
    s.pendingActions = [order(71, 'drill_hole', hole.id), order(73, 'drill_hole', 'other-1'), order(74, 'drill_hole', 'other-2')];
    const run = vi.fn();
    const root = mountWith(s, hole.id, run);
    const section = root.querySelector(ORDERS)!;
    const all = section.querySelector<HTMLElement>(CANCEL_ALL)!;
    expect(all.textContent).toContain('Cancel all 3');
    all.click();
    expect(run).toHaveBeenCalledWith('employee cancel 71 all');
  });

  it('orders of other holes add no controls of their own', () => {
    const s = makeState();
    const hole = drilled(s);
    s.pendingActions = [order(73, 'drill_hole', 'other-1'), order(74, 'charge_hole', 'other-2')];
    const root = mountWith(s, hole.id);
    expect(root.querySelector(ORDERS)).toBeNull();
    expect(root.querySelector(CANCEL)).toBeNull();
  });

  it('keeps the rest of the hole inspector', () => {
    const s = makeState();
    const hole = orderedHole(s);
    s.pendingActions = [order(71, 'drill_hole', hole.id)];
    const root = mountWith(s, hole.id);
    expect(root.querySelector('[data-hole-state="ordered"]')).not.toBeNull();
    expect(root.querySelector('[data-hole-charge="none"]')).not.toBeNull();
    expect(root.textContent).toContain('Blast Workshop');
  });
});
