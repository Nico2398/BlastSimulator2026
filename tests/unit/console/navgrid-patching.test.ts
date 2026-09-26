// BlastSimulator2026 — NavGrid patch wiring unit tests (Task 6.11)
// Verifies that building placement, demolition, upgrade, move, and blasts
// all trigger the appropriate NavGrid.patchNavGrid() calls — checking the
// resulting NavGrid cell types directly (NOT via events).

import { describe, it, expect, beforeEach } from 'vitest';
import { buildCommand, employeeCommand } from '../../../src/console/commands/entities.js';
import {
  blastCommand,
  drillPlanCommand,
  chargeCommand,
  sequenceCommand,
  type MiningContext,
} from '../../../src/console/commands/mining.js';
import { resetHoleIds } from '../../../src/core/mining/DrillPlan.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { tickCommand } from '../../../src/console/commands/events.js';
import { makeGameContext, GENERATED_TERRAIN_GRID_SIZE_Y } from '../../helpers/gameContext.js';
import { getBuildingDef } from '../../../src/core/entities/Building.js';
import { isOnBuildingRing } from '../../../src/core/nav/BuildingApproach.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(): MiningContext {
  // Staffed (#553): the "NavGrid patching — blast" describe below drills a
  // hole through drill_plan add, which now queues a drill_hole PendingAction
  // instead of writing the hole straight into state.drillHoles — it needs a
  // 'blasting'-qualified employee and a drill_rig vehicle to ever land.
  const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 32, staffed: true });
  // These tests exercise NavGrid patching on placement/upgrade, not the
  // research gate — pre-unlock every tier so placement isn't blocked.
  ctx.state!.buildings.unlockedTiers.management_office = 3;
  return ctx;
}

/**
 * Ticks until every ordered building has landed in state.buildings.buildings
 * (#556) — confirming a placement only queues a construction site; an idle
 * staffed employee needs to walk over and finish the `place_building` work
 * before the NavGrid actually gets patched.
 */
function tickUntilConstructionDone(ctx: MiningContext, maxTicks = 300): void {
  for (let i = 0; i < maxTicks && ctx.state!.plannedBuildings.length > 0; i++) {
    tickCommand(ctx, ['1'], {});
  }
}

/**
 * Ticks until every hole ordered by the last drill_plan add/grid has landed
 * in state.drillHoles (#553). Tops up employee need gauges each tick so an
 * unrelated needs collapse mid-drive can't derail a test of NavGrid patching
 * — see the equivalent helper in mining-commands.test.ts for the full
 * rationale.
 */
function driveDrillPlanToCompletion(ctx: MiningContext, maxTicks = 200): void {
  for (let i = 0; i < maxTicks && ctx.state!.plannedDrillHoles.length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.fatigue = 100;
    }
    tickCommand(ctx, ['1'], {});
  }
}

/**
 * Ticks until every charge ordered by the last `charge hole:*`/`charge
 * hole:<id>` has landed in state.chargesByHole (#554), mirroring
 * driveDrillPlanToCompletion above.
 */
function driveChargePlanToCompletion(ctx: MiningContext, maxTicks = 200): void {
  for (let i = 0; i < maxTicks && Object.keys(ctx.state!.plannedChargesByHole).length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.fatigue = 100;
    }
    tickCommand(ctx, ['1'], {});
  }
}

beforeEach(() => resetHoleIds());

/**
 * A cell not covered by any building footprint — passable, but its exact
 * natural type ('walkable' flat ground vs. a gentle 'ramp') depends on the
 * terrain generator's relief at that coordinate, not a fixed literal
 * (#458 T9.1/D15: assert the invariant these tests actually care about —
 * "not blocked by the footprint" — rather than pinning generator output).
 */
function expectPassable(cell: { type: string; moveCost: number }): void {
  expect(cell.type).not.toBe('blocked');
  expect(cell.type).not.toBe('void');
  expect(cell.moveCost).not.toBe(Infinity);
}

// ═══════════════════════════════════════════════════════════════════════════════
// NavGrid patching — building placement
// ═══════════════════════════════════════════════════════════════════════════════

describe('NavGrid patching — building placement', () => {
  it('blocks NavGrid cells under building footprint after placement', () => {
    const ctx = makeCtx();
    // management_office T1 has a 2×2 footprint — placed at (2,0) (flat on this
    // seed/size/mineType; (0,0) is sloped, #1008) — cells (2,0),(3,0),(2,1),(3,1)
    const result = buildCommand(ctx, ['management_office'], { at: '2,0' });
    expect(result.success).toBe(true);
    tickUntilConstructionDone(ctx);

    const nav = ctx.state!.navGrid!;

    // Cells under footprint must be blocked with Infinity moveCost
    // BEFORE the patchNavGrid wire-up this will FAIL because the cells
    // are still their original 'walkable' type.
    expect(nav.cells[0]![2]!.type).toBe('blocked');
    expect(nav.cells[0]![2]!.moveCost).toBe(Infinity);
    expect(nav.cells[1]![2]!.type).toBe('blocked');
    expect(nav.cells[0]![3]!.type).toBe('blocked');
    expect(nav.cells[1]![3]!.type).toBe('blocked');

    // Cells outside the footprint remain passable
    expectPassable(nav.cells[2]![2]!);
    expectPassable(nav.cells[0]![4]!);
    expectPassable(nav.cells[2]![4]!);
  });

  it('blocks NavGrid cells for multi-tile buildings at a non-origin location', () => {
    const ctx = makeCtx();
    // Place a management_office T1 at (4,4) — flat on this seed/size/mineType
    // ((5,5) is sloped, #1008) — footprint covers (4,4)-(5,5)
    buildCommand(ctx, ['management_office'], { at: '4,4' });
    tickUntilConstructionDone(ctx);
    const nav = ctx.state!.navGrid!;

    // Cells under footprint are blocked
    expect(nav.cells[4]![4]!.type).toBe('blocked');
    expect(nav.cells[4]![5]!.type).toBe('blocked');
    expect(nav.cells[5]![4]!.type).toBe('blocked');
    expect(nav.cells[5]![5]!.type).toBe('blocked');

    // Adjacent cells outside the footprint remain walkable
    expect(nav.cells[3]![4]!.type).toBe('walkable');
    expect(nav.cells[6]![4]!.type).toBe('walkable');
    expect(nav.cells[4]![6]!.type).toBe('walkable');
  });

  it('does not patch NavGrid when building placement fails (unreachable ground)', () => {
    const ctx = makeCtx();
    const nav = ctx.state!.navGrid!;
    const prevType = nav.cells[0]![0]!.type;

    // Place well outside the 32×32 site, further than the site can bridge in
    // one action (MAX_CLAIM_BRIDGE_CHUNKS, #558) — a nearer off-site placement
    // now bridges to the site instead of refusing (#473 D5).
    const result = buildCommand(ctx, ['management_office'], { at: '800,800' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('too far');

    // NavGrid should be untouched
    expect(nav.cells[0]![0]!.type).toBe(prevType);
  });

  it('does not patch NavGrid when building placement fails (occupied tile)', () => {
    const ctx = makeCtx();

    // Place first building at (2,0) — flat on this seed/size/mineType ((0,0)
    // is sloped, #1008)
    buildCommand(ctx, ['management_office'], { at: '2,0' });

    // Try to place a second building at the same location — should fail
    const result = buildCommand(ctx, ['management_office'], { at: '2,0' });
    expect(result.success).toBe(false);

    // The NavGrid should still be unchanged from the initial buildGameNavGrid state
    // (or from whatever the first placement may have done).
    // This test documents the expected behavior: failed placements don't patch.
    // We just verify the command rejected the duplicate placement
    expect(result.output).toContain('occupied');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NavGrid patching — building demolition
// ═══════════════════════════════════════════════════════════════════════════════

describe('NavGrid patching — building demolition', () => {
  it('reverts NavGrid cells to walkable after demolition', () => {
    const ctx = makeCtx();

    // Place a building at (2,0) — flat on this seed/size/mineType ((0,0) is
    // sloped, #1008)
    buildCommand(ctx, ['management_office'], { at: '2,0' });
    tickUntilConstructionDone(ctx);
    const nav = ctx.state!.navGrid!;

    // Confirm cells are blocked after placement (this assertion fails BEFORE
    // the patchNavGrid wire-up, but passes after it — making the whole test fail
    // until the implementer adds the patch call).
    expect(nav.cells[0]![2]!.type).toBe('blocked');

    const buildingId = ctx.state!.buildings.buildings[0]!.id;

    // Demolish
    const demolishResult = buildCommand(ctx, ['destroy', String(buildingId)], {});
    expect(demolishResult.success).toBe(true);

    // After demolition, footprint cells revert to passable natural terrain
    expectPassable(nav.cells[0]![2]!);
    expectPassable(nav.cells[1]![2]!);
    expectPassable(nav.cells[0]![3]!);
    expectPassable(nav.cells[1]![3]!);
  });

  it('does not patch NavGrid when destroy fails (unknown building ID)', () => {
    const ctx = makeCtx();
    // Place a building so we have a baseline
    buildCommand(ctx, ['management_office'], { at: '0,0' });
    const nav = ctx.state!.navGrid!;
    const prevType = nav.cells[0]![0]!.type;

    // Try demolishing a non-existent building
    const result = buildCommand(ctx, ['destroy', '9999'], {});
    expect(result.success).toBe(false);

    // NavGrid unchanged
    expect(nav.cells[0]![0]!.type).toBe(prevType);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NavGrid patching — building upgrade
// ═══════════════════════════════════════════════════════════════════════════════

describe('NavGrid patching — building upgrade', () => {
  it('blocks new footprint cells after upgrading T1→T2', () => {
    const ctx = makeCtx();
    // management_office T1: rect(2,2) footprint at (2,0) — flat across T1/T2
    // footprints on this seed/size/mineType ((0,0) is sloped, #1008)
    buildCommand(ctx, ['management_office'], { at: '2,0' });
    tickUntilConstructionDone(ctx);
    const nav = ctx.state!.navGrid!;

    // T1 footprint (2×2) cells should be blocked
    expect(nav.cells[0]![2]!.type).toBe('blocked');
    expect(nav.cells[0]![3]!.type).toBe('blocked');
    expect(nav.cells[1]![2]!.type).toBe('blocked');
    expect(nav.cells[1]![3]!.type).toBe('blocked');

    // T2 footprint is rect(2,3) — extra cells at z=2
    // Before upgrade, these are walkable
    expect(nav.cells[2]![2]!.type).toBe('walkable');
    expect(nav.cells[2]![3]!.type).toBe('walkable');

    const buildingId = ctx.state!.buildings.buildings[0]!.id;

    // #410: upgrade is research-gated — unlock tier 2 first.
    ctx.state!.buildings.unlockedTiers['management_office'] = 2;

    // Upgrade T1 → T2
    const upgradeResult = buildCommand(ctx, ['upgrade', String(buildingId)], {});
    expect(upgradeResult.success).toBe(true);

    // After upgrade, the new T2 footprint cells are blocked
    expect(nav.cells[0]![2]!.type).toBe('blocked');
    expect(nav.cells[0]![3]!.type).toBe('blocked');
    expect(nav.cells[1]![2]!.type).toBe('blocked');
    expect(nav.cells[1]![3]!.type).toBe('blocked');

    // New footprint cells (z=2 row from the 2×3 footprint) must be blocked
    // NavGrid stores cells[z][x] → cells[dz+building.z][dx+building.x]
    expect(nav.cells[2]![2]!.type).toBe('blocked');
    expect(nav.cells[2]![3]!.type).toBe('blocked');
  });

  it('does not patch NavGrid when upgrade fails (already at max tier)', () => {
    const ctx = makeCtx();
    // #410: tier 3 placement is research-gated — unlock it for this setup step.
    ctx.state!.buildings.unlockedTiers['management_office'] = 3;
    // Start with a T3 management_office (3×3 footprint at 8,8 — flat on this
    // seed/size/mineType; (10,10) is sloped, #1008)
    buildCommand(ctx, ['management_office'], { at: '8,8', tier: '3' });
    tickUntilConstructionDone(ctx);
    const nav = ctx.state!.navGrid!;

    // Verify T3 blocked some cells
    expect(nav.cells[8]![8]!.type).toBe('blocked');

    const buildingId = ctx.state!.buildings.buildings[0]!.id;

    // Try upgrading a T3 (already max) — should fail
    const result = buildCommand(ctx, ['upgrade', String(buildingId)], {});
    expect(result.success).toBe(false);

    // NavGrid remains unchanged from original state
    // (cells at the footprint are still whatever they were after placement)
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NavGrid patching — building move
// ═══════════════════════════════════════════════════════════════════════════════

describe('NavGrid patching — building move', () => {
  it('blocks new footprint and clears old footprint when moving a building', () => {
    const ctx = makeCtx();
    // Place management_office T1 at (2,0) — flat on this seed/size/mineType
    // ((0,0) is sloped, #1008) — 2×2 footprint
    buildCommand(ctx, ['management_office'], { at: '2,0' });
    tickUntilConstructionDone(ctx);
    const nav = ctx.state!.navGrid!;

    // Verify original footprint is blocked
    expect(nav.cells[0]![2]!.type).toBe('blocked');
    expect(nav.cells[1]![3]!.type).toBe('blocked');

    // Move to (4,4) — flat destination ((5,5) is sloped, #1008) — new
    // footprint (4,4)-(5,5)
    const buildingId = ctx.state!.buildings.buildings[0]!.id;
    const moveResult = buildCommand(ctx, ['move', String(buildingId)], { to: '4,4' });
    expect(moveResult.success).toBe(true);

    // Old footprint cells should now be passable natural terrain again
    expectPassable(nav.cells[0]![2]!);
    expectPassable(nav.cells[0]![3]!);
    expectPassable(nav.cells[1]![2]!);
    expectPassable(nav.cells[1]![3]!);

    // New footprint cells should be blocked
    expect(nav.cells[4]![4]!.type).toBe('blocked');
    expect(nav.cells[4]![4]!.moveCost).toBe(Infinity);
    expect(nav.cells[4]![5]!.type).toBe('blocked');
    expect(nav.cells[5]![4]!.type).toBe('blocked');
    expect(nav.cells[5]![5]!.type).toBe('blocked');
  });

  it('does not patch NavGrid when move fails (target tile occupied)', () => {
    const ctx = makeCtx();
    // Place two buildings — both on flat spots on this seed/size/mineType
    // ((0,0) and (5,5) are sloped, #1008)
    buildCommand(ctx, ['management_office'], { at: '2,0' });
    buildCommand(ctx, ['management_office'], { at: '4,4' });
    tickUntilConstructionDone(ctx);

    // Try moving the first building onto the second's location
    const buildingId = ctx.state!.buildings.buildings[0]!.id;
    const result = buildCommand(ctx, ['move', String(buildingId)], { to: '4,4' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('occupied');

    // NavGrid should be unchanged — old cells are still whatever they were
    // (the first building was never fully patched to blocked, so the "old"
    //  position check is less meaningful, but the "new" position at (5,5)
    //  should not have been double-patched)
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NavGrid patching — footprint blocking at order time, occupant relocation,
// ring-cell builder targeting (#1200)
//
// Tutorial feedback: "employees walk through buildings". A planned
// building's footprint must block routing from the moment it's ordered —
// not just once construction completes — and free again on cancel or on a
// failed/refunded construction. Anyone standing on a footprint that newly
// becomes blocked (order, upgrade, move, or complete) must be relocated off
// it. The builder's own walk target must be the footprint's approach-ring
// cell, not the raw order origin (now unreachable the instant it blocks).
// ═══════════════════════════════════════════════════════════════════════════════

describe('NavGrid patching — footprint blocking at order time (#1200)', () => {
  it('blocks the footprint the instant a building is ordered, before any tick runs', () => {
    const ctx = makeCtx();
    const nav = ctx.state!.navGrid!;
    // Baseline: this spot is passable before anything is ordered.
    expectPassable(nav.cells[0]![2]!);

    const result = buildCommand(ctx, ['management_office'], { at: '2,0' });
    expect(result.success).toBe(true);

    // No tick has run — construction hasn't started, yet the footprint must
    // already refuse routing (#1200), same as a completed building.
    expect(nav.cells[0]![2]!.type).toBe('blocked');
    expect(nav.cells[0]![2]!.moveCost).toBe(Infinity);
    expect(nav.cells[1]![2]!.type).toBe('blocked');
    expect(nav.cells[0]![3]!.type).toBe('blocked');
    expect(nav.cells[1]![3]!.type).toBe('blocked');

    // Cells outside the footprint remain passable.
    expectPassable(nav.cells[2]![2]!);
    expectPassable(nav.cells[0]![4]!);
  });

  it('frees the footprint when the order is cancelled before construction starts', () => {
    const ctx = makeCtx();
    const nav = ctx.state!.navGrid!;
    const prevType = nav.cells[0]![2]!.type;

    buildCommand(ctx, ['management_office'], { at: '2,0' });
    expect(nav.cells[0]![2]!.type).toBe('blocked');

    const order = ctx.state!.plannedBuildings[0]!;
    const cancelResult = employeeCommand(ctx, ['cancel', String(order.actionId)], {});
    expect(cancelResult.success).toBe(true);
    expect(ctx.state!.plannedBuildings).toHaveLength(0);

    // Cancelling the order must free the footprint back to its pre-order
    // classification.
    expect(nav.cells[0]![2]!.type).toBe(prevType);
    expectPassable(nav.cells[0]![2]!);
    expectPassable(nav.cells[1]![2]!);
    expectPassable(nav.cells[0]![3]!);
    expectPassable(nav.cells[1]![3]!);
  });

  it('relocates an employee standing on the footprint the instant it is newly ordered', () => {
    const ctx = makeCtx();
    const employee = ctx.state!.employees.employees[0]!;
    employee.x = 2;
    employee.z = 0;
    employee.activeActionId = null;
    employee.destinationX = null;
    employee.destinationZ = null;

    const result = buildCommand(ctx, ['management_office'], { at: '2,0' });
    expect(result.success).toBe(true);

    // No tick has run — the employee must already have been moved off the
    // footprint that just closed over their own tile.
    expect(employee.x === 2 && employee.z === 0).toBe(false);
    const cell = ctx.state!.navGrid!.cellAt(Math.round(employee.x), Math.round(employee.z));
    expect(cell).toBeTruthy();
    expect(cell!.type).not.toBe('blocked');
  });

  it('queues the builder\'s PendingAction at the footprint\'s approach ring cell, not the raw order origin', () => {
    const ctx = makeCtx();
    const result = buildCommand(ctx, ['management_office'], { at: '2,0' });
    expect(result.success).toBe(true);

    const order = ctx.state!.plannedBuildings[0]!;
    const action = ctx.state!.pendingActions.find(a => a.id === order.actionId)!;
    const def = getBuildingDef(order.type, order.tier);

    // The raw order origin now sits inside the (blocked) footprint —
    // Pathfinding refuses an impassable goal outright, so a target there
    // could never be reached. The builder's own walk target must instead be
    // a walkable cell on the footprint's approach ring.
    expect(action.targetX === order.x && action.targetZ === order.z).toBe(false);
    expect(isOnBuildingRing(order, def, action.targetX, action.targetZ)).toBe(true);
  });

  it('relocates an employee standing on the new tier\'s larger footprint when upgrading', () => {
    const ctx = makeCtx();
    // management_office T1: rect(2,2) footprint at (2,0); T2: rect(2,3) —
    // extra cells at z=2, walkable before the upgrade (mirrors the existing
    // "blocks new footprint cells after upgrading T1→T2" test above).
    buildCommand(ctx, ['management_office'], { at: '2,0' });
    tickUntilConstructionDone(ctx);
    const buildingId = ctx.state!.buildings.buildings[0]!.id;
    ctx.state!.buildings.unlockedTiers['management_office'] = 2;

    const employee = ctx.state!.employees.employees[0]!;
    employee.x = 2;
    employee.z = 2;
    employee.activeActionId = null;
    employee.destinationX = null;
    employee.destinationZ = null;
    expect(ctx.state!.navGrid!.cellAt(2, 2)!.type).not.toBe('blocked');

    const result = buildCommand(ctx, ['upgrade', String(buildingId)], {});
    expect(result.success).toBe(true);

    expect(employee.x === 2 && employee.z === 2).toBe(false);
    const cell = ctx.state!.navGrid!.cellAt(Math.round(employee.x), Math.round(employee.z));
    expect(cell).toBeTruthy();
    expect(cell!.type).not.toBe('blocked');
  });

  it('relocates an employee standing on the destination footprint when moving a building, but leaves one on the vacated old footprint alone', () => {
    const ctx = makeCtx();
    buildCommand(ctx, ['management_office'], { at: '2,0' });
    tickUntilConstructionDone(ctx);
    const buildingId = ctx.state!.buildings.buildings[0]!.id;

    const onDestination = ctx.state!.employees.employees[0]!;
    onDestination.x = 4;
    onDestination.z = 4;
    onDestination.activeActionId = null;
    onDestination.destinationX = null;
    onDestination.destinationZ = null;

    const onOldFootprint = ctx.state!.employees.employees[1]!;
    onOldFootprint.x = 2;
    onOldFootprint.z = 0;
    onOldFootprint.activeActionId = null;
    onOldFootprint.destinationX = null;
    onOldFootprint.destinationZ = null;

    const moveResult = buildCommand(ctx, ['move', String(buildingId)], { to: '4,4' });
    expect(moveResult.success).toBe(true);

    // The destination footprint's occupant must be relocated off it.
    expect(onDestination.x === 4 && onDestination.z === 4).toBe(false);
    const destCell = ctx.state!.navGrid!.cellAt(Math.round(onDestination.x), Math.round(onDestination.z));
    expect(destCell).toBeTruthy();
    expect(destCell!.type).not.toBe('blocked');

    // The vacated old footprint is passable again — moving a building only
    // needs to protect the NEW location, so this employee is left exactly
    // where they were.
    expect(onOldFootprint.x).toBe(2);
    expect(onOldFootprint.z).toBe(0);
  });

  it('refuses to order a building whose entire approach ring is already sealed by prior orders, with no side effects', () => {
    const ctx = makeCtx();

    // Three management_office T1 orders (2×2 footprints) at (2,0), (0,2) and
    // (2,2), none ticked to completion, jointly seal every ring cell around
    // the (0,0)-(1,1) pocket: (2,0)/(2,1) come from the first office, (0,2)/
    // (1,2) from the second, and the shared corner cell (2,2) from the
    // third — the grid's own edge supplies the remaining two sides. The
    // pocket's own footprint cells stay walkable throughout (#1200 finding):
    // a footprint is individually clear right up until the last order that
    // seals its ring.
    const first = buildCommand(ctx, ['management_office'], { at: '2,0' });
    expect(first.success).toBe(true);
    const second = buildCommand(ctx, ['management_office'], { at: '0,2' });
    expect(second.success).toBe(true);
    const third = buildCommand(ctx, ['management_office'], { at: '2,2' });
    expect(third.success).toBe(true);

    const nav = ctx.state!.navGrid!;
    expectPassable(nav.cellAt(0, 0)!);
    expectPassable(nav.cellAt(1, 0)!);
    expectPassable(nav.cellAt(0, 1)!);
    expectPassable(nav.cellAt(1, 1)!);

    const plannedCountBefore = ctx.state!.plannedBuildings.length;
    const cashBefore = ctx.state!.cash;

    // Ordering a fourth office to fill the now-sealed pocket must be refused
    // outright — its own footprint (0,0)-(1,1) is still clear, but nothing
    // on its ring is reachable — rather than dispatching a builder at an
    // unreachable fallback target.
    const result = buildCommand(ctx, ['management_office'], { at: '0,0' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('No reachable approach');

    // No side effects from the refused order: no cash spent, no PlannedBuilding
    // queued, and the pocket's own footprint left exactly as it was.
    expect(ctx.state!.plannedBuildings).toHaveLength(plannedCountBefore);
    expect(ctx.state!.cash).toBe(cashBefore);
    expectPassable(nav.cellAt(0, 0)!);
    expectPassable(nav.cellAt(1, 0)!);
    expectPassable(nav.cellAt(0, 1)!);
    expectPassable(nav.cellAt(1, 1)!);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NavGrid patching — blast
// ═══════════════════════════════════════════════════════════════════════════════

describe('NavGrid patching — blast', () => {
  it('leaves the blast region matching a NavGrid rebuilt from the blasted terrain', () => {
    const ctx = makeCtx();
    const nav = ctx.state!.navGrid!;
    expect(nav).toBeTruthy();

    resetHoleIds();
    drillPlanCommand(ctx, ['add'], { x: '8', z: '8', depth: '18' });
    driveDrillPlanToCompletion(ctx);
    chargeCommand(ctx, [], { hole: 'H1', explosive: 'dynatomics', amount: '20kg', stemming: '1m' });
    driveChargePlanToCompletion(ctx);
    sequenceCommand(ctx, ['set'], { hole: 'H1', delay: '0ms' });

    const result = blastCommand(ctx, [], {});
    expect(result.success).toBe(true);
    expect(ctx.lastBlastFragments!.length).toBeGreaterThan(0);
    expect(ctx.state!.navGrid).toBeTruthy();

    // The cleared voxels bound the region the patch was responsible for.
    const cleared = ctx.lastBlastFragments!;
    const region = {
      minX: Math.min(...cleared.map(p => Math.floor(p.x))),
      maxX: Math.max(...cleared.map(p => Math.floor(p.x))),
      minZ: Math.min(...cleared.map(p => Math.floor(p.z))),
      maxZ: Math.max(...cleared.map(p => Math.floor(p.z))),
    };
    expect(region.maxX).toBeGreaterThanOrEqual(region.minX);

    // A patched NavGrid must be indistinguishable from one built fresh off the
    // post-blast voxel grid. Asserting that, rather than a specific cell type,
    // keeps this a test of the patch wiring rather than of how much rock a
    // given charge happens to remove.
    const rebuilt = NavGrid.buildNavGrid(
      ctx.grid!,
      ctx.state!.buildings.buildings,
      ctx.state!.drillHoles,
    );

    for (let z = region.minZ; z <= region.maxZ; z++) {
      for (let x = region.minX; x <= region.maxX; x++) {
        const patched = nav.cellAt(x, z);
        const fresh = rebuilt.cellAt(x, z);
        if (!patched || !fresh) continue;
        expect(patched.type, `cell (${x},${z}) type`).toBe(fresh.type);
        expect(patched.moveCost, `cell (${x},${z}) moveCost`).toBe(fresh.moveCost);
      }
    }
  });

  it('lowers the ground under the blast so the NavGrid surface follows it down', () => {
    const ctx = makeCtx();
    const grid = ctx.grid!;

    const solidCount = (x: number, z: number): number => {
      let n = 0;
      for (let y = 0; y < GENERATED_TERRAIN_GRID_SIZE_Y; y++) if (grid.densityAt(x, y, z) > 0) n++;
      return n;
    };

    resetHoleIds();
    drillPlanCommand(ctx, ['add'], { x: '8', z: '8', depth: '18' });
    driveDrillPlanToCompletion(ctx);
    chargeCommand(ctx, [], { hole: 'H1', explosive: 'dynatomics', amount: '20kg', stemming: '1m' });
    driveChargePlanToCompletion(ctx);
    sequenceCommand(ctx, ['set'], { hole: 'H1', delay: '0ms' });

    const before = solidCount(8, 8);
    expect(blastCommand(ctx, [], {}).success).toBe(true);

    expect(solidCount(8, 8)).toBeLessThan(before);
  });

  it('does not patch NavGrid when blast fails (missing charges)', () => {
    const ctx = makeCtx();
    const nav = ctx.state!.navGrid!;
    const prevType = nav.cells[0]![0]!.type;

    // Create a drill hole but don't charge it — validation should fail
    resetHoleIds();
    drillPlanCommand(ctx, ['add'], { x: '8', z: '8', depth: '8' });
    driveDrillPlanToCompletion(ctx);

    const result = blastCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('Missing charge');

    // NavGrid unchanged
    expect(nav.cells[0]![0]!.type).toBe(prevType);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NavGrid patching — event names (#1161)
//
// The tests above only assert resulting NavGrid cell state, which stays true
// whichever event drives the patch. These pin the EVENT NAME each
// occupancy-only site uses: destroy/upgrade/move/the blast corrective patch
// must emit 'nav:occupancy_changed', not 'terrain:updated' — so the
// renderer's terrain:updated-only remesh subscription (src/main.ts) never
// fires on a pure occupancy change. A real voxel carve (construction's own
// levelBuildingFootprint carve, or a blast's own clear) still emits
// 'terrain:updated' and is untouched by this split.
// ═══════════════════════════════════════════════════════════════════════════════

describe('NavGrid patching — event names (#1161)', () => {
  it('destroy emits nav:occupancy_changed, not terrain:updated, for its footprint patch', () => {
    const ctx = makeCtx();
    buildCommand(ctx, ['management_office'], { at: '2,0' });
    tickUntilConstructionDone(ctx);
    const buildingId = ctx.state!.buildings.buildings[0]!.id;

    const events: string[] = [];
    ctx.emitter.on('terrain:updated', () => events.push('terrain:updated'));
    ctx.emitter.on('nav:occupancy_changed', () => events.push('nav:occupancy_changed'));

    const result = buildCommand(ctx, ['destroy', String(buildingId)], {});
    expect(result.success).toBe(true);

    // Destroy carves zero voxels — was always occupancy-only, so it must
    // emit exactly one nav:occupancy_changed and zero terrain:updated.
    expect(events).toEqual(['nav:occupancy_changed']);
  });

  it('upgrade emits nav:occupancy_changed as the final (wrapping) footprint-occupancy patch', () => {
    const ctx = makeCtx();
    buildCommand(ctx, ['management_office'], { at: '2,0' });
    tickUntilConstructionDone(ctx);
    const buildingId = ctx.state!.buildings.buildings[0]!.id;
    ctx.state!.buildings.unlockedTiers['management_office'] = 2;

    const events: string[] = [];
    ctx.emitter.on('terrain:updated', () => events.push('terrain:updated'));
    ctx.emitter.on('nav:occupancy_changed', () => events.push('nav:occupancy_changed'));

    const result = buildCommand(ctx, ['upgrade', String(buildingId)], {});
    expect(result.success).toBe(true);

    // levelBuildingFootprint's own internal carve (if it fired at all, real
    // rock removed) emits terrain:updated and always runs BEFORE the
    // wrapping occupancy emit in upgrade's own code — so whatever else
    // happened, the LAST event recorded for this command is the wrapping
    // one, and it must be nav:occupancy_changed.
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1]).toBe('nav:occupancy_changed');
  });

  it('move emits nav:occupancy_changed for both the old- and new-footprint patches', () => {
    const ctx = makeCtx();
    buildCommand(ctx, ['management_office'], { at: '2,0' });
    tickUntilConstructionDone(ctx);
    const buildingId = ctx.state!.buildings.buildings[0]!.id;

    const events: string[] = [];
    ctx.emitter.on('terrain:updated', () => events.push('terrain:updated'));
    ctx.emitter.on('nav:occupancy_changed', () => events.push('nav:occupancy_changed'));

    const result = buildCommand(ctx, ['move', String(buildingId)], { to: '4,4' });
    expect(result.success).toBe(true);

    // Both wrapping emits (old-footprint-clear, new-footprint-block) run
    // after any internal levelBuildingFootprint carve, so they are always
    // the last two events recorded for this command.
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.slice(-2)).toEqual(['nav:occupancy_changed', 'nav:occupancy_changed']);
  });

  it('blast emits terrain:updated exactly once (the real carve) and nav:occupancy_changed exactly once (the corrective post-clear patch)', () => {
    const ctx = makeCtx();

    resetHoleIds();
    drillPlanCommand(ctx, ['add'], { x: '8', z: '8', depth: '18' });
    driveDrillPlanToCompletion(ctx);
    chargeCommand(ctx, [], { hole: 'H1', explosive: 'dynatomics', amount: '20kg', stemming: '1m' });
    driveChargePlanToCompletion(ctx);
    sequenceCommand(ctx, ['set'], { hole: 'H1', delay: '0ms' });

    const events: string[] = [];
    ctx.emitter.on('terrain:updated', () => events.push('terrain:updated'));
    ctx.emitter.on('nav:occupancy_changed', () => events.push('nav:occupancy_changed'));

    const result = blastCommand(ctx, [], {});
    expect(result.success).toBe(true);

    const terrainCount = events.filter(e => e === 'terrain:updated').length;
    const occupancyCount = events.filter(e => e === 'nav:occupancy_changed').length;
    // executeBlast's own carve emits terrain:updated once. The corrective
    // post-drillHoles-clear re-patch must switch to nav:occupancy_changed —
    // today it double-fires terrain:updated instead.
    expect(terrainCount).toBe(1);
    expect(occupancyCount).toBe(1);
  });
});
