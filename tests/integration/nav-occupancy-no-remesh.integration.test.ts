// BlastSimulator2026 — Integration test: nav:occupancy_changed never triggers
// a terrain remesh (issue #1161)
//
// terrain:updated is overloaded today: it drives both the renderer's real
// terrain remesh (src/main.ts) AND NavGrid resync (NavGridSync.ts).
// Building destroy/upgrade/move (occupancy-only, no voxel carve) and the
// blast corrective post-clear patch emit terrain:updated purely to reach
// NavGridSync — wastefully triggering a renderer remesh along the way.
//
// The fix: those occupancy-only sites switch to emitting nav:occupancy_changed
// instead. NavGridSync.subscribeNavGridToUpdates widens to listen to BOTH
// events, so the NavGrid still resyncs either way. The renderer (mirrored
// here, exactly as wired in src/main.ts) keeps listening to terrain:updated
// only, so it stops remeshing on pure occupancy changes.
//
// ALL TESTS IN THIS FILE MUST FAIL before implementation: today destroy and
// the blast corrective patch still emit terrain:updated, so the mirrored
// renderer subscription still remeshes for them.

import { describe, it, expect, vi } from 'vitest';
import { GameRenderer } from '../../src/renderer/GameRenderer.js';
import { makeMockSceneManager } from '../helpers/rendererFixtures.js';
import { makeGameContext } from '../helpers/gameContext.js';
import { buildCommand } from '../../src/console/commands/entities.js';
import { tickCommand } from '../../src/console/commands/tick.js';
import {
  blastCommand,
  drillPlanCommand,
  chargeCommand,
  sequenceCommand,
  type MiningContext,
} from '../../src/console/commands/mining.js';
import { resetHoleIds } from '../../src/core/mining/DrillPlan.js';

// ── Helpers (mirror tests/unit/console/navgrid-patching.test.ts) ───────────

function makeCtx(): MiningContext {
  const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 32, staffed: true });
  ctx.state!.buildings.unlockedTiers.management_office = 3;
  return ctx;
}

function tickUntilConstructionDone(ctx: MiningContext, maxTicks = 300): void {
  for (let i = 0; i < maxTicks && ctx.state!.plannedBuildings.length > 0; i++) {
    tickCommand(ctx, ['1'], {});
  }
}

function driveDrillPlanToCompletion(ctx: MiningContext, maxTicks = 200): void {
  for (let i = 0; i < maxTicks && ctx.state!.plannedDrillHoles.length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.fatigue = 100;
    }
    tickCommand(ctx, ['1'], {});
  }
}

function driveChargePlanToCompletion(ctx: MiningContext, maxTicks = 200): void {
  for (let i = 0; i < maxTicks && Object.keys(ctx.state!.plannedChargesByHole).length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.fatigue = 100;
    }
    tickCommand(ctx, ['1'], {});
  }
}

/** Wires GameRenderer the same way src/main.ts does: remesh only on terrain:updated, never on nav:occupancy_changed. */
function wireRenderer(ctx: MiningContext): GameRenderer {
  const sm = makeMockSceneManager();
  const renderer = new GameRenderer(sm as any);
  renderer.syncFromContext(ctx);
  ctx.emitter.on('terrain:updated', ({ region }) => renderer.remeshTerrainRegion(ctx, region));
  // Deliberately no subscription to nav:occupancy_changed — the renderer
  // never listens to it, mirroring src/main.ts exactly.
  return renderer;
}

describe('nav:occupancy_changed never triggers a terrain remesh (#1161)', () => {
  it('destroy patches the NavGrid but triggers zero additional remeshes', () => {
    const ctx = makeCtx();
    const renderer = wireRenderer(ctx);
    const spy = vi.spyOn(renderer, 'remeshTerrainRegion');

    buildCommand(ctx, ['management_office'], { at: '2,0' });
    tickUntilConstructionDone(ctx);

    const nav = ctx.state!.navGrid!;
    expect(nav.cells[0]![2]!.type).toBe('blocked');

    const callsAfterConstruction = spy.mock.calls.length;

    const buildingId = ctx.state!.buildings.buildings[0]!.id;
    const result = buildCommand(ctx, ['destroy', String(buildingId)], {});
    expect(result.success).toBe(true);

    // Destroy is occupancy-only (carves zero voxels) — must not add any
    // remesh calls beyond what construction already caused.
    expect(spy.mock.calls.length).toBe(callsAfterConstruction);

    // The NavGrid patch itself still happened — via nav:occupancy_changed,
    // not skipped — a regression guard against a false pass from destroy
    // simply not running.
    expect(nav.cells[0]![2]!.type).not.toBe('blocked');
    expect(nav.cells[0]![2]!.moveCost).not.toBe(Infinity);
  });

  it('a full blast sequence triggers exactly one remesh for its cleared region', () => {
    const ctx = makeCtx();
    const renderer = wireRenderer(ctx);
    const spy = vi.spyOn(renderer, 'remeshTerrainRegion');

    resetHoleIds();
    drillPlanCommand(ctx, ['add'], { x: '8', z: '8', depth: '18' });
    driveDrillPlanToCompletion(ctx);
    chargeCommand(ctx, [], { hole: 'H1', explosive: 'dynatomics', amount: '20kg', stemming: '1m' });
    driveChargePlanToCompletion(ctx);
    sequenceCommand(ctx, ['set'], { hole: 'H1', delay: '0ms' });

    const callsBeforeBlast = spy.mock.calls.length;

    const result = blastCommand(ctx, [], {});
    expect(result.success).toBe(true);

    // executeBlast's own carve remeshes once. The corrective post-clear
    // re-patch (today a second terrain:updated) must switch to
    // nav:occupancy_changed, so it must NOT add a second remesh.
    expect(spy.mock.calls.length - callsBeforeBlast).toBe(1);
  });
});
