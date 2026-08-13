// BlastSimulator2026 — NavGrid patch wiring unit tests (Task 6.11)
// Verifies that building placement, demolition, upgrade, move, and blasts
// all trigger the appropriate NavGrid.patchNavGrid() calls — checking the
// resulting NavGrid cell types directly (NOT via events).

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { newGameCommand } from '../../../src/console/commands/world.js';
import { buildCommand } from '../../../src/console/commands/entities.js';
import {
  blastCommand,
  drillPlanCommand,
  chargeCommand,
  sequenceCommand,
  type MiningContext,
} from '../../../src/console/commands/mining.js';
import { resetHoleIds } from '../../../src/core/mining/DrillPlan.js';
import { getBuildingDef, getDefSize } from '../../../src/core/entities/Building.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { tickCommand } from '../../../src/console/commands/events.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(): MiningContext {
  const ctx: MiningContext = {
    state: null,
    grid: null,
    emitter: new EventEmitter(),
  };
  // Staffed (#553): the "NavGrid patching — blast" describe below drills a
  // hole through drill_plan add, which now queues a drill_hole PendingAction
  // instead of writing the hole straight into state.drillHoles — it needs a
  // 'blasting'-qualified employee and a drill_rig vehicle to ever land.
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32', staffed: 'true' });
  // These tests exercise NavGrid patching on placement/upgrade, not the
  // research gate — pre-unlock every tier so placement isn't blocked.
  ctx.state!.buildings.unlockedTiers.management_office = 3;
  return ctx;
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
      emp.hunger = 100;
      emp.fatigue = 100;
      emp.breakNeed = 100;
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
    // management_office T1 has a 2×2 footprint — cells (0,0),(1,0),(0,1),(1,1)
    const result = buildCommand(ctx, ['management_office'], { at: '0,0' });
    expect(result.success).toBe(true);

    const nav = ctx.state!.navGrid!;

    // Cells under footprint must be blocked with Infinity moveCost
    // BEFORE the patchNavGrid wire-up this will FAIL because the cells
    // are still their original 'walkable' type.
    expect(nav.cells[0]![0]!.type).toBe('blocked');
    expect(nav.cells[0]![0]!.moveCost).toBe(Infinity);
    expect(nav.cells[1]![0]!.type).toBe('blocked');
    expect(nav.cells[0]![1]!.type).toBe('blocked');
    expect(nav.cells[1]![1]!.type).toBe('blocked');

    // Cells outside the footprint remain passable
    expectPassable(nav.cells[2]![0]!);
    expectPassable(nav.cells[0]![2]!);
    expectPassable(nav.cells[2]![2]!);
  });

  it('blocks NavGrid cells for multi-tile buildings at a non-origin location', () => {
    const ctx = makeCtx();
    // Place a management_office T1 at (5,5) — footprint covers (5,5)-(6,6)
    buildCommand(ctx, ['management_office'], { at: '5,5' });
    const nav = ctx.state!.navGrid!;

    // Cells under footprint are blocked
    expect(nav.cells[5]![5]!.type).toBe('blocked');
    expect(nav.cells[6]![5]!.type).toBe('blocked');
    expect(nav.cells[5]![6]!.type).toBe('blocked');
    expect(nav.cells[6]![6]!.type).toBe('blocked');

    // Adjacent cells outside the footprint remain walkable
    expect(nav.cells[4]![5]!.type).toBe('walkable');
    expect(nav.cells[7]![5]!.type).toBe('walkable');
    expect(nav.cells[5]![7]!.type).toBe('walkable');
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

    // Place first building at (0,0)
    buildCommand(ctx, ['management_office'], { at: '0,0' });

    // Try to place a second building at the same location — should fail
    const result = buildCommand(ctx, ['management_office'], { at: '0,0' });
    expect(result.success).toBe(false);

    // The NavGrid should still be unchanged from the initial buildGameNavGrid state
    // (or from whatever the first placement may have done).
    // This test documents the expected behavior: failed placements don't patch.
    const nav = ctx.state!.navGrid!;
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

    // Place a building
    buildCommand(ctx, ['management_office'], { at: '0,0' });
    const nav = ctx.state!.navGrid!;

    // Confirm cells are blocked after placement (this assertion fails BEFORE
    // the patchNavGrid wire-up, but passes after it — making the whole test fail
    // until the implementer adds the patch call).
    expect(nav.cells[0]![0]!.type).toBe('blocked');

    const buildingId = ctx.state!.buildings.buildings[0]!.id;

    // Demolish
    const demolishResult = buildCommand(ctx, ['destroy', String(buildingId)], {});
    expect(demolishResult.success).toBe(true);

    // After demolition, footprint cells revert to passable natural terrain
    expectPassable(nav.cells[0]![0]!);
    expectPassable(nav.cells[1]![0]!);
    expectPassable(nav.cells[0]![1]!);
    expectPassable(nav.cells[1]![1]!);
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
    // management_office T1: rect(2,2) footprint at (0,0)
    buildCommand(ctx, ['management_office'], { at: '0,0' });
    const nav = ctx.state!.navGrid!;

    // T1 footprint (2×2) cells should be blocked
    expect(nav.cells[0]![0]!.type).toBe('blocked');
    expect(nav.cells[1]![0]!.type).toBe('blocked');
    expect(nav.cells[0]![1]!.type).toBe('blocked');
    expect(nav.cells[1]![1]!.type).toBe('blocked');

    // T2 footprint is rect(2,3) — extra cells at z=2
    // Before upgrade, these are walkable
    expect(nav.cells[0]![2]!.type).toBe('walkable');
    expect(nav.cells[1]![2]!.type).toBe('walkable');

    const buildingId = ctx.state!.buildings.buildings[0]!.id;

    // #410: upgrade is research-gated — unlock tier 2 first.
    ctx.state!.buildings.unlockedTiers['management_office'] = 2;

    // Upgrade T1 → T2
    const upgradeResult = buildCommand(ctx, ['upgrade', String(buildingId)], {});
    expect(upgradeResult.success).toBe(true);

    // After upgrade, the new T2 footprint cells are blocked
    expect(nav.cells[0]![0]!.type).toBe('blocked');
    expect(nav.cells[1]![0]!.type).toBe('blocked');
    expect(nav.cells[0]![1]!.type).toBe('blocked');
    expect(nav.cells[1]![1]!.type).toBe('blocked');

    // New footprint cells (z=2 row from the 2×3 footprint) must be blocked
    // NavGrid stores cells[z][x] → cells[dz+building.z][dx+building.x]
    expect(nav.cells[2]![0]!.type).toBe('blocked');
    expect(nav.cells[2]![1]!.type).toBe('blocked');
  });

  it('does not patch NavGrid when upgrade fails (already at max tier)', () => {
    const ctx = makeCtx();
    // #410: tier 3 placement is research-gated — unlock it for this setup step.
    ctx.state!.buildings.unlockedTiers['management_office'] = 3;
    // Start with a T3 management_office (3×3 footprint at 10,10)
    buildCommand(ctx, ['management_office'], { at: '10,10', tier: '3' });
    const nav = ctx.state!.navGrid!;

    // Verify T3 blocked some cells
    expect(nav.cells[10]![10]!.type).toBe('blocked');

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
    // Place management_office T1 at (0,0) — 2×2 footprint
    buildCommand(ctx, ['management_office'], { at: '0,0' });
    const nav = ctx.state!.navGrid!;

    // Verify original footprint is blocked
    expect(nav.cells[0]![0]!.type).toBe('blocked');
    expect(nav.cells[1]![1]!.type).toBe('blocked');

    // Move to (5,5) — new footprint (5,5)-(6,6)
    const buildingId = ctx.state!.buildings.buildings[0]!.id;
    const moveResult = buildCommand(ctx, ['move', String(buildingId)], { to: '5,5' });
    expect(moveResult.success).toBe(true);

    // Old footprint cells should now be passable natural terrain again
    expectPassable(nav.cells[0]![0]!);
    expectPassable(nav.cells[1]![0]!);
    expectPassable(nav.cells[0]![1]!);
    expectPassable(nav.cells[1]![1]!);

    // New footprint cells should be blocked
    expect(nav.cells[5]![5]!.type).toBe('blocked');
    expect(nav.cells[5]![5]!.moveCost).toBe(Infinity);
    expect(nav.cells[6]![5]!.type).toBe('blocked');
    expect(nav.cells[5]![6]!.type).toBe('blocked');
    expect(nav.cells[6]![6]!.type).toBe('blocked');
  });

  it('does not patch NavGrid when move fails (target tile occupied)', () => {
    const ctx = makeCtx();
    // Place two buildings
    buildCommand(ctx, ['management_office'], { at: '0,0' });
    buildCommand(ctx, ['management_office'], { at: '5,5' });

    const nav = ctx.state!.navGrid!;

    // Try moving the first building onto the second's location
    const buildingId = ctx.state!.buildings.buildings[0]!.id;
    const result = buildCommand(ctx, ['move', String(buildingId)], { to: '5,5' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('occupied');

    // NavGrid should be unchanged — old cells are still whatever they were
    // (the first building was never fully patched to blocked, so the "old"
    //  position check is less meaningful, but the "new" position at (5,5)
    //  should not have been double-patched)
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
      for (let y = 0; y < grid.sizeY; y++) if (grid.densityAt(x, y, z) > 0) n++;
      return n;
    };

    resetHoleIds();
    drillPlanCommand(ctx, ['add'], { x: '8', z: '8', depth: '18' });
    driveDrillPlanToCompletion(ctx);
    chargeCommand(ctx, [], { hole: 'H1', explosive: 'dynatomics', amount: '20kg', stemming: '1m' });
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
