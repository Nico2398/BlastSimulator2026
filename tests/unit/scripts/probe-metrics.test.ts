import { describe, it, expect } from 'vitest';
import { MetricsObserver, fragmentOreKg } from '../../../scripts/shared/probe-metrics.js';
import type { GameState } from '../../../src/core/state/GameState.js';

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
