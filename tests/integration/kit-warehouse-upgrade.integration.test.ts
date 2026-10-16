// BlastSimulator2026 — Integration: the opening kit's warehouse can be upgraded (#1830).
//
// The kit's spoil heap used to stand on the footprint a tier-2 warehouse needs,
// so `build upgrade 1` was refused with a bare "Space is occupied". The heap now
// keeps clear, and a refusal that still happens names whatever blocks it.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { FREIGHT_WAREHOUSE_CAPACITY_KG } from '../../src/core/config/balance.js';
import { getDefSize, getBuildingDef } from '../../src/core/entities/Building.js';
import { t, setLocale } from '../../src/core/i18n/I18n.js';
import { equipDemolition } from '../helpers/demolition.js';

const SEED = 42;
const MAX_RESEARCH_TICKS = 3000;
const MAX_REBUILD_TICKS = 3000;

function refresh(state: GameState): void {
  state.cash = Math.max(state.cash, 1_000_000);
  for (const e of state.employees.employees) e.fatigue = 100;
}

function tickUntil(run: (c: string) => unknown, state: GameState, done: () => boolean, max: number): void {
  for (let n = 0; n < max && !done(); n++) { refresh(state); run('tick 1'); }
}

/** Ore deposit near (40,33) on this seed: a shot here leaves debris for the haulers to chew on for thousands of ticks. */
const SHOT_START = '36,30';

function fireOpeningShot(run: (c: string) => unknown, state: GameState): void {
  expect(run(`drill_plan grid rows:3 cols:3 spacing:4 depth:6 start:${SHOT_START}`)).toMatchObject({ success: true });
  tickUntil(run, state, () => state.plannedDrillHoles.length === 0, 1500);
  expect(run('charge hole:* explosive:krackle amount:6 stemming:2')).toMatchObject({ success: true });
  tickUntil(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, 1500);
  expect(run('blast detonate')).toMatchObject({ success: true });
  tickUntil(run, state, () => state.lastBlastReport !== null, 600);
  expect(state.lastBlastReport).not.toBeNull();
}

function startWithResearchedTier2(opts: { blast?: boolean } = {}) {
  setLocale('en');
  const { runner, ctx } = createRunner();
  const run = (c: string) => runner.run(c);
  expect(run(`sandbox start biome:desert_badlands difficulty:easy seed:${SEED}`)).toMatchObject({ success: true });
  const state = ctx.state!;
  refresh(state);
  if (opts.blast === true) fireOpeningShot(run, state);
  expect(run('build research_center at:20,48')).toMatchObject({ success: true });
  tickUntil(run, state, () => state.buildings.buildings.some(b => b.type === 'research_center' && b.active), 1500);
  expect(state.buildings.buildings.some(b => b.type === 'research_center' && b.active)).toBe(true);
  expect(run('research queue type:freight_warehouse tier:2')).toMatchObject({ success: true });
  tickUntil(run, state, () => state.buildings.researchQueue.length === 0, MAX_RESEARCH_TICKS);
  expect(state.buildings.researchQueue).toHaveLength(0);
  return { run, state, ctx };
}

describe('kit warehouse upgrade (#1830)', () => {
  it('upgrades the kit freight warehouse to tier 2 with the tier-2 capacity', () => {
    const { run, state, ctx } = startWithResearchedTier2();
    const kit = state.buildings.buildings.find(b => b.type === 'freight_warehouse')!;
    expect(kit.id).toBe(1);
    equipDemolition(ctx); // upgrade = demolition by a building_destroyer, then rebuild
    const result = run('build upgrade 1');
    expect(result, JSON.stringify(result)).toMatchObject({ success: true });
    tickUntil(run, state, () => state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.tier === 2), MAX_REBUILD_TICKS);
    const upgraded = state.buildings.buildings.find(b => b.type === 'freight_warehouse')!;
    expect(upgraded.tier).toBe(2);
    expect(getBuildingDef('freight_warehouse', upgraded.tier).capacity).toBe(FREIGHT_WAREHOUSE_CAPACITY_KG[2]);
    expect(FREIGHT_WAREHOUSE_CAPACITY_KG[2]).toBe(72_000);
  });

  it('refusal names the blocking building when something sits on the tier-2 footprint', () => {
    const { run, state } = startWithResearchedTier2();
    const kit = state.buildings.buildings.find(b => b.type === 'freight_warehouse')!;
    const t1 = getDefSize(getBuildingDef('freight_warehouse', 1));
    const t2 = getDefSize(getBuildingDef('freight_warehouse', 2));
    // Force a blocker on the cells only tier 2 covers, clear of tier 1.
    state.buildings.buildings = state.buildings.buildings.filter(b => b.id === kit.id || b.type === 'research_center');
    state.buildings.buildings.push({
      ...kit, id: 900, type: 'management_office', tier: 1,
      x: kit.x + t1.sizeX, z: kit.z,
    });
    expect(t2.sizeX).toBeGreaterThan(t1.sizeX);
    const result = run('build upgrade 1') as { success: boolean; output: string };
    expect(result.success).toBe(false);
    expect(result.output).toContain(t('building.management_office.name'));
  });

  it('refusal text is translated in french', () => {
    const { run, state } = startWithResearchedTier2();
    const kit = state.buildings.buildings.find(b => b.type === 'freight_warehouse')!;
    const t1 = getDefSize(getBuildingDef('freight_warehouse', 1));
    state.buildings.buildings = state.buildings.buildings.filter(b => b.id === kit.id || b.type === 'research_center');
    state.buildings.buildings.push({ ...kit, id: 900, type: 'management_office', tier: 1, x: kit.x + t1.sizeX, z: kit.z });
    setLocale('fr');
    try {
      const result = run('build upgrade 1') as { success: boolean; output: string };
      expect(result.success).toBe(false);
      expect(result.output).toContain('Bureau de Gestion');
    } finally {
      setLocale('en');
    }
  });
  describe('upgrade ordered while every truck-licensed driver hauls debris (#1840)', () => {
    /** Ticks after the order within which the tier-2 warehouse must stand (repro: 2,200 and more). */
    const UPGRADE_BOUND_TICKS = 500;

    function sawUnreachableDemolition(state: GameState): boolean {
      return state.pendingActions.some(a => a.type === 'demolish_building' && a.blockedReason === 'target_unreachable');
    }

    /** Tick until the kit warehouse is tier 2; returns ticks spent and whether a demolition ever read target_unreachable. */
    function runUpgrade(run: (c: string) => unknown, state: GameState, max: number) {
      let ticks = 0;
      let unreachable = sawUnreachableDemolition(state);
      while (ticks < max && !state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.tier === 2)) {
        refresh(state);
        run('tick 1');
        ticks++;
        unreachable = unreachable || sawUnreachableDemolition(state);
      }
      return { ticks, unreachable };
    }

    it('kit alone: the upgrade completes, and its demolition never reads target_unreachable', () => {
      const { run, state, ctx } = startWithResearchedTier2({ blast: true });
      equipDemolition(ctx);
      expect(run('build upgrade 1')).toMatchObject({ success: true });
      const { ticks, unreachable } = runUpgrade(run, state, MAX_REBUILD_TICKS);
      expect(state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.tier === 2)).toBe(true);
      expect(ticks).toBeLessThanOrEqual(UPGRADE_BOUND_TICKS);
      expect(unreachable).toBe(false);
    });

    it('kit + 2 extra debris haulers + 1 hired driver: tier 2 within the bound of the order', () => {
      const { run, state, ctx } = startWithResearchedTier2({ blast: true });
      expect(run('vehicle buy debris_hauler tier:1')).toMatchObject({ success: true });
      expect(run('vehicle buy debris_hauler tier:1')).toMatchObject({ success: true });
      expect(run('employee hire role:driver')).toMatchObject({ success: true });
      equipDemolition(ctx);
      expect(run('build upgrade 1')).toMatchObject({ success: true });
      const { ticks } = runUpgrade(run, state, MAX_REBUILD_TICKS);
      expect(state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.tier === 2)).toBe(true);
      expect(ticks).toBeLessThanOrEqual(UPGRADE_BOUND_TICKS);
    });

    it('kit + 2 extra debris haulers + 1 hired driver: the demolition never reads target_unreachable', () => {
      const { run, state, ctx } = startWithResearchedTier2({ blast: true });
      expect(run('vehicle buy debris_hauler tier:1')).toMatchObject({ success: true });
      expect(run('vehicle buy debris_hauler tier:1')).toMatchObject({ success: true });
      expect(run('employee hire role:driver')).toMatchObject({ success: true });
      equipDemolition(ctx);
      expect(run('build upgrade 1')).toMatchObject({ success: true });
      expect(sawUnreachableDemolition(state)).toBe(false);
      const { unreachable } = runUpgrade(run, state, MAX_REBUILD_TICKS);
      expect(unreachable).toBe(false);
    });

    it('build destroy on the fresh site never carries target_unreachable', () => {
      setLocale('en');
      const { runner, ctx } = createRunner();
      const run = (c: string) => runner.run(c);
      expect(run(`sandbox start biome:desert_badlands difficulty:easy seed:${SEED}`)).toMatchObject({ success: true });
      const state = ctx.state!;
      refresh(state);
      equipDemolition(ctx);
      const heap = state.buildings.buildings.find(b => b.id === 2)!;
      expect(heap).toBeDefined();
      expect(run('build destroy 2')).toMatchObject({ success: true });
      let unreachable = sawUnreachableDemolition(state);
      for (let n = 0; n < 300 && state.buildings.buildings.some(b => b.id === 2); n++) {
        refresh(state);
        run('tick 1');
        unreachable = unreachable || sawUnreachableDemolition(state);
      }
      expect(state.buildings.buildings.some(b => b.id === 2)).toBe(false);
      expect(unreachable).toBe(false);
    });
  });
});
