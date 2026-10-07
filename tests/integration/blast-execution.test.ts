import { describe, it, expect, beforeEach } from 'vitest';
import { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { createGridPlan } from '../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../src/core/mining/ChargePlan.js';
import { assembleBlastPlan } from '../../src/core/mining/BlastPlan.js';
import { executeBlast } from '../../src/core/mining/BlastExecution.js';
import type { VillagePosition } from '../../src/core/mining/BlastExecution.js';
import { vec3 } from '../../src/core/math/Vec3.js';
import { t } from '../../src/core/i18n/I18n.js';
import { createRunner } from '../../src/console/createRunner.js';

const holeCounter = { nextHoleId: 1 };

// Helper: fill a region of the grid with a rock type
function fillRegion(
  grid: VoxelGrid,
  rock: string,
  minX: number, maxX: number,
  minY: number, maxY: number,
  minZ: number, maxZ: number,
  oreId?: string,
  oreDensity?: number,
) {
  for (let z = minZ; z <= maxZ; z++) {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const ores: Record<string, number> = {};
        if (oreId && oreDensity) ores[oreId] = oreDensity;
        grid.setVoxel(x, y, z, {
          composition: { rocks: [{ rockId: rock, coefficient: 1.0 }] },
          density: 1.0,
          oreDensities: ores,
          fractureModifier: 1.0,
        });
      }
    }
  }
}

const VILLAGE_FAR: VillagePosition[] = [
  { id: 'testville', position: vec3(200, 0, 200) },
];

beforeEach(() => { holeCounter.nextHoleId = 1; });

describe('Blast execution — integration', () => {
  it('well-designed plan on soft rock → fragments, good/perfect rating', () => {
    const grid = new VoxelGrid(40, 40);
    // Fill with molite (tier 2, threshold=500) — medium rock. Extends 10
    // voxels below the drilled holes so the charge has real bedrock underneath
    // rather than the open air the blast-zone box's own BLAST_ZONE_RADIUS
    // padding now reaches into with no vertical clamp (#1186) — a slab ending
    // exactly at the padding's depth reads as floating over void and breaks
    // apart more than a well-designed plan on ordinary confined rock should.
    fillRegion(grid, 'molite', 5, 25, -10, 10, 5, 25, 'blingite', 0.2);

    // Boomite 8kg (max): 340×8=2720E. Stemming 2m, depth 8: downward ≈ 2494E.
    // At hole pos (EPSILON=4): 2494/4 = 624. Ratio = 624/500 = 1.25 → good frag.
    // With neighbor contributions at midpoints, ratio ~1.5-2.5 → good to fine frag.
    const holes = createGridPlan(holeCounter, { x: 12, z: 12 }, 2, 3, 4, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 8, 2);
    const plan = assembleBlastPlan(holes, charges);

    const result = executeBlast(plan, grid, VILLAGE_FAR);
    expect(result).not.toBeNull();
    expect(result!.fragmentCount).toBeGreaterThan(0);
    expect(result!.clearedVoxels).toBeGreaterThan(0);
    expect(result!.rating).toMatch(/perfect|good/);
  });

  it('overcharged blast on soft rock → projections, bad/catastrophic rating', () => {
    const grid = new VoxelGrid(40, 40);
    fillRegion(grid, 'cruite', 5, 25, 0, 10, 5, 25);

    // Overcharge: dynatomics (1300 E/kg) × 25kg on soft cruite (threshold 200)
    const holes = createGridPlan(holeCounter, { x: 12, z: 12 }, 2, 3, 3, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'dynatomics', 14, 1);
    const plan = assembleBlastPlan(holes, charges);

    const result = executeBlast(plan, grid, VILLAGE_FAR);
    expect(result).not.toBeNull();
    expect(result!.projectionCount).toBeGreaterThan(0);
    expect(result!.rating).toMatch(/bad|catastrophic/);
  });

  it('undercharged blast on hard rock → mostly unaffected, bad rating', () => {
    const grid = new VoxelGrid(40, 40);
    // Fill with titanite (tier 5, threshold=4000)
    fillRegion(grid, 'titanite', 5, 25, 0, 10, 5, 25);

    // Undercharge: pop_rock (200 E/kg) × 2kg — way too weak
    const holes = createGridPlan(holeCounter, { x: 12, z: 12 }, 2, 3, 3, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'pop_rock', 2, 1);
    const plan = assembleBlastPlan(holes, charges);

    const result = executeBlast(plan, grid, VILLAGE_FAR);
    expect(result).not.toBeNull();
    // Very few or no cleared voxels since energy < threshold
    expect(result!.clearedVoxels).toBeLessThan(20);
    expect(result!.rating).toBe('bad');
  });

  it('terrain voxels are cleared after blast', () => {
    const grid = new VoxelGrid(30, 30);
    fillRegion(grid, 'cruite', 8, 20, 0, 8, 8, 20);

    // Verify voxels are solid before blast
    const beforeVoxel = grid.getVoxel(12, 2, 12);
    expect(beforeVoxel?.density).toBe(1.0);

    const holes = createGridPlan(holeCounter, { x: 12, z: 12 }, 2, 2, 3, 6, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 8, 1.5);
    const plan = assembleBlastPlan(holes, charges);

    const result = executeBlast(plan, grid, []);
    expect(result).not.toBeNull();
    expect(result!.clearedVoxels).toBeGreaterThan(0);

    // Count cleared voxels near the blast center
    let clearedCount = 0;
    for (let z = 10; z <= 14; z++) {
      for (let y = 0; y <= 4; y++) {
        for (let x = 10; x <= 14; x++) {
          const v = grid.getVoxel(x, y, z);
          if (v && v.density === 0) clearedCount++;
        }
      }
    }
    expect(clearedCount).toBeGreaterThan(0);
  });

  it('fragment ore densities match parent voxels', () => {
    const grid = new VoxelGrid(30, 30);
    fillRegion(grid, 'cruite', 8, 20, 0, 8, 8, 20, 'blingite', 0.5);

    const holes = createGridPlan(holeCounter, { x: 12, z: 12 }, 2, 2, 3, 6, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 5, 2);
    const plan = assembleBlastPlan(holes, charges);

    const result = executeBlast(plan, grid, []);
    expect(result).not.toBeNull();
    expect(result!.fragments.length).toBeGreaterThan(0);

    // All fragments from this blast should have blingite ore
    const withOre = result!.fragments.filter(f => (f.oreDensities['blingite'] ?? 0) > 0);
    expect(withOre.length).toBe(result!.fragments.length);
    expect(withOre[0]!.oreDensities['blingite']).toBe(0.5);
  });

  it('returns null for invalid blast plan', () => {
    const grid = new VoxelGrid(20, 20);
    const holes = createGridPlan(holeCounter, { x: 5, z: 5 }, 1, 1, 3, 6, 0.15);
    // No charges → invalid
    const plan = assembleBlastPlan(holes, {});
    const result = executeBlast(plan, grid, []);
    expect(result).toBeNull();
  });
});

// ── #553: a confirmed drill plan is not blastable until every hole has
// actually landed in state.drillHoles ──────────────────────────────────────
//
// The tests above operate on PlannedHole[] fed straight into
// assembleBlastPlan/executeBlast, bypassing state.drillHoles/
// plannedDrillHoles entirely — that pure pipeline doesn't know about the
// split (PlannedHole and DrillHole share a shape). blastCommand/
// blastPreviewCommand (console/commands/mining.ts), however, read only
// state.drillHoles, so these drive the console/state layer end to end to
// prove a plan still sitting in plannedDrillHoles is refused, and a fully
// drilled one blasts exactly as before.

describe('Blast execution — confirmed-but-undrilled holes are not blastable (#553)', () => {
  it('a confirmed plan whose holes are still ordered (plannedDrillHoles, not yet drilled) is refused by blast_preview, and state.drillHoles stays empty', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    expect(run('drill_plan grid rows:2 cols:2 spacing:5 depth:8 start:14,14').success).toBe(true);
    const state = ctx.state!;

    expect(state.plannedDrillHoles.length).toBeGreaterThan(0);
    expect(state.drillHoles).toHaveLength(0);

    const preview = run('blast_preview');
    expect(preview.success).toBe(false);
    expect(preview.output).toContain('No drill plan');
    expect(state.drillHoles).toHaveLength(0);
  });

  it('once every hole has landed (ticked to completion), blast executes exactly as before', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    expect(run('drill_plan grid rows:2 cols:3 spacing:4 depth:8 start:14,14').success).toBe(true);
    const state = ctx.state!;

    for (let i = 0; i < 800 && state.plannedDrillHoles.length > 0; i++) run('tick 1');
    expect(state.plannedDrillHoles).toHaveLength(0);
    expect(state.drillHoles.length).toBeGreaterThan(0);

    expect(run('charge hole:* explosive:boomite amount:8 stemming:2').success).toBe(true);

    // #554: charging is real work too — drain the ordered charges the same
    // way the drill plan above was drained before blasting.
    for (let i = 0; i < 800 && Object.keys(state.plannedChargesByHole).length > 0; i++) run('tick 1');
    expect(Object.keys(state.plannedChargesByHole)).toHaveLength(0);
    expect(Object.keys(state.chargesByHole).length).toBeGreaterThan(0);


    const result = run('blast');

    expect(result.success).toBe(true);
    expect(result.output).toContain('BLAST REPORT');
  });
});

// ── #554: a confirmed charge order is not blastable until it has actually
// loaded — chargesByHole, not plannedChargesByHole, is what blastCommand/
// validateBlastPlan reads ─────────────────────────────────────────────────

describe('Blast execution — outstanding (not yet landed) charge orders are not blastable (#554)', () => {
  it('a blast plan with an outstanding charge_hole order for a hole is refused, with a message distinguishing "still loading" from "missing", and chargesByHole for that hole stays empty', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    expect(run('drill_plan grid rows:1 cols:2 spacing:5 depth:8 start:14,14').success).toBe(true);
    const state = ctx.state!;

    for (let i = 0; i < 800 && state.plannedDrillHoles.length > 0; i++) run('tick 1');
    expect(state.drillHoles.length).toBeGreaterThan(0);

    // Order charges for every drilled hole but do NOT wait for them to land —
    // every hole should still be sitting in plannedChargesByHole.
    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
    expect(Object.keys(state.chargesByHole)).toHaveLength(0);
    expect(Object.keys(state.plannedChargesByHole).length).toBeGreaterThan(0);

    const result = run('blast');

    expect(result.success).toBe(false);
    expect(result.output.toLowerCase()).toContain('loading');
    expect(result.output.toLowerCase()).not.toContain('missing charge');
    expect(Object.keys(state.chargesByHole)).toHaveLength(0);
  });
});

// ── #1346: firing the blast cancels every still-ordered drill hole ───────────

describe('Blast execution — #1346', () => {
  /** Drill a 3x4 grid until >=3 holes have landed while others are still ordered, then charge only the landed ones. */
  function setupPartiallyDrilled() {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);
    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    expect(run('drill_plan grid rows:4 cols:6 spacing:3 depth:8 start:12,12').success).toBe(true);
    const state = ctx.state!;
    for (let i = 0; i < 2000 && state.drillHoles.length < 3; i++) run('tick 1');
    expect(state.drillHoles.length).toBeGreaterThanOrEqual(3);
    expect(state.plannedDrillHoles.length).toBeGreaterThan(0);
    // Keep ordering charges for each newly landed hole until every landed hole
    // is charged while others are still ordered (the drill crew keeps working).
    const ordered = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      for (const h of state.drillHoles) {
        if (ordered.has(h.id)) continue;
        state.cash = Math.max(state.cash, 100000); // slower scaled drilling accrues wages; keep charge orders affordable
        expect(run(`charge hole:${h.id} explosive:boomite amount:8 stemming:2`).success).toBe(true);
        ordered.add(h.id);
      }
      if (state.plannedDrillHoles.length === 0) break;
      if (state.drillHoles.every(h => state.chargesByHole[h.id])) break;
      run('tick 1');
    }
    const ids = state.drillHoles.map(h => h.id);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(ids.every(id => state.chargesByHole[id])).toBe(true);
    expect(state.plannedDrillHoles.length).toBeGreaterThan(0);
    return { run, state, ids };
  }

  it('a successful blast cancels all pending drill_hole actions and empties plannedDrillHoles', () => {
    const { run, state } = setupPartiallyDrilled();
    const orderedBefore = state.plannedDrillHoles.length;
    expect(orderedBefore).toBeGreaterThan(0);
    expect(state.pendingActions.some(a => a.type === 'drill_hole')).toBe(true);
    // Only the charged, drilled holes may be in the plan at fire time.
    for (const h of state.drillHoles) expect(state.chargesByHole[h.id]).toBeDefined();

    const result = run('blast');

    expect(result.success).toBe(true);
    expect(state.pendingActions.filter(a => a.type === 'drill_hole')).toHaveLength(0);
    expect(state.plannedDrillHoles).toHaveLength(0);
    expect(result.output).toContain(t('mining.blast.cancelled_drill_orders', { count: orderedBefore }));
  });

  it('no new hole is drilled after the blast, however long the crew keeps ticking', () => {
    const { run, state } = setupPartiallyDrilled();
    expect(run('blast').success).toBe(true);
    const drilledAfterBlast = state.drillHoles.length;
    for (let i = 0; i < 600; i++) run('tick 1');
    expect(state.drillHoles).toHaveLength(drilledAfterBlast);
    expect(state.plannedDrillHoles).toHaveLength(0);
    expect(state.pendingActions.filter(a => a.type === 'drill_hole')).toHaveLength(0);
  });

  it('a refused blast (charges still loading) cancels nothing', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);
    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    expect(run('drill_plan grid rows:4 cols:6 spacing:3 depth:8 start:12,12').success).toBe(true);
    const state = ctx.state!;
    for (let i = 0; i < 2000 && state.drillHoles.length < 2; i++) run('tick 1');
    expect(state.plannedDrillHoles.length).toBeGreaterThan(0);
    const id = state.drillHoles[0]!.id;
    expect(run(`charge hole:${id} explosive:boomite amount:8 stemming:2`).success).toBe(true);
    const pendingDrills = state.pendingActions.filter(a => a.type === 'drill_hole').length;
    const planned = state.plannedDrillHoles.length;

    const result = run('blast');

    expect(result.success).toBe(false);
    expect(state.pendingActions.filter(a => a.type === 'drill_hole')).toHaveLength(pendingDrills);
    expect(state.plannedDrillHoles).toHaveLength(planned);
  });

  it('a refused blast (invalid plan: drilled hole without a charge) cancels nothing', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);
    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    expect(run('drill_plan grid rows:4 cols:6 spacing:3 depth:8 start:12,12').success).toBe(true);
    const state = ctx.state!;
    for (let i = 0; i < 2000 && state.drillHoles.length < 1; i++) run('tick 1');
    expect(state.drillHoles.length).toBeGreaterThan(0);
    const planned = state.plannedDrillHoles.length;
    expect(planned).toBeGreaterThan(0);
    const pendingDrills = state.pendingActions.filter(a => a.type === 'drill_hole').length;

    const result = run('blast');

    expect(result.success).toBe(false);
    expect(state.plannedDrillHoles).toHaveLength(planned);
    expect(state.pendingActions.filter(a => a.type === 'drill_hole')).toHaveLength(pendingDrills);
  });

  it('a fully drilled pattern blasts with no cancel line', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);
    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    expect(run('drill_plan grid rows:1 cols:2 spacing:5 depth:8 start:14,14').success).toBe(true);
    const state = ctx.state!;
    for (let i = 0; i < 2000 && state.plannedDrillHoles.length > 0; i++) run('tick 1');
    expect(run('charge hole:* explosive:boomite amount:8 stemming:2').success).toBe(true);
    for (let i = 0; i < 2000 && Object.keys(state.plannedChargesByHole).length > 0; i++) run('tick 1');

    const result = run('blast');

    expect(result.success).toBe(true);
    // No drill orders outstanding: neither the raw key nor the localized line may appear.
    expect(result.output).not.toContain('cancelled_drill_orders');
    expect(result.output).not.toContain(t('mining.blast.cancelled_drill_orders', { count: 0 }));
  });
});
