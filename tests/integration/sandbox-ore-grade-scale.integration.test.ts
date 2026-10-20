// Ore grade scale lever through the real console runner (#1932).
//
// `sandbox start ... ore_grade:0.2` leaves the same rock (same voxels, same
// fragments, same mass) but a fifth of the ore grade, so the blast report
// shows about a fifth of the ore value.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { EXPLOSIVE_DELIVERY_TICKS } from '../../src/core/config/balance.js';
import { fundForDeliveryWait } from '../helpers/playthrough.js';
import { consumeStoredOre } from '../../src/core/economy/Logistics.js';
import { ORE_DENSITY_KG_M3 } from '../../src/core/config/balance.js';
import { oreGradeScaleOf } from '../../src/core/economy/OreGrade.js';

const SEED = 42;
const SHOT_START = '36,30';
const SCALE = 0.2;

function refresh(state: GameState): void {
  fundForDeliveryWait(state);
  for (const e of state.employees.employees) e.fatigue = 100;
}

function tickWhile(run: (c: string) => unknown, state: GameState, until: () => boolean, max: number): void {
  for (let n = 0; n < max && !until(); n++) { refresh(state); run('tick 1'); }
}

function openingBlast(extra: string) {
  const { runner, ctx } = createRunner();
  const run = (c: string) => runner.run(c);
  expect(run(`sandbox start biome:desert_badlands seed:${SEED} kit:digger${extra}`)).toMatchObject({ success: true });
  const state = ctx.state!;
  state.events.eventFreqMultiplier = 0;
  refresh(state);
  expect(run(`drill_plan grid rows:3 cols:3 spacing:4 depth:6 start:${SHOT_START}`)).toMatchObject({ success: true });
  tickWhile(run, state, () => state.plannedDrillHoles.length === 0, 1500);
  expect(run('charge hole:* explosive:krackle amount:6 stemming:2')).toMatchObject({ success: true });
  tickWhile(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, EXPLOSIVE_DELIVERY_TICKS + 1500);
  expect(run('blast detonate')).toMatchObject({ success: true });
  tickWhile(run, state, () => state.lastBlastReport !== null, 600);
  expect(state.lastBlastReport).not.toBeNull();
  const oreSum = state.logistics.fragments.reduce(
    (a, f) => a + Object.values(f.fragment.oreDensities).reduce((x, y) => x + y, 0), 0);
  return { state, report: state.lastBlastReport!, oreSum };
}

describe('ore grade scale: standard opening blast (#1932)', () => {
  let base: ReturnType<typeof openingBlast>;
  let scaled: ReturnType<typeof openingBlast>;
  beforeAll(() => {
    base = openingBlast(' ore_grade:1');
    scaled = openingBlast(` ore_grade:${SCALE}`);
  }, 600_000);

  it('the default site yields ore from the opening shot', () => {
    expect(base.report.totalOreValue).toBeGreaterThan(0);
  });

  it('the scaled site yields about a fifth of the ore value', () => {
    expect(scaled.report.totalOreValue / base.report.totalOreValue).toBeGreaterThan(SCALE * 0.8);
    expect(scaled.report.totalOreValue / base.report.totalOreValue).toBeLessThan(SCALE * 1.2);
  });

  it('the fragments carry about a fifth of the summed ore density', () => {
    expect(scaled.oreSum / base.oreSum).toBeGreaterThan(SCALE * 0.8);
    expect(scaled.oreSum / base.oreSum).toBeLessThan(SCALE * 1.2);
  });

  it('fragment count and rock mass are unchanged', () => {
    expect(scaled.report.fragmentCount).toBe(base.report.fragmentCount);
    expect(scaled.report.totalRockVolume).toBeCloseTo(base.report.totalRockVolume, 9);
    expect(scaled.report.clearedVoxels).toBe(base.report.clearedVoxels);
  });

  // Ledger invariant (#1786) at a scaled grade: removing ore removes exactly its mass from the stored fragments.
  it('selling ore at the scaled site removes exactly its mass from stored fragments and keeps the ledger equal to storage', () => {
    const { state } = scaled;
    expect(oreGradeScaleOf(state.world)).toBe(SCALE);
    const logistics = state.logistics;
    const ledger: Record<string, number> = {};
    logistics.storedMassKg = 0;
    for (const tracked of logistics.fragments) {
      tracked.state = 'stored';
      logistics.storedMassKg += tracked.fragment.mass;
      for (const [ore, d] of Object.entries(tracked.fragment.oreDensities)) {
        ledger[ore] = (ledger[ore] ?? 0) + tracked.fragment.volume * d * ORE_DENSITY_KG_M3;
      }
    }
    const oreId = Object.keys(ledger).sort((a, b) => ledger[b]! - ledger[a]!)[0]!;
    const storedMass = () => logistics.fragments.reduce((a, f) => a + f.fragment.mass, 0);
    const before = storedMass();

    const result = consumeStoredOre(logistics, ledger, oreId, ledger[oreId]! / 2, []);

    expect(result.success).toBe(true);
    const removed = before - storedMass();
    expect(removed).toBeGreaterThan(0);
    expect(logistics.storedMassKg).toBeCloseTo(before - removed, 6);
    expect(logistics.storedMassKg).toBeCloseTo(storedMass(), 6);
    for (const [ore, kg] of Object.entries(ledger)) {
      const implied = logistics.fragments.reduce((a, f) => a + f.fragment.volume * (f.fragment.oreDensities[ore] ?? 0) * ORE_DENSITY_KG_M3, 0);
      expect(kg, ore).toBeCloseTo(implied, 4);
    }
  });
});
