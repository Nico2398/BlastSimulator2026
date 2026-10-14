import { describe, it, expect, beforeEach } from 'vitest';
import { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { createGridPlan } from '../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../src/core/mining/ChargePlan.js';
import { assembleBlastPlan } from '../../src/core/mining/BlastPlan.js';
import { executeBlast } from '../../src/core/mining/BlastExecution.js';
import type { VillagePosition } from '../../src/core/mining/BlastExecution.js';
import { vec3 } from '../../src/core/math/Vec3.js';
import { t } from '../../src/core/i18n/I18n.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { createRunner, runCommand } from '../../src/console/createRunner.js';
import { purchaseVehicle } from '../../src/core/entities/Vehicle.js';
import { tickUntilFresh } from '../helpers/blastFixtures.js';
import { buildPlanEnergyField } from '../../src/core/mining/BlastExecution.js';
import { identifyFragmentedVoxels } from '../../src/core/mining/VoxelFragmentation.js';
import { getSmoothTerrainSurfaceY } from '../../src/core/world/VoxelGrid.js';
import {
  NAV_MAX_SLOPE_RATIO,
  DRILL_GRID_DEFAULT_SPACING_M, DRILL_GRID_DEFAULT_DEPTH_M,
  CHARGE_DEFAULT_AMOUNT_KG, CHARGE_DEFAULT_STEMMING_M,
} from '../../src/core/config/balance.js';
import { buildBlastReport } from '../../src/core/mining/BlastExecution.js';

/** tickUntilFresh that also keeps payroll from bankrupting the run: charging is worked from a truck by one crew member (#1649), so a charge pass spans far more payroll ticks than the starting cash covers. */
function tickFunded(run: (cmd: string) => unknown, state: GameState, predicate: () => boolean, maxTicks: number): void {
  tickUntilFresh(run, state, () => { state.cash = Math.max(state.cash, 100000); return predicate(); }, maxTicks);
}

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
    tickFunded(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, 800);
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
  /**
   * Drill and charge a 1x3 pattern completely, then order a second pattern that
   * is still pending at fire time. Charging is worked from a truck by one crew
   * member (#1649) and is slower than drilling, so the pending orders are placed
   * after the charges landed rather than racing the drill crew.
   */
  function setupPartiallyDrilled() {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);
    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    expect(run('drill_plan grid rows:1 cols:3 spacing:3 depth:8 start:12,12').success).toBe(true);
    const state = ctx.state!;
    tickFunded(run, state, () => state.plannedDrillHoles.length === 0, 2000);
    expect(state.drillHoles.length).toBeGreaterThanOrEqual(3);
    expect(run('charge hole:* explosive:boomite amount:8 stemming:2').success).toBe(true);
    tickFunded(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, 3000);
    for (const x of [12, 15, 18]) expect(run(`drill_plan add x:${x} z:20 depth:8`).success).toBe(true);
    expect(state.plannedDrillHoles.length).toBeGreaterThan(0);
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
    expect(run('drill_plan grid rows:1 cols:2 spacing:4 depth:8 start:14,14').success).toBe(true);
    const state = ctx.state!;
    tickFunded(run, state, () => state.plannedDrillHoles.length === 0, 2000);
    expect(run('charge hole:* explosive:boomite amount:8 stemming:2').success).toBe(true);
    tickFunded(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, 2000);

    const result = run('blast');

    expect(result.success).toBe(true);
    // No drill orders outstanding: neither the raw key nor the localized line may appear.
    expect(result.output).not.toContain('cancelled_drill_orders');
    expect(result.output).not.toContain(t('mining.blast.cancelled_drill_orders', { count: 0 }));
  });
});

// ── #1362: DETONATE arms an evacuation sequence that fires once the zone is clear ──

describe('Blast execution — DETONATE flow (#1362)', () => {
  const SAFE_XZ = 44; // well outside the 3x3/spacing:3 pattern's padded danger zone

  /** Staffed game with a drilled and fully charged 3x3 pattern, nobody yet moved. */
  function setupCharged() {
    const engine = createRunner();
    const { runner, ctx } = engine;
    const run = (cmd: string) => runner.run(cmd);
    expect(run('new_game seed:42 size:48 mine_type:desert staffed:true').success).toBe(true);
    expect(run('drill_plan grid rows:3 cols:3 spacing:3 depth:8 start:15,15').success).toBe(true);
    const state = () => ctx.state!;
    const topUp = () => { state().cash = Math.max(state().cash, 100000); for (const e of state().employees.employees) e.fatigue = 100; };
    for (let i = 0; i < 600 && state().plannedDrillHoles.length > 0; i++) { topUp(); run('tick 1'); }
    expect(run('charge hole:* explosive:boomite amount:8 stemming:2').success).toBe(true);
    for (let i = 0; i < 2000 && Object.keys(state().plannedChargesByHole).length > 0; i++) { topUp(); run('tick 1'); }
    expect(state().drillHoles.length).toBeGreaterThan(0);
    expect(Object.keys(state().plannedChargesByHole)).toHaveLength(0);
    return { run, ctx, state, topUp, engine };
  }

  type Setup = ReturnType<typeof setupCharged>;

  /** Put every employee at (x,z) and every vehicle at the safe corner. */
  function crewAt(s: Setup, x: number, z: number): void {
    for (const e of s.state().employees.employees) { e.x = x; e.z = z; e.destinationX = null; e.destinationZ = null; }
    for (const v of s.state().vehicles.vehicles) { v.x = SAFE_XZ; v.z = SAFE_XZ; }
  }

  function crewClear(s: Setup): void { crewAt(s, SAFE_XZ, SAFE_XZ); }

  /** Tick one at a time until a blast has been recorded (or the cap hits). */
  function tickUntilBlast(s: Setup, cap = 400): number {
    let n = 0;
    while (n < cap && s.state().damage.blastCount === 0) { s.topUp(); s.run('tick 1'); n++; }
    return n;
  }

  it('occupied zone: detonate does not fire on its own call, then auto-fires once clear with zero casualties', () => {
    const s = setupCharged();
    crewAt(s, 16, 16);
    const staff = s.state().employees.employees.filter(e => e.alive).length;
    expect(staff).toBeGreaterThan(0);

    const res = s.run('blast detonate');

    expect(res.success, res.output).toBe(true);
    expect(s.state().damage.blastCount).toBe(0);
    expect(s.state().damage.deathCount).toBe(0);
    expect(s.state().pendingDetonation).not.toBeNull();

    tickUntilBlast(s);

    expect(s.state().damage.blastCount).toBe(1);
    expect(s.state().pendingDetonation).toBeNull();
    expect(s.state().lastBlastReport).not.toBeNull();
    expect(s.state().damage.deathCount).toBe(0);
    expect(s.state().employees.employees.filter(e => e.alive)).toHaveLength(staff);
  });

  it('fires exactly once and stops the tick batch at the firing tick', () => {
    const s = setupCharged();
    crewAt(s, 16, 16);
    s.run('blast detonate');
    const startTick = s.state().tickCount;
    for (const e of s.state().employees.employees) e.fatigue = 100;

    const out = s.run('tick 300');

    expect(out.success).toBe(true);
    expect(s.state().damage.blastCount).toBe(1);
    expect(s.state().tickCount - startTick).toBeLessThan(300);
    s.run('tick 20');
    expect(s.state().damage.blastCount).toBe(1);
  });

  // ── Sliced detonation (#1603): the browser resolves a blast over frames ──

  /** Tick until the armed shot fires (sync) or starts resolving (sliced). */
  function tickUntilFired(s: Setup, cap = 400): void {
    for (let n = 0; n < cap && s.state().damage.blastCount === 0 && !s.ctx.blastJob; n++) { s.topUp(); s.run('tick 1'); }
  }

  /** Everything a blast decides, for comparing two runs of the same shot. */
  const blastOutcome = (s: Setup) => JSON.stringify({
    tick: s.state().tickCount,
    report: s.state().lastBlastReport,
    fragments: s.state().logistics.fragments.map(f => [f.fragment.id, f.fragment.position, f.fragment.mass]),
    flights: s.ctx.lastBlastFlights,
    holes: s.state().drillHoles.length,
    alive: s.state().employees.employees.filter(e => e.alive).length,
  });

  it('a sliced auto-fire holds the game, then lands exactly what the synchronous fire does', () => {
    const sync = setupCharged();
    crewAt(sync, 16, 16);
    sync.run('blast detonate');
    tickUntilFired(sync);
    expect(sync.state().damage.blastCount).toBe(1);

    const sliced = setupCharged();
    sliced.ctx.sliceBlasts = true;
    crewAt(sliced, 16, 16);
    sliced.run('blast detonate');
    tickUntilFired(sliced);
    const job = sliced.ctx.blastJob!;
    expect(job).toBeTruthy();
    // Started, not landed: the rock is still standing and the holes still loaded.
    expect(sliced.state().damage.blastCount).toBe(0);
    expect(sliced.state().drillHoles.length).toBeGreaterThan(0);

    let steps = 0;
    let next = job.next();
    while (next.done !== true) { steps++; next = job.next(); }
    expect(steps).toBeGreaterThan(10); // genuinely spread out, not one slice
    expect(next.value.success, next.value.output).toBe(true);
    expect(next.value.output).toContain('BLAST REPORT');
    sliced.ctx.blastJob = null;

    expect(blastOutcome(sliced)).toBe(blastOutcome(sync));
  });

  it('a command arriving while a sliced blast resolves lands the blast first', () => {
    const s = setupCharged();
    s.ctx.sliceBlasts = true;
    crewClear(s);

    const res = s.run('blast detonate'); // already clear: starts resolving at once
    expect(res.success, res.output).toBe(true);
    expect(s.ctx.blastJob).toBeTruthy();
    expect(s.state().damage.blastCount).toBe(0);
    const tick = s.state().tickCount;

    expect(runCommand(s.engine, 'tick 1').success).toBe(true);

    expect(s.ctx.blastJob).toBeNull();
    expect(s.state().damage.blastCount).toBe(1);
    expect(s.state().lastBlastReport?.tick).toBe(tick);
    expect(s.state().tickCount).toBe(tick + 1);
  });

  it('already-clear zone: detonate fires immediately in that call', () => {
    const s = setupCharged();
    crewClear(s);

    const res = s.run('blast detonate');

    expect(res.success, res.output).toBe(true);
    expect(s.state().damage.blastCount).toBe(1);
    expect(s.state().pendingDetonation).toBeNull();
    expect(s.state().lastBlastReport).not.toBeNull();
    expect(s.state().damage.deathCount).toBe(0);
  });

  it('cancel clears the armed detonation and nothing ever fires', () => {
    const s = setupCharged();
    crewAt(s, 16, 16);
    expect(s.run('blast detonate').success).toBe(true);
    expect(s.state().pendingDetonation).not.toBeNull();

    const res = s.run('blast cancel');

    expect(res.success, res.output).toBe(true);
    expect(s.state().pendingDetonation).toBeNull();
    for (let i = 0; i < 120; i++) { s.topUp(); s.run('tick 1'); }
    expect(s.state().damage.blastCount).toBe(0);
    expect(s.state().drillHoles.length).toBeGreaterThan(0);
  });

  it('cancel with nothing armed is harmless and leaves the pattern loaded', () => {
    const s = setupCharged();
    s.run('blast cancel');
    expect(s.state().pendingDetonation).toBeNull();
    expect(s.state().damage.blastCount).toBe(0);
  });

  it('fire anyway (plain blast) on an occupied zone fires at once with casualties and clears the armed record', () => {
    const s = setupCharged();
    const hole = s.state().drillHoles[0]!;
    crewAt(s, hole.x, hole.z);
    expect(s.run('blast detonate').success).toBe(true);
    expect(s.state().pendingDetonation).not.toBeNull();

    const res = s.run('blast');

    expect(res.success, res.output).toBe(true);
    expect(s.state().damage.blastCount).toBe(1);
    expect(s.state().pendingDetonation).toBeNull();
    expect(s.state().damage.deathCount).toBeGreaterThan(0);
  });

  it('fire anyway without ever arming still fires immediately (legacy path)', () => {
    const s = setupCharged();
    const hole = s.state().drillHoles[0]!;
    crewAt(s, hole.x, hole.z);
    const res = s.run('blast');
    expect(res.success, res.output).toBe(true);
    expect(s.state().damage.blastCount).toBe(1);
    expect(s.state().damage.deathCount).toBeGreaterThan(0);
  });

  it('after fire anyway nothing fires a second time', () => {
    const s = setupCharged();
    crewAt(s, 16, 16);
    s.run('blast detonate');
    s.run('blast');
    for (let i = 0; i < 100; i++) s.run('tick 1');
    expect(s.state().damage.blastCount).toBe(1);
  });

  it('a stranded occupant blocks the auto-fire, is named in blast status, and Fire anyway still works', () => {
    const s = setupCharged();
    crewClear(s);
    const { vehicle } = purchaseVehicle(s.state().vehicles, 'rock_digger', 16, 16);
    vehicle.occupantIds = []; // driverless: cannot drive itself out
    const typeName = t(`vehicle_type.${vehicle.type}`);

    const res = s.run('blast detonate');
    expect(res.success, res.output).toBe(true);
    expect(s.state().damage.blastCount).toBe(0);

    for (let i = 0; i < 200; i++) { s.topUp(); s.run('tick 1'); }
    expect(s.state().damage.blastCount).toBe(0);
    expect(s.state().pendingDetonation).not.toBeNull();

    const status = s.run('blast status');
    expect(status.success).toBe(true);
    expect(status.output).toContain(typeName);

    const fired = s.run('blast');
    expect(fired.success, fired.output).toBe(true);
    expect(s.state().damage.blastCount).toBe(1);
    expect(s.state().pendingDetonation).toBeNull();
  });

  it('a stranded occupant can be cancelled instead', () => {
    const s = setupCharged();
    crewClear(s);
    const { vehicle } = purchaseVehicle(s.state().vehicles, 'rock_digger', 16, 16);
    vehicle.occupantIds = [];
    s.run('blast detonate');
    expect(s.run('blast cancel').success).toBe(true);
    for (let i = 0; i < 50; i++) s.run('tick 1');
    expect(s.state().damage.blastCount).toBe(0);
    expect(s.state().pendingDetonation).toBeNull();
  });

  it('blast status reports without firing or changing state, armed or not', () => {
    const s = setupCharged();
    crewAt(s, 16, 16);
    const idle = s.run('blast status');
    expect(idle.success).toBe(true);
    expect(idle.output.length).toBeGreaterThan(0);
    s.run('blast detonate');
    const armedTick = s.state().pendingDetonation!.armedTick;
    const armed = s.run('blast status');
    expect(armed.success).toBe(true);
    expect(armed.output).not.toBe(idle.output);
    expect(s.state().damage.blastCount).toBe(0);
    expect(s.state().pendingDetonation!.armedTick).toBe(armedTick);
  });

  it('save/load mid-sequence keeps the detonation armed and it still fires once clear', () => {
    const s = setupCharged();
    crewAt(s, 16, 16);
    expect(s.run('blast detonate').success).toBe(true);
    for (let i = 0; i < 2; i++) { s.topUp(); s.run('tick 1'); }
    expect(s.state().damage.blastCount).toBe(0);
    const armedTick = s.state().pendingDetonation!.armedTick;
    expect(s.run('save slot:detonate-1362').success).toBe(true);

    expect(s.run('load slot:detonate-1362').success).toBe(true);

    expect(s.state().pendingDetonation).not.toBeNull();
    expect(s.state().pendingDetonation!.armedTick).toBe(armedTick);
    tickUntilBlast(s);
    expect(s.state().damage.blastCount).toBe(1);
    expect(s.state().pendingDetonation).toBeNull();
    expect(s.state().damage.deathCount).toBe(0);
  });

  it('no occupied-zone refusal: plain blast fires on an occupied zone', () => {
    const s = setupCharged();
    crewAt(s, 16, 16);

    const res = s.run('blast');

    expect(res.success, res.output).toBe(true);
    expect(s.state().damage.blastCount).toBe(1);
  });

  it('no occupied-zone refusal: detonate arms the sequence on an occupied zone', () => {
    const s = setupCharged();
    crewAt(s, 16, 16);

    const res = s.run('blast detonate');

    expect(res.success, res.output).toBe(true);
    expect(s.state().pendingDetonation).not.toBeNull();
    tickUntilBlast(s);
    expect(s.state().damage.blastCount).toBe(1);
    expect(s.state().damage.deathCount).toBe(0);
  });

  it('a refused fire (charge still loading) leaves the armed detonation armed', () => {
    const s = setupCharged();
    crewAt(s, 16, 16);
    expect(s.run('blast detonate').success).toBe(true);
    const armed = s.state().pendingDetonation;
    const holeId = s.state().drillHoles[0]!.id;
    const landed = s.state().chargesByHole[holeId]!;
    delete s.state().chargesByHole[holeId];
    s.state().plannedChargesByHole[holeId] = landed;

    const res = s.run('blast');

    expect(res.success).toBe(false);
    expect(s.state().pendingDetonation).toBe(armed);
    expect(s.state().damage.blastCount).toBe(0);
  });

  it('an unknown blast subcommand is refused and fires nothing', () => {
    const s = setupCharged();
    crewClear(s);

    const res = s.run('blast detonat');

    expect(res.success).toBe(false);
    expect(s.state().damage.blastCount).toBe(0);
    expect(s.state().drillHoles.length).toBeGreaterThan(0);
  });

  it('a second detonate while armed is refused and leaves the armed record untouched', () => {
    const s = setupCharged();
    crewAt(s, 16, 16);
    expect(s.run('blast detonate').success).toBe(true);
    const armed = s.state().pendingDetonation;

    const again = s.run('blast detonate');

    expect(again.success).toBe(false);
    expect(again.output.length).toBeGreaterThan(0);
    expect(s.state().pendingDetonation).toBe(armed);
    expect(s.state().damage.blastCount).toBe(0);
  });

  it('detonate with no holes is refused and leaves pendingDetonation null', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game seed:42 size:32 staffed:true').success).toBe(true);

    const res = runner.run('blast detonate');

    expect(res.success).toBe(false);
    expect(res.output.length).toBeGreaterThan(0);
    expect(ctx.state!.pendingDetonation).toBeNull();
  });

  it('detonate with drilled but uncharged holes is refused, nothing armed', () => {
    const { runner, ctx } = createRunner();
    const run = (c: string) => runner.run(c);
    expect(run('new_game seed:42 size:48 staffed:true').success).toBe(true);
    expect(run('drill_plan grid rows:1 cols:2 spacing:5 depth:8 start:14,14').success).toBe(true);
    for (let i = 0; i < 600 && ctx.state!.plannedDrillHoles.length > 0; i++) {
      for (const e of ctx.state!.employees.employees) e.fatigue = 100;
      run('tick 1');
    }

    const res = run('blast detonate');

    expect(res.success).toBe(false);
    expect(ctx.state!.pendingDetonation).toBeNull();
  });
});

// ── #1723: a blast breaks its floor down to grade, so the crater is drivable ──

/** Sandbox desert_badlands seed 42, a 3x3 spacing-S 8 m grid at (28,18), krackle `kg` kg, stemming 2.5 — the issue's measured pattern. */
function sandboxCraterBlast(kg: number, spacing: number) {
  const { runner, ctx } = createRunner();
  expect(runner.run('sandbox start biome:desert_badlands difficulty:normal seed:42').success).toBe(true);
  const grid = ctx.grid!;
  const counter = { nextHoleId: 1 };
  const holes = createGridPlan(counter, { x: 28, z: 18 }, 3, 3, spacing, 8, 0.15);
  const depths: Record<string, number> = {};
  for (const h of holes) depths[h.id] = h.depth;
  const { charges } = batchCharge(holes.map(h => h.id), depths, 'krackle', kg, 2.5);
  const plan = assembleBlastPlan(holes, charges);

  const before = new Map<string, number>();
  for (let z = 10; z < 40; z++) for (let x = 18; x < 50; x++) before.set(`${x},${z}`, getSmoothTerrainSurfaceY(grid, x, z));
  const field = buildPlanEnergyField(plan, grid);
  const estimatedBroken = field ? identifyFragmentedVoxels(field, grid, false).fragmented.length : 0;
  const result = executeBlast(plan, grid, []);
  expect(result, 'blast plan was rejected').not.toBeNull();

  const crater: Array<{ x: number; z: number }> = [];
  for (const [key, h0] of before) {
    const [x, z] = key.split(',').map(Number) as [number, number];
    if (h0 - getSmoothTerrainSurfaceY(grid, x, z) > 0.5) crater.push({ x, z });
  }
  return { grid, result: result!, crater, estimatedBroken };
}

/** Size of the largest group of `crater` columns joined (8-neighbour) by steps within the slope limit on the smooth surface. */
function largestDrivablePatch(grid: VoxelGrid, crater: Array<{ x: number; z: number }>): number {
  const key = (x: number, z: number) => `${x},${z}`;
  const cols = new Set(crater.map(c => key(c.x, c.z)));
  const seen = new Set<string>();
  let best = 0;
  for (const start of crater) {
    if (seen.has(key(start.x, start.z))) continue;
    let size = 0;
    const stack = [start];
    seen.add(key(start.x, start.z));
    while (stack.length > 0) {
      const c = stack.pop()!;
      size++;
      const h = getSmoothTerrainSurfaceY(grid, c.x, c.z);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = c.x + dx, nz = c.z + dz;
        const k = key(nx, nz);
        if (!cols.has(k) || seen.has(k)) continue;
        const run = Math.hypot(dx, dz);
        if (Math.abs(getSmoothTerrainSurfaceY(grid, nx, nz) - h) / run > NAV_MAX_SLOPE_RATIO) continue;
        seen.add(k);
        stack.push({ x: nx, z: nz });
      }
    }
    best = Math.max(best, size);
  }
  return best;
}

describe('Blast execution — floor broken to grade (#1723)', () => {
  // 6 kg at spacing 4 is not covered: it leaves nine separate pits with intact
  // rock between the holes (issue #1723's table), so no grade makes them one
  // drivable patch. The measured patterns are 8 kg and 10 kg.
  for (const kg of [8, 10]) {
    it(`krackle ${kg} kg, spacing 4: at least 80% of the crater's columns are one slope-connected patch`, () => {
      const { grid, crater } = sandboxCraterBlast(kg, 4);
      expect(crater.length).toBeGreaterThan(20);
      expect(largestDrivablePatch(grid, crater) / crater.length).toBeGreaterThanOrEqual(0.8);
    });
  }

  it('krackle 8 kg: the pre-blast estimate breaks exactly the voxels the blast clears', () => {
    const { result, estimatedBroken } = sandboxCraterBlast(8, 4);
    expect(estimatedBroken).toBeGreaterThan(0);
    expect(estimatedBroken).toBe(result.clearedVoxels);
  });

  it('krackle 8 kg: the fragments carry every cleared voxel (volume conserved)', () => {
    const { result } = sandboxCraterBlast(8, 4);
    const volume = result.fragments.reduce((sum, f) => sum + f.volume, 0);
    expect(volume).toBeCloseTo(result.clearedVoxels, 0);
  });
});

describe('Blast execution — haulers keep hauling reachable debris past a crater (#1722)', () => {
  it('desert_badlands easy: while a reachable haul order is queued the truck driver is not left idle, and reachable orders drain', () => {
    const engine = createRunner();
    const { runner, ctx } = engine;
    const run = (cmd: string) => runner.run(cmd);
    const state = () => ctx.state!;
    expect(run('sandbox start biome:desert_badlands difficulty:easy seed:42').success).toBe(true);

    expect(run('drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:28,18').success).toBe(true);
    tickFunded(run, state(), () => state().plannedDrillHoles.length === 0 && state().drillHoles.length >= 9, 1500);
    expect(state().drillHoles.length).toBeGreaterThanOrEqual(9);
    expect(run('charge hole:* explosive:krackle amount:8 stemming:2.5').success).toBe(true);
    tickFunded(run, state(), () => Object.keys(state().plannedChargesByHole).length === 0, 2500);
    expect(Object.keys(state().plannedChargesByHole)).toHaveLength(0);

    expect(run('blast detonate').success).toBe(true);
    tickFunded(run, state(), () => state().damage.blastCount > 0, 600);
    expect(state().damage.blastCount).toBe(1);
    // The fragments' haul orders are queued by the dispatcher a tick or so after the shot.
    tickFunded(run, state(), () => state().pendingActions.filter(a => a.type === 'haul_debris').length > 0, 20);
    expect(state().pendingActions.filter(a => a.type === 'haul_debris').length).toBeGreaterThan(128);

    const isTruckDriver = (e: { alive: boolean; qualifications: { category: string }[] }) =>
      e.alive && e.qualifications.some(q => q.category === 'driving.truck');
    const reachableQueued = () => state().pendingActions.filter(a =>
      a.type === 'haul_debris' && a.status === 'queued' && a.holderId === null && !a.blockedReason).length;

    const WINDOW = 400;
    const start = state().tickCount;
    let idleWhileReachable = 0;
    let midpointQueued = -1;
    for (let i = 0; i < WINDOW; i++) {
      state().cash = Math.max(state().cash, 100000);
      for (const e of state().employees.employees) e.fatigue = 100;
      run('tick 1');
      if (i === 150) midpointQueued = reachableQueued();
      if (reachableQueued() === 0) continue;
      const drivers = state().employees.employees.filter(isTruckDriver);
      expect(drivers.length).toBeGreaterThan(0);
      // Some truck driver is working (or walking to work), not idle with reachable rock waiting.
      if (drivers.every(e => e.activeActionId === null && e.restTicksRemaining === null)) idleWhileReachable++;
    }
    expect(state().tickCount - start).toBe(WINDOW);

    // Before the fix the crew idled for ~250 of the 400 ticks with reachable orders still queued.
    expect(idleWhileReachable).toBeLessThan(WINDOW / 10);
    // Reachable orders left at the midpoint keep draining afterwards (stranded ones carry a blockedReason and are not counted).
    if (midpointQueued > 0) expect(reachableQueued()).toBeLessThan(midpointQueued);
  }, 240_000);
});

// ── #1724: a charge too deep to break out keeps its rock in the ground ──────

/** Smooth surface height of every column in the box, keyed "x,z". */
function surfaceSnapshot(grid: VoxelGrid, x0: number, x1: number, z0: number, z1: number): Map<string, number> {
  const out = new Map<string, number>();
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) out.set(`${x},${z}`, getSmoothTerrainSurfaceY(grid, x, z));
  return out;
}

/** Columns whose smooth surface dropped by more than 0.5 m since `before`. */
function loweredColumns(grid: VoxelGrid, before: Map<string, number>): string[] {
  const lowered: string[] = [];
  for (const [key, h0] of before) {
    const [x, z] = key.split(',').map(Number) as [number, number];
    if (h0 - getSmoothTerrainSurfaceY(grid, x, z) > 0.5) lowered.push(key);
  }
  return lowered;
}

/** Sandbox desert_badlands seed 42 flat pad: a 3x3 krackle pattern at (28,18). */
function sandboxBlast(spacing: number, depth: number, kg: number, stemming: number) {
  const { runner, ctx } = createRunner();
  expect(runner.run('sandbox start biome:desert_badlands difficulty:normal seed:42').success).toBe(true);
  const grid = ctx.grid!;
  const holes = createGridPlan({ nextHoleId: 1 }, { x: 28, z: 18 }, 3, 3, spacing, depth, 0.15);
  const depths: Record<string, number> = {};
  for (const h of holes) depths[h.id] = h.depth;
  const { charges } = batchCharge(holes.map(h => h.id), depths, 'krackle', kg, stemming);
  const plan = assembleBlastPlan(holes, charges);
  const before = surfaceSnapshot(grid, 18, 50, 10, 40);
  const result = executeBlast(plan, grid, []);
  expect(result, 'blast plan was rejected').not.toBeNull();
  return { grid, result: result!, before };
}

describe('Blast execution — a charge too deep to break out (#1724)', () => {
  it('the measured 4 kg pattern does not break out: rock is broken but no column drops', () => {
    const { grid, result, before } = sandboxBlast(4, 8, 4, 2.5);
    expect(result.clearedVoxels).toBeGreaterThan(0);
    expect(result.brokeOut).toBe(false);
    expect(loweredColumns(grid, before)).toHaveLength(0);
  });

  it('the measured 4 kg pattern leaves no fragment resting above the pre-blast surface of its column', () => {
    const { result, before } = sandboxBlast(4, 8, 4, 2.5);
    expect(result.flights.length).toBeGreaterThan(0);
    for (const fl of result.flights) {
      const surface = before.get(`${Math.floor(fl.to.x)},${Math.floor(fl.to.z)}`);
      if (surface === undefined) continue;
      expect(fl.to.y, `fragment ${fl.fragmentId} came to rest on top of intact ground`).toBeLessThanOrEqual(surface);
    }
  });

  it('the measured 4 kg pattern throws nothing: every flight is a drop', () => {
    const { result } = sandboxBlast(4, 8, 4, 2.5);
    expect(result.flights.some(f => f.thrown)).toBe(false);
  });

  it('the measured 4 kg pattern reports the failure: cap no_breakout, rating no better than bad', () => {
    const { result } = sandboxBlast(4, 8, 4, 2.5);
    const report = buildBlastReport(result, 0, 0);
    expect(report.ratingCap).toBe('no_breakout');
    expect(['bad', 'catastrophic']).toContain(report.rating);
    expect(report.brokeOut).toBe(false);
  });

  it('a pattern that opens a crater (krackle 8 kg) breaks out and is not capped for it', () => {
    const { grid, result, before } = sandboxBlast(4, 8, 8, 2.5);
    expect(result.brokeOut).toBe(true);
    expect(loweredColumns(grid, before).length).toBeGreaterThan(0);
    expect(buildBlastReport(result, 0, 0).ratingCap).not.toBe('no_breakout');
  });

  it('the default plan (grid, charge and stemming defaults) breaks out on the sandbox flat pad and lowers the surface', () => {
    const { grid, result, before } = sandboxBlast(
      DRILL_GRID_DEFAULT_SPACING_M, DRILL_GRID_DEFAULT_DEPTH_M, CHARGE_DEFAULT_AMOUNT_KG, CHARGE_DEFAULT_STEMMING_M,
    );
    expect(result.clearedVoxels).toBeGreaterThan(0);
    expect(result.brokeOut).toBe(true);
    // A crater, not a couple of edge columns: at least one lowered column per hole.
    expect(loweredColumns(grid, before).length).toBeGreaterThanOrEqual(9);
    expect(buildBlastReport(result, 0, 0).ratingCap).not.toBe('no_breakout');
  });

  it('the default plan carries every cleared voxel in a fragment (volume conserved) and opens a crater', () => {
    const { grid, result, before } = sandboxBlast(
      DRILL_GRID_DEFAULT_SPACING_M, DRILL_GRID_DEFAULT_DEPTH_M, CHARGE_DEFAULT_AMOUNT_KG, CHARGE_DEFAULT_STEMMING_M,
    );
    expect(loweredColumns(grid, before).length).toBeGreaterThanOrEqual(9);
    // Volume is conserved: every cleared voxel is carried by a fragment.
    const volume = result.fragments.reduce((sum, f) => sum + f.volume, 0);
    expect(volume).toBeCloseTo(result.clearedVoxels, 0);
  });
});

describe('Blast execution — the tutorial plan opens the box cut (#1724)', () => {
  it('tutorial_pit: ramp, then the 3x3 spacing 4 depth 8 plan charged with the defaults, breaks out and lowers the surface', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);
    const topUp = (): void => {
      ctx.state!.cash = Math.max(ctx.state!.cash, 500000);
      for (const e of ctx.state!.employees.employees) { e.fatigue = 100; e.ticksWorked = 0; }
    };
    const tickWhile = (pending: () => boolean, cap: number): void => {
      for (let i = 0; i < cap && pending(); i++) {
        topUp();
        run('tick 1');
        if (ctx.state!.events.pendingEvent) run('event choose 0');
      }
    };
    expect(run('campaign start level:tutorial_pit staffed:true').success).toBe(true);
    expect(run('build living_quarters at:12,15').success).toBe(true);
    expect(run('build_ramp start:10,23 end:10,35 depth:6').success).toBe(true);
    tickWhile(() => ctx.state!.plannedRamps.length > 0 || ctx.state!.pendingActions.some(a => a.type === 'dig_ramp_segment'), 1500);
    expect(ctx.state!.pendingActions.some(a => a.type === 'dig_ramp_segment')).toBe(false);

    expect(run('drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:14,24').success).toBe(true);
    tickWhile(() => ctx.state!.plannedDrillHoles.length > 0, 1500);
    expect(ctx.state!.drillHoles.length).toBe(9);
    expect(run(`charge hole:* explosive:boomite amount:${CHARGE_DEFAULT_AMOUNT_KG} stemming:${CHARGE_DEFAULT_STEMMING_M}`).success).toBe(true);
    tickWhile(() => Object.keys(ctx.state!.plannedChargesByHole).length > 0, 3000);
    expect(Object.keys(ctx.state!.plannedChargesByHole)).toHaveLength(0);

    const grid = ctx.grid!;
    const before = surfaceSnapshot(grid, 6, 28, 18, 40);
    topUp();
    const out = run('blast');
    expect(out.success, out.output).toBe(true);

    const report = ctx.state!.lastBlastReport!;
    expect(report.clearedVoxels).toBeGreaterThan(0);
    expect(report.brokeOut).not.toBe(false);
    expect(report.ratingCap).not.toBe('no_breakout');
    // A crater, not a couple of edge columns: at least one lowered column per hole.
    expect(loweredColumns(grid, before).length).toBeGreaterThanOrEqual(9);
  }, 300000);
});
