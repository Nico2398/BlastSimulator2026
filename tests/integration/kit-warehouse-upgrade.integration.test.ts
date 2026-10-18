// BlastSimulator2026 — Integration: the opening kit's warehouse can be upgraded (#1830).
//
// The kit's spoil heap used to stand on the footprint a tier-2 warehouse needs,
// so `build upgrade 1` was refused with a bare "Space is occupied". The heap now
// keeps clear, and a refusal that still happens names whatever blocks it.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { FREIGHT_WAREHOUSE_CAPACITY_KG, EXPLOSIVE_DELIVERY_TICKS } from '../../src/core/config/balance.js';
import { getDefSize, getBuildingDef } from '../../src/core/entities/Building.js';
import { t, setLocale } from '../../src/core/i18n/I18n.js';
import { equipDemolition } from '../helpers/demolition.js';
import { warehouseStoredKg } from '../../src/core/economy/FreightWarehouses.js';
import { fundForDeliveryWait } from '../helpers/playthrough.js';

const SEED = 42;
const MAX_RESEARCH_TICKS = 3000;
const MAX_REBUILD_TICKS = 3000;

function refresh(state: GameState): void {
  fundForDeliveryWait(state);
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
  tickUntil(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, EXPLOSIVE_DELIVERY_TICKS + 1500);
  expect(run('blast detonate')).toMatchObject({ success: true });
  tickUntil(run, state, () => state.lastBlastReport !== null, 600);
  expect(state.lastBlastReport).not.toBeNull();
}

/** Put a lump of ore straight into one warehouse's stock. */
function putStoredOre(state: GameState, warehouseId: number, massKg: number): void {
  state.logistics.fragments.push({
    state: 'stored', vehicleId: null, warehouseId,
    fragment: {
      id: 987_654, position: { x: 0, y: 0, z: 0 }, volume: massKg / 2.5, mass: massKg, rockId: 'sandite',
      oreDensities: { dirtite: 0.3 }, initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false,
      halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, shapeSeed: 1, origin: { x: 0, y: 0, z: 0 },
    },
  });
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
    const { run, state } = startWithResearchedTier2();
    const kit = state.buildings.buildings.find(b => b.type === 'freight_warehouse')!;
    expect(kit.id).toBe(1);
    // No Building Destroyer, no driver: an upgrade is in-place construction (#1875).
    expect(state.vehicles.vehicles.some(v => v.type === 'building_destroyer')).toBe(false);
    const result = run('build upgrade 1');
    expect(result, JSON.stringify(result)).toMatchObject({ success: true });
    tickUntil(run, state, () => state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.tier === 2), MAX_REBUILD_TICKS);
    const upgraded = state.buildings.buildings.find(b => b.type === 'freight_warehouse')!;
    expect(upgraded.tier).toBe(2);
    expect(getBuildingDef('freight_warehouse', upgraded.tier).capacity).toBe(FREIGHT_WAREHOUSE_CAPACITY_KG[2]);
    expect(FREIGHT_WAREHOUSE_CAPACITY_KG[2]).toBe(72_000);
    expect(state.vehicles.vehicles.some(v => v.type === 'building_destroyer')).toBe(false);
  });

  it('keeps the same id and the stored ore through the upgrade, without a destroyer (#1875)', () => {
    const { run, state } = startWithResearchedTier2();
    const stored = 12_345;
    putStoredOre(state, 1, stored);
    expect(warehouseStoredKg(state.logistics, 1)).toBeCloseTo(stored);
    expect(run('build upgrade 1')).toMatchObject({ success: true });
    // standing and operating for the whole work
    tickUntil(run, state, () => state.plannedBuildings.length === 0, MAX_REBUILD_TICKS);
    const upgraded = state.buildings.buildings.filter(b => b.type === 'freight_warehouse');
    expect(upgraded.map(b => b.id)).toContain(1);
    const after = upgraded.find(b => b.id === 1)!;
    expect(after.tier).toBe(2);
    expect(warehouseStoredKg(state.logistics, 1)).toBeCloseTo(stored);
  });

  it('the warehouse never leaves state while the upgrade runs', () => {
    const { run, state } = startWithResearchedTier2();
    expect(run('build upgrade 1')).toMatchObject({ success: true });
    for (let n = 0; n < MAX_REBUILD_TICKS && state.plannedBuildings.length > 0; n++) {
      refresh(state);
      run('tick 1');
      expect(state.buildings.buildings.some(b => b.id === 1)).toBe(true);
    }
    expect(state.buildings.buildings.find(b => b.id === 1)!.tier).toBe(2);
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

  it('a blocker that appears after the order fails the completion: refunded, tier unchanged (#1875)', () => {
    const { run, state } = startWithResearchedTier2();
    const kit = state.buildings.buildings.find(b => b.id === 1)!;
    const t1 = getDefSize(getBuildingDef('freight_warehouse', 1));
    expect(run('build upgrade 1')).toMatchObject({ success: true });
    // Plant a blocker on the cells only tier 2 covers, after the order passed its check.
    state.buildings.buildings.push({ ...kit, id: 900, type: 'management_office', tier: 1, x: kit.x + t1.sizeX, z: kit.z });
    tickUntil(run, state, () => state.plannedBuildings.length === 0, MAX_REBUILD_TICKS);
    expect(state.plannedBuildings).toHaveLength(0);
    expect(state.buildings.buildings.find(b => b.id === 1)!.tier).toBe(1);
    expect(state.finances.transactions.some(
      tx => tx.category === 'refund' && tx.description.startsWith('Construction cancelled: freight_warehouse T2'),
    )).toBe(true);
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

    function sawUnreachableBuilderOrder(state: GameState): boolean {
      return state.pendingActions.some(a => a.type === 'place_building' && a.blockedReason === 'target_unreachable');
    }

    /** Tick until the kit warehouse is tier 2; returns ticks spent and whether its place_building order ever read target_unreachable. */
    function runUpgrade(run: (c: string) => unknown, state: GameState, max: number) {
      let ticks = 0;
      let unreachable = sawUnreachableBuilderOrder(state);
      while (ticks < max && !state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.tier === 2)) {
        refresh(state);
        run('tick 1');
        ticks++;
        unreachable = unreachable || sawUnreachableBuilderOrder(state);
      }
      return { ticks, unreachable };
    }

    it('kit alone: the upgrade completes within the bound, and its builder order never reads target_unreachable', () => {
      const { run, state } = startWithResearchedTier2({ blast: true });
      expect(run('build upgrade 1')).toMatchObject({ success: true });
      const { ticks, unreachable } = runUpgrade(run, state, MAX_REBUILD_TICKS);
      expect(state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.tier === 2)).toBe(true);
      expect(ticks).toBeLessThanOrEqual(UPGRADE_BOUND_TICKS);
      expect(unreachable).toBe(false);
    });

    it('kit + 2 extra debris haulers + 1 hired driver: tier 2 within the bound of the order', () => {
      const { run, state } = startWithResearchedTier2({ blast: true });
      expect(run('vehicle buy debris_hauler tier:1')).toMatchObject({ success: true });
      expect(run('vehicle buy debris_hauler tier:1')).toMatchObject({ success: true });
      expect(run('employee hire role:driver')).toMatchObject({ success: true });
      expect(run('build upgrade 1')).toMatchObject({ success: true });
      const { ticks } = runUpgrade(run, state, MAX_REBUILD_TICKS);
      expect(state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.tier === 2)).toBe(true);
      expect(ticks).toBeLessThanOrEqual(UPGRADE_BOUND_TICKS);
    });

    it('kit + 2 extra debris haulers + 1 hired driver: the builder order never reads target_unreachable', () => {
      const { run, state } = startWithResearchedTier2({ blast: true });
      expect(run('vehicle buy debris_hauler tier:1')).toMatchObject({ success: true });
      expect(run('vehicle buy debris_hauler tier:1')).toMatchObject({ success: true });
      expect(run('employee hire role:driver')).toMatchObject({ success: true });
      expect(run('build upgrade 1')).toMatchObject({ success: true });
      expect(sawUnreachableBuilderOrder(state)).toBe(false);
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
