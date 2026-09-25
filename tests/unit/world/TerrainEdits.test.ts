// BlastSimulator2026 — TerrainEdits unit tests (#1180)
// TerrainEdits is a compact, replayable log of dig/add/fracture edits made to
// a VoxelGrid's generated baseline: per-(x,z)-column ordered non-overlapping
// segments plus a sparse per-voxel fracture-modifier log. All of TerrainEdits'
// instance methods and `static empty()` are still `throw new Error('not
// implemented')` stubs, so every test below is expected to FAIL in this RED
// phase — that failure is the point.

import { describe, it, expect } from 'vitest';
import { TerrainEdits, replayTerrainEdits, type EditBoundary } from '../../../src/core/world/TerrainEdits.js';
import { VoxelGrid, type VoxelRockComposition } from '../../../src/core/world/VoxelGrid.js';

/** Distinct, deterministic composition per numeric id — same id always
 *  produces a deep-equal (but not reference-equal) composition object, so
 *  tests can compare "same material" vs "different material" the way they
 *  did with raw palette-index numbers before #1180's retype. */
function comp(id: number): VoxelRockComposition {
  return { rocks: [{ rockId: `rock${id}`, coefficient: 1 }] };
}

describe('TerrainEdits.empty', () => {
  it('creates an edit record with no segments and no fracture entries', () => {
    const edits = TerrainEdits.empty();
    expect(edits.isEmpty()).toBe(true);
    expect(edits.columns()).toEqual([]);
    expect(edits.fractureEntries()).toEqual([]);
  });
});

describe('recordDig / recordAdd — basic segment creation', () => {
  it('recordDig creates a single dug segment covering the recorded range', () => {
    const edits = TerrainEdits.empty();
    edits.recordDig(3, 4, 2, 5);
    const segs = edits.segmentsAt(3, 4);
    expect(segs.length).toBe(1);
    expect(segs[0]).toMatchObject({ kind: 'dug', yLo: 2, yHi: 5 });
  });

  it('recordAdd creates a single added segment carrying the given compId/ores', () => {
    const edits = TerrainEdits.empty();
    edits.recordAdd(1, 1, 0, 3, comp(7), { blingite: 0.4 });
    const segs = edits.segmentsAt(1, 1);
    expect(segs.length).toBe(1);
    expect(segs[0]).toMatchObject({ kind: 'added', yLo: 0, yHi: 3, compId: comp(7), ores: { blingite: 0.4 } });
  });

  it('segmentsAt an unedited column returns empty', () => {
    const edits = TerrainEdits.empty();
    expect(edits.segmentsAt(9, 9)).toEqual([]);
  });
});

describe('adjacent segment merging on insert', () => {
  it('merges two adjacent recordAdd calls with the same compId/ores into one segment', () => {
    const edits = TerrainEdits.empty();
    edits.recordAdd(2, 2, 0, 2, comp(5), { dirtite: 0.1 });
    edits.recordAdd(2, 2, 3, 5, comp(5), { dirtite: 0.1 });
    const segs = edits.segmentsAt(2, 2);
    expect(segs.length).toBe(1);
    expect(segs[0]).toMatchObject({ kind: 'added', yLo: 0, yHi: 5, compId: comp(5) });
  });

  it('merges two adjacent recordDig calls into one segment (dug carries no material to distinguish)', () => {
    const edits = TerrainEdits.empty();
    edits.recordDig(2, 2, 0, 2);
    edits.recordDig(2, 2, 3, 5);
    const segs = edits.segmentsAt(2, 2);
    expect(segs.length).toBe(1);
    expect(segs[0]).toMatchObject({ kind: 'dug', yLo: 0, yHi: 5 });
  });

  it('does NOT merge two adjacent added segments with different compId, even though kind matches', () => {
    const edits = TerrainEdits.empty();
    edits.recordAdd(2, 2, 0, 2, comp(5));
    edits.recordAdd(2, 2, 3, 5, comp(6));
    const segs = edits.segmentsAt(2, 2);
    expect(segs.length).toBe(2);
  });

  it('does NOT merge two adjacent added segments with the same compId but different ores', () => {
    const edits = TerrainEdits.empty();
    edits.recordAdd(2, 2, 0, 2, comp(5), { blingite: 0.4 });
    edits.recordAdd(2, 2, 3, 5, comp(5), { blingite: 0.5 });
    const segs = edits.segmentsAt(2, 2);
    expect(segs.length).toBe(2);
  });
});

describe('a dig punching a hole in an existing added segment', () => {
  it('fully overlapping the added segment removes it entirely', () => {
    const edits = TerrainEdits.empty();
    edits.recordAdd(4, 4, 2, 8, comp(3));
    edits.recordDig(4, 4, 0, 10);
    const segs = edits.segmentsAt(4, 4);
    expect(segs.some(s => s.kind === 'added')).toBe(false);
  });

  it('punching a hole in the middle splits the added segment into two shorter added segments either side', () => {
    const edits = TerrainEdits.empty();
    edits.recordAdd(4, 4, 0, 10, comp(3));
    edits.recordDig(4, 4, 4, 6);
    const segs = [...edits.segmentsAt(4, 4)].sort((a, b) => a.yLo - b.yLo);
    expect(segs.length).toBe(3);
    expect(segs[0]).toMatchObject({ kind: 'added', yLo: 0, yHi: 3, compId: comp(3) });
    expect(segs[1]).toMatchObject({ kind: 'dug', yLo: 4, yHi: 6 });
    expect(segs[2]).toMatchObject({ kind: 'added', yLo: 7, yHi: 10, compId: comp(3) });
  });
});

describe('an add landing inside an existing dug region', () => {
  it('landing fully inside splits the dug segment into two shorter dug segments either side', () => {
    const edits = TerrainEdits.empty();
    edits.recordDig(4, 4, 0, 10);
    edits.recordAdd(4, 4, 4, 6, comp(9));
    const segs = [...edits.segmentsAt(4, 4)].sort((a, b) => a.yLo - b.yLo);
    expect(segs.length).toBe(3);
    expect(segs[0]).toMatchObject({ kind: 'dug', yLo: 0, yHi: 3 });
    expect(segs[1]).toMatchObject({ kind: 'added', yLo: 4, yHi: 6, compId: comp(9) });
    expect(segs[2]).toMatchObject({ kind: 'dug', yLo: 7, yHi: 10 });
  });

  it('fully covering the dug segment removes it entirely', () => {
    const edits = TerrainEdits.empty();
    edits.recordDig(4, 4, 2, 8);
    edits.recordAdd(4, 4, 0, 10, comp(9));
    const segs = edits.segmentsAt(4, 4);
    expect(segs.some(s => s.kind === 'dug')).toBe(false);
  });
});

describe('fill-then-dig / dig-then-refill of the identical volume', () => {
  it('recordAdd then recordDig of the same range on a previously unedited column ends in a plain dug segment, not two segments', () => {
    // TerrainEdits cannot know the generated baseline's material, so it must
    // not assume this pair cancels back to "no edit" — see #1180 review:
    // collapsing here would silently misreplay when the baseline at this
    // column was not air (e.g. a different rock than whatever was added).
    const edits = TerrainEdits.empty();
    edits.recordAdd(6, 6, 0, 5, comp(3));
    edits.recordDig(6, 6, 0, 5);
    expect(edits.segmentsAt(6, 6)).toEqual([{ yLo: 0, yHi: 5, kind: 'dug' }]);
  });

  it('recordDig then recordAdd of the same range/material on a previously unedited column ends in a plain added segment, not two segments', () => {
    // TerrainEdits cannot verify the caller's implicit claim that this add's
    // compId equals the generated baseline's material, so it must not assume
    // this pair cancels back to "no edit" — see #1180 review: collapsing here
    // would silently misreplay when the baseline material differs.
    const edits = TerrainEdits.empty();
    edits.recordDig(7, 7, 0, 5);
    edits.recordAdd(7, 7, 0, 5, comp(4));
    expect(edits.segmentsAt(7, 7)).toEqual([{ yLo: 0, yHi: 5, kind: 'added', compId: comp(4) }]);
  });

  it('recordDig then recordAdd of the same range/material on a previously added column does not grow beyond the pre-edit segment count', () => {
    const edits = TerrainEdits.empty();
    edits.recordAdd(6, 6, 0, 5, comp(3));
    const before = edits.segmentsAt(6, 6).length;
    edits.recordDig(6, 6, 0, 5);
    edits.recordAdd(6, 6, 0, 5, comp(3));
    expect(edits.segmentsAt(6, 6).length).toBeLessThanOrEqual(before);
  });

  it('recordAdd then recordDig of the same range/material on a previously dug column does not grow beyond the pre-edit segment count', () => {
    const edits = TerrainEdits.empty();
    edits.recordDig(8, 8, 0, 5);
    const before = edits.segmentsAt(8, 8).length;
    edits.recordAdd(8, 8, 0, 5, comp(3));
    edits.recordDig(8, 8, 0, 5);
    expect(edits.segmentsAt(8, 8).length).toBeLessThanOrEqual(before);
  });
});

describe('continuous / fractional boundaries', () => {
  it('recordAdd with bottomBoundary/topBoundary preserves the boundary\'s own density/compId/ores, distinct from the segment\'s interior compId', () => {
    const edits = TerrainEdits.empty();
    const bottomBoundary: EditBoundary = { density: 0.3, compId: comp(11) };
    const topBoundary: EditBoundary = { density: 0.6, compId: comp(12), ores: { sparkium: 0.2 } };
    edits.recordAdd(5, 5, 2, 6, comp(9), undefined, bottomBoundary, topBoundary);
    const segs = edits.segmentsAt(5, 5);
    expect(segs.length).toBe(1);
    expect(segs[0]!.compId).toEqual(comp(9));
    expect(segs[0]!.bottomBoundary).toEqual(bottomBoundary);
    expect(segs[0]!.topBoundary).toEqual(topBoundary);
  });

  it('recordDig with a bottomBoundary preserves the boundary on the resulting dug segment', () => {
    const edits = TerrainEdits.empty();
    const bottomBoundary: EditBoundary = { density: 0.4, compId: comp(2) };
    edits.recordDig(5, 5, 2, 6, bottomBoundary);
    const segs = edits.segmentsAt(5, 5);
    expect(segs.length).toBe(1);
    expect(segs[0]!.kind).toBe('dug');
    expect(segs[0]!.bottomBoundary).toEqual(bottomBoundary);
  });

  it('recordDig with a topBoundary preserves the boundary on the resulting dug segment', () => {
    const edits = TerrainEdits.empty();
    const topBoundary: EditBoundary = { density: 0.7, compId: comp(6), ores: { rustite: 0.1 } };
    edits.recordDig(5, 5, 2, 6, undefined, topBoundary);
    const segs = edits.segmentsAt(5, 5);
    expect(segs.length).toBe(1);
    expect(segs[0]!.topBoundary).toEqual(topBoundary);
  });
});

describe('recordFracture / fractureAt', () => {
  it('recordFracture sets a fracture modifier that fractureAt returns', () => {
    const edits = TerrainEdits.empty();
    edits.recordFracture(1, 2, 3, 0.4);
    expect(edits.fractureAt(1, 2, 3)).toBe(0.4);
  });

  it('recordFracture(x, y, z, 1) removes any existing entry (1 = unmodified default)', () => {
    const edits = TerrainEdits.empty();
    edits.recordFracture(1, 2, 3, 0.4);
    edits.recordFracture(1, 2, 3, 1);
    expect(edits.fractureAt(1, 2, 3)).toBeUndefined();
  });

  it('fractureAt an untouched voxel returns undefined', () => {
    const edits = TerrainEdits.empty();
    expect(edits.fractureAt(9, 9, 9)).toBeUndefined();
  });
});

describe('columns / fractureEntries / isEmpty', () => {
  it('isEmpty is true on a fresh record', () => {
    expect(TerrainEdits.empty().isEmpty()).toBe(true);
  });

  it('isEmpty is false after a recordDig call', () => {
    const edits = TerrainEdits.empty();
    edits.recordDig(1, 1, 0, 1);
    expect(edits.isEmpty()).toBe(false);
  });

  it('isEmpty is false after a recordAdd call', () => {
    const edits = TerrainEdits.empty();
    edits.recordAdd(1, 1, 0, 1, comp(3));
    expect(edits.isEmpty()).toBe(false);
  });

  it('isEmpty is false after a recordFracture call', () => {
    const edits = TerrainEdits.empty();
    edits.recordFracture(1, 1, 1, 0.5);
    expect(edits.isEmpty()).toBe(false);
  });

  it('isEmpty is true again once a fracture edit is undone back to the default modifier', () => {
    // A fracture's "unmodified" state (modifier === 1) is a fixed constant,
    // not generator-dependent, so recordFracture(..., 1) can safely delete
    // its entry and genuinely return to empty. A dig/add pair on a column
    // cannot make the same claim — see #1180 review: TerrainEdits has no way
    // to know whether a dig-then-add (or add-then-dig) pair nets back to the
    // generated baseline, since it never sees the generator's own material at
    // that column, so it must not collapse column edits to `[]` on a guess.
    const edits = TerrainEdits.empty();
    edits.recordFracture(2, 2, 2, 0.5);
    edits.recordFracture(2, 2, 2, 1);
    expect(edits.isEmpty()).toBe(true);
  });

  it('isEmpty stays false after a dig/add pair on a previously unedited column, even though the pair looks self-cancelling', () => {
    // Companion to the fracture case above: a dig-then-add (or add-then-dig)
    // pair never proves it reconstructs the generated baseline, so the
    // resulting single segment must remain recorded — see #1180 review.
    const edits = TerrainEdits.empty();
    edits.recordAdd(1, 1, 0, 3, comp(5));
    edits.recordDig(1, 1, 0, 3);
    expect(edits.isEmpty()).toBe(false);
  });

  it('columns() lists one entry per edited column, with its segments', () => {
    const edits = TerrainEdits.empty();
    edits.recordDig(1, 1, 0, 2);
    edits.recordAdd(5, 5, 0, 2, comp(4));
    const cols = edits.columns();
    expect(cols.length).toBe(2);
    const byKey = new Map(cols.map(c => [`${c.x},${c.z}`, c]));
    expect(byKey.get('1,1')!.segments.length).toBe(1);
    expect(byKey.get('5,5')!.segments.length).toBe(1);
  });

  it('fractureEntries() lists every non-default fracture modifier recorded', () => {
    const edits = TerrainEdits.empty();
    edits.recordFracture(1, 2, 3, 0.4);
    edits.recordFracture(4, 5, 6, 0.7);
    const entries = edits.fractureEntries();
    expect(entries.length).toBe(2);
    expect(entries).toContainEqual({ x: 1, y: 2, z: 3, modifier: 0.4 });
    expect(entries).toContainEqual({ x: 4, y: 5, z: 6, modifier: 0.7 });
  });
});

describe('idempotency — repeating an identical record call does not grow the record', () => {
  it('repeating an identical recordDig call twice leaves the segment count unchanged', () => {
    const edits = TerrainEdits.empty();
    edits.recordDig(3, 3, 1, 4);
    const before = edits.segmentsAt(3, 3).length;
    edits.recordDig(3, 3, 1, 4);
    expect(edits.segmentsAt(3, 3).length).toBe(before);
  });

  it('repeating an identical recordAdd call twice leaves the segment count unchanged', () => {
    const edits = TerrainEdits.empty();
    edits.recordAdd(3, 3, 1, 4, comp(8), { blingite: 0.2 });
    const before = edits.segmentsAt(3, 3).length;
    edits.recordAdd(3, 3, 1, 4, comp(8), { blingite: 0.2 });
    expect(edits.segmentsAt(3, 3).length).toBe(before);
  });

  it('repeating an identical recordFracture call twice leaves fractureEntries() unchanged', () => {
    const edits = TerrainEdits.empty();
    edits.recordFracture(2, 2, 2, 0.6);
    const before = edits.fractureEntries().length;
    edits.recordFracture(2, 2, 2, 0.6);
    expect(edits.fractureEntries().length).toBe(before);
  });
});

describe('replayTerrainEdits — unit-level round trip', () => {
  it('replays a dig + add + fracture edit record onto a fresh grid to match the live grid voxel for voxel', () => {
    const cruiteComp: VoxelRockComposition = { rocks: [{ rockId: 'cruite', coefficient: 1 }] };

    const live = new VoxelGrid(8, 8, 8);
    const rockCompId = live.palette.intern(cruiteComp);
    for (let y = 0; y <= 4; y++) live.fillVoxel(2, y, 2, rockCompId, undefined, 1);
    live.clearVoxel(2, 4, 2);
    live.fillVoxel(2, 5, 2, rockCompId, { blingite: 0.3 }, 1);
    live.setFractureAt(3, 3, 3, 0.6);

    // Same baseline as `live` before its own gameplay edits (mirrors what a
    // real freshly generated grid looks like before the recorded edits below
    // were ever made), built directly rather than depending on the mutators'
    // own (still-unimplemented) auto-recording.
    const fresh = new VoxelGrid(8, 8, 8);
    // A real generator interns every composition it paints into the grid it
    // is generating — mirror that here so `fresh`'s own palette assigns
    // `rockCompId` the same index `live`'s did (both are fresh palettes, and
    // this is the first composition either one interns). This is about
    // VoxelGrid.fillVoxel's own raw-index API (unchanged by #1180) and is
    // still needed regardless of the edits below, which carry portable
    // composition data and re-intern on replay themselves.
    fresh.palette.intern(cruiteComp);
    for (let y = 0; y <= 4; y++) fresh.fillVoxel(2, y, 2, rockCompId, undefined, 1);

    const edits = TerrainEdits.empty();
    edits.recordDig(2, 2, 4, 4);
    edits.recordAdd(2, 2, 5, 5, cruiteComp, { blingite: 0.3 });
    edits.recordFracture(3, 3, 3, 0.6);

    replayTerrainEdits(fresh, edits);

    for (let y = 0; y < 8; y++) {
      expect(fresh.densityAt(2, y, 2), `density mismatch at y=${y}`).toBe(live.densityAt(2, y, 2));
      expect(fresh.dominantRockAt(2, y, 2), `rock mismatch at y=${y}`).toBe(live.dominantRockAt(2, y, 2));
      expect(fresh.oresAt(2, y, 2), `ore mismatch at y=${y}`).toEqual(live.oresAt(2, y, 2));
    }
    expect(fresh.fractureAt(3, 3, 3)).toBe(live.fractureAt(3, 3, 3));
  });

  it('replaying an empty edit record onto a grid identical to the live baseline leaves it unchanged', () => {
    const live = new VoxelGrid(4, 4, 4);
    const compId = live.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    live.fillVoxel(1, 1, 1, compId, undefined, 1);

    const fresh = new VoxelGrid(4, 4, 4);
    fresh.fillVoxel(1, 1, 1, compId, undefined, 1);

    replayTerrainEdits(fresh, TerrainEdits.empty());

    expect(fresh.densityAt(1, 1, 1)).toBe(live.densityAt(1, 1, 1));
  });
});
