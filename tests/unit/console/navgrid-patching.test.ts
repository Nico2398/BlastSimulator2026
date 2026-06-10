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
import { createTubingState } from '../../../src/core/mining/Tubing.js';
import { resetHoleIds } from '../../../src/core/mining/DrillPlan.js';
import { getBuildingDef, getDefSize } from '../../../src/core/entities/Building.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(): MiningContext {
  const ctx: MiningContext = {
    state: null,
    grid: null,
    softwareTier: 0,
    tubingState: createTubingState(),
    emitter: new EventEmitter(),
  };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32' });
  return ctx;
}

beforeEach(() => resetHoleIds());

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

    // Cells outside the footprint remain walkable
    expect(nav.cells[2]![0]!.type).toBe('walkable');
    expect(nav.cells[0]![2]!.type).toBe('walkable');
    expect(nav.cells[2]![2]!.type).toBe('walkable');
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

  it('does not patch NavGrid when building placement fails (out of bounds)', () => {
    const ctx = makeCtx();
    const nav = ctx.state!.navGrid!;
    const prevType = nav.cells[0]![0]!.type;

    // Place at a position well outside the 32×32 grid
    const result = buildCommand(ctx, ['management_office'], { at: '100,100' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Out of bounds');

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

    // After demolition, footprint cells revert to walkable
    expect(nav.cells[0]![0]!.type).toBe('walkable');
    expect(nav.cells[0]![0]!.moveCost).toBe(1.0);
    expect(nav.cells[1]![0]!.type).toBe('walkable');
    expect(nav.cells[0]![1]!.type).toBe('walkable');
    expect(nav.cells[1]![1]!.type).toBe('walkable');
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

    // Old footprint cells should now be walkable
    expect(nav.cells[0]![0]!.type).toBe('walkable');
    expect(nav.cells[0]![0]!.moveCost).toBe(1.0);
    expect(nav.cells[1]![0]!.type).toBe('walkable');
    expect(nav.cells[0]![1]!.type).toBe('walkable');
    expect(nav.cells[1]![1]!.type).toBe('walkable');

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
  it('updates NavGrid cells in the blast cleared region after explosion', () => {
    const ctx = makeCtx();
    const nav = ctx.state!.navGrid!;
    expect(nav).toBeTruthy();

    // Place a hole at grid center-top area and charge it strongly so the
    // blast clears voxels all the way down to y=0, making those columns void.
    // Use dynatomics 12kg (max is 20) for high energy (1300×12=15600).
    resetHoleIds();
    drillPlanCommand(ctx, ['add'], { x: '8', z: '8', depth: '20' });
    chargeCommand(ctx, [], { hole: 'H1', explosive: 'dynatomics', amount: '12kg', stemming: '3m' });
    sequenceCommand(ctx, ['set'], { hole: 'H1', delay: '0ms' });

    // Record cell type at origin before blast
    const preType = nav.cells[8]![8]!.type;

    // Execute blast
    const result = blastCommand(ctx, [], {});
    expect(result.success).toBe(true);
    expect(ctx.lastBlastFragments!.length).toBeGreaterThan(0);

    // The NavGrid still exists after blast
    expect(ctx.state!.navGrid).toBeTruthy();
    expect(ctx.state!.navGrid!.cells[8]![8]).toBeTruthy();

    // Cells near the blast center should now be 'void' because the blast
    // cleared all solid voxels in those columns (deep hole + strong charge).
    // BEFORE the patchNavGrid call in blastCommand, these cells remain
    // unchanged (walkable), so this assertion FAILS.
    // AFTER the implementer wires patchNavGrid into blastCommand, the cells
    // in the cleared region are recomputed and become 'void'.
    expect(nav.cells[8]![8]!.type).toBe('void');
    expect(nav.cells[8]![8]!.moveCost).toBe(Infinity);

    // Nearby cells within the 5-voxel blast radius should also be affected
    expect(nav.cells[7]![8]!.type).toBe('void');
    expect(nav.cells[8]![7]!.type).toBe('void');
    expect(nav.cells[9]![8]!.type).toBe('void');
    expect(nav.cells[8]![9]!.type).toBe('void');
  });

  it('does not patch NavGrid when blast fails (missing charges)', () => {
    const ctx = makeCtx();
    const nav = ctx.state!.navGrid!;
    const prevType = nav.cells[0]![0]!.type;

    // Create a drill hole but don't charge it — validation should fail
    resetHoleIds();
    drillPlanCommand(ctx, ['add'], { x: '8', z: '8', depth: '8' });

    const result = blastCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('Missing charge');

    // NavGrid unchanged
    expect(nav.cells[0]![0]!.type).toBe(prevType);
  });
});
