// BlastSimulator2026 — Integration: wall stability / slump (#1941)
//
// Progression sites only: after a blast, a face taller than its weakest rock's safe height slumps
// into the pit. The standard opening (3x3, 8 m holes, 4 m spacing, floor up to 4 m deeper) must
// stay stable in every biome; non-progression sites and campaign levels never slump.
// Drives the real console command layer: no DOM, no Three.js.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { serializeGameState } from '../../src/console-api.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { VoxelGrid, computeVoxelColumnSurfaceY } from '../../src/core/world/VoxelGrid.js';
import { getAllBiomes } from '../../src/core/world/BiomeCatalog.js';
import { createGridPlan } from '../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../src/core/mining/ChargePlan.js';
import { assembleBlastPlan } from '../../src/core/mining/BlastPlan.js';
import { executeBlast } from '../../src/core/mining/BlastExecution.js';
import { applyWallSlumps } from '../../src/console/commands/mining/wallSlump.js';
import { placeBuilding } from '../../src/core/entities/Building.js';
import { drain } from '../../src/core/engine/Steps.js';
import { findOverheightFaces, runWallStability } from '../../src/core/mining/WallStability.js';
import { EXPLOSIVE_DELIVERY_TICKS } from '../../src/core/config/balance.js';
import { fundForDeliveryWait } from '../helpers/playthrough.js';
import { setLocale, t } from '../../src/core/i18n/I18n.js';

// ── Standard opening, every biome ──

const SEEDS = [42, 7, 13];
/** Hole depths of the standard opening and the variant with a floor 4 m deeper. */
const OPENING_DEPTHS = [8, 12];

function standardOpening(grid: VoxelGrid, depth: number) {
  const counter = { nextHoleId: 1 };
  const origin = { x: Math.floor(grid.sizeX / 2) - 4, z: Math.floor(grid.sizeZ / 2) - 4 };
  const holes = createGridPlan(counter, origin, 3, 3, 4, depth, 0.089);
  const depths: Record<string, number> = {};
  for (const h of holes) depths[h.id] = h.depth;
  const { charges } = batchCharge(holes.map(h => h.id), depths, 'krackle', 8, 2.5);
  return executeBlast(assembleBlastPlan(holes, charges), grid, []);
}

describe('standard opening never slumps (#1941)', () => {
  for (const biome of getAllBiomes()) {
    for (const seed of SEEDS) {
      for (const depth of OPENING_DEPTHS) {
        it(`${biome.id} seed ${seed}, ${depth} m holes: no overheight face around the crater`, () => {
          const { runner, ctx } = createRunner();
          expect(runner.run(`sandbox start biome:${biome.id} kit:full seed:${seed}`).success).toBe(true);
          const grid = ctx.grid!;
          const result = standardOpening(grid, depth);
          expect(result).not.toBeNull();
          // Hard-rock biomes (tropical_karst, volcanic_flats) barely break under this charge: an empty
          // crater is trivially stable, so the check is "no overheight face", not "rock was cleared".
          expect(findOverheightFaces(grid, result!.clearedRegion)).toEqual([]);
          expect(runWallStability(grid, result!.clearedRegion)).toEqual([]);
        });
      }
    }
  }
});

it('the standard opening really opens a crater in a softer biome (the stability checks are not vacuous)', () => {
  const { runner, ctx } = createRunner();
  expect(runner.run('sandbox start biome:desert_badlands kit:full seed:42').success).toBe(true);
  expect(standardOpening(ctx.grid!, 8)!.clearedVoxels).toBeGreaterThan(0);
});

// ── Blast hook ──

const PIT_DEPTH_M = 35; // taller than any rock's safe height (max 30 m)

interface Rig {
  run: (c: string) => { success: boolean; output: string };
  state: GameState;
  grid: VoxelGrid;
  ctx: ReturnType<typeof createRunner>['ctx'];
  slumps: Array<{ x: number; z: number; volumeM3: number }>;
  terrainEvents: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
  pit: { minX: number; maxX: number; minZ: number; maxZ: number };
}

function refresh(state: GameState): void {
  fundForDeliveryWait(state);
  for (const e of state.employees.employees) e.fatigue = 100;
}

/** Dig the 35 m pit beside where the standard opening goes; returns its footprint. */
function carvePit(grid: VoxelGrid): Rig['pit'] {
  const ox = Math.floor(grid.sizeX / 2) - 4;
  const oz = Math.floor(grid.sizeZ / 2) - 4;
  const pit = { minX: ox + 12, maxX: ox + 21, minZ: oz - 4, maxZ: oz + 12 };
  for (let z = pit.minZ; z <= pit.maxZ; z++) {
    for (let x = pit.minX; x <= pit.maxX; x++) {
      const top = computeVoxelColumnSurfaceY(grid, x, z);
      if (top === null) continue;
      for (let y = top - PIT_DEPTH_M + 1; y <= top; y++) grid.clearVoxel(x, y, z);
    }
  }
  return pit;
}

/**
 * Start `startCmd`, dig a 35 m pit beside where the standard opening goes, drill/charge/fire it and
 * wait for the report. The pit wall is far over any safe height, so on a progression site the
 * blast's stability pass (cleared region plus margin) must slump it.
 */
function blastBesidePit(startCmd: string, mutate?: (state: GameState) => void): Rig {
  const { runner, ctx } = createRunner();
  const run = (c: string) => runner.run(c);
  expect(run(startCmd)).toMatchObject({ success: true });
  const state = ctx.state!;
  const grid = ctx.grid!;
  mutate?.(state);
  state.events.eventFreqMultiplier = 0;
  refresh(state);

  const slumps: Rig['slumps'] = [];
  const terrainEvents: Rig['terrainEvents'] = [];
  ctx.emitter.on('mining:wall_slump', p => slumps.push(p));
  ctx.emitter.on('terrain:updated', ({ region }) => terrainEvents.push({ ...region }));

  const ox = Math.floor(grid.sizeX / 2) - 4;
  const oz = Math.floor(grid.sizeZ / 2) - 4;
  const pit = carvePit(grid);

  expect(run(`drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:${ox},${oz}`)).toMatchObject({ success: true });
  for (let i = 0; i < 800 && state.plannedDrillHoles.length > 0; i++) { refresh(state); run('tick 1'); }
  expect(run('charge hole:* explosive:krackle amount:8 stemming:2.5')).toMatchObject({ success: true });
  for (let i = 0; i < EXPLOSIVE_DELIVERY_TICKS + 800 && Object.keys(state.plannedChargesByHole).length > 0; i++) { refresh(state); run('tick 1'); }
  terrainEvents.length = 0;
  expect(run('blast detonate')).toMatchObject({ success: true });
  for (let i = 0; i < 400 && state.lastBlastReport === null; i++) { refresh(state); run('tick 1'); }
  expect(state.lastBlastReport).not.toBeNull();
  return { run, state, grid, ctx, slumps, terrainEvents, pit };
}

describe('post-blast stability hook (#1941)', () => {
  it('progression site: a blast beside an overheight wall slumps it and emits mining:wall_slump', () => {
    const rig = blastBesidePit('sandbox start biome:desert_badlands kit:full seed:42 staffed:true');
    expect(rig.slumps.length).toBeGreaterThan(0);
    for (const s of rig.slumps) expect(s.volumeM3).toBeGreaterThan(0);
  });

  it('the slump goes through terrain:updated so the nav grid follows', () => {
    const rig = blastBesidePit('sandbox start biome:desert_badlands kit:full seed:42 staffed:true');
    const s = rig.slumps[0]!;
    const covering = rig.terrainEvents.filter(r => r.minX <= s.x && s.x <= r.maxX && r.minZ <= s.z && s.z <= r.maxZ);
    expect(covering.length).toBeGreaterThan(0);
  });

  it('exposes the slump count in the game state dump (wallSlumpCount)', () => {
    const rig = blastBesidePit('sandbox start biome:desert_badlands kit:full seed:42 staffed:true');
    const dump = serializeGameState(rig.ctx) as unknown as Record<string, unknown>;
    expect(dump['wallSlumpCount']).toBe(rig.slumps.length);
  });

  it('is deterministic: the same plan and seed give the same slump', () => {
    const a = blastBesidePit('sandbox start biome:desert_badlands kit:full seed:42 staffed:true');
    const b = blastBesidePit('sandbox start biome:desert_badlands kit:full seed:42 staffed:true');
    expect(a.slumps.length).toBeGreaterThan(0);
    expect(JSON.stringify(a.slumps)).toBe(JSON.stringify(b.slumps));
  });

  it('non-progression sandbox: the same overheight wall never slumps', () => {
    const rig = blastBesidePit('sandbox start biome:desert_badlands kit:full seed:42 staffed:true', (state) => {
      delete (state as { grade?: unknown }).grade;
    });
    expect(rig.slumps).toEqual([]);
    // Control: the wall is really over its limit, so only the site switch kept it standing.
    expect(findOverheightFaces(rig.grid, { minX: rig.pit.minX - 2, maxX: rig.pit.maxX + 2, minZ: rig.pit.minZ - 2, maxZ: rig.pit.maxZ + 2 }).length).toBeGreaterThan(0);
  });

  it('non-progression new_game: the same overheight wall never slumps', () => {
    const rig = blastBesidePit('new_game seed:42 size:64 staffed:true');
    expect(rig.slumps).toEqual([]);
    expect(findOverheightFaces(rig.grid, { minX: rig.pit.minX - 2, maxX: rig.pit.maxX + 2, minZ: rig.pit.minZ - 2, maxZ: rig.pit.maxZ + 2 }).length).toBeGreaterThan(0);
  });

  it('campaign level dusty_hollow: the same overheight wall never slumps', () => {
    const rig = blastBesidePit('campaign start level:dusty_hollow staffed:true');
    expect(rig.state.grade).toBeUndefined();
    expect(rig.slumps).toEqual([]);
  });
});

// ── Toe-zone damage ──

describe('slump damage is confined to the toe zone (#1941)', () => {
  const START = 'sandbox start biome:desert_badlands kit:full seed:42 staffed:true';

  function pitRig() {
    const { runner, ctx } = createRunner();
    expect(runner.run(START)).toMatchObject({ success: true });
    const pit = carvePit(ctx.grid!);
    return { ctx, pit };
  }

  it('an employee, vehicle and building in the toe zone are hurt; ones just behind the crest are not', () => {
    // A twin run (same seed, same pit) tells where the first slump's toe and crest are.
    const twin = pitRig();
    const [first] = runWallStability(twin.ctx.grid!, twin.pit);
    expect(first).toBeDefined();
    const dx = Math.sign(first!.toe.x - first!.crest.x), dz = Math.sign(first!.toe.z - first!.crest.z);
    const inToe = first!.toeColumns[0]!;
    const safe = { x: first!.crest.x - 2 * dx, z: first!.crest.z - 2 * dz };

    const { ctx, pit } = pitRig();
    const state = ctx.state!;
    // The kit has no buildings: place two on open ground, then move them into the scenario.
    for (const [bx, bz] of [[2, 2], [2, 12]] as const) {
      const placed = placeBuilding(state.buildings, 'management_office', bx, bz, ctx.grid!.sizeX, ctx.grid!.sizeZ);
      expect(placed.success).toBe(true);
    }
    const [empIn, empOut] = state.employees.employees;
    const [vehIn, vehOut] = state.vehicles.vehicles;
    const [bldIn, bldOut] = state.buildings.buildings;
    expect([empIn, empOut, vehIn, vehOut, bldIn, bldOut].every(e => e !== undefined)).toBe(true);
    empIn!.x = inToe.x + 0.5; empIn!.z = inToe.z + 0.5;
    empOut!.x = safe.x + 0.5; empOut!.z = safe.z + 0.5;
    vehIn!.x = inToe.x + 0.5; vehIn!.z = inToe.z + 0.5;
    vehOut!.x = safe.x + 0.5; vehOut!.z = safe.z + 0.5;
    bldIn!.x = inToe.x; bldIn!.z = inToe.z;
    bldOut!.x = safe.x; bldOut!.z = safe.z;
    const hp = { vehIn: vehIn!.hp, vehOut: vehOut!.hp, bldIn: bldIn!.hp, bldOut: bldOut!.hp };

    drain(applyWallSlumps(ctx, pit));

    expect(state.damage.wallSlumpCount).toBeGreaterThan(0);
    expect(empIn!.injured || !empIn!.alive).toBe(true);
    expect(empOut!.injured).toBe(false);
    expect(empOut!.alive).toBe(true);
    expect(state.vehicles.vehicles.find(v => v.id === vehIn!.id)?.hp ?? 0).toBeLessThan(hp.vehIn);
    expect(state.vehicles.vehicles.find(v => v.id === vehOut!.id)?.hp).toBe(hp.vehOut);
    expect(state.buildings.buildings.find(b => b.id === bldIn!.id)?.hp ?? 0).toBeLessThan(hp.bldIn);
    expect(state.buildings.buildings.find(b => b.id === bldOut!.id)?.hp).toBe(hp.bldOut);
  });
});

// ── Notification text ──

describe('wall slump notification text (#1941)', () => {
  it('english names the place and carries the geologist line', () => {
    setLocale('en');
    expect(t('notification.wall_slump.body', { x: 12, z: 34 })).toBe('Wall slump at (12, 34). The geologist did warn you.');
  });

  it('french is translated, not the english fallback or the raw key', () => {
    setLocale('fr');
    const fr = t('notification.wall_slump.body', { x: 12, z: 34 });
    setLocale('en');
    expect(fr).not.toBe('notification.wall_slump.body');
    expect(fr).not.toBe(t('notification.wall_slump.body', { x: 12, z: 34 }));
    expect(fr).toContain('12');
    expect(fr).toContain('34');
  });
});
