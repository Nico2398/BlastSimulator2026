// @vitest-environment jsdom
// Water fixes carried by the water warnings (#2267): drain, tube, buy tubing, open the water section.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildWaterFixes,
  waterFixKey,
  waterFixOffer,
  type WaterFixOffer,
} from '../../../../src/ui/panels/waterFixes.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import { addHole } from '../../../../src/core/mining/DrillPlan.js';
import { createCharge } from '../../../../src/core/mining/ChargePlan.js';
import { HOLE_DRAIN_COST_PER_HOLE } from '../../../../src/core/config/balance.js';
import { TUBING_BUY_AMOUNT, TUBING_COST } from '../../../../src/core/mining/Tubing.js';
import { setLocale } from '../../../../src/core/i18n/I18n.js';
import { setHoleWater } from '../../../helpers/holeWater.js';

const TIGHT = 0.03;
const POROUS = 0.35;

const FIXES = '[data-role="water-fixes"]';
const DRAIN = '[data-action="water-drain"]';
const TUBE = '[data-action="water-tube"]';
const BUY = '[data-action="water-buy-tubing"]';
const OPEN = '[data-action="water-open"]';
const REASON = '[data-role="water-fix-reason"]';
const TUBE_FIRST = '[data-role="water-tube-first"]';

const holeCounter = { nextHoleId: 1 };

beforeEach(() => {
  holeCounter.nextHoleId = 1;
  document.body.innerHTML = '';
  setLocale('en');
});

/** A desert game with `n` drilled holes charged with `explosiveId`. */
function chargedState(n: number, explosiveId = 'boomite'): GameState {
  const state = createGame({ seed: 1, mineType: 'desert' });
  state.cash = 10_000;
  for (let i = 0; i < n; i++) {
    const hole = addHole(holeCounter, state.drillHoles, 20 + i * 3, 20, 8, 0.15);
    const c = createCharge(explosiveId, 5, 2, hole.depth);
    if ('charge' in c) state.chargesByHole[hole.id] = c.charge;
  }
  return state;
}

function ids(state: GameState): string[] {
  return state.drillHoles.map(h => h.id);
}

function offerOf(over: Partial<WaterFixOffer> = {}): WaterFixOffer {
  return {
    target: 'wet',
    drainableIds: ['H1', 'H2'],
    porousBlockedIds: [],
    tubeIds: ['H1', 'H2'],
    wetCount: 2,
    drainCost: 2 * HOLE_DRAIN_COST_PER_HOLE,
    cash: 1000,
    stock: 10,
    ...over,
  };
}

function mount(offer: WaterFixOffer, withOpen = true) {
  const run = vi.fn();
  const openWater = vi.fn();
  const root = buildWaterFixes(offer, withOpen ? { run, openWater } : { run });
  document.body.appendChild(root);
  return { root, run, openWater };
}

const q = (root: HTMLElement, sel: string) => root.querySelector<HTMLButtonElement>(sel);

describe('waterFixOffer', () => {
  it('wet target: every wet hole in tight rock is drainable and tubeable, cost is count x per-hole cost', () => {
    const state = chargedState(3);
    setHoleWater(state, ids(state), 0.9, TIGHT);
    state.cash = 1000;
    state.tubingState.inventory = 4;

    const offer = waterFixOffer(state, 'wet');

    expect(offer.target).toBe('wet');
    expect([...offer.drainableIds].sort()).toEqual(ids(state).sort());
    expect(offer.porousBlockedIds).toEqual([]);
    expect([...offer.tubeIds].sort()).toEqual(ids(state).sort());
    expect(offer.wetCount).toBe(3);
    expect(offer.drainCost).toBe(3 * HOLE_DRAIN_COST_PER_HOLE);
    expect(offer.cash).toBe(1000);
    expect(offer.stock).toBe(4);
  });

  it('a wet untubed hole in porous rock is blocked for draining, and tubing it comes first', () => {
    const state = chargedState(1);
    setHoleWater(state, ids(state), 0.9, POROUS);

    const offer = waterFixOffer(state, 'wet');

    expect(offer.drainableIds).toEqual([]);
    expect(offer.porousBlockedIds).toEqual(ids(state));
    expect(offer.tubeIds).toEqual(ids(state));
    expect(offer.drainCost).toBe(0);
  });

  it('once tubed the porous hole is drainable and no longer a tube target', () => {
    const state = chargedState(1);
    setHoleWater(state, ids(state), 0.9, POROUS);
    state.tubingState.installedHoles = new Set(ids(state));

    const offer = waterFixOffer(state, 'wet');

    expect(offer.drainableIds).toEqual(ids(state));
    expect(offer.porousBlockedIds).toEqual([]);
    expect(offer.tubeIds).toEqual([]);
    expect(offer.drainCost).toBe(HOLE_DRAIN_COST_PER_HOLE);
  });

  it('tube targets are the untubed wet holes only; dry holes are left out', () => {
    const state = chargedState(3);
    const [a, b, c] = ids(state) as [string, string, string];
    setHoleWater(state, [a, b], 0.9, TIGHT);
    state.tubingState.installedHoles = new Set([a]);

    const offer = waterFixOffer(state, 'wet');

    expect(offer.tubeIds).toEqual([b]);
    expect(offer.tubeIds).not.toContain(c);
    expect([...offer.drainableIds].sort()).toEqual([a, b].sort());
  });

  it('cash equal to the drain cost total still leaves the offer intact (boundary)', () => {
    const state = chargedState(2);
    setHoleWater(state, ids(state), 0.9, TIGHT);
    state.cash = 2 * HOLE_DRAIN_COST_PER_HOLE;

    const offer = waterFixOffer(state, 'wet');

    expect(offer.cash).toBe(offer.drainCost);
    expect(offer.drainableIds).toHaveLength(2);
  });

  it('rain target: the tube targets are the rain-exposed holes, nothing is drainable when nothing is wet', () => {
    const state = chargedState(3);
    state.weather.current = 'light_rain';
    state.tubingState.installedHoles = new Set([ids(state)[0]!]);

    const offer = waterFixOffer(state, 'rain');

    expect(offer.target).toBe('rain');
    expect([...offer.tubeIds].sort()).toEqual(ids(state).slice(1).sort());
    expect(offer.drainableIds).toEqual([]);
    expect(offer.wetCount).toBe(0);
    expect(offer.drainCost).toBe(0);
  });

  it('rain target outside rain has no tube targets', () => {
    const state = chargedState(2);
    state.weather.current = 'sunny';
    expect(waterFixOffer(state, 'rain').tubeIds).toEqual([]);
  });

  it('reports the tubing stock and cash it was given', () => {
    const state = chargedState(1);
    state.cash = 321;
    state.tubingState.inventory = 7;
    const offer = waterFixOffer(state, 'rain');
    expect(offer.cash).toBe(321);
    expect(offer.stock).toBe(7);
  });
});

describe('waterFixKey', () => {
  function keyedState(): GameState {
    const state = chargedState(2);
    state.weather.current = 'light_rain';
    return state;
  }

  it('is stable for an unchanged state', () => {
    const state = keyedState();
    expect(waterFixKey(state)).toBe(waterFixKey(state));
    expect(typeof waterFixKey(state)).toBe('string');
  });

  it('changes when a hole turns wet', () => {
    const state = keyedState();
    const before = waterFixKey(state);
    setHoleWater(state, [ids(state)[0]!], 0.9, TIGHT);
    expect(waterFixKey(state)).not.toBe(before);
  });

  it('changes when the tubing stock changes', () => {
    const state = keyedState();
    const before = waterFixKey(state);
    state.tubingState.inventory = 5;
    expect(waterFixKey(state)).not.toBe(before);
  });

  it('changes when a hole is tubed', () => {
    const state = keyedState();
    const before = waterFixKey(state);
    state.tubingState.installedHoles = new Set([ids(state)[0]!]);
    expect(waterFixKey(state)).not.toBe(before);
  });

  it('changes when cash can no longer pay the drain', () => {
    const state = keyedState();
    setHoleWater(state, ids(state), 0.9, TIGHT);
    state.cash = 100_000;
    const before = waterFixKey(state);
    state.cash = 0;
    expect(waterFixKey(state)).not.toBe(before);
  });

  it('changes when rain starts on charged untubed holes', () => {
    const state = chargedState(2);
    state.weather.current = 'sunny';
    const before = waterFixKey(state);
    state.weather.current = 'storm';
    expect(waterFixKey(state)).not.toBe(before);
  });
});

describe('buildWaterFixes', () => {
  it('builds a root tagged water-fixes', () => {
    const { root } = mount(offerOf());
    expect(root.dataset['role']).toBe('water-fixes');
  });

  describe('drain', () => {
    it('is offered enabled and shows the drain cost (drainable count x per-hole cost)', () => {
      const { root } = mount(offerOf());
      const btn = q(root, DRAIN)!;
      expect(btn).not.toBeNull();
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toContain(`$${2 * HOLE_DRAIN_COST_PER_HOLE}`);
    });

    it('runs one drain_hole command per drainable hole', () => {
      const { root, run } = mount(offerOf({ drainableIds: ['H1', 'H3', 'H7'], drainCost: 3 * HOLE_DRAIN_COST_PER_HOLE }));
      q(root, DRAIN)!.click();
      expect(run.mock.calls.map(c => c[0])).toEqual(['drain_hole hole:H1', 'drain_hole hole:H3', 'drain_hole hole:H7']);
    });

    it('does not target porous-blocked holes', () => {
      const { root, run } = mount(offerOf({ drainableIds: ['H2'], porousBlockedIds: ['H1'], drainCost: HOLE_DRAIN_COST_PER_HOLE }));
      q(root, DRAIN)!.click();
      expect(run.mock.calls.map(c => c[0])).toEqual(['drain_hole hole:H2']);
    });

    it('is enabled when cash exactly equals the drain cost total', () => {
      const cost = 2 * HOLE_DRAIN_COST_PER_HOLE;
      const { root, run } = mount(offerOf({ cash: cost, drainCost: cost }));
      const btn = q(root, DRAIN)!;
      expect(btn.disabled).toBe(false);
      btn.click();
      expect(run).toHaveBeenCalledTimes(2);
    });

    it('is disabled with a visible reason, never hidden, when cash is short', () => {
      const cost = 2 * HOLE_DRAIN_COST_PER_HOLE;
      const { root, run } = mount(offerOf({ cash: cost - 1, drainCost: cost }));
      const btn = q(root, DRAIN)!;
      expect(btn).not.toBeNull();
      expect(btn.disabled).toBe(true);
      expect(root.querySelectorAll(REASON).length).toBeGreaterThan(0);
      expect(root.querySelector(REASON)!.textContent!.trim()).not.toBe('');
      btn.click();
      expect(run).not.toHaveBeenCalled();
    });

    it('is disabled with the tube-first reason when only porous untubed holes are wet', () => {
      const { root, run } = mount(offerOf({ drainableIds: [], porousBlockedIds: ['H1'], tubeIds: ['H1'], wetCount: 1, drainCost: 0 }));
      const btn = q(root, DRAIN)!;
      expect(btn).not.toBeNull();
      expect(btn.disabled).toBe(true);
      const line = root.querySelector(TUBE_FIRST);
      expect(line).not.toBeNull();
      expect(line!.textContent!.trim()).not.toBe('');
      btn.click();
      expect(run).not.toHaveBeenCalled();
    });

    it('has no tube-first line when nothing is porous-blocked', () => {
      const { root } = mount(offerOf());
      expect(root.querySelector(TUBE_FIRST)).toBeNull();
    });

    it('is disabled with a reason when the wet row has nothing wet to drain', () => {
      const { root, run } = mount(offerOf({ drainableIds: [], porousBlockedIds: [], tubeIds: [], wetCount: 0, drainCost: 0 }));
      const btn = q(root, DRAIN)!;
      expect(btn).not.toBeNull();
      expect(btn.disabled).toBe(true);
      expect(root.querySelectorAll(REASON).length).toBeGreaterThan(0);
      btn.click();
      expect(run).not.toHaveBeenCalled();
    });

    it('is not offered on the rain row when no hole is wet', () => {
      const { root } = mount(offerOf({ target: 'rain', drainableIds: [], porousBlockedIds: [], wetCount: 0, drainCost: 0 }));
      expect(root.querySelector(DRAIN)).toBeNull();
    });
  });

  describe('tube', () => {
    it('is offered enabled when stock covers every hole, and installs one per hole', () => {
      const { root, run } = mount(offerOf({ tubeIds: ['H1', 'H4'], stock: 2 }));
      const btn = q(root, TUBE)!;
      expect(btn).not.toBeNull();
      expect(btn.disabled).toBe(false);
      btn.click();
      expect(run.mock.calls.map(c => c[0])).toEqual(['install_tubing hole:H1', 'install_tubing hole:H4']);
    });

    it('stock equal to the holes to tube is enough (boundary)', () => {
      const { root } = mount(offerOf({ tubeIds: ['H1', 'H2', 'H3'], stock: 3 }));
      expect(q(root, TUBE)!.disabled).toBe(false);
    });

    it('is not offered when there is nothing to tube', () => {
      const { root } = mount(offerOf({ tubeIds: [] }));
      expect(root.querySelector(TUBE)).toBeNull();
    });

    it('is disabled when stock is short, with a reason that shows stock and need', () => {
      const { root, run } = mount(offerOf({ tubeIds: ['H1', 'H2', 'H3', 'H4', 'H5'], stock: 2 }));
      const btn = q(root, TUBE)!;
      expect(btn).not.toBeNull();
      expect(btn.disabled).toBe(true);
      const reasons = [...root.querySelectorAll(REASON)].map(r => r.textContent ?? '');
      expect(reasons.some(text => text.includes('2') && text.includes('5'))).toBe(true);
      btn.click();
      expect(run).not.toHaveBeenCalled();
    });

    it('is offered on the rain row for the rain-exposed holes', () => {
      const { root, run } = mount(offerOf({ target: 'rain', drainableIds: [], wetCount: 0, drainCost: 0, tubeIds: ['H2'], stock: 3 }));
      q(root, TUBE)!.click();
      expect(run.mock.calls.map(c => c[0])).toEqual(['install_tubing hole:H2']);
    });
  });

  describe('buy tubing', () => {
    it('is not shown when stock already covers the holes to tube', () => {
      const { root } = mount(offerOf({ tubeIds: ['H1', 'H2'], stock: 2 }));
      expect(root.querySelector(BUY)).toBeNull();
    });

    it('is shown when stock is short and runs `buy amount:10`', () => {
      const { root, run } = mount(offerOf({ tubeIds: ['H1', 'H2', 'H3'], stock: 1, cash: 5000 }));
      const btn = q(root, BUY)!;
      expect(btn).not.toBeNull();
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toContain(`$${TUBING_BUY_AMOUNT * TUBING_COST}`);
      btn.click();
      expect(run.mock.calls.map(c => c[0])).toEqual([`buy amount:${TUBING_BUY_AMOUNT}`]);
      expect(TUBING_BUY_AMOUNT).toBe(10);
    });

    it('is shown disabled with a reason when cash is short', () => {
      const { root, run } = mount(offerOf({ tubeIds: ['H1', 'H2', 'H3'], stock: 0, cash: TUBING_BUY_AMOUNT * TUBING_COST - 1, drainableIds: [], drainCost: 0 }));
      const btn = q(root, BUY)!;
      expect(btn).not.toBeNull();
      expect(btn.disabled).toBe(true);
      expect(root.querySelectorAll(REASON).length).toBeGreaterThan(0);
      btn.click();
      expect(run).not.toHaveBeenCalled();
    });

    it('is enabled when cash exactly covers the purchase (boundary)', () => {
      const { root } = mount(offerOf({ tubeIds: ['H1'], stock: 0, cash: TUBING_BUY_AMOUNT * TUBING_COST, drainableIds: [], drainCost: 0 }));
      expect(q(root, BUY)!.disabled).toBe(false);
    });
  });

  describe('water section link', () => {
    it('is offered on the wet row and calls openWater', () => {
      const { root, openWater, run } = mount(offerOf());
      const link = q(root, OPEN)!;
      expect(link).not.toBeNull();
      link.click();
      expect(openWater).toHaveBeenCalledTimes(1);
      expect(run).not.toHaveBeenCalled();
    });

    it('is offered on the rain row too', () => {
      const { root, openWater } = mount(offerOf({ target: 'rain', drainableIds: [], wetCount: 0, drainCost: 0 }));
      q(root, OPEN)!.click();
      expect(openWater).toHaveBeenCalledTimes(1);
    });

    it('stays offered when every action is unavailable', () => {
      const { root } = mount(offerOf({ drainableIds: [], tubeIds: [], wetCount: 0, drainCost: 0 }));
      expect(q(root, OPEN)).not.toBeNull();
    });
  });

  it('actions only run console commands: nothing else is invoked while clicking everything', () => {
    const { root, run } = mount(offerOf({ tubeIds: ['H1', 'H2'], stock: 5 }));
    root.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.click());
    for (const [cmd] of run.mock.calls) {
      expect(cmd).toMatch(/^(drain_hole hole:H\d|install_tubing hole:H\d|buy amount:\d+)$/);
    }
  });

  it('the root is found by the shared water-fixes selector, once', () => {
    const { root } = mount(offerOf());
    expect(document.body.querySelectorAll(FIXES)).toHaveLength(1);
    expect(root.matches(FIXES)).toBe(true);
  });
});
