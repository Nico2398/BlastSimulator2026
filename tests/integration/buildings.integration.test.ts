// BlastSimulator2026 — Integration tests: Buildings lifecycle
// Covers placement, listing, destruction, demolition, upgrade, move,
// warehouse storage, explosives inventory, and research tier-unlock.

import { describe, it, expect, beforeEach } from 'vitest';
import type { GameContext } from '../../src/console/commands/world.js';
import { buildCommand, employeeCommand } from '../../src/console/commands/entities.js';
import { vehicleCommand } from '../../src/console/commands/vehicle.js';
import { tickCommand } from '../../src/console/commands/events.js';
import { setPolicyCommand } from '../../src/console/commands/policy.js';
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
  getSurfaceY,
  type BuildingType,
} from '../../src/core/entities/Building.js';
import { createLogisticsState, syncLogisticsCapacity, addBlastFragments } from '../../src/core/economy/Logistics.js';
import { syncHaulDispatch } from '../../src/core/economy/HaulDispatch.js';
import type { FragmentData } from '../../src/core/mining/BlastExecution.js';
import { serialize, deserialize } from '../../src/core/state/SaveLoad.js';
import {
  BUILDING_CONSTRUCTION_BASE_DURATION_TICKS,
  BUILDING_CONSTRUCTION_TIER_MULTIPLIER,
  ACTION_STARVATION_TICK_THRESHOLD,
  BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD,
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
    const orderResult = buildCommand(ctx, ['living_quarters'], { at: '9,14' });

    expect(orderResult.success).toBe(true);
    expect(orderResult.output).toContain('ordered');
    expect(orderResult.output).toContain('living_quarters');
    expect(orderResult.output).toContain('9,14');

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
    expect(b.x).toBe(9);
    expect(b.z).toBe(14);
    expect(b.tier).toBe(1);
    expect(b.id).toBe(1);

    // List command should show it
    const listResult = buildCommand(ctx, ['list'], {});
    expect(listResult.success).toBe(true);
    expect(listResult.output).toContain('living_quarters');
    expect(listResult.output).toContain('9,14');
    expect(listResult.output).toContain('T1');
    expect(listResult.output).toContain('[1]');
  });

  // ── 2. Reject overlap ───────────────────────────────────────────────────────

  it('rejects placement on occupied tile', () => {
    // First placement succeeds and completes.
    const first = buildCommand(ctx, ['living_quarters'], { at: '9,14' });
    expect(first.success).toBe(true);
    tickUntilConstructionDone(ctx);
    expect(ctx.state!.buildings.buildings).toHaveLength(1);

    // Second placement at same coordinates must fail
    const second = buildCommand(ctx, ['management_office'], { at: '9,14' });
    expect(second.success).toBe(false);
    expect(second.output).toMatch(/occupied/i);

    // Only the first building should exist
    expect(ctx.state!.buildings.buildings).toHaveLength(1);
  });

  // ── 3. Destroy + demolish ──────────────────────────────────────────────────

  it('destroys a building and removes it from state', () => {
    // Place a building and let construction finish.
    buildCommand(ctx, ['living_quarters'], { at: '9,14' });
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
    buildCommand(ctx, ['living_quarters'], { at: '9,14', tier: '1' });
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
    const result = buildCommand(ctx, ['living_quarters'], { at: '9,14', tier: '2' });
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/research/i);
    expect(ctx.state!.buildings.buildings).toHaveLength(0);
  });

  // ── 5c. Reject upgrade to a tier that has not been researched ───────────────

  it('rejects upgrade to a tier that has not been researched', () => {
    buildCommand(ctx, ['living_quarters'], { at: '9,14', tier: '1' });
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
    buildCommand(ctx, ['living_quarters'], { at: '9,14', tier: '3' });
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
    buildCommand(ctx, ['living_quarters'], { at: '6,9' });
    buildCommand(ctx, ['management_office'], { at: '13,4' });
    tickUntilConstructionDone(ctx);

    expect(ctx.state!.buildings.buildings).toHaveLength(2);

    const listResult = buildCommand(ctx, ['list'], {});
    expect(listResult.success).toBe(true);

    // Both building types appear in output
    expect(listResult.output).toContain('living_quarters');
    expect(listResult.output).toContain('management_office');

    // Both positions appear
    expect(listResult.output).toContain('6,9');
    expect(listResult.output).toContain('13,4');

    // Both IDs appear
    expect(listResult.output).toContain('[1]');
    expect(listResult.output).toContain('[2]');
  });

  // ── 9. Move updates position ────────────────────────────────────────────────

  it('move command updates building position', () => {
    buildCommand(ctx, ['living_quarters'], { at: '9,14' });
    tickUntilConstructionDone(ctx);
    expect(ctx.state!.buildings.buildings[0]!.x).toBe(9);
    expect(ctx.state!.buildings.buildings[0]!.z).toBe(14);

    const moveResult = buildCommand(ctx, ['move', '1'], { to: '18,20' });
    expect(moveResult.success).toBe(true);
    expect(moveResult.output).toContain('moved');

    // Position updated in state
    expect(ctx.state!.buildings.buildings[0]!.x).toBe(18);
    expect(ctx.state!.buildings.buildings[0]!.z).toBe(20);
  });

  it('refuses to move a building onto a site still under construction', () => {
    // Existing, finished building to move.
    buildCommand(ctx, ['living_quarters'], { at: '9,14' });
    tickUntilConstructionDone(ctx);
    expect(ctx.state!.buildings.buildings).toHaveLength(1);

    // A second order queues a site management_office is 3x3 -> reserves (30,30)-(32,32).
    const order = buildCommand(ctx, ['management_office'], { at: '28,28' });
    expect(order.success, JSON.stringify(order)).toBe(true);
    expect(ctx.state!.plannedBuildings).toHaveLength(1);

    // Moving the finished building onto the reserved, still-under-construction
    // site must be refused up front, not silently accepted and corrected later
    // by tickTaskCompletion.ts's defensive refund branch.
    const moveResult = buildCommand(ctx, ['move', '1'], { to: '28,28' });

    expect(moveResult.success).toBe(false);
    expect(moveResult.output).toMatch(/occupied/i);

    // Nothing moved, and the pending site is untouched.
    expect(ctx.state!.buildings.buildings[0]!.x).toBe(9);
    expect(ctx.state!.buildings.buildings[0]!.z).toBe(14);
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

    const result = buildCommand(ctx, ['freight_warehouse'], { at: '6,9' });

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
    expect(planned.x).toBe(6);
    expect(planned.z).toBe(9);
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
    buildCommand(ctx, ['freight_warehouse'], { at: '6,9' });

    const planned = ctx.state!.plannedBuildings[0]!;
    const action = ctx.state!.pendingActions.find(a => a.id === planned.actionId)!;
    const payload = action.payload as unknown as PlaceBuildingActionPayload;

    expect(payload.durationTicks).toBe(BUILDING_CONSTRUCTION_BASE_DURATION_TICKS);
  });

  it('a tier-2 order carries payload.durationTicks scaled by BUILDING_CONSTRUCTION_TIER_MULTIPLIER[2]', () => {
    // Tier 2 requires research to be unlocked first (same gate as direct placement).
    ctx.state!.buildings.unlockedTiers['management_office'] = 2;

    const result = buildCommand(ctx, ['management_office'], { at: '6,9', tier: '2' });
    expect(result.success, JSON.stringify(result)).toBe(true);

    const planned = ctx.state!.plannedBuildings[0]!;
    const action = ctx.state!.pendingActions.find(a => a.id === planned.actionId)!;
    const payload = action.payload as unknown as PlaceBuildingActionPayload;

    expect(payload.durationTicks).toBe(
      BUILDING_CONSTRUCTION_BASE_DURATION_TICKS * BUILDING_CONSTRUCTION_TIER_MULTIPLIER[2],
    );
  });

  it('drives the order to completion: the site lands as a real building and its effects apply', () => {
    buildCommand(ctx, ['freight_warehouse'], { at: '6,9' });
    expect(ctx.state!.plannedBuildings).toHaveLength(1);

    tickUntilConstructionDone(ctx);

    expect(ctx.state!.plannedBuildings).toHaveLength(0);
    expect(ctx.state!.buildings.buildings).toHaveLength(1);
    const built = ctx.state!.buildings.buildings[0]!;
    expect(built.type).toBe('freight_warehouse');
    expect(built.x).toBe(6);
    expect(built.z).toBe(9);
    expect(getStorageCapacity(ctx.state!.buildings)).toBe(getBuildingDef('freight_warehouse', 1).capacity);

    // The completed action and its ghost are gone.
    expect(ctx.state!.pendingActions.find(a => a.type === 'place_building')).toBeUndefined();
    expect(ctx.state!.ghostPreviews).toHaveLength(0);
  });

  it('living_quarters well-being effect only applies once construction completes, not at order time', () => {
    buildCommand(ctx, ['living_quarters'], { at: '6,9' });
    expect(getBuildingScoreEffects(ctx.state!.buildings).wellBeing).toBe(0);

    tickUntilConstructionDone(ctx);

    expect(ctx.state!.plannedBuildings).toHaveLength(0);
    expect(getBuildingScoreEffects(ctx.state!.buildings).wellBeing).toBeGreaterThan(0);
  });

  it('research_center only gates research once construction completes, not at order time', () => {
    buildCommand(ctx, ['research_center'], { at: '6,9' });
    expect(hasActiveResearchCenter(ctx.state!.buildings)).toBe(false);

    tickUntilConstructionDone(ctx);

    expect(ctx.state!.plannedBuildings).toHaveLength(0);
    expect(hasActiveResearchCenter(ctx.state!.buildings)).toBe(true);
  });

  it('rejects the order when funds are insufficient, charging nothing and queuing nothing', () => {
    ctx.state!.cash = 10;

    const result = buildCommand(ctx, ['freight_warehouse'], { at: '6,9' });

    expect(result.success).toBe(false);
    expect(ctx.state!.cash).toBe(10);
    expect(ctx.state!.plannedBuildings).toHaveLength(0);
    expect(ctx.state!.buildings.buildings).toHaveLength(0);
  });

  it('rejects ordering an unresearched tier, same gate as direct placement', () => {
    const result = buildCommand(ctx, ['living_quarters'], { at: '6,9', tier: '2' });

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
    buildCommand(ctx, ['freight_warehouse'], { at: '6,9' }); // freight_warehouse T1 is 4x4 -> (6,9)-(9,12)

    const second = buildCommand(ctx, ['management_office'], { at: '7,10' });

    expect(second.success).toBe(false);
    expect(second.output).toMatch(/occupied/i);
    expect(ctx.state!.plannedBuildings).toHaveLength(1);
    expect(ctx.state!.buildings.buildings).toHaveLength(0);
  });

  it('an order succeeds and queues even with no employees hired yet (mirrors #553/#554/#555 silent-queue pattern)', () => {
    const freshCtx = makeCtx(); // NOT staffed
    expect(freshCtx.state!.employees.employees).toHaveLength(0);

    const result = buildCommand(freshCtx, ['freight_warehouse'], { at: '6,9' });

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
    buildCommand(ctx, ['freight_warehouse'], { at: '6,9' });
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
    buildCommand(ctx, ['freight_warehouse'], { at: '6,9' });
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
    buildCommand(ctx, ['freight_warehouse'], { at: '6,9' });
    const cashAfterOrder = ctx.state!.cash;

    const result = employeeCommand(ctx, ['cancel', '9999'], {});

    expect(result.success).toBe(false);
    expect(ctx.state!.cash).toBe(cashAfterOrder);
    expect(ctx.state!.plannedBuildings).toHaveLength(1);
  });

  it('save/load round-trips a site under construction, preserving its remaining work', () => {
    buildCommand(ctx, ['freight_warehouse'], { at: '6,9' });
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
    buildCommand(ctx, ['freight_warehouse'], { at: '6,9' });
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

// ═══════════════════════════════════════════════════════════════════════════
// #1000 — a deep same-role (debris_hauler) haul backlog must never starve out
// an unclaimed place_building order forever. tryContinueVehicleGatedAction's
// same-role vehicle-continuity fast path (VehicleContinuity.ts) keeps handing
// a driver the next open haul_debris action the instant they finish one —
// with a roster that has NO ONE else free, that means nobody ever walks to
// the building site. The fix: a queued, unclaimed, requiredVehicleRole: null
// action that has waited ACTION_STARVATION_TICK_THRESHOLD ticks must win
// dispatch over that continuity fast path (findStarvedActionForEmployee,
// ActionSelection.ts).
// ═══════════════════════════════════════════════════════════════════════════

describe('Buildings — completes despite a starved debris_hauler backlog (#1000)', () => {
  let ctx: GameContext;

  beforeEach(() => {
    // Generous cash: 3 debris_hauler vehicles + a freight_warehouse + a
    // management_office order, plus several hundred ticks of payroll/upkeep.
    ctx = makeGameContext({ mineType: 'desert', seed: 42, size: 32, cash: 1_000_000 });
  });

  /** Top up every employee's fatigue before a tick — an unrelated forced-rest
   * interruption (ForceShiftRest.ts/needs auto-insertion) would otherwise
   * hand a driver a spontaneous idle window on its own, letting the ordinary
   * (non-continuity) idle-dispatch path pick up the place_building order and
   * pass this test for a reason that has nothing to do with #1000. Mirrors
   * blast-oversized-boulders.integration.test.ts's driveConstructionToCompletion. */
  function tickWithFatigueToppedUp(): void {
    for (const emp of ctx.state!.employees.employees) emp.fatigue = 100;
    tickCommand(ctx, ['1'], {});
  }

  it('a place_building order lands even while a huge unclaimed haul_debris backlog exists, because the starved order eventually wins dispatch over vehicle continuity', () => {
    // Roster: three employees licensed ONLY as debris_hauler drivers
    // (driving.truck, the 'driver' role's own starting qualification) —
    // nobody else exists to ever be free on foot. This reproduces the bug
    // precisely: without the #1000 fix, none of them can ever be spared for
    // the place_building order once the haul backlog exists.
    for (let i = 0; i < 3; i++) {
      const hireResult = employeeCommand(ctx, ['hire'], { role: 'driver' });
      expect(hireResult.success, JSON.stringify(hireResult)).toBe(true);
      const buyResult = vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
      expect(buyResult.success, JSON.stringify(buyResult)).toBe(true);
    }
    expect(ctx.state!.employees.employees).toHaveLength(3);
    expect(ctx.state!.vehicles.vehicles).toHaveLength(3);

    // A freight_warehouse must exist before any haul_debris action can ever
    // actually complete (HaulingTask.ts refuses to start hauling with no
    // active depot) — build it first, before the backlog exists, so this
    // step alone proves nothing about the fix. Tier 1 (2,000kg capacity,
    // needs no research unlock) is plenty: the light-weight fragments seeded
    // below total well under that even if every one were delivered, so
    // storage room never becomes the bottleneck instead of #1000's own fix.
    const warehouseOrder = buildCommand(ctx, ['freight_warehouse'], { at: '6,9' });
    expect(warehouseOrder.success, JSON.stringify(warehouseOrder)).toBe(true);
    for (let i = 0; i < 300 && ctx.state!.plannedBuildings.length > 0; i++) tickWithFatigueToppedUp();
    expect(ctx.state!.buildings.buildings).toHaveLength(1);

    // Seed a large (>200), deliberately light (5kg each — total mass well
    // under the 2,000kg warehouse capacity even if every single fragment
    // were delivered) haul_debris backlog, sparsely scattered across the
    // whole site (spacing 2, so drivers never traffic-jam each other) —
    // dense enough in total that 3 drivers cannot drain it within this
    // test's tick budget (verified empirically: draining ~225 of these at
    // this spacing takes ~2000+ ticks, an order of magnitude over budget).
    const fragments: FragmentData[] = [];
    let fragId = 1;
    for (let x = 1; x < 31; x += 2) {
      for (let z = 1; z < 31; z += 2) {
        fragments.push({
          id: fragId++,
          position: { x, y: 0, z },
          volume: 0.3,
          mass: 5,
          rockId: 'cruite',
          oreDensities: {},
          initialVelocity: { x: 0, y: 0, z: 0 },
          isProjection: false,
          halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
          shapeSeed: 1,
        });
      }
    }
    addBlastFragments(ctx.state!.logistics, fragments, ctx.state!.navGrid);
    syncHaulDispatch(ctx.state!);
    const backlogSize = ctx.state!.pendingActions.filter(a => a.type === 'haul_debris').length;
    expect(backlogSize).toBeGreaterThan(200);

    // Let all three drivers actually commit to a haul_debris action FIRST —
    // this matters because an idle employee's *first* dispatch is the
    // general cost-ranked pick across every claimable action (which already
    // considers place_building fairly). The #1000 bug is specifically in
    // tryContinueVehicleGatedAction's same-role continuity fast path, which
    // only ever runs once a driver already mid-chain finishes a haul — so
    // the place_building order below must not exist yet while any driver
    // could still win it through ordinary idle dispatch, or this test would
    // pass without exercising the bug at all.
    const isEveryoneHauling = (): boolean => ctx.state!.employees.employees.every(e => {
      const action = e.activeActionId !== null
        ? ctx.state!.pendingActions.find(a => a.id === e.activeActionId)
        : undefined;
      return action?.type === 'haul_debris';
    });
    for (let i = 0; i < 100 && !isEveryoneHauling(); i++) tickWithFatigueToppedUp();
    expect(isEveryoneHauling(), JSON.stringify(ctx.state!.employees.employees.map(e => e.activeActionId))).toBe(true);

    // Order the SECOND building only now that every driver is already
    // committed to the haul backlog via vehicle continuity.
    const orderResult = buildCommand(ctx, ['management_office'], { at: '25,3' });
    expect(orderResult.success, JSON.stringify(orderResult)).toBe(true);
    expect(ctx.state!.buildings.buildings).toHaveLength(1); // not yet landed

    // Budget: ACTION_STARVATION_TICK_THRESHOLD ticks before the starved
    // order can even win dispatch, plus a tier-1 construction's own duration
    // (BUILDING_CONSTRUCTION_BASE_DURATION_TICKS) once claimed, plus a
    // generous travel/dispatch margin — sized well above what the fix
    // actually needs, so this isn't a flaky race against the tick budget,
    // yet nowhere near the ~2000+ ticks the backlog above needs to drain on
    // its own (so this cannot pass merely because the backlog ran out).
    const TICK_BUDGET = ACTION_STARVATION_TICK_THRESHOLD + BUILDING_CONSTRUCTION_BASE_DURATION_TICKS + 150;

    let backlogStillOpenDuringTheRun = false;
    for (let i = 0; i < TICK_BUDGET && ctx.state!.buildings.buildings.length < 2; i++) {
      tickWithFatigueToppedUp();
      const openHauls = ctx.state!.pendingActions.filter(a => a.type === 'haul_debris' && a.status === 'queued').length;
      if (openHauls > 0) backlogStillOpenDuringTheRun = true;
    }

    expect(ctx.state!.buildings.buildings).toHaveLength(2);
    // Proves the building went up WHILE the backlog was starved, not because
    // it coincidentally drained first — a false positive this assertion is
    // specifically here to rule out.
    expect(backlogStillOpenDuringTheRun).toBe(true);
  });
});

// ── Terrain flatness gate, real console entry point (#1008) ──────────────────
// checkFootprintPlacement never checked terrain flatness — only bounds and
// occupancy — so `build <type> at:x,z` (buildCommand's default case ->
// orderBuildingCommand, the only console entry point that reaches it) ordered
// a building on any slope. These exercise that real command, not
// checkFootprintPlacement directly, against the real generated ctx.grid.

/**
 * Force every column under `type`/`tier`'s footprint at (x,z) to a uniform
 * surface height on the real ctx.grid — the generated terrain at any given
 * coordinate isn't guaranteed flat OR uneven, so these tests carve a
 * deterministic step directly into the grid rather than search for one.
 */
function flattenFootprint(
  ctx: GameContext, type: BuildingType, tier: 1 | 2 | 3, x: number, z: number, height: number,
): void {
  const def = getBuildingDef(type, tier);
  const grid = ctx.grid!;
  const rock = { composition: { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] }, density: 1, oreDensities: {}, fractureModifier: 1 };
  for (const [dx, dz] of def.footprint) {
    const cx = x + dx;
    const cz = z + dz;
    for (let y = 0; y < grid.sizeY; y++) {
      if (y < height) grid.setVoxel(cx, y, cz, rock);
      else grid.clearVoxel(cx, y, cz);
    }
  }
}

/**
 * Same as flattenFootprint, but raises one footprint cell `stepLevels` layers
 * above the rest — a footprint with a known height spread. One level is inside
 * the placement tolerance (BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD); the default
 * of one level past it is the genuinely refused case.
 */
function unevenFootprint(
  ctx: GameContext, type: BuildingType, tier: 1 | 2 | 3, x: number, z: number, baseHeight: number,
  stepLevels: number = BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD + 1,
): void {
  flattenFootprint(ctx, type, tier, x, z, baseHeight);
  const def = getBuildingDef(type, tier);
  const [dx0, dz0] = def.footprint[0]!;
  for (let step = 0; step < stepLevels; step++) {
    ctx.grid!.setVoxel(x + dx0, baseHeight + step, z + dz0, {
      composition: { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] }, density: 1, oreDensities: {}, fractureModifier: 1,
    });
  }
}

/** Every footprint cell's surface height, as the placement rule samples them. */
function footprintHeights(
  ctx: GameContext, type: BuildingType, tier: 1 | 2 | 3, x: number, z: number,
): number[] {
  const def = getBuildingDef(type, tier);
  return def.footprint.map(([dx, dz]) => getSurfaceY(ctx.grid!, x + dx, z + dz));
}

describe('build command — terrain levelness gate (#1008)', () => {
  it('refuses to order a building on ground steeper than the tolerance', () => {
    const ctx = makeCtx();
    unevenFootprint(ctx, 'management_office', 1, 20, 2, 5);

    const result = buildCommand(ctx, ['management_office'], { at: '20,2' });

    expect(result.success).toBe(false);
    expect(ctx.state!.plannedBuildings.length).toBe(0);
    expect(ctx.state!.buildings.buildings.length).toBe(0);
  });

  it('orders a building successfully on flat ground', () => {
    const ctx = makeCtx();
    flattenFootprint(ctx, 'management_office', 1, 20, 2, 5);

    const result = buildCommand(ctx, ['management_office'], { at: '20,2' });

    expect(result.success).toBe(true);
    expect(ctx.state!.plannedBuildings.length).toBe(1);
  });

  it('orders a building successfully on a slope within the tolerance — siting is forgiving, not exact', () => {
    const ctx = makeCtx();
    unevenFootprint(ctx, 'management_office', 1, 20, 2, 5, BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD);
    // The footprint really is uneven, so this is the tolerance passing it, not flat ground.
    expect(new Set(footprintHeights(ctx, 'management_office', 1, 20, 2)).size).toBeGreaterThan(1);

    const result = buildCommand(ctx, ['management_office'], { at: '20,2' });

    expect(result.success).toBe(true);
    expect(ctx.state!.plannedBuildings.length).toBe(1);
  });
});

describe('construction levels the ground under the footprint (#1008)', () => {
  it('a building ordered on a tolerated slope stands on flat ground once construction completes', () => {
    const ctx = makeStaffedCtx();
    unevenFootprint(ctx, 'management_office', 1, 20, 2, 5, BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD);
    const before = footprintHeights(ctx, 'management_office', 1, 20, 2);
    const lowest = Math.min(...before);
    expect(Math.max(...before)).toBe(lowest + BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD);

    expect(buildCommand(ctx, ['management_office'], { at: '20,2' }).success).toBe(true);
    // Still sloped while it is only an order — levelling is construction work,
    // not something the order does up front.
    expect(footprintHeights(ctx, 'management_office', 1, 20, 2)).toEqual(before);

    tickUntilConstructionDone(ctx);

    expect(ctx.state!.buildings.buildings.length).toBe(1);
    const after = footprintHeights(ctx, 'management_office', 1, 20, 2);
    expect(new Set(after).size).toBe(1);
    // Cut down to the lowest column, never filled up to the highest.
    expect(after[0]).toBe(lowest);
  });

  it('leaves an already-flat footprint exactly as it was', () => {
    const ctx = makeStaffedCtx();
    flattenFootprint(ctx, 'management_office', 1, 20, 2, 5);
    const before = footprintHeights(ctx, 'management_office', 1, 20, 2);

    expect(buildCommand(ctx, ['management_office'], { at: '20,2' }).success).toBe(true);
    tickUntilConstructionDone(ctx);

    expect(ctx.state!.buildings.buildings.length).toBe(1);
    expect(footprintHeights(ctx, 'management_office', 1, 20, 2)).toEqual(before);
  });

  it('a refused upgrade leaves the original building standing, unbilled', () => {
    const ctx = makeStaffedCtx();
    const bs = ctx.state!.buildings;
    placeBuilding(bs, 'research_center', 50, 50, 64, 64);
    expect(queueResearchTask(bs, 'management_office', 2).success).toBe(true);
    tickResearch(bs);

    // T1's own 2x2 is flat; the row T2 grows onto steps up two levels, past the
    // placement tolerance — so the upgrade is refused on levelness grounds.
    flattenFootprint(ctx, 'management_office', 2, 20, 2, 5);
    for (const [dx, dz] of getBuildingDef('management_office', 2).footprint.filter(([, z]) => z === 2)) {
      for (let step = 0; step <= BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD; step++) {
        ctx.grid!.setVoxel(20 + dx, 5 + step, 2 + dz, {
          composition: { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] }, density: 1, oreDensities: {}, fractureModifier: 1,
        });
      }
    }

    expect(buildCommand(ctx, ['management_office'], { at: '20,2' }).success).toBe(true);
    tickUntilConstructionDone(ctx);
    const before = ctx.state!.buildings.buildings.find(b => b.type === 'management_office')!;
    const cashBefore = ctx.state!.cash;

    const upgrade = buildCommand(ctx, ['upgrade', String(before.id)], {});

    expect(upgrade.success).toBe(false);
    // The refusal must not have cost the player the building they already own.
    const after = ctx.state!.buildings.buildings.find(b => b.id === before.id);
    expect(after).toBeDefined();
    expect(after!.tier).toBe(1);
    expect(ctx.state!.cash).toBe(cashBefore);
  });

  it('a relocated building levels the ground it lands on', () => {
    const ctx = makeStaffedCtx();
    flattenFootprint(ctx, 'management_office', 1, 20, 2, 5);
    // Destination: level enough to move onto, but a level short of flat.
    unevenFootprint(ctx, 'management_office', 1, 10, 10, 5, BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD);

    expect(buildCommand(ctx, ['management_office'], { at: '20,2' }).success).toBe(true);
    tickUntilConstructionDone(ctx);
    const id = ctx.state!.buildings.buildings[0]!.id;
    expect(new Set(footprintHeights(ctx, 'management_office', 1, 10, 10)).size).toBe(2);

    const move = buildCommand(ctx, ['move', String(id)], { to: '10,10' });
    expect(move.success, move.output).toBe(true);

    expect(new Set(footprintHeights(ctx, 'management_office', 1, 10, 10)).size).toBe(1);
  });

  it('an upgrade levels the ground the larger tier newly covers', () => {
    const ctx = makeStaffedCtx();
    const bs = ctx.state!.buildings;
    placeBuilding(bs, 'research_center', 50, 50, 64, 64);
    expect(queueResearchTask(bs, 'management_office', 2).success).toBe(true);
    tickResearch(bs);
    expect(isTierUnlocked(bs, 'management_office', 2)).toBe(true);

    // management_office T1 covers 2x2, T2 2x3 — so T2 grows onto row z+2.
    // Flatten everything T2 will cover, then step that extra row up one level:
    // the T1 build sees dead-flat ground, and the upgrade sees a slope inside
    // the tolerance that only its own larger footprint touches.
    flattenFootprint(ctx, 'management_office', 2, 20, 2, 5);
    const extraRow = getBuildingDef('management_office', 2).footprint
      .filter(([, dz]) => dz === 2);
    expect(extraRow.length).toBeGreaterThan(0);
    for (const [dx, dz] of extraRow) {
      ctx.grid!.setVoxel(20 + dx, 5, 2 + dz, {
        composition: { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] }, density: 1, oreDensities: {}, fractureModifier: 1,
      });
    }

    expect(buildCommand(ctx, ['management_office'], { at: '20,2' }).success).toBe(true);
    tickUntilConstructionDone(ctx);
    const id = ctx.state!.buildings.buildings.find(b => b.type === 'management_office')!.id;
    // The T1 footprint came out flat; the ground the T2 footprint will cover
    // has not been levelled by anything yet.
    expect(new Set(footprintHeights(ctx, 'management_office', 1, 20, 2)).size).toBe(1);
    expect(new Set(footprintHeights(ctx, 'management_office', 2, 20, 2)).size).toBe(2);

    const upgrade = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(upgrade.success, upgrade.output).toBe(true);

    expect(new Set(footprintHeights(ctx, 'management_office', 2, 20, 2)).size).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #1039 — a continuous-mode site policy with an aggressive fatigue threshold
// must not fragment a single place_building order into a chain of
// interrupt-walk-reclaim-restart cycles. Before ForceShiftRest.ts's
// isMidConstructionWork guard exists (currently a stub returning false, so
// this test is expected to stay red until the implementer fills it in), a
// proactive shift-cycle rest yanks the assigned employee off the site the
// instant fatigue crosses the policy's threshold, even mid-execution — and
// since the crossing recurs every few ticks under a policy this aggressive,
// the construction is directly observed here (empirically, via `npm run
// console`) to never complete within 100 ticks at all on the buggy code,
// instead of landing in ~20 (BUILDING_CONSTRUCTION_BASE_DURATION_TICKS=15
// plus a short walk).
// ═══════════════════════════════════════════════════════════════════════════
describe('a place_building order survives an aggressive continuous-mode site policy (#1039)', () => {
  it('completes driving_center within a bounded tick count with at most one interruption of its in_progress work', () => {
    const ctx = makeStaffedCtx();

    const policyResult = setPolicyCommand(ctx, [], { mode: 'continuous', fatigue: '90' });
    expect(policyResult.success, JSON.stringify(policyResult)).toBe(true);

    const orderResult = buildCommand(ctx, ['driving_center'], { at: '6,7' });
    expect(orderResult.success, JSON.stringify(orderResult)).toBe(true);
    const actionId = ctx.state!.plannedBuildings[0]!.actionId;

    const MAX_TICKS = 100;
    let reachedInProgress = false;
    let transitionsAwayFromInProgress = 0;
    let prevStatus: string | null = null;
    let completed = false;

    for (let i = 0; i < MAX_TICKS; i++) {
      const action = ctx.state!.pendingActions.find(a => a.id === actionId);
      if (!action) {
        // Removed from pendingActions entirely: the order has landed.
        completed = true;
        break;
      }
      if (action.status === 'in_progress') reachedInProgress = true;
      if (prevStatus === 'in_progress' && action.status !== 'in_progress') {
        transitionsAwayFromInProgress++;
      }
      prevStatus = action.status;
      tickCommand(ctx, ['1'], {});
    }
    // One more check after the final tick, in case completion landed on it.
    if (!completed && ctx.state!.pendingActions.find(a => a.id === actionId) === undefined) {
      completed = true;
    }

    expect(reachedInProgress, 'construction never reached in_progress work at all').toBe(true);
    expect(transitionsAwayFromInProgress).toBeLessThanOrEqual(1);
    expect(completed, `driving_center did not complete within ${MAX_TICKS} ticks`).toBe(true);
    const built = ctx.state!.buildings.buildings.find(b => b.type === 'driving_center');
    expect(built).toBeDefined();
  });
});
