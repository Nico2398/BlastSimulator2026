// BlastSimulator2026 — `contract spoil <ore> [confirm]`: send a stored ore to the spoil heaps, its value lost (#2278)
import { describe, it, expect, beforeAll } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import { formatMoney } from '../../../src/core/economy/formatMoney.js';
import { oreValuePerKg } from '../../../src/core/economy/Market.js';
import { totalSpoilKg, stateRubbleStockKg } from '../../../src/core/economy/SpoilHeaps.js';
import { SPOIL_HEAP_CAPACITY_KG } from '../../../src/core/config/balance.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { Building } from '../../../src/core/entities/Building.js';

function oreFragment(id: number, kg: number, ore: string): FragmentData {
  return {
    id, position: { x: 0, y: 0, z: 0 }, volume: kg / 2500, mass: kg * 5, rockId: 'sandite', oreDensities: { [ore]: 1.0 },
    initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false, halfExtents: { x: 0.3, y: 0.3, z: 0.3 }, shapeSeed: id,
    origin: { x: 0, y: 0, z: 0 },
  };
}

/** A grade-2 sandbox with the given ore stored and one tier 1 spoil heap with `roomKg` of room. */
function site(stock: Record<string, number>, roomKg = SPOIL_HEAP_CAPACITY_KG) {
  const { runner, ctx } = createRunner();
  expect(runner.run('sandbox start biome:desert_badlands kit:full seed:42 grade:2').success).toBe(true);
  const state: GameState = ctx.state!;
  let id = 1_000;
  for (const [ore, kg] of Object.entries(stock)) {
    const f = oreFragment(id++, kg, ore);
    state.logistics.fragments.push({ fragment: f, state: 'stored', vehicleId: null, warehouseId: null });
    state.logistics.storedMassKg += f.mass;
    state.collectedOre[ore] = kg;
  }
  const heap = { id: 9_000, type: 'spoil_heap', tier: 1, storedSpoilKg: SPOIL_HEAP_CAPACITY_KG - roomKg } as unknown as Building;
  state.buildings.buildings = [heap];
  return { runner, state, heap };
}

describe('contract spoil (#2278)', () => {
  beforeAll(() => setLocale('en'));

  describe('without confirm', () => {
    it('states the kg and the value lost, and changes nothing', () => {
      const { runner, state, heap } = site({ blingite: 300 });
      const r = runner.run('contract spoil blingite');
      expect(r.success, r.output).toBe(true);
      expect(r.output).toContain('300');
      const lost = 300 * oreValuePerKg('blingite', state.contracts.market ?? 'legacy');
      expect(r.output.includes(formatMoney(lost)) || r.output.includes(String(Math.round(lost)))).toBe(true);
      expect(state.collectedOre['blingite']).toBeCloseTo(300, 6);
      expect(totalSpoilKg([heap])).toBe(0);
    });

    it('is repeatable: asking twice still changes nothing', () => {
      const { runner, state } = site({ blingite: 300 });
      runner.run('contract spoil blingite');
      expect(runner.run('contract spoil blingite').success).toBe(true);
      expect(state.collectedOre['blingite']).toBeCloseTo(300, 6);
    });

    it('states only what the heaps have room for', () => {
      const { runner } = site({ blingite: 300 }, 120);
      const r = runner.run('contract spoil blingite');
      expect(r.success, r.output).toBe(true);
      expect(r.output).toContain('120');
    });
  });

  describe('with confirm', () => {
    it('moves the ore out of storage and into the heap', () => {
      const { runner, state, heap } = site({ blingite: 300, dirtite: 80 });
      const heapBefore = heap.storedSpoilKg ?? 0;
      const rubbleBefore = stateRubbleStockKg(state);
      const r = runner.run('contract spoil blingite confirm');
      expect(r.success, r.output).toBe(true);
      expect(state.collectedOre['blingite'] ?? 0).toBeCloseTo(0, 6);
      expect(state.collectedOre['dirtite']).toBeCloseTo(80, 6);
      expect(heap.storedSpoilKg ?? 0).toBeCloseTo(heapBefore + 300, 6);
      expect(stateRubbleStockKg(state)).toBeCloseTo(rubbleBefore + 300, 6);
    });

    it('books no income: the value is lost', () => {
      const { runner, state } = site({ blingite: 300 });
      const cash = state.cash;
      runner.run('contract spoil blingite confirm');
      expect(state.cash).toBe(cash);
      expect(state.finances.transactions.filter(tx => tx.category === 'sales')).toEqual([]);
    });

    it('works for an ore of a grade above the site\'s', () => {
      const { runner, state } = site({ treranium: 40 });
      expect(runner.run('contract spoil treranium confirm').success).toBe(true);
      expect(state.collectedOre['treranium'] ?? 0).toBeCloseTo(0, 6);
    });

    it('moves only what the heaps have room for', () => {
      const { runner, state } = site({ blingite: 300 }, 120);
      expect(runner.run('contract spoil blingite confirm').success).toBe(true);
      expect(state.collectedOre['blingite']).toBeCloseTo(180, 6);
    });

    it('a second confirm finds nothing left and is refused', () => {
      const { runner } = site({ blingite: 300 });
      expect(runner.run('contract spoil blingite confirm').success).toBe(true);
      expect(runner.run('contract spoil blingite confirm').success).toBe(false);
    });
  });

  describe('refusals change nothing', () => {
    for (const suffix of ['', ' confirm']) {
      it(`an unknown ore${suffix ? ' (confirm)' : ''}`, () => {
        const { runner, state, heap } = site({ blingite: 300 });
        const r = runner.run(`contract spoil unobtainium${suffix}`);
        expect(r.success).toBe(false);
        expect(r.output.length).toBeGreaterThan(0);
        expect(state.collectedOre['blingite']).toBeCloseTo(300, 6);
        expect(heap.storedSpoilKg ?? 0).toBe(0);
      });

      it(`an ore with no stock${suffix ? ' (confirm)' : ''}`, () => {
        const { runner, state } = site({ blingite: 300 });
        expect(runner.run(`contract spoil rustite${suffix}`).success).toBe(false);
        expect(state.collectedOre['blingite']).toBeCloseTo(300, 6);
      });

      it(`no heap with room${suffix ? ' (confirm)' : ''}`, () => {
        const { runner, state, heap } = site({ blingite: 300 }, 0);
        expect(runner.run(`contract spoil blingite${suffix}`).success).toBe(false);
        expect(state.collectedOre['blingite']).toBeCloseTo(300, 6);
        expect(heap.storedSpoilKg).toBe(SPOIL_HEAP_CAPACITY_KG);
      });

      it(`no spoil heap at all${suffix ? ' (confirm)' : ''}`, () => {
        const { runner, state } = site({ blingite: 300 });
        state.buildings.buildings = [];
        expect(runner.run(`contract spoil blingite${suffix}`).success).toBe(false);
        expect(state.collectedOre['blingite']).toBeCloseTo(300, 6);
      });
    }
  });
});
