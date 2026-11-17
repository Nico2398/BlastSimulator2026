import { describe, it, expect } from 'vitest';
import {
  CASH_SAMPLE_TICKS, FRONTIER_MARKS, MetricsObserver, fragmentOreKg, frontierMarks, gradeEarningsPerTick, salesCostsAfterFirstSale,
} from '../../../scripts/shared/probe-metrics.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { Transaction } from '../../../src/core/economy/Finance.js';

const small = { id: 1, volume: 0.1, oreDensities: { iron: 0.5 } };
// 3 m³: a boulder, above OVERSIZED_FRAGMENT_THRESHOLD (2.0 m³).
const boulder = { id: 2, volume: 3, oreDensities: { iron: 0.5 } };

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

describe('MetricsObserver tiers (#2277)', () => {
  it('records the tick each tier was first reached, keyed grade.tier, leaving the start tier out', () => {
    const obs = new MetricsObserver();
    const at = (tick: number, grade: number, tier: number) => {
      const s = synthetic({ tick }) as unknown as { grade: { grade: number; tier: number } };
      s.grade.grade = grade;
      s.grade.tier = tier;
      obs.onTick(s as unknown as GameState);
    };
    at(10, 0, 1);
    at(20, 0, 2);
    at(30, 0, 2);
    at(40, 0, 3);
    at(50, 1, 1);
    expect(obs.finalize().tierReachedTick).toEqual({ '0.2': 20, '0.3': 40, '1.1': 50 });
  });
});

describe('gradeEarningsPerTick (#2322)', () => {
  it('divides the sales income of each grade span by the ticks of that span', () => {
    const ledger = [income(50, 400), income(150, 600, 'sales'), income(350, 1000, 'bonus')];
    const r = gradeEarningsPerTick(ledger, { 1: 100, 2: 300 }, 500);
    expect(r[0]).toBeCloseTo(4, 9);
    expect(r[1]).toBeCloseTo(3, 9);
    expect(r[2]).toBeCloseTo(5, 9);
  });

  it('puts an income on the tick a grade was reached into that grade', () => {
    const r = gradeEarningsPerTick([income(100, 200)], { 1: 100 }, 200);
    expect(r[0]).toBeCloseTo(0, 9);
    expect(r[1]).toBeCloseTo(2, 9);
  });

  it('leaves out income on or after the end tick', () => {
    const r = gradeEarningsPerTick([income(100, 500), income(200, 9999)], {}, 200);
    expect(r[0]).toBeCloseTo(2.5, 9);
  });

  it('counts sales income only, never expenses or other categories', () => {
    const ledger = [
      income(10, 100), expense(20, 5000), income(30, 7000, 'refund'), income(40, 7000, 'events'), income(50, 7000, 'smuggling'),
    ];
    expect(gradeEarningsPerTick(ledger, {}, 100)[0]).toBeCloseTo(1, 9);
  });

  it('reports zero for a grade that earned nothing', () => {
    const r = gradeEarningsPerTick([income(10, 100)], { 1: 50 }, 100);
    expect(r[1]).toBe(0);
  });

  it('omits a grade whose span has no ticks', () => {
    const r = gradeEarningsPerTick([income(10, 100)], { 1: 0, 2: 100 }, 100);
    expect(r).not.toHaveProperty('0');
    expect(r[1]).toBeCloseTo(1, 9);
    expect(r).not.toHaveProperty('2');
  });

  it('omits an earlier grade when two grades were reached on one tick', () => {
    const r = gradeEarningsPerTick([income(150, 100)], { 1: 100, 2: 100 }, 200);
    expect(r).not.toHaveProperty('1');
    expect(r[2]).toBeCloseTo(1, 9);
  });

  it('is empty for no ticks at all and zero for no transactions', () => {
    expect(gradeEarningsPerTick([], {}, 0)).toEqual({});
    expect(gradeEarningsPerTick([], { 1: 10 }, 20)).toEqual({ 0: 0, 1: 0 });
  });
});

describe('frontierMarks (#2322)', () => {
  const state = (over: object): GameState => ({ grade: { grade: 0, deepestPitM: 0 }, ...over }) as unknown as GameState;
  const surveys = (...methods: string[]) => methods.map((method, id) => ({ id, method }));

  it('lists the marks in report order', () => {
    expect([...FRONTIER_MARKS]).toEqual(['bench2', 'prospection', 'shuttle', 'detector', 'island', 'treranium']);
  });

  it('is empty for a bare state, partial fixtures read as false', () => {
    expect(frontierMarks({} as unknown as GameState)).toEqual([]);
    expect(frontierMarks(state({}))).toEqual([]);
  });

  it('marks bench2 from grade 1 with a pit deeper than the first bench', () => {
    expect(frontierMarks(state({ grade: { grade: 1, deepestPitM: 6 } }))).toEqual(['bench2']);
    expect(frontierMarks(state({ grade: { grade: 1, deepestPitM: 5 } }))).toEqual([]);
    expect(frontierMarks(state({ grade: { grade: 0, deepestPitM: 30 } }))).toEqual([]);
  });

  it('marks prospection and detector from the survey methods, not other surveys', () => {
    expect(frontierMarks(state({ surveyResults: surveys('seismic', 'aerial') }))).toEqual([]);
    expect(frontierMarks(state({ surveyResults: surveys('prospection') }))).toEqual(['prospection']);
    expect(frontierMarks(state({ surveyResults: surveys('meteorite_detector') }))).toEqual(['detector']);
  });

  it('marks shuttle from a travel vehicle', () => {
    expect(frontierMarks(state({ vehicles: { vehicles: [{ type: 'drill_rig' }] } }))).toEqual([]);
    expect(frontierMarks(state({ vehicles: { vehicles: [{ type: 'drill_rig' }, { type: 'travel_vehicle' }] } }))).toEqual(['shuttle']);
  });

  it('marks island on craktonite or absurdium ore and treranium on treranium', () => {
    const ore = (oreYields: Record<string, number>) => state({ lastOreReport: { oreYields } });
    expect(frontierMarks(ore({ iron: 900 }))).toEqual([]);
    expect(frontierMarks(ore({ craktonite: 5 }))).toEqual(['island']);
    expect(frontierMarks(ore({ absurdium: 5 }))).toEqual(['island']);
    expect(frontierMarks(ore({ craktonite: 0, absurdium: 0, treranium: 0 }))).toEqual([]);
    expect(frontierMarks(ore({ treranium: 1 }))).toEqual(['treranium']);
    expect(frontierMarks(state({ lastOreReport: null }))).toEqual([]);
  });

  it('returns every mark that holds, in report order', () => {
    const all = state({
      grade: { grade: 3, deepestPitM: 12 },
      surveyResults: surveys('meteorite_detector', 'prospection'),
      vehicles: { vehicles: [{ type: 'travel_vehicle' }] },
      lastOreReport: { oreYields: { craktonite: 1, treranium: 1 } },
    });
    expect(frontierMarks(all)).toEqual([...FRONTIER_MARKS]);
  });
});

describe('MetricsObserver quest and frontier ticks (#2322)', () => {
  type Extra = Record<string, unknown>;
  const at = (tick: number, extra: Extra = {}): GameState => ({ ...(synthetic({ tick }) as unknown as Extra), ...extra }) as unknown as GameState;
  const quests = (...completed: string[]) => ({ quests: { completed } });

  it('records the tick each quest was first seen completed and keeps it', () => {
    const obs = new MetricsObserver();
    obs.onTick(at(10, quests()));
    obs.onTick(at(20, quests('quest_a')));
    obs.onTick(at(30, quests('quest_a', 'quest_b')));
    obs.onTick(at(40, quests('quest_a', 'quest_b')));
    expect(obs.finalize().questTicks).toEqual({ quest_a: 20, quest_b: 30 });
  });

  it('records a quest already completed at the first observed tick on that tick', () => {
    const obs = new MetricsObserver();
    obs.onTick(at(7, quests('quest_a')));
    expect(obs.finalize().questTicks).toEqual({ quest_a: 7 });
  });

  it('has no quest ticks without a quest state', () => {
    const obs = new MetricsObserver();
    obs.onTick(at(5));
    expect(obs.finalize().questTicks ?? {}).toEqual({});
  });

  it('records the first tick each frontier mark held', () => {
    const obs = new MetricsObserver();
    obs.onTick(at(10));
    obs.onTick(at(20, { vehicles: { vehicles: [{ type: 'travel_vehicle' }] } }));
    obs.onTick(at(30, { vehicles: { vehicles: [{ type: 'travel_vehicle' }] }, surveyResults: [{ id: 1, method: 'prospection' }] }));
    obs.onTick(at(40, { vehicles: { vehicles: [] }, surveyResults: [{ id: 1, method: 'prospection' }] }));
    expect(obs.finalize().frontierTicks).toEqual({ shuttle: 20, prospection: 30 });
  });

  it('has no frontier ticks when no mark ever held', () => {
    const obs = new MetricsObserver();
    obs.onTick(at(5));
    expect(obs.finalize().frontierTicks ?? {}).toEqual({});
  });

  it('computes the per-grade earnings per tick over the ledger, reached ticks and last tick', () => {
    const obs = new MetricsObserver();
    const finances = { transactions: [income(50, 400), income(150, 600, 'sales'), expense(160, 9999)] };
    const step = (tick: number, grade: number) => {
      const s = at(tick, { finances }) as unknown as { grade: { grade: number } };
      s.grade = { grade };
      obs.onTick(s as unknown as GameState);
    };
    step(10, 0);
    step(100, 1);
    step(300, 1);
    const per = obs.finalize().gradeEarnPerTick!;
    expect(per[0]).toBeCloseTo(4, 9);
    expect(per[1]).toBeCloseTo(3, 9);
    expect(per).not.toHaveProperty('2');
  });

  it('serializes the new metrics deterministically', () => {
    const build = () => {
      const obs = new MetricsObserver();
      obs.onTick(at(10, quests('quest_a')));
      return JSON.stringify(obs.finalize());
    };
    expect(build()).toBe(build());
  });
});
