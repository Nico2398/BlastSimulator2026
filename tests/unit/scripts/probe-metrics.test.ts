import { describe, it, expect } from 'vitest';
import { CASH_SAMPLE_TICKS, MetricsObserver, fragmentOreKg, salesCostsAfterFirstSale } from '../../../scripts/shared/probe-metrics.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { Transaction } from '../../../src/core/economy/Finance.js';

const small = { id: 1, volume: 0.1, oreDensities: { iron: 0.5 } };
const boulder = { id: 2, volume: 2, oreDensities: { iron: 0.5 } };

interface SyntheticOpts {
  tick: number;
  fragments?: Array<{ fragment: typeof small; state: string }>;
  blocked?: boolean;
  stored?: number;
  delivered?: number;
  report?: object | null;
}

/** The slice of GameState the observer reads; everything else stays absent. */
function synthetic(o: SyntheticOpts): GameState {
  return {
    tickCount: o.tick,
    cash: 1_000_000,
    bankruptcy: { bankrupt: false },
    levelEndReason: null,
    lastBlastReport: o.report ?? null,
    logistics: { fragments: o.fragments ?? [], storageCapacityKg: 100, storedMassKg: o.stored ?? 0 },
    pendingActions: o.blocked ? [{ blockedReason: 'storage_full' }] : [],
    grade: { grade: 0, oreDeliveredKg: o.delivered ?? 0 },
    vehicles: { vehicles: [{ type: 'rock_fragmenter' }] },
  } as unknown as GameState;
}

describe('fragmentOreKg', () => {
  it('sums ore mass over fragments and is zero for none', () => {
    expect(fragmentOreKg([])).toBe(0);
    expect(fragmentOreKg([small, boulder])).toBeCloseTo(fragmentOreKg([small]) + fragmentOreKg([boulder]), 6);
  });
});

describe('MetricsObserver', () => {
  const report = {};
  const onGround = [small, boulder].map(fragment => ({ fragment, state: 'on_ground' }));

  it('reads first-blast sold share at t6000 from delivered ore', () => {
    const obs = new MetricsObserver();
    obs.onTick(synthetic({ tick: 10, report, fragments: onGround }));
    const total = fragmentOreKg([small, boulder]);
    obs.onTick(synthetic({ tick: 6000, report, fragments: onGround, delivered: total / 4 }));
    expect(obs.finalize().firstBlastSoldShareAt6000).toBeCloseTo(0.25, 6);
  });

  it('reports a boulder as sold once it no longer lies on the ground', () => {
    const obs = new MetricsObserver();
    obs.onTick(synthetic({ tick: 10, report, fragments: onGround }));
    obs.onTick(synthetic({ tick: 100, report, fragments: [onGround[0]!] }));
    expect(obs.finalize().boulderSoldShare).toBe(1);
  });

  it('keeps the boulder unsold while it still lies there', () => {
    const obs = new MetricsObserver();
    obs.onTick(synthetic({ tick: 10, report, fragments: onGround }));
    obs.onTick(synthetic({ tick: 100, report, fragments: onGround }));
    expect(obs.finalize().boulderSoldShare).toBe(0);
  });

  it('records the first full-warehouse tick and counts haul-wait ticks', () => {
    const obs = new MetricsObserver();
    obs.onTick(synthetic({ tick: 1 }));
    obs.onTick(synthetic({ tick: 2, blocked: true }));
    obs.onTick(synthetic({ tick: 3, blocked: true }));
    obs.onTick(synthetic({ tick: 4, stored: 100 }));
    const m = obs.finalize();
    expect(m.warehouseFullTick).toBe(2);
    expect(m.ticksHaulWaitedOnFullStorage).toBe(2);
  });

  it('leaves share metrics null before any blast', () => {
    const obs = new MetricsObserver();
    obs.onTick(synthetic({ tick: 6000 }));
    const m = obs.finalize();
    expect(m.firstBlastSoldShareAt6000).toBeNull();
    expect(m.boulderSoldShare).toBeNull();
    expect(m.blastsFired).toBe(0);
  });
});

describe('extended metrics (#1945)', () => {
  it('samples cash at the extended ticks', () => {
    expect([...CASH_SAMPLE_TICKS]).toEqual([1000, 3000, 6000, 10000, 15000, 25000, 40000, 50000]);
    const obs = new MetricsObserver();
    obs.onTick(synthetic({ tick: 1000 }));
    const m = obs.finalize();
    for (const t of [15000, 25000, 40000, 50000]) expect(m.cashAt).toHaveProperty(String(t), null);
  });

  it('samples the deepest pit at the cash sample ticks, null before them (#2093)', () => {
    const obs = new MetricsObserver();
    const at = (tick: number, pit: number) => {
      const s = synthetic({ tick }) as unknown as { grade: { deepestPitM: number } };
      s.grade.deepestPitM = pit;
      obs.onTick(s as never);
    };
    at(999, 2);
    at(1000, 4.5);
    at(3000, 10.4);
    const m = obs.finalize();
    expect(m.pitDepthAt?.[1000]).toBe(4.5);
    expect(m.pitDepthAt?.[3000]).toBe(10.4);
    expect(m.pitDepthAt?.[6000]).toBeNull();
  });

  it('records the cash held when each grade was first reached', () => {
    const obs = new MetricsObserver();
    const at = (tick: number, grade: number, cash: number) => {
      const s = synthetic({ tick }) as unknown as { grade: { grade: number }; cash: number };
      s.grade.grade = grade;
      s.cash = cash;
      obs.onTick(s as unknown as GameState);
    };
    at(10, 0, 500);
    at(20, 1, 777);
    at(30, 1, 999);
    at(40, 2, 1234);
    const m = obs.finalize();
    expect(m.gradeCashAt).toEqual({ 1: 777, 2: 1234 });
    expect(m.gradeReachedTick).toEqual({ 1: 20, 2: 40 });
  });

  it('leaves catalogBoughtTick null and boulderOreSoldShare null without a ladder or boulders', () => {
    const obs = new MetricsObserver();
    obs.onTick(synthetic({ tick: 5 }));
    const m = obs.finalize();
    expect(m.catalogBoughtTick).toBeNull();
    expect(m.boulderOreSoldShare).toBeNull();
  });
});

const tx = (
  tick: number, amount: number, type: Transaction['type'], category: Transaction['category'],
): Transaction => ({ tick, amount, type, category, description: 'fixture' });
const income = (tick: number, amount: number, category: Transaction['category'] = 'contracts') => tx(tick, amount, 'income', category);
const expense = (tick: number, amount: number, category: Transaction['category'] = 'salaries') => tx(tick, amount, 'expense', category);

describe('salesCostsAfterFirstSale (#2117)', () => {
  it('is empty for an empty ledger', () => {
    expect(salesCostsAfterFirstSale([])).toEqual({ firstSaleTick: null, sales: 0, costs: 0, ratio: null });
  });

  it('sums sales and costs from the first sale on and divides them', () => {
    const r = salesCostsAfterFirstSale([
      expense(10, 400), income(100, 300), expense(150, 100), income(200, 500, 'sales'), expense(300, 100),
    ]);
    expect(r.firstSaleTick).toBe(100);
    expect(r.sales).toBe(800);
    expect(r.costs).toBe(200);
    expect(r.ratio).toBeCloseTo(4, 9);
  });

  it('counts contracts, sales and bonus income as sales', () => {
    for (const category of ['contracts', 'sales', 'bonus'] as const) {
      const r = salesCostsAfterFirstSale([income(50, 70, category), expense(60, 10)]);
      expect(r.firstSaleTick, category).toBe(50);
      expect(r.sales, category).toBe(70);
    }
  });

  it('does not count refund, events or smuggling income as sales', () => {
    for (const category of ['refund', 'events', 'smuggling'] as const) {
      const r = salesCostsAfterFirstSale([income(50, 70, category), expense(60, 10)]);
      expect(r.firstSaleTick, category).toBeNull();
      expect(r.sales, category).toBe(0);
      expect(r.ratio, category).toBeNull();
    }
  });

  it('a non-sale income before the first sale neither starts the window nor adds sales', () => {
    const r = salesCostsAfterFirstSale([income(10, 999, 'refund'), expense(20, 50), income(100, 200), expense(120, 40)]);
    expect(r.firstSaleTick).toBe(100);
    expect(r.sales).toBe(200);
    expect(r.costs).toBe(40);
  });

  it('non-sale income after the first sale is not a sale and not a cost', () => {
    const r = salesCostsAfterFirstSale([income(100, 200), income(120, 5000, 'events'), expense(130, 50)]);
    expect(r.sales).toBe(200);
    expect(r.costs).toBe(50);
  });

  it('counts expenses of every category, including a contracts-category expense', () => {
    const r = salesCostsAfterFirstSale([
      income(0, 100), expense(1, 10, 'salaries'), expense(2, 20, 'explosives'), expense(3, 30, 'contracts'), expense(4, 40, 'events'),
    ]);
    expect(r.costs).toBe(100);
    expect(r.ratio).toBeCloseTo(1, 9);
  });

  it('an expense on the first-sale tick counts, one just before does not', () => {
    const r = salesCostsAfterFirstSale([expense(99, 1000), expense(100, 25), income(100, 50)]);
    expect(r.firstSaleTick).toBe(100);
    expect(r.costs).toBe(25);
    expect(r.ratio).toBeCloseTo(2, 9);
  });

  it('finds the earliest sale whatever the ledger order', () => {
    const r = salesCostsAfterFirstSale([income(300, 10), expense(250, 5), income(200, 20), expense(100, 7)]);
    expect(r.firstSaleTick).toBe(200);
    expect(r.sales).toBe(30);
    expect(r.costs).toBe(5);
  });

  it('has no ratio when there are no costs after the first sale', () => {
    const r = salesCostsAfterFirstSale([expense(5, 100), income(10, 300)]);
    expect(r).toEqual({ firstSaleTick: 10, sales: 300, costs: 0, ratio: null });
  });

  it('has no ratio and no sales when only costs exist', () => {
    const r = salesCostsAfterFirstSale([expense(5, 100), expense(9, 20)]);
    expect(r.firstSaleTick).toBeNull();
    expect(r.sales).toBe(0);
    expect(r.ratio).toBeNull();
  });

  it('endTick closes the window exclusively', () => {
    const ledger = [income(100, 100), expense(150, 10), income(200, 400), expense(200, 30), expense(250, 60)];
    const r = salesCostsAfterFirstSale(ledger, 200);
    expect(r.firstSaleTick).toBe(100);
    expect(r.sales).toBe(100);
    expect(r.costs).toBe(10);
    expect(r.ratio).toBeCloseTo(10, 9);
    const wide = salesCostsAfterFirstSale(ledger, 201);
    expect(wide.sales).toBe(500);
    expect(wide.costs).toBe(40);
  });
});

/** synthetic() plus a ledger. */
function withLedger(tick: number, transactions: Transaction[]): GameState {
  const s = synthetic({ tick }) as unknown as { finances: { transactions: Transaction[] } };
  s.finances = { transactions };
  return s as unknown as GameState;
}

describe('sales/cost metrics from the ledger (#2117)', () => {
  const ledger: Transaction[] = [
    expense(500, 100),
    income(1200, 1000),
    expense(1300, 250),
    expense(2499, 250),
    expense(2500, 400),
    income(3000, 200, 'sales'),
    expense(4000, 100),
    income(4100, 700, 'bonus'),
    expense(6999, 50),
    expense(7000, 999),
  ];

  function finalized(): ReturnType<MetricsObserver['finalize']> {
    const obs = new MetricsObserver();
    obs.onTick(withLedger(8000, ledger));
    return obs.finalize();
  }

  it('reports the first sale tick', () => {
    expect(finalized().firstSaleTick).toBe(1200);
  });

  it('reports the whole-ledger sales/costs ratio from the first sale on', () => {
    const m = finalized();
    // sales 1000 + 200 + 700 = 1900; costs from t1200: 250 + 250 + 400 + 100 + 50 + 999 = 2049
    expect(m.salesCostRatio).toBeCloseTo(1900 / 2049, 9);
  });

  it('reports one ratio per 1500-tick window starting at 1000, 2500, 4000, 5500', () => {
    const w = finalized().salesCostWindows;
    expect(w).toHaveLength(4);
    // [1000,2500): sales 1000, costs 500
    expect(w[0]).toBeCloseTo(2, 9);
    // [2500,4000): sales 200, costs 400
    expect(w[1]).toBeCloseTo(0.5, 9);
    // [4000,5500): sales 700, costs 100
    expect(w[2]).toBeCloseTo(7, 9);
    // [5500,7000): no sales, costs 50
    expect(w[3]).toBeCloseTo(0, 9);
  });

  it('windows carry their own sums: costs before the first sale count, the end tick is exclusive', () => {
    const obs = new MetricsObserver();
    obs.onTick(withLedger(8000, [
      expense(1000, 100), income(1400, 300), expense(2499, 100), expense(2500, 500), income(2500, 50),
    ]));
    const w = obs.finalize().salesCostWindows;
    expect(w[0]).toBeCloseTo(300 / 200, 9);
    expect(w[1]).toBeCloseTo(50 / 500, 9);
  });

  it('a window with no costs is null', () => {
    const obs = new MetricsObserver();
    obs.onTick(withLedger(8000, [income(1100, 500), expense(2600, 100)]));
    const w = obs.finalize().salesCostWindows;
    expect(w[0]).toBeNull();
    expect(w[1]).toBeCloseTo(0, 9);
    expect(w[2]).toBeNull();
    expect(w[3]).toBeNull();
  });

  it('is null without a sale', () => {
    const obs = new MetricsObserver();
    obs.onTick(withLedger(3000, [expense(1500, 100)]));
    const m = obs.finalize();
    expect(m.firstSaleTick).toBeNull();
    expect(m.salesCostRatio).toBeNull();
  });

  it('is null for a fixture without a ledger', () => {
    const obs = new MetricsObserver();
    obs.onTick(synthetic({ tick: 100 }));
    const m = obs.finalize();
    expect(m.firstSaleTick).toBeNull();
    expect(m.salesCostRatio).toBeNull();
    expect(m.salesCostWindows).toHaveLength(4);
    expect(m.salesCostWindows.every(v => v === null)).toBe(true);
  });
});
