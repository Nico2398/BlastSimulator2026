// BlastSimulator2026 — GameRenderer landscape wiring and staged level load
// (#559 playableCut/meshClaimsColumn, #474 staged LoadPhases)
// Split out of GameRenderer.test.ts: each test here builds a real landscape
// (seconds each), and vitest only parallelises across files.

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { GameRenderer } from '../../../src/renderer/GameRenderer.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { makeGameContext, makeEmptyGameContext } from '../../helpers/gameContext.js';
import { makeMockSceneManager } from '../../helpers/rendererFixtures.js';
import { TerrainMesh } from '../../../src/renderer/TerrainMesh.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { playableCut } from '../../../src/renderer/GameRendererTerrain.js';

describe('GameRenderer — playableCut/meshClaimsColumn wiring (#559)', () => {
  async function makeLandscapeCtx(mineType = 'green_foothills'): Promise<MiningContext> {
    return makeGameContext({ mineType, seed: '42', size: '64' });
  }

  it('playableCut(grid) cuts the landscape against the cells TerrainMesh actually marches (#907)', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = await makeLandscapeCtx();

    renderer.syncFromContext(ctx);

    // meshClaimsColumn is meshClaimsCell against this very grid, so the
    // landscape's cut and TerrainMesh's march bounds cannot answer differently
    // about a square metre (PlayableCoverage.ts). Spot-check the ring the two
    // sheets share and one cell either side of it.
    const grid = ctx.grid!;
    const cut = playableCut(grid);
    expect(cut.meshClaimsColumn).toBeDefined();
    const claims = cut.meshClaimsColumn!;
    expect(claims(grid.minX, grid.minZ)).toBe(true);                  // owned
    expect(claims(grid.minX - 1, grid.minZ)).toBe(true);              // west sealing halo
    expect(claims(grid.minX - 1, grid.minZ - 1)).toBe(true);          // its diagonal corner
    expect(claims(grid.minX - 2, grid.minZ)).toBe(false);             // the landscape's
    expect(claims(grid.maxX - 1, grid.minZ)).toBe(true);              // last owned cell
    expect(claims(grid.maxX, grid.minZ)).toBe(false);                 // the landscape's
  });

  it('playableCut(grid, edgeHeight).boundaryHeightAt answers on the shared ring, and only there (#907)', async () => {
    const ctx = await makeLandscapeCtx();
    const grid = ctx.grid!;
    const edgeHeight = (x: number, z: number): number => 7.25 + x * 0 + z * 0;
    const cut = playableCut(grid, edgeHeight);
    const at = cut.boundaryHeightAt!;

    // Inside the site: the live voxel surface, never the sampler.
    expect(at(grid.minX + 4, grid.minZ + 4)).not.toBe(7.25);
    expect(Number.isNaN(at(grid.minX + 4, grid.minZ + 4))).toBe(false);
    // On the ring the landscape shares with the playable mesh: the sampler,
    // so both sheets place that node at the same height.
    expect(at(grid.minX - 1, grid.minZ + 4)).toBeCloseTo(7.25, 9);
    expect(at(grid.maxX, grid.minZ + 4)).toBeCloseTo(7.25, 9);
    // One node further out the playable mesh draws nothing, and the landscape
    // must fall back to its own sampled height rather than to a clamped one.
    expect(Number.isNaN(at(grid.minX - 2, grid.minZ + 4))).toBe(true);
    expect(Number.isNaN(at(grid.maxX + 1, grid.minZ + 4))).toBe(true);
  });

  it('loadGame() sets the terrain edge-height sampler BEFORE buildAll(), and it is non-null afterward', async () => {
    const setSamplerSpy = vi.spyOn(TerrainMesh.prototype, 'setEdgeHeightSampler');
    const buildAllSpy = vi.spyOn(TerrainMesh.prototype, 'buildAll');
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);

    renderer.syncFromContext(await makeLandscapeCtx());

    expect(setSamplerSpy).toHaveBeenCalled();
    expect(buildAllSpy).toHaveBeenCalled();
    // vitest mock functions record a global invocation order counter --
    // setEdgeHeightSampler's first call must precede buildAll's first call,
    // pinning the #559 init-ordering fix (previously buildAll ran first,
    // so the initial mesh missed the boundary-normal fix entirely).
    expect(setSamplerSpy.mock.invocationCallOrder[0]!).toBeLessThan(buildAllSpy.mock.invocationCallOrder[0]!);
    // The dead-code concern (quality-reviewer): currentEdgeHeightSampler
    // actually earns its keep here, proving the sampler GameRenderer wired in
    // reached TerrainMesh, not just that some setter was called.
    expect(renderer.terrain!.currentEdgeHeightSampler).not.toBeNull();

    setSamplerSpy.mockRestore();
    buildAllSpy.mockRestore();
  });

  it('rebuildLandscapeMesh() (level swap) re-applies the edge-height sampler', async () => {
    const setSamplerSpy = vi.spyOn(TerrainMesh.prototype, 'setEdgeHeightSampler');
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = await makeLandscapeCtx();
    renderer.syncFromContext(ctx); // loadGame() — 1st setEdgeHeightSampler call
    const callsAfterLoad = setSamplerSpy.mock.calls.length;
    expect(callsAfterLoad).toBeGreaterThan(0);

    // Same seed, different grid object — the "grid changed, same seed" branch
    // that calls rebuildLandscapeMesh() a second time without going through
    // loadGame()'s clearAll() first (mirrors a campaign level swap), exactly
    // as the existing ambient-mesh test above exercises.
    ctx.grid = new VoxelGrid(64, 64);
    ctx.landscape = null;
    renderer.syncFromContext(ctx);

    expect(setSamplerSpy.mock.calls.length).toBeGreaterThan(callsAfterLoad);
    expect(renderer.terrain!.currentEdgeHeightSampler).not.toBeNull();

    setSamplerSpy.mockRestore();
  });
});

// ── Staged level load (#474) ──
//
// enterLevel() in main.ts no longer drives the whole load through one
// syncFromContext() call — it runs buildPlayableMesh() / buildLandscapeMesh()
// / buildAmbient() / finishLevelLoad() as separate weighted LoadPhases, so
// the loading screen can paint a frame between each. These prove the staged
// path lands in the same place syncFromContext() always did.

describe('GameRenderer — staged level load (#474)', () => {
  async function makeLandscapeCtx(mineType = 'green_foothills'): Promise<MiningContext> {
    return makeGameContext({ mineType, seed: '42', size: '64' });
  }

  it('buildPlayableMesh() + buildLandscapeMesh() + buildAmbient() + finishLevelLoad(), run as separate staged calls, reach the same end state as one syncFromContext() call', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = await makeLandscapeCtx();

    renderer.buildPlayableMesh(ctx);
    renderer.buildLandscapeMesh(ctx);
    renderer.buildAmbient(ctx);
    renderer.finishLevelLoad(ctx);

    expect(renderer.lastGridId).toBe(ctx.grid!.id);
    expect(renderer.terrain).not.toBeNull();
    expect(renderer.landscape).not.toBeNull();
    // Grass is the unconditional ambient signal the existing #458 T7.2 tests
    // already rely on — present whenever buildAmbient() actually ran.
    expect(sm.scene.children.find((c) => c.name === 'vegetation-grass')).toBeDefined();
    expect(sm.cameraController.frameSite).toHaveBeenCalled();
  });

  it('finishLevelLoad() records the same bookkeeping loadGame() does, so a later syncFromContext() call does not repeat the load', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = await makeLandscapeCtx();
    const buildAllSpy = vi.spyOn(TerrainMesh.prototype, 'buildAll');

    renderer.buildPlayableMesh(ctx);
    renderer.buildLandscapeMesh(ctx);
    renderer.buildAmbient(ctx);
    renderer.finishLevelLoad(ctx);
    expect(buildAllSpy).toHaveBeenCalledTimes(1);

    // Same seed, same grid — without finishLevelLoad()'s bookkeeping this
    // would look like an unseen seed and re-run the whole load, doubling the
    // cost the staged phases were just charged for.
    renderer.syncFromContext(ctx);
    expect(buildAllSpy).toHaveBeenCalledTimes(1);

    buildAllSpy.mockRestore();
  });

  it('finishLevelLoad() is a no-op without a loaded state/grid, rather than throwing', () => {
    const renderer = new GameRenderer(makeMockSceneManager() as any);
    expect(() => renderer.finishLevelLoad(makeEmptyGameContext())).not.toThrow();
  });

  it('after the world grows past its base size, buildLandscapeMesh rebuilds the landscape from the level\'s base size, not the live/expanded one (#1188)', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = await makeLandscapeCtx();
    const baseSizeX = ctx.state!.world!.baseSizeX;
    const baseSizeZ = ctx.state!.world!.baseSizeZ;

    // buildPlayableMesh requires terrain built first, and caches ctx.landscape
    // at the correct (pre-expansion) size as a side effect of its own
    // landscapeEdgeHeightSampler() call.
    renderer.buildPlayableMesh(ctx);

    // Simulate a post-expansion world whose landscape cache was invalidated
    // (e.g. a campaign level swap, mirroring the "rebuildLandscapeMesh"
    // test above): the live bounding box has grown, the level's original
    // base size (the generation datum) has not. This isolates
    // buildLandscapeMesh's OWN ensureLandscape() call — landscapeEdgeHeightSampler's
    // is covered by GameRendererTerrain.test.ts.
    ctx.state!.world!.sizeX = baseSizeX + 64;
    ctx.state!.world!.sizeZ = baseSizeZ + 64;
    ctx.landscape = null;

    renderer.buildLandscapeMesh(ctx);

    expect(ctx.landscape).not.toBeNull();
    expect(ctx.landscape!.playableRect.maxX).toBe(baseSizeX);
    expect(ctx.landscape!.playableRect.maxZ).toBe(baseSizeZ);
  });
});

// ── Ghost/terrain resync dirty-check gating (#761) ──────────────────────────
//
// syncEntities() unconditionally re-syncs ~1000 ghost-preview meshes on
// every console command today, which is what stalls tutorial-interactive.json
// at step 37 in interaction mode (30s timeout). The fix gates GhostMesh.sync()
// behind `ghostPreviewsRevision !== lastGhostRevision || terrainMeshRevision
// !== lastSyncedTerrainRevision` — TaskDispatch.ts bumps ghostPreviewsRevision
// at its four ghostPreviews-mutating call sites (see
// tests/unit/engine/TaskDispatch.test.ts's own #761 suite); GameRenderer.ts
// bumps terrainMeshRevision at its four remesh call sites (localized and
// full-rebuild paths in onBlast(), plus the other terrain-mutating call
// sites), no TODO remains.
//
// These assert the gating decision through the three diagnostic getters
// (lastGhostRevisionSynced / terrainMeshRevisionCount / lastTerrainRevisionSynced)
// and by spying on GhostMesh.prototype.sync directly — the same seam
// GameRenderer's other tests already use for onBlast()/spawnFragments above.

// ── Landscape material follows the per-level terrain material (#1674) ──
//
// Each level load rebuilds TerrainMesh/TerrainMaterial (biome-specific, the old
// one disposed). The LandscapeMesh used to be created once, so later loads left
// it pointing at the first level's disposed material.

describe('GameRenderer — landscape material follows the terrain material across level loads (#1674)', () => {
  const ctxFor = (mineType: string): Promise<MiningContext> =>
    makeGameContext({ mineType, seed: '42', size: '64' });

  function stagedLoad(renderer: GameRenderer, ctx: MiningContext): void {
    renderer.buildPlayableMesh(ctx);
    renderer.buildLandscapeMesh(ctx);
    renderer.buildAmbient(ctx);
    renderer.finishLevelLoad(ctx);
  }

  /** Every Mesh/InstancedMesh material currently in the scene graph. */
  function sceneMaterials(sm: ReturnType<typeof makeMockSceneManager>): Set<THREE.Material> {
    const out = new Set<THREE.Material>();
    sm.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (Array.isArray(m)) m.forEach((x) => out.add(x));
      else if (m) out.add(m);
    });
    return out;
  }

  it('staged path: second load (other biome) leaves landscape on the new terrain material, not the first', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);

    stagedLoad(renderer, await ctxFor('red_canyon'));
    const firstMaterial = renderer.terrain!.sharedMaterial;
    expect(renderer.landscape!.currentMaterial).toBe(firstMaterial);

    const ctx2 = await ctxFor('green_foothills');
    renderer.buildPlayableMesh(ctx2);
    // buildPlayableMesh drops the old landscape; buildLandscapeMesh makes the next one.
    expect(renderer.landscape).toBeNull();
    renderer.buildLandscapeMesh(ctx2);
    renderer.buildAmbient(ctx2);
    renderer.finishLevelLoad(ctx2);

    const secondMaterial = renderer.terrain!.sharedMaterial;
    expect(secondMaterial).not.toBe(firstMaterial);
    expect(renderer.landscape!.currentMaterial).toBe(secondMaterial);
  });

  it('syncFromContext: same seed, new grid, other biome rebuilds terrain and repoints landscape at its material', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    renderer.syncFromContext(await ctxFor('red_canyon'));
    const firstTerrain = renderer.terrain!;
    const firstMaterial = firstTerrain.sharedMaterial;

    renderer.syncFromContext(await ctxFor('green_foothills'));

    expect(renderer.terrain === firstTerrain).toBe(false);
    expect(renderer.terrain!.biomeId).toBe('green_foothills');
    expect(renderer.terrain!.sharedMaterial).not.toBe(firstMaterial);
    expect(renderer.landscape!.currentMaterial).toBe(renderer.terrain!.sharedMaterial);
    expect(renderer.landscape!.currentMaterial).not.toBe(firstMaterial);
  });

  it('syncFromContext: same seed, same biome, new grid keeps the terrain and landscape points at its material', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    renderer.syncFromContext(await ctxFor('green_foothills'));
    const firstTerrain = renderer.terrain!;

    renderer.syncFromContext(await ctxFor('green_foothills'));

    expect(renderer.terrain === firstTerrain).toBe(true);
    expect(renderer.landscape!.currentMaterial).toBe(firstTerrain.sharedMaterial);
  });

  it('after the second load no landscape chunk or fragment bucket uses the disposed first material', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    renderer.syncFromContext(await ctxFor('red_canyon'));
    renderer.update(0.016);
    renderer.flushLandscapeStreaming();
    const firstMaterial = renderer.terrain!.sharedMaterial;
    const disposeSpy = vi.spyOn(firstMaterial, 'dispose');

    renderer.syncFromContext(await ctxFor('green_foothills'));
    renderer.update(0.016);
    renderer.flushLandscapeStreaming();

    const secondMaterial = renderer.terrain!.sharedMaterial;
    expect(secondMaterial).not.toBe(firstMaterial);
    expect(renderer.landscape!.meshCount).toBeGreaterThan(0);
    for (const mesh of renderer.landscape!.meshes) {
      expect(mesh.material).toBe(secondMaterial);
    }
    // Fragment buckets are the scene's InstancedMeshes sharing terrain's material.
    const instanced: THREE.InstancedMesh[] = [];
    sm.scene.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) instanced.push(o as THREE.InstancedMesh); });
    expect(instanced.some((m) => m.material === secondMaterial)).toBe(true);
    // Whatever disposal happened, nothing still in the scene draws with the disposed material.
    if (disposeSpy.mock.calls.length > 0) {
      expect(sceneMaterials(sm).has(firstMaterial)).toBe(false);
    }
    expect(sceneMaterials(sm).has(firstMaterial)).toBe(false);
  });

  it('buildLandscapeMesh reuse path (existing landscape, no buildPlayableMesh) repoints a stale material to terrain.sharedMaterial', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = await ctxFor('green_foothills');
    stagedLoad(renderer, ctx);
    const landscape = renderer.landscape!;
    const stale = new THREE.MeshBasicMaterial();
    landscape.setMaterial(stale);
    expect(landscape.currentMaterial).toBe(stale);

    renderer.buildLandscapeMesh(ctx);

    expect(renderer.landscape).toBe(landscape);
    expect(landscape.currentMaterial).toBe(renderer.terrain!.sharedMaterial);
  });
});
