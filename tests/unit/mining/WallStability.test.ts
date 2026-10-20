// BlastSimulator2026 — WallStability unit tests (#1941)
// Faces taller than their weakest rock's safe height slump into the pit: crest rock moves to the
// toe, volume and ore are conserved, berms (>= 3 m flat) split a face, and nothing is random.

import { describe, it, expect } from 'vitest';
import { VoxelGrid, computeVoxelColumnSurfaceY } from '../../../src/core/world/VoxelGrid.js';
import {
  findOverheightFaces, applySlump, runWallStability,
} from '../../../src/core/mining/WallStability.js';
import type { BlastRegion } from '../../../src/core/mining/BlastExecution.js';

const SIZE = 40;
const WHOLE: BlastRegion = { minX: 0, maxX: SIZE - 1, minZ: 0, maxZ: SIZE - 1 };

interface Layer { upToY: number; rock: string }

/**
 * Terrain whose column (x, z) is solid from y=0 to its top index `heightAt(x, z)`.
 * `layers` picks the rock by y (first layer with y <= upToY); default is one rock throughout.
 * Ore sits in the upper 3 m of every column so slump has something to conserve.
 */
function buildGrid(heightAt: (x: number, z: number) => number, rock = 'cruite', layers?: Layer[]): VoxelGrid {
  const grid = new VoxelGrid(SIZE, SIZE);
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      const top = heightAt(x, z);
      for (let y = 0; y <= top; y++) {
        const rockId = layers ? layers.find(l => y <= l.upToY)!.rock : rock;
        grid.setVoxel(x, y, z, {
          composition: { rocks: [{ rockId, coefficient: 1.0 }] },
          density: 1.0,
          oreDensities: y > top - 3 ? { blingite: 0.25 } : {},
          fractureModifier: 1.0,
        });
      }
    }
  }
  return grid;
}

/** Plateau of height `high` for x <= edgeX, pit floor of height `low` beyond. */
const cliff = (high: number, low: number, edgeX = 19) => (x: number) => (x <= edgeX ? high : low);

function solidVolume(grid: VoxelGrid): number {
  let sum = 0;
  for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) for (let y = 0; y < 60; y++) sum += grid.densityAt(x, y, z);
  return sum;
}

function oreTotal(grid: VoxelGrid): number {
  let sum = 0;
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      for (let y = 0; y < 60; y++) {
        const ores = grid.oresAt(x, y, z);
        if (ores) for (const v of Object.values(ores)) sum += v * grid.densityAt(x, y, z);
      }
    }
  }
  return sum;
}

function profile(grid: VoxelGrid, z = 20): number[] {
  return Array.from({ length: SIZE }, (_, x) => computeVoxelColumnSurfaceY(grid, x, z) ?? -1);
}

describe('findOverheightFaces', () => {
  it('reports a face taller than the safe height of its rock', () => {
    const grid = buildGrid(cliff(20, 0), 'cruite'); // tier 1: safe 12 m
    const faces = findOverheightFaces(grid, WHOLE);
    expect(faces.length).toBeGreaterThan(0);
    const f = faces.find(face => face.crest.z === 20)!;
    expect(f).toBeDefined();
    expect(f.heightM).toBe(20);
    expect(f.crestY - f.toeY).toBe(20);
    expect(f.safeM).toBe(12);
    expect(f.crest.x).toBe(19);
  });

  it('reports nothing for a face under the safe height', () => {
    expect(findOverheightFaces(buildGrid(cliff(10, 0), 'cruite'), WHOLE)).toEqual([]);
  });

  it('does not report a face exactly at the safe height (strictly greater only)', () => {
    expect(findOverheightFaces(buildGrid(cliff(12, 0), 'cruite'), WHOLE)).toEqual([]);
  });

  it('reports a face one metre over the safe height', () => {
    expect(findOverheightFaces(buildGrid(cliff(13, 0), 'cruite'), WHOLE).length).toBeGreaterThan(0);
  });

  it('flat ground has no faces', () => {
    expect(findOverheightFaces(buildGrid(() => 10), WHOLE)).toEqual([]);
  });

  it('a harder rock holds the same face: tier 5 holds 20 m', () => {
    expect(findOverheightFaces(buildGrid(cliff(20, 0), 'titanite'), WHOLE)).toEqual([]);
  });

  it('a harder rock still fails beyond its own limit: tier 5 over 30 m', () => {
    const faces = findOverheightFaces(buildGrid(cliff(35, 0), 'titanite'), WHOLE);
    expect(faces.length).toBeGreaterThan(0);
    expect(faces[0]!.safeM).toBe(30);
  });

  it('the weakest rock along the face sets the limit', () => {
    // Tier-5 cap over a tier-1 base: a 20 m face holds as pure titanite but not with cruite in it.
    const layers: Layer[] = [{ upToY: 9, rock: 'cruite' }, { upToY: 99, rock: 'titanite' }];
    const faces = findOverheightFaces(buildGrid(cliff(20, 0), 'cruite', layers), WHOLE);
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.find(f => f.crest.z === 20)!.safeM).toBe(12);
  });

  it('a berm of 3 m splits one tall face into two short ones', () => {
    // 20 m total, but a 3-wide flat ledge at 10 m: two 10 m faces, each under 12 m.
    const height = (x: number) => (x <= 10 ? 20 : x <= 13 ? 10 : 0);
    expect(findOverheightFaces(buildGrid(height, 'cruite'), WHOLE)).toEqual([]);
  });

  it('a berm of only 2 m does not split the face', () => {
    const height = (x: number) => (x <= 10 ? 20 : x <= 12 ? 10 : 0);
    const faces = findOverheightFaces(buildGrid(height, 'cruite'), WHOLE);
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.find(f => f.crest.z === 20)!.heightM).toBe(20);
  });

  it('a berm wider than 3 m also splits the face', () => {
    const height = (x: number) => (x <= 10 ? 20 : x <= 15 ? 10 : 0);
    expect(findOverheightFaces(buildGrid(height, 'cruite'), WHOLE)).toEqual([]);
  });

  it('a berm splits the face but each half still slumps when it is over its own limit', () => {
    // Upper face 20 m (over 12), lower face 8 m.
    const height = (x: number) => (x <= 10 ? 28 : x <= 13 ? 8 : 0);
    const faces = findOverheightFaces(buildGrid(height, 'cruite'), WHOLE).filter(f => f.crest.z === 20);
    expect(faces).toHaveLength(1);
    expect(faces[0]!.heightM).toBe(20);
  });

  it('only scans inside the region', () => {
    const grid = buildGrid(cliff(20, 0));
    const away: BlastRegion = { minX: 30, maxX: 39, minZ: 0, maxZ: 39 };
    expect(findOverheightFaces(grid, away)).toEqual([]);
  });

  it('clamps a region that overhangs the grid without throwing', () => {
    const grid = buildGrid(cliff(20, 0));
    const wild: BlastRegion = { minX: -50, maxX: 500, minZ: -50, maxZ: 500 };
    const faces = findOverheightFaces(grid, wild);
    expect(faces.length).toBeGreaterThan(0);
    for (const f of faces) {
      expect(f.crest.x).toBeGreaterThanOrEqual(0);
      expect(f.crest.x).toBeLessThan(SIZE);
      expect(f.crest.z).toBeGreaterThanOrEqual(0);
      expect(f.crest.z).toBeLessThan(SIZE);
    }
  });

  it('an empty region (max < min) yields nothing', () => {
    expect(findOverheightFaces(buildGrid(cliff(20, 0)), { minX: 0, maxX: -1, minZ: 0, maxZ: -1 })).toEqual([]);
  });
});

describe('applySlump', () => {
  function firstFace(grid: VoxelGrid) {
    return findOverheightFaces(grid, WHOLE).find(f => f.crest.z === 20)!;
  }

  it('moves crest rock to the toe and reports the volume', () => {
    const grid = buildGrid(cliff(20, 0));
    const report = applySlump(grid, firstFace(grid));
    expect(report).not.toBeNull();
    expect(report!.volumeM3).toBeGreaterThan(0);
    expect(report!.crest.x).toBe(19);
    expect(report!.toe.x).toBeGreaterThanOrEqual(20);
  });

  it('removes only material above the safe height, within 2 m of the face', () => {
    const grid = buildGrid(cliff(20, 0));
    applySlump(grid, firstFace(grid));
    const p = profile(grid);
    expect(p[19]!).toBeLessThanOrEqual(12);
    expect(p[19]!).toBeGreaterThan(0);
    expect(p[18]!).toBeLessThanOrEqual(12);
    expect(p[17]).toBe(20); // 3 m back from the face: untouched
    expect(p[5]).toBe(20);
  });

  it('conserves volume', () => {
    const grid = buildGrid(cliff(20, 0));
    const before = solidVolume(grid);
    applySlump(grid, firstFace(grid));
    expect(solidVolume(grid)).toBeCloseTo(before, 6);
  });

  it('conserves ore: the fill keeps the rock ore', () => {
    const grid = buildGrid(cliff(20, 0));
    const before = oreTotal(grid);
    expect(before).toBeGreaterThan(0);
    applySlump(grid, firstFace(grid));
    expect(oreTotal(grid)).toBeCloseTo(before, 6);
  });

  it('the fill keeps the rock type of the crest', () => {
    const grid = buildGrid(cliff(20, 0), 'molite'); // tier 2 (safe 15)
    const report = applySlump(grid, findOverheightFaces(grid, WHOLE).find(f => f.crest.z === 20)!);
    expect(report).not.toBeNull();
    const [tx, tz] = report!.toeColumns[0]!.split(',').map(Number) as [number, number];
    const top = computeVoxelColumnSurfaceY(grid, tx, tz)!;
    expect(grid.dominantRockAt(tx, top, tz)).toBe('molite');
  });

  it('lands the fill on the floor at the toe, raising those columns without leaving gaps', () => {
    const grid = buildGrid(cliff(20, 0));
    const report = applySlump(grid, firstFace(grid))!;
    expect(report.toeColumns.length).toBeGreaterThan(0);
    for (const key of report.toeColumns) {
      const [x, z] = key.split(',').map(Number) as [number, number];
      expect(x).toBeGreaterThanOrEqual(20); // pit side only
      const top = computeVoxelColumnSurfaceY(grid, x, z)!;
      expect(top).toBeGreaterThan(0); // raised above the old floor
      for (let y = 0; y <= top; y++) expect(grid.densityAt(x, y, z), `gap at ${x},${y},${z}`).toBeGreaterThan(0);
    }
  });

  it('the toe columns are the damage zone and include the column at the foot of the face', () => {
    const grid = buildGrid(cliff(20, 0));
    const report = applySlump(grid, firstFace(grid))!;
    expect(report.toeColumns).toContain('20,20');
    expect(report.toeColumns.every(k => Number(k.split(',')[0]) >= 20)).toBe(true);
  });

  it('the report region covers the crest and the toe', () => {
    const grid = buildGrid(cliff(20, 0));
    const report = applySlump(grid, firstFace(grid))!;
    expect(report.region.minX).toBeLessThanOrEqual(report.crest.x);
    expect(report.region.maxX).toBeGreaterThanOrEqual(report.toe.x);
    expect(report.region.minZ).toBeLessThanOrEqual(report.crest.z);
    expect(report.region.maxZ).toBeGreaterThanOrEqual(report.crest.z);
  });

  it('returns null and changes nothing when the face is within its safe height', () => {
    const grid = buildGrid(cliff(10, 0));
    const before = profile(grid);
    const face = { crest: { x: 19, z: 20 }, dir: { dx: 1, dz: 0 }, crestY: 10, toeY: 0, heightM: 10, safeM: 12 };
    expect(applySlump(grid, face)).toBeNull();
    expect(profile(grid)).toEqual(before);
  });
});

describe('runWallStability', () => {
  it('slumps an overheight face and returns one report per slump', () => {
    const grid = buildGrid(cliff(20, 0));
    const reports = runWallStability(grid, WHOLE);
    expect(reports.length).toBeGreaterThan(0);
    for (const r of reports) expect(r.volumeM3).toBeGreaterThan(0);
  });

  it('a face under the safe height does not slump', () => {
    const grid = buildGrid(cliff(11, 0));
    const before = profile(grid);
    expect(runWallStability(grid, WHOLE)).toEqual([]);
    expect(profile(grid)).toEqual(before);
  });

  it('a face exactly at the safe height does not slump', () => {
    const grid = buildGrid(cliff(12, 0));
    expect(runWallStability(grid, WHOLE)).toEqual([]);
  });

  it('a berm of 3 m prevents the slump that the same depth without it causes', () => {
    const benched = buildGrid((x) => (x <= 10 ? 20 : x <= 13 ? 10 : 0));
    const straight = buildGrid((x) => (x <= 10 ? 20 : 0));
    expect(runWallStability(benched, WHOLE)).toEqual([]);
    expect(runWallStability(straight, WHOLE).length).toBeGreaterThan(0);
  });

  it('a 2 m flat step does not save the face', () => {
    const grid = buildGrid((x) => (x <= 10 ? 20 : x <= 12 ? 10 : 0));
    expect(runWallStability(grid, WHOLE).length).toBeGreaterThan(0);
  });

  it('conserves volume and ore over the whole pass', () => {
    const grid = buildGrid(cliff(25, 0));
    const volume = solidVolume(grid);
    const ore = oreTotal(grid);
    runWallStability(grid, WHOLE);
    expect(solidVolume(grid)).toBeCloseTo(volume, 6);
    expect(oreTotal(grid)).toBeCloseTo(ore, 6);
  });

  it('reported volume matches the volume that left the crest', () => {
    const grid = buildGrid(cliff(20, 0));
    const before = solidVolume(grid);
    const reports = runWallStability(grid, WHOLE);
    const moved = reports.reduce((s, r) => s + r.volumeM3, 0);
    // What was removed from the plateau side equals what is reported (volume is only relocated).
    let plateauAfter = 0;
    for (let z = 0; z < SIZE; z++) for (let x = 0; x <= 19; x++) for (let y = 0; y < 60; y++) plateauAfter += grid.densityAt(x, y, z);
    let plateauBefore = 0;
    const fresh = buildGrid(cliff(20, 0));
    for (let z = 0; z < SIZE; z++) for (let x = 0; x <= 19; x++) for (let y = 0; y < 60; y++) plateauBefore += fresh.densityAt(x, y, z);
    expect(plateauBefore - plateauAfter).toBeCloseTo(moved, 6);
    expect(solidVolume(grid)).toBeCloseTo(before, 6);
  });

  it('is deterministic: two identical grids slump identically', () => {
    const a = buildGrid(cliff(22, 0));
    const b = buildGrid(cliff(22, 0));
    const ra = runWallStability(a, WHOLE);
    const rb = runWallStability(b, WHOLE);
    expect(JSON.stringify(ra)).toBe(JSON.stringify(rb));
    for (const z of [0, 10, 20, 39]) expect(profile(a, z)).toEqual(profile(b, z));
  });

  it('repeating the pass on the same grid is stable: a second run with no change in faces is no worse', () => {
    const grid = buildGrid(cliff(20, 0));
    runWallStability(grid, WHOLE);
    const volume = solidVolume(grid);
    runWallStability(grid, WHOLE);
    expect(solidVolume(grid)).toBeCloseTo(volume, 6);
  });

  it('only touches faces inside the region', () => {
    const grid = buildGrid(cliff(20, 0));
    const before = profile(grid);
    expect(runWallStability(grid, { minX: 30, maxX: 39, minZ: 0, maxZ: 39 })).toEqual([]);
    expect(profile(grid)).toEqual(before);
  });

  it('clamps a region that overhangs the grid without throwing', () => {
    const grid = buildGrid(cliff(20, 0));
    expect(() => runWallStability(grid, { minX: -100, maxX: 1000, minZ: -100, maxZ: 1000 })).not.toThrow();
  });

  it('an empty region does nothing', () => {
    const grid = buildGrid(cliff(20, 0));
    expect(runWallStability(grid, { minX: 0, maxX: -1, minZ: 0, maxZ: -1 })).toEqual([]);
  });

  it('the weakest rock sets the limit: soft cruite base under hard cap slumps, all titanite does not', () => {
    const layers: Layer[] = [{ upToY: 9, rock: 'cruite' }, { upToY: 99, rock: 'titanite' }];
    expect(runWallStability(buildGrid(cliff(20, 0), 'cruite', layers), WHOLE).length).toBeGreaterThan(0);
    expect(runWallStability(buildGrid(cliff(20, 0), 'titanite'), WHOLE)).toEqual([]);
  });

  it('faces along the z axis slump too', () => {
    const grid = buildGrid((_x, z) => (z <= 19 ? 20 : 0));
    expect(runWallStability(grid, WHOLE).length).toBeGreaterThan(0);
  });
});
