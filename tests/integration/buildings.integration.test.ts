// BlastSimulator2026 — Integration tests: Buildings lifecycle
// Covers placement, listing, destruction, demolition, upgrade, move,
// warehouse storage, explosives inventory, and research tier-unlock.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { buildCommand } from '../../src/console/commands/entities.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import {
  createBuildingState,
  placeBuilding,
  destroyBuilding,
  demolishBuilding,
  getStorageCapacity,
  hasExplosivesForBlast,
  storeExplosives,
  consumeExplosives,
  queueResearchTask,
  tickResearch,
  isTierUnlocked,
  getBuildingDef,
  type BuildingType,
} from '../../src/core/entities/Building.js';
import { createLogisticsState, syncLogisticsCapacity } from '../../src/core/economy/Logistics.js';

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Build a fresh context with a real GameState (seed=42, desert biome, 32×32 grid). */
function makeCtx(): GameContext {
  const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
  return ctx;
}

const ALL_BUILDING_TYPES: BuildingType[] = [
  'driving_center',
  'blasting_academy',
  'management_office',
  'geology_lab',
  'research_center',
  'living_quarters',
  'explosive_warehouse',
  'freight_warehouse',
  'vehicle_depot',
];

// ── Buildings lifecycle ──────────────────────────────────────────────────────

describe('Buildings lifecycle', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  // ── 1. Place + list ─────────────────────────────────────────────────────────

  it('places a building and lists it', () => {
    const placeResult = buildCommand(ctx, ['living_quarters'], { at: '10,10' });

    expect(placeResult.success).toBe(true);
    expect(placeResult.output).toContain('Built');
    expect(placeResult.output).toContain('living_quarters');
    expect(placeResult.output).toContain('10,10');

    // State should reflect the new building
    expect(ctx.state!.buildings.buildings).toHaveLength(1);
    const b = ctx.state!.buildings.buildings[0]!;
    expect(b.type).toBe('living_quarters');
    expect(b.x).toBe(10);
    expect(b.z).toBe(10);
    expect(b.tier).toBe(1);
    expect(b.id).toBe(1);

    // List command should show it
    const listResult = buildCommand(ctx, ['list'], {});
    expect(listResult.success).toBe(true);
    expect(listResult.output).toContain('living_quarters');
    expect(listResult.output).toContain('10,10');
    expect(listResult.output).toContain('T1');
    expect(listResult.output).toContain('[1]');
  });

  // ── 2. Reject overlap ───────────────────────────────────────────────────────

  it('rejects placement on occupied tile', () => {
    // First placement succeeds
    const first = buildCommand(ctx, ['living_quarters'], { at: '10,10' });
    expect(first.success).toBe(true);

    // Second placement at same coordinates must fail
    const second = buildCommand(ctx, ['management_office'], { at: '10,10' });
    expect(second.success).toBe(false);
    expect(second.output).toMatch(/occupied/i);

    // Only the first building should exist
    expect(ctx.state!.buildings.buildings).toHaveLength(1);
  });

  // ── 3. Destroy + demolish ──────────────────────────────────────────────────

  it('destroys a building and removes it from state', () => {
    // Place a building
    buildCommand(ctx, ['living_quarters'], { at: '10,10' });
    expect(ctx.state!.buildings.buildings).toHaveLength(1);

    // Destroy it via console command
    const destroyResult = buildCommand(ctx, ['destroy', '1'], {});
    expect(destroyResult.success).toBe(true);
    expect(destroyResult.output).toContain('demolished');

    // State should be empty
    expect(ctx.state!.buildings.buildings).toHaveLength(0);

    // Calling destroyBuilding on the already-removed ID returns false
    expect(destroyBuilding(ctx.state!.buildings, 1)).toBe(false);

    // Calling demolishBuilding on the already-removed ID returns an error
    const demolishResult = demolishBuilding(ctx.state!.buildings, 1);
    expect(demolishResult.success).toBe(false);
    expect(demolishResult.error).toContain('not found');
    expect(demolishResult.freedCells).toEqual([]);
  });

  // ── 4. Reject destroy on missing ID ─────────────────────────────────────────

  it('rejects destroy on non-existent building ID', () => {
    const result = buildCommand(ctx, ['destroy', '999'], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('not found');
  });

  // ── 5. Upgrade + research tier-unlock ───────────────────────────────────────

  it('upgrade command changes building tier', () => {
    // --- Research pipeline: queue, tick, unlock ---
    const bs = createBuildingState();

    // Tier 2 is locked initially
    expect(isTierUnlocked(bs, 'living_quarters', 2)).toBe(false);

    // Queue a research task for tier-2 living_quarters
    const researchCost = queueResearchTask(bs, 'living_quarters', 2, 10, 5000);
    expect(researchCost).toBe(5000);
    expect(bs.researchQueue).toHaveLength(1);
    expect(bs.researchQueue[0]!.ticksRemaining).toBe(10);

    // Tick until complete
    for (let i = 0; i < 10; i++) {
      tickResearch(bs);
    }

    // Tier 2 should now be unlocked and queue empty
    expect(isTierUnlocked(bs, 'living_quarters', 2)).toBe(true);
    expect(bs.researchQueue).toHaveLength(0);

    // --- Console upgrade command ---
    buildCommand(ctx, ['living_quarters'], { at: '10,10', tier: '1' });
    expect(ctx.state!.buildings.buildings[0]!.tier).toBe(1);

    const upgradeResult = buildCommand(ctx, ['upgrade', '1'], {});
    expect(upgradeResult.success).toBe(true);
    expect(upgradeResult.output).toContain('T2');

    // The building is now tier 2
    const upgraded = ctx.state!.buildings.buildings[0]!;
    expect(upgraded.tier).toBe(2);
    expect(upgraded.type).toBe('living_quarters');

    // getBuildingDef returns the tier-2 definition
    const defT2 = getBuildingDef('living_quarters', 2);
    expect(defT2.tier).toBe(2);
    expect(defT2.capacity).toBe(40); // Tier 2 living_quarters capacity
  });

  // ── 6. Reject upgrade at max tier ───────────────────────────────────────────

  it('rejects upgrade at max tier', () => {
    // Place a tier-3 building directly
    buildCommand(ctx, ['living_quarters'], { at: '10,10', tier: '3' });
    expect(ctx.state!.buildings.buildings[0]!.tier).toBe(3);

    // Attempt upgrade — must fail
    const result = buildCommand(ctx, ['upgrade', '1'], {});
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/max tier/i);
  });

  // ── 7. Types command lists all 9 ────────────────────────────────────────────

  it('building types command lists all 9 types', () => {
    const result = buildCommand(ctx, ['types'], {});
    expect(result.success).toBe(true);

    for (const t of ALL_BUILDING_TYPES) {
      expect(result.output).toContain(t);
    }
  });

  // ── 8. List shows all placed ────────────────────────────────────────────────

  it('list command shows all placed buildings', () => {
    // Place two different buildings at distinct locations
    buildCommand(ctx, ['living_quarters'], { at: '5,5' });
    buildCommand(ctx, ['management_office'], { at: '15,5' });

    expect(ctx.state!.buildings.buildings).toHaveLength(2);

    const listResult = buildCommand(ctx, ['list'], {});
    expect(listResult.success).toBe(true);

    // Both building types appear in output
    expect(listResult.output).toContain('living_quarters');
    expect(listResult.output).toContain('management_office');

    // Both positions appear
    expect(listResult.output).toContain('5,5');
    expect(listResult.output).toContain('15,5');

    // Both IDs appear
    expect(listResult.output).toContain('[1]');
    expect(listResult.output).toContain('[2]');
  });

  // ── 9. Move updates position ────────────────────────────────────────────────

  it('move command updates building position', () => {
    buildCommand(ctx, ['living_quarters'], { at: '10,10' });
    expect(ctx.state!.buildings.buildings[0]!.x).toBe(10);
    expect(ctx.state!.buildings.buildings[0]!.z).toBe(10);

    const moveResult = buildCommand(ctx, ['move', '1'], { to: '20,20' });
    expect(moveResult.success).toBe(true);
    expect(moveResult.output).toContain('moved');

    // Position updated in state
    expect(ctx.state!.buildings.buildings[0]!.x).toBe(20);
    expect(ctx.state!.buildings.buildings[0]!.z).toBe(20);
  });

  // ── 10. Freight warehouse storage + logistics sync ──────────────────────────

  it('freight warehouse adds storage capacity', () => {
    // Build a freight warehouse via direct core function
    const bs = createBuildingState();
    placeBuilding(bs, 'freight_warehouse', 0, 0, 64, 64);

    const capacity = getStorageCapacity(bs);
    const def = getBuildingDef('freight_warehouse', 1);
    expect(capacity).toBe(def.capacity);
    expect(capacity).toBeGreaterThan(0);

    // Adding a second warehouse stacks capacity
    placeBuilding(bs, 'freight_warehouse', 5, 0, 64, 64);
    const stackedCapacity = getStorageCapacity(bs);
    expect(stackedCapacity).toBe(capacity * 2);

    // Sync logistics capacity from buildings
    const logistics = createLogisticsState(0);
    expect(logistics.storageCapacityKg).toBe(0);

    syncLogisticsCapacity(logistics, stackedCapacity);
    expect(logistics.storageCapacityKg).toBe(stackedCapacity);
  });

  // ── 11. Explosive warehouse gates blast capability ─────────────────────────

  it('explosive warehouse gates blast capability', () => {
    const bs = createBuildingState();
    placeBuilding(bs, 'explosive_warehouse', 0, 0, 64, 64);

    // Without stock, blasts are not possible
    expect(hasExplosivesForBlast(bs)).toBe(false);

    // Store explosives
    const stored = storeExplosives(bs, 200);
    expect(stored).toBe(200);
    expect(hasExplosivesForBlast(bs)).toBe(true);

    // Consume part — still has stock
    const consumed1 = consumeExplosives(bs, 80);
    expect(consumed1).toBe(true);
    expect(hasExplosivesForBlast(bs)).toBe(true);

    // Consume the remainder
    const consumed2 = consumeExplosives(bs, 120);
    expect(consumed2).toBe(true);
    expect(hasExplosivesForBlast(bs)).toBe(false);

    // Over-consumption attempt returns false
    const overConsume = consumeExplosives(bs, 50);
    expect(overConsume).toBe(false);
    expect(hasExplosivesForBlast(bs)).toBe(false);
  });
});
