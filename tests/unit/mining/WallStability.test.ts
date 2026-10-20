// BlastSimulator2026 — WallStability unit tests (#1941)
// Faces taller than their weakest rock's safe height slump into the pit: crest rock moves to the
// toe, volume and ore are conserved, berms (>= 3 m flat) split a face, and nothing is random.

import { describe, it, expect } from 'vitest';
import { VoxelGrid, computeVoxelColumnSurfaceY } from '../../../src/core/world/VoxelGrid.js';
import {
  findOverheightFaces, applySlump, runWallStability, gridSurface, findFacesAtRisk, predictWallFaces,
} from '../../../src/core/mining/WallStability.js';
import type { BlastRegion } from '../../../src/core/mining/BlastExecution.js';
import { executeBlast } from '../../../src/core/mining/BlastExecution.js';
import { buildWallGrid, standardShot } from '../../helpers/wallWarningFixture.js';
import type { WallGridOpts, ShotPlan } from '../../helpers/wallWarningFixture.js';

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
    const faces = findOverheightFaces(gridSurface(grid), WHOLE);
    expect(faces.length).toBeGreaterThan(0);
    const f = faces.find(face => face.crest.z === 20)!;
    expect(f).toBeDefined();
    expect(f.heightM).toBe(20);
    expect(f.crestY - f.toeY).toBe(20);
    expect(f.safeM).toBe(12);
    expect(f.crest.x).toBe(19);
  });

  it('reports nothing for a face under the safe height', () => {
    expect(findOverheightFaces(gridSurface(buildGrid(cliff(10, 0), 'cruite')), WHOLE)).toEqual([]);
  });

  it('does not report a face exactly at the safe height (strictly greater only)', () => {
    expect(findOverheightFaces(gridSurface(buildGrid(cliff(12, 0), 'cruite')), WHOLE)).toEqual([]);
  });

  it('reports a face one metre over the safe height', () => {
    expect(findOverheightFaces(gridSurface(buildGrid(cliff(13, 0), 'cruite')), WHOLE).length).toBeGreaterThan(0);
  });

  it('flat ground has no faces', () => {
    expect(findOverheightFaces(gridSurface(buildGrid(() => 10)), WHOLE)).toEqual([]);
  });

  it('a harder rock holds the same face: tier 5 holds 20 m', () => {
    expect(findOverheightFaces(gridSurface(buildGrid(cliff(20, 0), 'titanite')), WHOLE)).toEqual([]);
  });

  it('a harder rock still fails beyond its own limit: tier 5 over 30 m', () => {
    const faces = findOverheightFaces(gridSurface(buildGrid(cliff(35, 0), 'titanite')), WHOLE);
    expect(faces.length).toBeGreaterThan(0);
    expect(faces[0]!.safeM).toBe(30);
  });

  it('the weakest rock along the face sets the limit', () => {
    // Tier-5 cap over a tier-1 base: a 20 m face holds as pure titanite but not with cruite in it.
    const layers: Layer[] = [{ upToY: 9, rock: 'cruite' }, { upToY: 99, rock: 'titanite' }];
    const faces = findOverheightFaces(gridSurface(buildGrid(cliff(20, 0), 'cruite', layers)), WHOLE);
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.find(f => f.crest.z === 20)!.safeM).toBe(12);
  });

  it('a berm of 3 m splits one tall face into two short ones', () => {
    // 20 m total, but a 3-wide flat ledge at 10 m: two 10 m faces, each under 12 m.
    const height = (x: number) => (x <= 10 ? 20 : x <= 13 ? 10 : 0);
    expect(findOverheightFaces(gridSurface(buildGrid(height, 'cruite')), WHOLE)).toEqual([]);
  });

  it('a berm of only 2 m does not split the face', () => {
    const height = (x: number) => (x <= 10 ? 20 : x <= 12 ? 10 : 0);
    const faces = findOverheightFaces(gridSurface(buildGrid(height, 'cruite')), WHOLE);
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.find(f => f.crest.z === 20)!.heightM).toBe(20);
  });

  it('a berm wider than 3 m also splits the face', () => {
    const height = (x: number) => (x <= 10 ? 20 : x <= 15 ? 10 : 0);
    expect(findOverheightFaces(gridSurface(buildGrid(height, 'cruite')), WHOLE)).toEqual([]);
  });

  it('a berm splits the face: only the half over its own limit is reported', () => {
    // Upper face 20 m (over 12), lower face 8 m.
    const height = (x: number) => (x <= 10 ? 28 : x <= 13 ? 8 : 0);
    const faces = findOverheightFaces(gridSurface(buildGrid(height, 'cruite')), WHOLE).filter(f => f.crest.z === 20);
    expect(faces).toHaveLength(1);
    expect(faces[0]!.heightM).toBe(20);
  });

  it('only scans inside the region', () => {
    const grid = buildGrid(cliff(20, 0));
    const away: BlastRegion = { minX: 30, maxX: 39, minZ: 0, maxZ: 39 };
    expect(findOverheightFaces(gridSurface(grid), away)).toEqual([]);
  });

  it('clamps a region that overhangs the grid without throwing', () => {
    const grid = buildGrid(cliff(20, 0));
    const wild: BlastRegion = { minX: -50, maxX: 500, minZ: -50, maxZ: 500 };
    const faces = findOverheightFaces(gridSurface(grid), wild);
    expect(faces.length).toBeGreaterThan(0);
    for (const f of faces) {
      expect(f.crest.x).toBeGreaterThanOrEqual(0);
      expect(f.crest.x).toBeLessThan(SIZE);
      expect(f.crest.z).toBeGreaterThanOrEqual(0);
      expect(f.crest.z).toBeLessThan(SIZE);
    }
  });

  it('an empty region (max < min) yields nothing', () => {
    expect(findOverheightFaces(gridSurface(buildGrid(cliff(20, 0))), { minX: 0, maxX: -1, minZ: 0, maxZ: -1 })).toEqual([]);
  });
});

describe('applySlump', () => {
  function firstFace(grid: VoxelGrid) {
    return findOverheightFaces(gridSurface(grid), WHOLE).find(f => f.crest.z === 20)!;
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
    const report = applySlump(grid, findOverheightFaces(gridSurface(grid), WHOLE).find(f => f.crest.z === 20)!);
    expect(report).not.toBeNull();
    const { x: tx, z: tz } = report!.toeColumns[0]!;
    const top = computeVoxelColumnSurfaceY(grid, tx, tz)!;
    expect(grid.dominantRockAt(tx, top, tz)).toBe('molite');
  });

  it('lands the fill on the floor at the toe, raising those columns without leaving gaps', () => {
    const grid = buildGrid(cliff(20, 0));
    const report = applySlump(grid, firstFace(grid))!;
    expect(report.toeColumns.length).toBeGreaterThan(0);
    for (const { x, z } of report.toeColumns) {
      expect(x).toBeGreaterThanOrEqual(20); // pit side only
      const top = computeVoxelColumnSurfaceY(grid, x, z)!;
      expect(top).toBeGreaterThan(0); // raised above the old floor
      for (let y = 0; y <= top; y++) expect(grid.densityAt(x, y, z), `gap at ${x},${y},${z}`).toBeGreaterThan(0);
    }
  });

  it('the toe columns are the damage zone and include the column at the foot of the face', () => {
    const grid = buildGrid(cliff(20, 0));
    const report = applySlump(grid, firstFace(grid))!;
    expect(report.toeColumns).toContainEqual({ x: 20, z: 20 });
    expect(report.toeColumns.every(c => c.x >= 20)).toBe(true);
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

  it('repeating the pass is one pass without cascade: the first fixes its faces, a second run still conserves volume', () => {
    // The slump pass does not iterate to a fixed point (the fill can leave a new face), so a second run
    // may report more; what must hold is that every report moves rock and none is lost.
    const grid = buildGrid(cliff(20, 0));
    const first = runWallStability(grid, WHOLE);
    expect(first.length).toBeGreaterThan(0);
    const volume = solidVolume(grid);
    const second = runWallStability(grid, WHOLE);
    for (const r of second) expect(r.volumeM3).toBeGreaterThan(0);
    expect(second.length).toBeLessThanOrEqual(first.length);
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

// ── #1943: prediction ──

describe('gridSurface', () => {
  it('reads column tops and dominant rock from the grid', () => {
    const grid = buildGrid(cliff(20, 0), 'molite');
    const s = gridSurface(grid);
    expect(s.topAt(5, 5)).toBe(computeVoxelColumnSurfaceY(grid, 5, 5));
    expect(s.topAt(30, 5)).toBe(0);
    expect(s.rockAt(5, 10, 5)).toBe('molite');
  });

  it('topAt is null outside the grid', () => {
    const s = gridSurface(buildGrid(cliff(20, 0)));
    expect(s.topAt(-1, 0)).toBeNull();
    expect(s.topAt(0, SIZE)).toBeNull();
  });

  it('findOverheightFaces on a gridSurface finds the same face as before the refactor', () => {
    const f = findOverheightFaces(gridSurface(buildGrid(cliff(20, 0))), WHOLE).find(face => face.crest.z === 20)!;
    expect(f).toMatchObject({ crestY: 20, toeY: 0, heightM: 20, safeM: 12 });
  });

  it('findOverheightFaces accepts any WallSurface, not only a grid', () => {
    const fake = {
      topAt: (x: number, z: number) => (x < 0 || z < 0 || x >= SIZE || z >= SIZE ? null : x <= 19 ? 20 : 0),
      rockAt: () => 'cruite',
    };
    const f = findOverheightFaces(fake, WHOLE).find(face => face.crest.z === 20)!;
    expect(f.heightM).toBe(20);
    expect(f.safeM).toBe(12);
  });
});

describe('findFacesAtRisk', () => {
  const risk = (high: number, minRatio?: number, rock = 'cruite') =>
    findFacesAtRisk(gridSurface(buildGrid(cliff(high, 0), rock)), WHOLE, minRatio).filter(p => p.face.crest.z === 20);

  it('reports an overheight face with its rock and ratio', () => {
    const [p] = risk(20);
    expect(p).toBeDefined();
    expect(p!.rockId).toBe('cruite');
    expect(p!.ratio).toBeCloseTo(20 / 12, 6);
    expect(p!.face.heightM).toBe(20);
  });

  it('reports a face at 80% of its safe height by default (10 of 12 m)', () => {
    expect(risk(10)).toHaveLength(1);
  });

  it('skips a face under 80% of its safe height (9 of 12 m)', () => {
    expect(risk(9)).toEqual([]);
  });

  it('reports a face exactly at its safe height (ratio 1), which findOverheightFaces does not', () => {
    expect(risk(12)).toHaveLength(1);
    expect(findOverheightFaces(gridSurface(buildGrid(cliff(12, 0))), WHOLE)).toEqual([]);
  });

  it('minRatio is inclusive and honoured', () => {
    expect(risk(12, 1)).toHaveLength(1);
    expect(risk(11, 1)).toEqual([]);
    expect(risk(6, 0.5)).toHaveLength(1);
    expect(risk(5, 0.5)).toEqual([]);
  });

  it('a harder rock needs a taller face: 20 m of titanite (safe 30) is under 80%', () => {
    expect(risk(20, undefined, 'titanite')).toEqual([]);
    expect(risk(24, undefined, 'titanite')).toHaveLength(1);
  });

  it('the weakest rock along the face limits it and is named', () => {
    const layers: Layer[] = [{ upToY: 9, rock: 'cruite' }, { upToY: 99, rock: 'titanite' }];
    const [p] = findFacesAtRisk(gridSurface(buildGrid(cliff(20, 0), 'cruite', layers)), WHOLE).filter(q => q.face.crest.z === 20);
    expect(p!.face.safeM).toBe(12);
    expect(p!.rockId).toBe('cruite');
  });

  it('a berm splits the face: two 10 m faces of a 20 m drop are each reported at 83%', () => {
    const height = (x: number) => (x <= 10 ? 20 : x <= 13 ? 10 : 0);
    const faces = findFacesAtRisk(gridSurface(buildGrid(height, 'cruite')), WHOLE).filter(p => p.face.crest.z === 20);
    expect(faces.map(p => p.face.heightM)).toEqual([10, 10]);
  });

  it('flat ground and an empty region yield nothing', () => {
    expect(findFacesAtRisk(gridSurface(buildGrid(() => 10)), WHOLE)).toEqual([]);
    expect(findFacesAtRisk(gridSurface(buildGrid(cliff(20, 0))), { minX: 0, maxX: -1, minZ: 0, maxZ: -1 })).toEqual([]);
  });

  it('only scans inside the region', () => {
    expect(findFacesAtRisk(gridSurface(buildGrid(cliff(20, 0))), { minX: 30, maxX: 39, minZ: 0, maxZ: 39 })).toEqual([]);
  });
});

describe('predictWallFaces', () => {
  type Dump = Array<{ x: number; z: number; dx: number; dz: number; h: number; safe: number }>;
  const dump = (faces: ReadonlyArray<{ crest: { x: number; z: number }; dir: { dx: number; dz: number }; heightM: number; safeM: number }>): Dump =>
    faces.map(f => ({ x: f.crest.x, z: f.crest.z, dx: f.dir.dx, dz: f.dir.dz, h: f.heightM, safe: f.safeM }));

  /** Fire the shot on a fresh grid; the faces standing over their safe height before the slump pass runs. */
  function actualOverheight(opts: WallGridOpts, shot: ShotPlan, wet: ReadonlySet<string> = new Set()) {
    const grid = buildWallGrid(opts);
    const result = executeBlast(shot.plan, grid, [], undefined, undefined, undefined, wet);
    expect(result).not.toBeNull();
    const faces = findOverheightFaces(gridSurface(grid), result!.clearedRegion);
    const slumps = runWallStability(grid, result!.clearedRegion);
    return { faces, slumps };
  }

  function predictedOver(opts: WallGridOpts, shot: ShotPlan, wet?: ReadonlySet<string>) {
    return predictWallFaces(shot.plan, buildWallGrid(opts), wet).filter(p => p.face.heightM > p.face.safeM);
  }

  it('returns [] for a plan with no holes', () => {
    expect(predictWallFaces({ holes: [], charges: {} }, buildWallGrid({ plateauTop: 25 }))).toEqual([]);
  });

  it('returns [] for holes with no charge (nothing would break)', () => {
    const shot = standardShot();
    expect(predictWallFaces({ holes: shot.plan.holes, charges: {} }, buildWallGrid({ plateauTop: 25 }))).toEqual([]);
  });

  it('does not mutate the grid', () => {
    const grid = buildWallGrid({ plateauTop: 25 });
    const rev = grid.editRevision;
    const before = computeVoxelColumnSurfaceY(grid, 18, 20);
    predictWallFaces(standardShot().plan, grid);
    expect(grid.editRevision).toBe(rev);
    expect(computeVoxelColumnSurfaceY(grid, 18, 20)).toBe(before);
  });

  it('is deterministic', () => {
    const a = predictWallFaces(standardShot().plan, buildWallGrid({ plateauTop: 25 }));
    const b = predictWallFaces(standardShot().plan, buildWallGrid({ plateauTop: 25 }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  describe('agrees with the slump that happens on firing', () => {
    it('straight bench: a 13 m wall over soft rock is predicted and slumps', () => {
      const opts = { plateauTop: 25 };
      const predicted = predictedOver(opts, standardShot());
      const actual = actualOverheight(opts, standardShot());
      expect(actual.slumps.length).toBeGreaterThan(0); // non-vacuous
      expect(predicted.length).toBeGreaterThan(0);
      expect(dump(predicted.map(p => p.face))).toEqual(dump(actual.faces));
      const p = predicted.find(q => q.face.crest.x === 13 && q.face.crest.z === 20)!;
      expect(p.face.heightM).toBe(13);
      expect(p.face.safeM).toBe(12);
      expect(p.rockId).toBe('cruite');
      expect(p.ratio).toBeCloseTo(13 / 12, 6);
    });

    it('same bench with a berm left standing: nothing predicted, nothing slumps', () => {
      const opts = { plateauTop: 25, plateauEdgeX: 8 }; // 5 m flat bench between the plateau and the crater
      const predicted = predictWallFaces(standardShot().plan, buildWallGrid(opts));
      const actual = actualOverheight(opts, standardShot());
      expect(actual.slumps).toEqual([]);
      expect(predicted).toEqual([]);
    });

    it('a face at 11 of 12 m is warned (amber range) and does not slump', () => {
      const opts = { plateauTop: 23 };
      const predicted = predictWallFaces(standardShot().plan, buildWallGrid(opts));
      const p = predicted.find(q => q.face.crest.x === 13 && q.face.crest.z === 20)!;
      expect(p).toBeDefined();
      expect(p.ratio).toBeGreaterThanOrEqual(0.8);
      expect(p.ratio).toBeLessThan(1);
      expect(actualOverheight(opts, standardShot()).slumps).toEqual([]);
    });

    it('boundary: a face exactly at its safe height (12 of 12 m) is warned and does not slump', () => {
      const opts = { plateauTop: 24 };
      const p = predictWallFaces(standardShot().plan, buildWallGrid(opts)).find(q => q.face.crest.x === 13 && q.face.crest.z === 20)!;
      expect(p).toBeDefined();
      expect(p.face.heightM).toBe(p.face.safeM);
      expect(p.ratio).toBe(1);
      expect(actualOverheight(opts, standardShot()).slumps).toEqual([]);
    });

    it('a face under 80% (9 of 12 m) is not warned and does not slump', () => {
      const opts = { plateauTop: 21 };
      expect(predictWallFaces(standardShot().plan, buildWallGrid(opts))).toEqual([]);
      expect(actualOverheight(opts, standardShot()).slumps).toEqual([]);
    });

    it('mixed rock: the weakest rock in the wall sets safeM, as on firing', () => {
      // molite (safe 15) with one cruite (safe 12) band in the wall rows
      const opts: WallGridOpts = { plateauTop: 25, rock: y => (y >= 13 && y <= 14 ? 'cruite' : 'molite') };
      const predicted = predictedOver(opts, standardShot());
      const actual = actualOverheight(opts, standardShot());
      expect(actual.slumps.length).toBeGreaterThan(0);
      expect(dump(predicted.map(p => p.face))).toEqual(dump(actual.faces));
      expect(predicted.find(p => p.face.crest.x === 13 && p.face.crest.z === 20)!.face.safeM).toBe(12);
      expect(predicted.find(p => p.face.crest.x === 13 && p.face.crest.z === 20)!.rockId).toBe('cruite');
    });

    it('uniform molite (safe 15): the same wall is only a warning and does not slump', () => {
      const opts: WallGridOpts = { plateauTop: 25, rock: 'molite' };
      const p = predictWallFaces(standardShot().plan, buildWallGrid(opts)).find(q => q.face.crest.x === 13 && q.face.crest.z === 20)!;
      expect(p).toBeDefined();
      expect(p.face.safeM).toBe(15);
      expect(p.rockId).toBe('molite');
      expect(p.ratio).toBeLessThan(1);
      expect(actualOverheight(opts, standardShot()).slumps).toEqual([]);
    });

    it('wet holes with water-sensitive boomite: the prediction uses the weakened shot, as on firing', () => {
      const opts = { plateauTop: 25 };
      const wetShot = standardShot('boomite');
      const wet = new Set(wetShot.holeIds);
      const predicted = predictedOver(opts, wetShot, wet);
      const actual = actualOverheight(opts, standardShot('boomite'), wet);
      expect(dump(predicted.map(p => p.face))).toEqual(dump(actual.faces));
    });

    it('wet holes change the crater: a wet boomite shot is not predicted like a dry one', () => {
      const opts = { plateauTop: 25 };
      const shot = standardShot('boomite');
      const dry = predictWallFaces(shot.plan, buildWallGrid(opts));
      const wet = predictWallFaces(shot.plan, buildWallGrid(opts), new Set(shot.holeIds));
      expect(JSON.stringify(wet)).not.toBe(JSON.stringify(dry));
    });
  });
});
