import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createRunner, runCommand, type RunnerWithContext } from '../../src/console/createRunner.js';
import { ensureLandscape } from '../../src/console/commands/world.js';
import { getBiome } from '../../src/core/world/BiomeCatalog.js';
import { computeVoxelColumnSurfaceHeight } from '../../src/core/world/VoxelGrid.js';
import { TerrainMesh } from '../../src/renderer/TerrainMesh.js';
import { LandscapeMesh } from '../../src/renderer/terrain/LandscapeMesh.js';
import { meshClaimsCell, haloSurfaceHeight, nodeTouchesMeshedCell } from '../../src/renderer/terrain/PlayableCoverage.js';
import { measureSeam } from '../helpers/landscapeSeam.js';

describe('Console — landscape_info / lazy landscape build (#458 T2.1)', () => {
  let engine: RunnerWithContext;

  beforeEach(() => {
    engine = createRunner();
  });

  it('new_game leaves the landscape unbuilt (lazy — no cost paid until requested)', () => {
    runCommand(engine, 'new_game mine_type:desert_badlands seed:42 size:32');
    expect(engine.ctx.landscape).toBeNull();
  });

  it('landscape_info builds and reports the landscape on first call', () => {
    runCommand(engine, 'new_game mine_type:desert_badlands seed:42 size:32');
    const result = runCommand(engine, 'landscape_info');
    expect(result.success).toBe(true);
    expect(result.output).toContain('Tiles:');
    expect(result.output).toContain('129x129');
    expect(engine.ctx.landscape).not.toBeNull();
    expect(engine.ctx.landscape!.map.tiles.length).toBeGreaterThan(0);
  });

  it('landscape_info is idempotent — a second call reuses the cached map', () => {
    runCommand(engine, 'new_game mine_type:desert_badlands seed:42 size:32');
    runCommand(engine, 'landscape_info');
    const first = engine.ctx.landscape;
    runCommand(engine, 'landscape_info');
    expect(engine.ctx.landscape).toBe(first); // same object reference, not rebuilt
  });

  it('fails cleanly with no game loaded', () => {
    const result = runCommand(engine, 'landscape_info');
    expect(result.success).toBe(false);
    expect(engine.ctx.landscape).toBeNull();
  });

  it('a fresh new_game invalidates a previously-built landscape', () => {
    runCommand(engine, 'new_game mine_type:desert_badlands seed:42 size:32');
    runCommand(engine, 'landscape_info');
    expect(engine.ctx.landscape).not.toBeNull();

    runCommand(engine, 'new_game mine_type:alpine_granite seed:99 size:32');
    expect(engine.ctx.landscape).toBeNull(); // stale map cleared, not silently reused across games
  });

  it('does not affect the playable grid or any other command output', () => {
    runCommand(engine, 'new_game mine_type:desert_badlands seed:42 size:32');
    const before = runCommand(engine, 'terrain_info');
    runCommand(engine, 'landscape_info');
    const after = runCommand(engine, 'terrain_info');
    expect(after.output).toBe(before.output);
  });
});

// ── The join, on a real level's world (#907) ────────────────────────────────
//
// The unit suite proves the seam invariants against a synthetic curved field.
// This proves them against the world the player actually loads — the tutorial
// level whose playtest screenshot opened #907 — and after a real blast has
// moved the surface at the boundary, which is the case a fresh-level check
// cannot reach. It builds both meshes, so it reaches for Three.js the way the
// survey-overlay integration suites already do.

describe('Landscape/playable seam on a real level (#907)', () => {
  function buildBothMeshes(engine: RunnerWithContext): {
    playable: TerrainMesh; landscape: LandscapeMesh; grid: NonNullable<typeof engine.ctx.grid>;
  } {
    const ctx = engine.ctx;
    const grid = ctx.grid!;
    const state = ctx.state!;
    const biome = getBiome(state.mineType)!;
    const { sizeX, sizeY, sizeZ } = state.world!;
    const handle = ensureLandscape(ctx, { seed: state.seed, climateBias: biome.climateCenter, sizeX, sizeY, sizeZ })!;

    const playable = new TerrainMesh(new THREE.Scene(), grid, state.mineType);
    playable.setEdgeHeightSampler((x, z) => handle.sampleColumn(x, z).height);
    playable.buildAll();

    const landscape = new LandscapeMesh(new THREE.Scene(), new THREE.MeshBasicMaterial());
    landscape.build(handle, grid.palette, {
      rect: { minX: grid.minX, minZ: grid.minZ, maxX: grid.maxX, maxZ: grid.maxZ },
      ownsColumn: (x, z) => grid.containsColumn(x, z),
      boundaryHeightAt: (x, z) => {
        const live = computeVoxelColumnSurfaceHeight(grid, x, z);
        if (!Number.isNaN(live)) return live;
        if (!nodeTouchesMeshedCell(grid, x, z)) return NaN;
        return haloSurfaceHeight(grid, handle.sampleColumn(x, z).height);
      },
      meshClaimsColumn: (x, z) => meshClaimsCell(grid, x, z),
    });
    return { playable, landscape, grid };
  }

  function assertSeamClosed(engine: RunnerWithContext, when: string): void {
    const { playable, landscape, grid } = buildBothMeshes(engine);
    const seam = measureSeam(playable.meshes, landscape.meshes, grid);
    expect(seam.doubleCovered, `cells drawn by both sheets ${when}`).toEqual([]);
    expect(seam.uncovered, `cells drawn by neither sheet ${when}`).toEqual([]);
    expect(seam.sharedNodes, `shared ring nodes ${when}`).toBe(132); // the full 4 * 33 perimeter ring
    expect(seam.worstDisagreement, `height disagreement ${when}, worst at ${seam.worstAt}`).toBeLessThan(1e-6);
    playable.dispose();
    landscape.dispose();
  }

  it('joins along the whole claim boundary of the tutorial level, from its own world', () => {
    const engine = createRunner();
    expect(runCommand(engine, 'campaign start level:tutorial_pit cash:340000').success).toBe(true);
    assertSeamClosed(engine, 'on a fresh tutorial_pit');
  });

  it('still joins after a real blast has moved the surface at the boundary', () => {
    // tutorial_pit's own biome, seed and size, staffed — the campaign start
    // hires nobody, so a drill plan there can never land a hole and no blast
    // can be fired through the game loop at all.
    const engine = createRunner();
    const run = (cmd: string): { success: boolean; output: string } => runCommand(engine, cmd);
    expect(run('new_game mine_type:desert_badlands seed:42 size:32 staffed:true').success).toBe(true);

    assertSeamClosed(engine, 'before the blast');

    const state = engine.ctx.state!;
    expect(run('drill_plan grid rows:2 cols:2 spacing:3 depth:8 start:2,2').success).toBe(true);
    for (let i = 0; i < 2000 && state.plannedDrillHoles.length > 0; i++) run('tick 1');
    expect(state.drillHoles.length, 'no hole was ever drilled').toBeGreaterThan(0);
    expect(run('charge hole:* explosive:boomite amount:8 stemming:2').success).toBe(true);
    for (let i = 0; i < 2000 && Object.keys(state.plannedChargesByHole).length > 0; i++) run('tick 1');
    run('sequence auto delay_step:25');
    expect(run('blast').success).toBe(true);

    assertSeamClosed(engine, 'after a blast at the site edge');
  });
});
