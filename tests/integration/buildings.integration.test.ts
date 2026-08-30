// BlastSimulator2026 — Integration tests: Buildings lifecycle
// Covers placement, listing, destruction, demolition, upgrade, move,
// warehouse storage, explosives inventory, and research tier-unlock.

import { describe, it, expect, beforeEach } from 'vitest';
import type { GameContext } from '../../src/console/commands/world.js';
import { buildCommand, employeeCommand } from '../../src/console/commands/entities.js';
import { tickCommand } from '../../src/console/commands/events.js';
import type { PlaceBuildingActionPayload } from '../../src/console/commands/buildOrder.js';
import { makeGameContext } from '../helpers/gameContext.js';
import {
  createBuildingState,
  placeBuilding,
  destroyBuilding,
  demolishBuilding,
  getStorageCapacity,
  getBuildingScoreEffects,
  hasActiveResearchCenter,
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
import { serialize, deserialize } from '../../src/core/state/SaveLoad.js';
import {
  BUILDING_CONSTRUCTION_BASE_DURATION_TICKS,
  BUILDING_CONSTRUCTION_TIER_MULTIPLIER,
} from '../../src/core/config/balance.js';

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Build a fresh context with a real GameState (seed=42, desert biome, 32×32 grid). */
function makeCtx(): GameContext {
  return makeGameContext({ mineType: 'desert', seed: 42, size: 32 });
}

/**
 * Same as makeCtx() but with a free, pre-hired roster (#551) so a construction
 * site's `place_building` action — unskilled, `requiredSkill: null` (#556) —
 * has someone idle to walk to it and work it.
 */
function makeStaffedCtx(): GameContext {
  return makeGameContext({ mineType: 'desert', seed: 42, size: 32, staffed: true });
}

/** Tick until every ordered building has landed (or maxTicks is exhausted). */
function tickUntilConstructionDone(ctx: GameContext, maxTicks = 300): void {
  for (let i = 0; i < maxTicks && ctx.state!.plannedBuildings.length > 0; i++) {
    tickCommand(ctx, ['1'], {});
  }
}

/**
 * Tick a staffed `place_building` order past arrival and into genuine
 * mid-work — the employee holding `actionId` has a non-null
 * `taskTicksRemaining` that has already decremented below the duration it
 * was seeded with. Arrival alone isn't enough: `tick.ts` runs
 * `tickTaskProgress` before `tickArrivalGate` each tick, so the tick an
 * employee arrives only seeds `taskTicksRemaining` to the full duration —
 * one further tick is needed to observe it actually counting down (#556
 * review finding — "preserving remaining work" tests must prove work is
 * actually in flight, not just that a static PendingAction shape survives).
 * Throws if the order never reaches this state within `maxTicks`.
 */
function tickUntilBuildingMidWork(
  ctx: GameContext,
  actionId: number,
  maxTicks = 60,
): { employeeId: number; ticksRemaining: number; durationTicks: number } {
  const findHolder = () => {
    const action = ctx.state!.pendingActions.find(a => a.id === actionId);
    if (!action || action.holderId === null) return null;
    return ctx.state!.employees.employees.find(e => e.id === action.holderId) ?? null;
  };

  let holder = findHolder();
  for (let i = 0; i < maxTicks && (!holder || holder.taskTicksRemaining === null); i++) {
    tickCommand(ctx, ['1'], {});
    holder = findHolder();
  }
  if (!holder || holder.taskTicksRemaining === null) {
    throw new Error('Setup: place_building order never reached in-progress work before maxTicks');
  }
  const durationTicks = holder.taskTicksRemaining;

  tickCommand(ctx, ['1'], {});
  holder = findHolder();
  if (!holder || holder.taskTicksRemaining === null) {
    throw new Error('Setup: employee left in-progress work unexpectedly');
  }

  return { employeeId: holder.id, ticksRemaining: holder.taskTicksRemaining, durationTicks };
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
    // Staffed (#551): confirming a placement now only queues a construction
    // site (#556) — an idle employee is needed to actually walk over and
    // finish the `place_building` work before any of these lifecycle tests
    // (destroy/upgrade/move/list) can see a real building in state.
    ctx = makeStaffedCtx();
  });

  // ── 1. Place + list ─────────────────────────────────────────────────────────

  it('places a building and lists it', () => {
    const orderResult = buildCommand(ctx, ['living_quarters'], { at: '10,10' });

    expect(orderResult.success).toBe(true);
    expect(orderResult.output).toContain('ordered');
    expect(orderResult.output).toContain('living_quarters');
    expect(orderResult.output).toContain('10,10');

    // Confirming placement only queues a construction site (#556) — nothing
    // is built yet.
    expect(ctx.state!.buildings.buildings).toHaveLength(0);
    expect(ctx.state!.plannedBuildings).toHaveLength(1);

    // Drive construction to completion.
    tickUntilConstructionDone(ctx);

    // State should reflect the new building
    expect(ctx.state!.plannedBuildings).toHaveLength(0);
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
    // First placement succeeds and completes.
    const first = buildCommand(ctx, ['living_quarters'], { at: '10,10' });
    expect(first.success).toBe(true);
    tickUntilConstructionDone(ctx);
    expect(ctx.state!.buildings.buildings).toHaveLength(1);

    // Second placement at same coordinates must fail
    const second = buildCommand(ctx, ['management_office'], { at: '10,10' });
    expect(second.success).toBe(false);
    expect(second.output).toMatch(/occupied/i);

    // Only the first building should exist
    expect(ctx.state!.buildings.buildings).toHaveLength(1);
  });

  // ── 3. Destroy + demolish ──────────────────────────────────────────────────

  it('destroys a building and removes it from state', () => {
    // Place a building and let construction finish.
    buildCommand(ctx, ['living_quarters'], { at: '10,10' });
    tickUntilConstructionDone(ctx);
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
    // --- Research pipeline: queue, tick, unlock — on the SAME buildings state the
    //     console upgrade command operates on. Queuing research on a disconnected
    //     BuildingState would leave ctx.state!.buildings.unlockedTiers empty, and
    //     the upgrade below would then be rejected by the research gate. A placed
    //     research_center is also a hard prerequisite (#442) to queue research at all. ---
    const bs = ctx.state!.buildings;
    placeBuilding(bs, 'research_center', 50, 50, 64, 64);

    // Tier 2 is locked initially
    expect(isTierUnlocked(bs, 'living_quarters', 2)).toBe(false);

    // Queue a research task for tier-2 living_quarters — tier-2 (first upgrade) is
    // cost-only: 0 ticks, no conditions.
    const researchResult = queueResearchTask(bs, 'living_quarters', 2);
    expect(researchResult.success, JSON.stringify(researchResult)).toBe(true);
    expect(bs.researchQueue).toHaveLength(1);
    expect(bs.researchQueue[0]!.ticksRemaining).toBe(0);

    // Tick once — a 0-duration task completes on the very next tick.
    tickResearch(bs);

    // Tier 2 should now be unlocked and queue empty
    expect(isTierUnlocked(bs, 'living_quarters', 2)).toBe(true);
    expect(bs.researchQueue).toHaveLength(0);

    // --- Console upgrade command ---
    buildCommand(ctx, ['living_quarters'], { at: '10,10', tier: '1' });
    tickUntilConstructionDone(ctx);
    const placed = ctx.state!.buildings.buildings.find(b => b.type === 'living_quarters')!;
    expect(placed.tier).toBe(1);

    const upgradeResult = buildCommand(ctx, ['upgrade', String(placed.id)], {});
    expect(upgradeResult.success).toBe(true);
    expect(upgradeResult.output).toContain('T2');

    // The building is now tier 2
    const upgraded = ctx.state!.buildings.buildings.find(b => b.type === 'living_quarters')!;
    expect(upgraded.tier).toBe(2);
    expect(upgraded.type).toBe('living_quarters');

    // getBuildingDef returns the tier-2 definition
    const defT2 = getBuildingDef('living_quarters', 2);
    expect(defT2.tier).toBe(2);
    expect(defT2.capacity).toBe(40); // Tier 2 living_quarters capacity
  });

  // ── 5b. Reject direct placement of a non-unlocked tier ──────────────────────

  it('rejects direct placement of an unresearched tier via the build command', () => {
    const result = buildCommand(ctx, ['living_quarters'], { at: '10,10', tier: '2' });
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/research/i);
    expect(ctx.state!.buildings.buildings).toHaveLength(0);
  });

  // ── 5c. Reject upgrade to a tier that has not been researched ───────────────

  it('rejects upgrade to a tier that has not been researched', () => {
    buildCommand(ctx, ['living_quarters'], { at: '10,10', tier: '1' });
    tickUntilConstructionDone(ctx);
    expect(ctx.state!.buildings.buildings[0]!.tier).toBe(1);

    const result = buildCommand(ctx, ['upgrade', '1'], {});
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/research/i);

    // The failed upgrade must not have replaced the tier-1 building
    expect(ctx.state!.buildings.buildings).toHaveLength(1);
    expect(ctx.state!.buildings.buildings[0]!.tier).toBe(1);
  });

  // ── 6. Reject upgrade at max tier ───────────────────────────────────────────

  it('rejects upgrade at max tier', () => {
    // Place a tier-3 building directly — pre-unlock tier 3 research so the setup
    // placement itself is not the thing under test here (that's tests 5b/5c).
    ctx.state!.buildings.unlockedTiers['living_quarters'] = 3;
    buildCommand(ctx, ['living_quarters'], { at: '10,10', tier: '3' });
    tickUntilConstructionDone(ctx);
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
    tickUntilConstructionDone(ctx);

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
    tickUntilConstructionDone(ctx);
    expect(ctx.state!.buildings.buildings[0]!.x).toBe(10);
    expect(ctx.state!.buildings.buildings[0]!.z).toBe(10);

    const moveResult = buildCommand(ctx, ['move', '1'], { to: '20,20' });
    expect(moveResult.success).toBe(true);
    expect(moveResult.output).toContain('moved');

    // Position updated in state
    expect(ctx.state!.buildings.buildings[0]!.x).toBe(20);
    expect(ctx.state!.buildings.buildings[0]!.z).toBe(20);
  });

  it('refuses to move a building onto a site still under construction', () => {
    // Existing, finished building to move.
    buildCommand(ctx, ['living_quarters'], { at: '10,10' });
    tickUntilConstructionDone(ctx);
    expect(ctx.state!.buildings.buildings).toHaveLength(1);

    // A second order queues a site management_office is 3x3 -> reserves (30,30)-(32,32).
    const order = buildCommand(ctx, ['management_office'], { at: '30,30' });
    expect(order.success, JSON.stringify(order)).toBe(true);
    expect(ctx.state!.plannedBuildings).toHaveLength(1);

    // Moving the finished building onto the reserved, still-under-construction
    // site must be refused up front, not silently accepted and corrected later
    // by tickTaskCompletion.ts's defensive refund branch.
    const moveResult = buildCommand(ctx, ['move', '1'], { to: '30,30' });

    expect(moveResult.success).toBe(false);
    expect(moveResult.output).toMatch(/occupied/i);

    // Nothing moved, and the pending site is untouched.
    expect(ctx.state!.buildings.buildings[0]!.x).toBe(10);
    expect(ctx.state!.buildings.buildings[0]!.z).toBe(10);
    expect(ctx.state!.plannedBuildings).toHaveLength(1);
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

// ── Construction sites — order-then-build (#556) ─────────────────────────────
// Ordering a building creates a construction site instead of an instant
// building: confirming placement validates and charges exactly as before,
// then queues a `place_building` action at the target. Nothing the building
// provides counts until an employee has actually finished the work.

describe('Construction sites — order-then-build (#556)', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = makeStaffedCtx();
  });

  it('ordering a freight_warehouse charges cash and queues a site instead of placing the building instantly', () => {
    const cashBefore = ctx.state!.cash;
    const storageBefore = getStorageCapacity(ctx.state!.buildings);
    const def = getBuildingDef('freight_warehouse', 1);

    const result = buildCommand(ctx, ['freight_warehouse'], { at: '5,5' });

    expect(result.success, JSON.stringify(result)).toBe(true);

    // No building exists yet — nothing it provides is live either.
    expect(ctx.state!.buildings.buildings).toHaveLength(0);
    expect(getStorageCapacity(ctx.state!.buildings)).toBe(storageBefore);

    // Cash was charged in full at order time, same as an instant build.
    expect(ctx.state!.cash).toBe(cashBefore - def.constructionCost);

    // A construction site is queued instead.
    expect(ctx.state!.plannedBuildings).toHaveLength(1);
    const planned = ctx.state!.plannedBuildings[0]!;
    expect(planned.type).toBe('freight_warehouse');
    expect(planned.tier).toBe(1);
    expect(planned.x).toBe(5);
    expect(planned.z).toBe(5);
    expect(planned.cost).toBe(def.constructionCost);

    // One place_building PendingAction was dispatched for it, unskilled.
    const action = ctx.state!.pendingActions.find(a => a.id === planned.actionId);
    expect(action).toBeDefined();
    expect(action!.type).toBe('place_building');
    expect(action!.requiredSkill).toBeNull();

    // A blue ghost matching the real footprint appears at the site.
    const ghost = ctx.state!.ghostPreviews.find(g => g.id === planned.actionId);
    expect(ghost).toBeDefined();
    expect(ghost!.footprint).toEqual(def.footprint);
  });

  it('a tier-1 order carries payload.durationTicks === BUILDING_CONSTRUCTION_BASE_DURATION_TICKS (multiplier 1)', () => {
    buildCommand(ctx, ['freight_warehouse'], { at: '5,5' });

    const planned = ctx.state!.plannedBuildings[0]!;
    const action = ctx.state!.pendingActions.find(a => a.id === planned.actionId)!;
    const payload = action.payload as unknown as PlaceBuildingActionPayload;

    expect(payload.durationTicks).toBe(BUILDING_CONSTRUCTION_BASE_DURATION_TICKS);
  });

  it('a tier-2 order carries payload.durationTicks scaled by BUILDING_CONSTRUCTION_TIER_MULTIPLIER[2]', () => {
    // Tier 2 requires research to be unlocked first (same gate as direct placement).
    ctx.state!.buildings.unlockedTiers['management_office'] = 2;

    const result = buildCommand(ctx, ['management_office'], { at: '5,5', tier: '2' });
    expect(result.success, JSON.stringify(result)).toBe(true);

    const planned = ctx.state!.plannedBuildings[0]!;
    const action = ctx.state!.pendingActions.find(a => a.id === planned.actionId)!;
    const payload = action.payload as unknown as PlaceBuildingActionPayload;

    expect(payload.durationTicks).toBe(
      BUILDING_CONSTRUCTION_BASE_DURATION_TICKS * BUILDING_CONSTRUCTION_TIER_MULTIPLIER[2],
    );
  });

  it('drives the order to completion: the site lands as a real building and its effects apply', () => {
    buildCommand(ctx, ['freight_warehouse'], { at: '5,5' });
    expect(ctx.state!.plannedBuildings).toHaveLength(1);

    tickUntilConstructionDone(ctx);

    expect(ctx.state!.plannedBuildings).toHaveLength(0);
    expect(ctx.state!.buildings.buildings).toHaveLength(1);
    const built = ctx.state!.buildings.buildings[0]!;
    expect(built.type).toBe('freight_warehouse');
    expect(built.x).toBe(5);
    expect(built.z).toBe(5);
    expect(getStorageCapacity(ctx.state!.buildings)).toBe(getBuildingDef('freight_warehouse', 1).capacity);

    // The completed action and its ghost are gone.
    expect(ctx.state!.pendingActions.find(a => a.type === 'place_building')).toBeUndefined();
    expect(ctx.state!.ghostPreviews).toHaveLength(0);
  });

  it('living_quarters well-being effect only applies once construction completes, not at order time', () => {
    buildCommand(ctx, ['living_quarters'], { at: '5,5' });
    expect(getBuildingScoreEffects(ctx.state!.buildings).wellBeing).toBe(0);

    tickUntilConstructionDone(ctx);

    expect(ctx.state!.plannedBuildings).toHaveLength(0);
    expect(getBuildingScoreEffects(ctx.state!.buildings).wellBeing).toBeGreaterThan(0);
  });

  it('research_center only gates research once construction completes, not at order time', () => {
    buildCommand(ctx, ['research_center'], { at: '5,5' });
    expect(hasActiveResearchCenter(ctx.state!.buildings)).toBe(false);

    tickUntilConstructionDone(ctx);

    expect(ctx.state!.plannedBuildings).toHaveLength(0);
    expect(hasActiveResearchCenter(ctx.state!.buildings)).toBe(true);
  });

  it('rejects the order when funds are insufficient, charging nothing and queuing nothing', () => {
    ctx.state!.cash = 10;

    const result = buildCommand(ctx, ['freight_warehouse'], { at: '5,5' });

    expect(result.success).toBe(false);
    expect(ctx.state!.cash).toBe(10);
    expect(ctx.state!.plannedBuildings).toHaveLength(0);
    expect(ctx.state!.buildings.buildings).toHaveLength(0);
  });

  it('rejects ordering an unresearched tier, same gate as direct placement', () => {
    const result = buildCommand(ctx, ['living_quarters'], { at: '5,5', tier: '2' });

    expect(result.success).toBe(false);
    expect(result.output).toMatch(/research/i);
    expect(ctx.state!.plannedBuildings).toHaveLength(0);
  });

  it('rejects an out-of-bounds order, same gate as direct placement', () => {
    // (60,60) is off the 32x32 starting site but still gets claimed by site
    // expansion (#473) — the site can bridge up to MAX_CLAIM_BRIDGE_CHUNKS
    // chunks (≈384 voxels) of ground to reach a claim. Go far enough that
    // even bridging refuses it, so this exercises the same "too far" gate
    // direct placement always went through.
    const result = buildCommand(ctx, ['freight_warehouse'], { at: '5000,5000' });

    expect(result.success).toBe(false);
    expect(ctx.state!.plannedBuildings).toHaveLength(0);
  });

  it('a second order overlapping a site under construction is refused, like an overlapping real building', () => {
    buildCommand(ctx, ['freight_warehouse'], { at: '5,5' }); // freight_warehouse T1 is 4x4 -> (5,5)-(8,8)

    const second = buildCommand(ctx, ['management_office'], { at: '6,6' });

    expect(second.success).toBe(false);
    expect(second.output).toMatch(/occupied/i);
    expect(ctx.state!.plannedBuildings).toHaveLength(1);
    expect(ctx.state!.buildings.buildings).toHaveLength(0);
  });

  it('an order succeeds and queues even with no employees hired yet (mirrors #553/#554/#555 silent-queue pattern)', () => {
    const freshCtx = makeCtx(); // NOT staffed
    expect(freshCtx.state!.employees.employees).toHaveLength(0);

    const result = buildCommand(freshCtx, ['freight_warehouse'], { at: '5,5' });

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(freshCtx.state!.plannedBuildings).toHaveLength(1);
    expect(freshCtx.state!.buildings.buildings).toHaveLength(0);
  });

  it('cancelling an ordered site removes it and refunds the full construction cost', () => {
    // There is no `build cancel` subcommand — a queued site is cancelled the
    // same generic way any other dispatched action is, through
    // `employee cancel <actionId>` (mirrors the dig_ramp_segment/drill_hole
    // order-cancellation pattern; see releasePlannedHoleForCancelledAction's
    // place_building branch in src/console/commands/mining.ts).
    const cashBefore = ctx.state!.cash;
    buildCommand(ctx, ['freight_warehouse'], { at: '5,5' });
    const def = getBuildingDef('freight_warehouse', 1);
    expect(ctx.state!.cash).toBe(cashBefore - def.constructionCost);
    const planned = ctx.state!.plannedBuildings[0]!;
    const actionId = planned.actionId;

    const cancelResult = employeeCommand(ctx, ['cancel', String(actionId)], {});

    expect(cancelResult.success, JSON.stringify(cancelResult)).toBe(true);
    expect(ctx.state!.cash).toBe(cashBefore);
    expect(ctx.state!.plannedBuildings).toHaveLength(0);
    expect(ctx.state!.buildings.buildings).toHaveLength(0);
    expect(ctx.state!.ghostPreviews).toHaveLength(0);
  });

  it('cancelling a site whose employee is already mid-work still refunds the full cost, not a prorated amount', () => {
    // TaskCancellation.ts's actionOrderCost refund is unconditional (a
    // building isn't segmented like a ramp, so there's no partial-progress
    // deduction to apply) — this proves it holds once the employee has
    // actually arrived and burned some of the work timer, not just while the
    // order is still queued/pre-walk (every other cancel test here cancels
    // immediately after ordering).
    const cashBefore = ctx.state!.cash;
    buildCommand(ctx, ['freight_warehouse'], { at: '5,5' });
    const def = getBuildingDef('freight_warehouse', 1);
    expect(ctx.state!.cash).toBe(cashBefore - def.constructionCost);
    const planned = ctx.state!.plannedBuildings[0]!;
    const actionId = planned.actionId;

    const midWork = tickUntilBuildingMidWork(ctx, actionId);
    expect(midWork.ticksRemaining).toBeLessThan(midWork.durationTicks);

    // Ticking to mid-work spends employee upkeep along the way, so cash by
    // now is already below cashBefore for reasons unrelated to the refund —
    // what's under test is that the cancel refund itself is the FULL
    // construction cost, not prorated down for the ticks already worked.
    const cashBeforeCancel = ctx.state!.cash;
    const cancelResult = employeeCommand(ctx, ['cancel', String(actionId)], {});

    expect(cancelResult.success, JSON.stringify(cancelResult)).toBe(true);
    expect(ctx.state!.cash).toBe(cashBeforeCancel + def.constructionCost);
    expect(ctx.state!.plannedBuildings).toHaveLength(0);
    expect(ctx.state!.buildings.buildings).toHaveLength(0);
  });

  it('cancelling an unknown site id fails without touching cash or any in-flight order', () => {
    buildCommand(ctx, ['freight_warehouse'], { at: '5,5' });
    const cashAfterOrder = ctx.state!.cash;

    const result = employeeCommand(ctx, ['cancel', '9999'], {});

    expect(result.success).toBe(false);
    expect(ctx.state!.cash).toBe(cashAfterOrder);
    expect(ctx.state!.plannedBuildings).toHaveLength(1);
  });

  it('save/load round-trips a site under construction, preserving its remaining work', () => {
    buildCommand(ctx, ['freight_warehouse'], { at: '5,5' });
    // Let the site partially progress before saving.
    for (let i = 0; i < 5; i++) tickCommand(ctx, ['1'], {});
    expect(ctx.state!.plannedBuildings).toHaveLength(1);
    expect(ctx.state!.buildings.buildings).toHaveLength(0);

    const json = serialize(ctx.state!);
    const restored = deserialize(json);

    expect(restored.plannedBuildings).toEqual(ctx.state!.plannedBuildings);
    expect(restored.buildings.buildings).toHaveLength(0);
    const restoredAction = restored.pendingActions.find(
      a => a.id === ctx.state!.plannedBuildings[0]!.actionId,
    );
    expect(restoredAction).toBeDefined();
    expect(restoredAction!.type).toBe('place_building');
  });

  it('save/load preserves the actual remaining work of a site whose employee is mid-construction', () => {
    // The test above only proves the static PendingAction/PlannedBuilding
    // shape survives a JSON round trip — it ticks before the employee has
    // arrived, so taskTicksRemaining is still null throughout. This drives
    // the order until an employee has actually arrived and started counting
    // down, then asserts THAT number survives, unchanged, across save/load.
    buildCommand(ctx, ['freight_warehouse'], { at: '5,5' });
    const planned = ctx.state!.plannedBuildings[0]!;
    const midWork = tickUntilBuildingMidWork(ctx, planned.actionId);

    const json = serialize(ctx.state!);
    const restored = deserialize(json);

    const restoredEmployee = restored.employees.employees.find(e => e.id === midWork.employeeId);
    expect(restoredEmployee).toBeDefined();
    expect(restoredEmployee!.taskTicksRemaining).toBe(midWork.ticksRemaining);
    expect(restored.plannedBuildings).toEqual(ctx.state!.plannedBuildings);
    expect(restored.buildings.buildings).toHaveLength(0);
  });
});
