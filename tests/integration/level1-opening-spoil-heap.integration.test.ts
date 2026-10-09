// BlastSimulator2026 — Integration: Dusty Hollow and tutorial_pit open with a Spoil Heap (#1574)
// Barren rock needs a heap from the first blast; without one every barren haul
// order is blocked `no_spoil_heap`. Level 1 (dusty_hollow) opens with warehouse +
// heap; the tutorial with a heap only. Kit stays consistent with #1363.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { recordProfit } from '../../src/core/campaign/Campaign.js';
import { getLevel } from '../../src/core/campaign/Level.js';
import { DUSTY_HOLLOW_STARTING_SITE, TUTORIAL_STARTING_SITE } from '../../src/core/config/balance.js';
import { getBuildingDef, getDefSize, type BuildingType } from '../../src/core/entities/Building.js';
import { REGION } from '../../src/ui/tutorialStages.js';
import { totalSpoilKg } from '../../src/core/economy/SpoilHeaps.js';
import { addBlastFragments } from '../../src/core/economy/Logistics.js';
import { syncHaulDispatch } from '../../src/core/economy/HaulDispatch.js';
import { drillChargeAndBlast, tickUntilFresh } from '../helpers/blastFixtures.js';
import type { FragmentData } from '../../src/core/mining/BlastExecution.js';
import { tickUntil } from './helpers.js';

function startLevel(levelId: string, args = '') {
  const { runner, ctx } = createRunner();
  recordProfit(ctx.campaignProfile.campaign, 'tutorial_pit', 5000);
  recordProfit(ctx.campaignProfile.campaign, 'dusty_hollow', 80000);
  const result = runner.run(`campaign start level:${levelId}${args ? ` ${args}` : ''}`);
  expect(result.success, result.output).toBe(true);
  return { runner, ctx, state: ctx.state!, result };
}

const ofType = (state: { buildings: { buildings: { type: string }[] } }, type: string) =>
  state.buildings.buildings.filter((b) => b.type === type);

describe('starting site compositions (#1574)', () => {
  it('TUTORIAL_STARTING_SITE is one tier-1 spoil heap, no crew, no fleet', () => {
    expect(TUTORIAL_STARTING_SITE.buildings).toEqual([{ type: 'spoil_heap', tier: 1 }]);
    expect(TUTORIAL_STARTING_SITE.employees).toHaveLength(0);
    expect(TUTORIAL_STARTING_SITE.vehicles).toHaveLength(0);
  });

  it('DUSTY_HOLLOW_STARTING_SITE places the warehouse first, then the heap', () => {
    expect(DUSTY_HOLLOW_STARTING_SITE.buildings).toEqual([
      { type: 'freight_warehouse', tier: 1 },
      { type: 'spoil_heap', tier: 1 },
    ]);
  });
});

describe('campaign start level:dusty_hollow opens with warehouse and heap (#1574)', () => {
  it('has exactly one active freight warehouse and one active spoil heap', () => {
    const { state } = startLevel('dusty_hollow');
    expect(ofType(state, 'freight_warehouse')).toHaveLength(1);
    expect(ofType(state, 'spoil_heap')).toHaveLength(1);
    expect(state.buildings.buildings.every((b) => b.active)).toBe(true);
    expect(state.buildings.buildings).toHaveLength(2);
  });

  it('keeps the warehouse as buildings[0]', () => {
    const { state } = startLevel('dusty_hollow');
    expect(state.buildings.buildings[0]!.type).toBe('freight_warehouse');
  });

  it('keeps level cash and an empty ledger: the heap is free', () => {
    const { state } = startLevel('dusty_hollow');
    expect(state.cash).toBe(50000);
    expect(state.finances.cash).toBe(50000);
    expect(state.finances.transactions).toHaveLength(0);
  });

  it('the heap starts empty and lies on the grid', () => {
    const { ctx, state } = startLevel('dusty_hollow');
    const heap = ofType(state, 'spoil_heap')[0]! as { x: number; z: number };
    expect(totalSpoilKg(state.buildings.buildings)).toBe(0);
    expect(heap.x).toBeGreaterThanOrEqual(0);
    expect(heap.z).toBeGreaterThanOrEqual(0);
    expect(heap.x).toBeLessThan(ctx.grid!.sizeX);
    expect(heap.z).toBeLessThan(ctx.grid!.sizeZ);
  });

  it('keeps the #1363 crew and fleet', () => {
    const { state } = startLevel('dusty_hollow');
    expect(state.employees.employees.map((e) => e.role).sort()).toEqual(['blaster', 'driller', 'driver']);
    expect(state.vehicles.vehicles.map((v) => v.type).sort()).toEqual(['debris_hauler', 'drill_rig']);
  });

  it('start message still says Staffed', () => {
    const { result } = startLevel('dusty_hollow');
    expect(result.output).toContain('Staffed');
  });

  it('restart leaves one heap and one warehouse', () => {
    const { runner, ctx } = startLevel('dusty_hollow');
    expect(runner.run('campaign start level:dusty_hollow').success).toBe(true);
    expect(ofType(ctx.state!, 'spoil_heap')).toHaveLength(1);
    expect(ofType(ctx.state!, 'freight_warehouse')).toHaveLength(1);
  });

  it('staffed:false stays bare', () => {
    const { state } = startLevel('dusty_hollow', 'staffed:false');
    expect(state.buildings.buildings).toHaveLength(0);
    expect(state.employees.employees).toHaveLength(0);
    expect(state.vehicles.vehicles).toHaveLength(0);
  });

  it('staffed:true gives the global composition: no buildings', () => {
    const { state } = startLevel('dusty_hollow', 'staffed:true');
    expect(state.buildings.buildings).toHaveLength(0);
  });
});

describe('campaign start level:tutorial_pit opens with a heap only (#1574)', () => {
  it('has exactly one active spoil heap, no crew, no fleet', () => {
    const { state } = startLevel('tutorial_pit');
    expect(state.buildings.buildings).toHaveLength(1);
    expect(state.buildings.buildings[0]!.type).toBe('spoil_heap');
    expect(state.buildings.buildings[0]!.active).toBe(true);
    expect(state.employees.employees).toHaveLength(0);
    expect(state.vehicles.vehicles).toHaveLength(0);
  });

  it('leaves starting cash unchanged and the ledger empty', () => {
    const { state } = startLevel('tutorial_pit');
    const cash = getLevel('tutorial_pit')!.startingCash;
    expect(state.cash).toBe(cash);
    expect(state.finances.cash).toBe(cash);
    expect(state.finances.transactions).toHaveLength(0);
  });

  it('start message does not claim staffed', () => {
    const { result } = startLevel('tutorial_pit');
    expect(result.output).not.toMatch(/staffed/i);
  });

  it('the heap lies in-grid', () => {
    const { ctx, state } = startLevel('tutorial_pit');
    const heap = state.buildings.buildings[0]!;
    const { sizeX, sizeZ } = getDefSize(getBuildingDef('spoil_heap', 1));
    expect(heap.x).toBeGreaterThanOrEqual(0);
    expect(heap.z).toBeGreaterThanOrEqual(0);
    expect(heap.x + sizeX).toBeLessThanOrEqual(ctx.grid!.sizeX);
    expect(heap.z + sizeZ).toBeLessThanOrEqual(ctx.grid!.sizeZ);
  });

  it('the heap overlaps none of the tutorial scripted build footprints', () => {
    const { state } = startLevel('tutorial_pit');
    const heap = state.buildings.buildings[0]!;
    const h = getDefSize(getBuildingDef('spoil_heap', 1));
    const pins: ReadonlyArray<{ type: BuildingType; region: { x1: number; z1: number } }> = [
      { type: 'living_quarters', region: REGION.livingQuarters },
      { type: 'driving_center', region: REGION.drivingCenter },
      { type: 'freight_warehouse', region: REGION.warehouse },
    ];
    for (const pin of pins) {
      const p = getDefSize(getBuildingDef(pin.type, 1));
      const overlapX = heap.x < pin.region.x1 + p.sizeX && pin.region.x1 < heap.x + h.sizeX;
      const overlapZ = heap.z < pin.region.z1 + p.sizeZ && pin.region.z1 < heap.z + h.sizeZ;
      expect(overlapX && overlapZ, `heap overlaps ${pin.type}`).toBe(false);
    }
  });

  it('restart leaves one heap', () => {
    const { runner, ctx } = startLevel('tutorial_pit');
    expect(runner.run('campaign start level:tutorial_pit').success).toBe(true);
    expect(ctx.state!.buildings.buildings).toHaveLength(1);
    expect(ofType(ctx.state!, 'spoil_heap')).toHaveLength(1);
  });

  it('staffed:false stays bare', () => {
    const { state } = startLevel('tutorial_pit', 'staffed:false');
    expect(state.buildings.buildings).toHaveLength(0);
  });
});

describe('other levels stay bare (#1574)', () => {
  it('grumpstone_ridge has no buildings', () => {
    const { state } = startLevel('grumpstone_ridge');
    expect(state.buildings.buildings).toHaveLength(0);
  });

  it('new_game staffed:true has no buildings', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    expect(ctx.state!.buildings.buildings).toHaveLength(0);
  });
});

function fragment(id: number, x: number, z: number): FragmentData {
  return {
    id, position: { x, y: 0, z }, volume: 0.3, mass: 900, rockId: 'cruite', oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, shapeSeed: 1, origin: { x, y: 0, z },
  };
}

describe('barren rock is hauled to the opening heap without a no_spoil_heap block (#1574)', () => {
  it('dusty_hollow: the crewed hauler dumps a barren fragment on the heap', () => {
    const { runner, state } = startLevel('dusty_hollow');
    const run = (c: string) => runner.run(c);
    const hauler = state.vehicles.vehicles.find((v) => v.type === 'debris_hauler')!;
    const driver = state.employees.employees.find((e) => e.role === 'driver')!;
    run(`vehicle driver ${hauler.id} ${driver.id}`);
    const near = ofType(state, 'spoil_heap')[0]! as { x: number; z: number };
    addBlastFragments(state.logistics, [fragment(9901, near.x + 4, near.z + 4)], state.navGrid);
    syncHaulDispatch(state);
    run('tick 3');
    expect(state.pendingActions.some((a) => a.blockedReason === 'no_spoil_heap')).toBe(false);
    tickUntilFresh(run, state, () => totalSpoilKg(state.buildings.buildings) > 0, 2500);
    expect(totalSpoilKg(state.buildings.buildings)).toBeGreaterThan(0);
  });

  it('tutorial_pit: first blast produces barren fragments and no haul order is blocked no_spoil_heap', () => {
    const { run, state } = drillChargeAndBlast(18, 10, 3, 5_000_000);
    expect(state.logistics.fragments.length).toBeGreaterThan(0);
    run('employee hire role:driver');
    run('vehicle buy debris_hauler');
    const hauler = state.vehicles.vehicles.find((v) => v.type === 'debris_hauler')!;
    const driver = [...state.employees.employees].reverse().find((e) => e.role === 'driver')!;
    run(`vehicle driver ${hauler.id} ${driver.id}`);
    syncHaulDispatch(state);
    tickUntil(run, () => false, 5);
    tickUntilFresh(run, state, () => totalSpoilKg(state.buildings.buildings) > 0, 3000);
    expect(state.pendingActions.some((a) => a.blockedReason === 'no_spoil_heap')).toBe(false);
    expect(totalSpoilKg(state.buildings.buildings)).toBeGreaterThan(0);
  });
});
