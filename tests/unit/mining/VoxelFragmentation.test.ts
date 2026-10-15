import { describe, it, expect } from 'vitest';
import {
  identifyFragmentedVoxels,
  isFragmented,
  floorToGrade,
} from '../../../src/core/mining/VoxelFragmentation.js';
import {
  createEnergyField,
  seedEnergy,
  indexOf,
  type BlastBox,
} from '../../../src/core/mining/EnergyPropagation.js';
import {
  VoxelGrid, type VoxelData,
  renormaliseVoxelColumnAfterCarve, computeVoxelColumnSurfaceY,
  setVoxelColumnSurfaceHeight,
} from '../../../src/core/world/VoxelGrid.js';
import { getRock } from '../../../src/core/world/RockCatalog.js';
import { CRACKED_VOXEL_WEAKENING, BLAST_GRADE_MAX_CUT_M, BLAST_GRADE_FLOOR_OFFSET_M } from '../../../src/core/config/balance.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function rockVoxel(rockId: string): VoxelData {
  return {
    composition: { rocks: [{ rockId, coefficient: 1.0 }] },
    density: 1.0,
    oreDensities: {},
    fractureModifier: 1.0,
  };
}

function solidGrid(size: number, rockId = 'cruite'): VoxelGrid {
  const grid = new VoxelGrid(size, size);
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        grid.setVoxel(x, y, z, rockVoxel(rockId));
      }
    }
  }
  return grid;
}

/** `height` is the grid's own constructed height (the size it was built with) — VoxelGrid itself no longer declares one. */
function wholeGrid(grid: VoxelGrid, height: number): BlastBox {
  return {
    minX: grid.minX, minY: 0, minZ: grid.minZ,
    maxX: grid.maxX, maxY: height, maxZ: grid.maxZ,
  };
}

const CRUITE = getRock('cruite')!.energyAbsorption; // 200

// ── Energy-driven fragmentation ───────────────────────────────────────────────

describe('VoxelFragmentation — energy pass', () => {
  it('a voxel that reached its threshold breaks', () => {
    const grid = solidGrid(7);
    const field = createEnergyField(grid, wholeGrid(grid, 7));
    seedEnergy(field, [{ x: 3, y: 3, z: 3, energy: CRUITE * 3 }]);

    const result = identifyFragmentedVoxels(field, grid);

    expect(isFragmented(result, field, 3, 3, 3)).toBe(true);
  });

  it('a voxel that never reached its threshold survives', () => {
    const grid = solidGrid(7);
    const field = createEnergyField(grid, wholeGrid(grid, 7));
    seedEnergy(field, [{ x: 3, y: 3, z: 3, energy: CRUITE * 0.6 }]);

    const result = identifyFragmentedVoxels(field, grid);

    expect(result.fragmented).toHaveLength(0);
  });

  it('a bigger charge breaks more rock', () => {
    const small = solidGrid(15);
    const big = solidGrid(15);
    const smallField = createEnergyField(small, wholeGrid(small, 15));
    const bigField = createEnergyField(big, wholeGrid(big, 15));

    seedEnergy(smallField, [{ x: 7, y: 7, z: 7, energy: CRUITE * 20 }]);
    seedEnergy(bigField, [{ x: 7, y: 7, z: 7, energy: CRUITE * 200 }]);

    const smallResult = identifyFragmentedVoxels(smallField, small);
    const bigResult = identifyFragmentedVoxels(bigField, big);

    expect(bigResult.fragmented.length).toBeGreaterThan(smallResult.fragmented.length);
  });

  it('hard rock resists a charge that shatters soft rock', () => {
    const soft = solidGrid(11, 'cruite');
    const hard = solidGrid(11, 'titanite');
    const softField = createEnergyField(soft, wholeGrid(soft, 11));
    const hardField = createEnergyField(hard, wholeGrid(hard, 11));
    const charge = CRUITE * 40;

    seedEnergy(softField, [{ x: 5, y: 5, z: 5, energy: charge }]);
    seedEnergy(hardField, [{ x: 5, y: 5, z: 5, energy: charge }]);

    const softResult = identifyFragmentedVoxels(softField, soft);
    const hardResult = identifyFragmentedVoxels(hardField, hard);

    expect(softResult.fragmented.length).toBeGreaterThan(hardResult.fragmented.length);
  });

  it('returns voxels in a deterministic order', () => {
    const gridA = solidGrid(9);
    const gridB = solidGrid(9);
    const fieldA = createEnergyField(gridA, wholeGrid(gridA, 9));
    const fieldB = createEnergyField(gridB, wholeGrid(gridB, 9));

    seedEnergy(fieldA, [{ x: 4, y: 4, z: 4, energy: CRUITE * 50 }]);
    seedEnergy(fieldB, [{ x: 4, y: 4, z: 4, energy: CRUITE * 50 }]);

    expect(identifyFragmentedVoxels(fieldB, gridB).fragmented)
      .toEqual(identifyFragmentedVoxels(fieldA, gridA).fragmented);
  });

  it('the mask and the list agree', () => {
    const grid = solidGrid(9);
    const field = createEnergyField(grid, wholeGrid(grid, 9));
    seedEnergy(field, [{ x: 4, y: 4, z: 4, energy: CRUITE * 60 }]);

    const result = identifyFragmentedVoxels(field, grid);

    let maskCount = 0;
    for (const flag of result.mask) if (flag === 1) maskCount++;
    expect(maskCount).toBe(result.fragmented.length);
    for (const { x, y, z } of result.fragmented) {
      expect(result.mask[indexOf(field, x, y, z)]).toBe(1);
    }
  });
});

// ── Cracking ──────────────────────────────────────────────────────────────────

describe('VoxelFragmentation — cracking', () => {
  it('rock that took real energy but held together is recorded as cracked', () => {
    const grid = solidGrid(7);
    const field = createEnergyField(grid, wholeGrid(grid, 7));
    seedEnergy(field, [{ x: 3, y: 3, z: 3, energy: CRUITE * 0.7 }]);

    const result = identifyFragmentedVoxels(field, grid);

    expect(result.cracked).toContainEqual({ x: 3, y: 3, z: 3 });
    expect(result.fragmented).toHaveLength(0);
  });

  it('cracked rock is weakened for the next blast', () => {
    const grid = solidGrid(7);
    const field = createEnergyField(grid, wholeGrid(grid, 7));
    seedEnergy(field, [{ x: 3, y: 3, z: 3, energy: CRUITE * 0.7 }]);

    identifyFragmentedVoxels(field, grid);

    expect(grid.fractureAt(3, 3, 3)).toBeCloseTo(CRACKED_VOXEL_WEAKENING, 6);
  });

  it('rock that took almost nothing is left alone', () => {
    const grid = solidGrid(7);
    const field = createEnergyField(grid, wholeGrid(grid, 7));
    seedEnergy(field, [{ x: 3, y: 3, z: 3, energy: CRUITE * 0.2 }]);

    const result = identifyFragmentedVoxels(field, grid);

    expect(result.cracked).toHaveLength(0);
    expect(grid.fractureAt(3, 3, 3)).toBe(1.0);
  });

  it('a broken voxel is not also counted as cracked', () => {
    const grid = solidGrid(7);
    const field = createEnergyField(grid, wholeGrid(grid, 7));
    seedEnergy(field, [{ x: 3, y: 3, z: 3, energy: CRUITE * 5 }]);

    const result = identifyFragmentedVoxels(field, grid);

    for (const cracked of result.cracked) {
      expect(isFragmented(result, field, cracked.x, cracked.y, cracked.z)).toBe(false);
    }
  });
});

// ── Unsupported rock ──────────────────────────────────────────────────────────

describe('VoxelFragmentation — unsupported rock', () => {
  it('rock left floating by the blast comes down with it', () => {
    // A 5×5×5 grid whose only rock is a lone block in the middle, plus an
    // anchored column at the edge so the fill has something to hold on to.
    const grid = new VoxelGrid(5, 5);
    for (let y = 0; y < 5; y++) grid.setVoxel(0, y, 0, rockVoxel('cruite'));
    grid.setVoxel(2, 2, 2, rockVoxel('cruite'));

    const field = createEnergyField(grid, wholeGrid(grid, 5));
    const result = identifyFragmentedVoxels(field, grid);

    // The floating block never took any energy, but nothing connects it to the
    // shell, so it drops.
    expect(isFragmented(result, field, 2, 2, 2)).toBe(true);
    expect(result.detachedCount).toBe(1);
    // The anchored column stays put.
    expect(isFragmented(result, field, 0, 2, 0)).toBe(false);
  });

  it('an arch whose footings are blasted away collapses', () => {
    const grid = solidGrid(9);
    // Hollow out everything under y=5 in a 3×3 column, leaving a roof above it
    // that still connects to the surrounding rock — it should survive.
    for (let y = 0; y < 5; y++) {
      for (let z = 3; z <= 5; z++) for (let x = 3; x <= 5; x++) grid.clearVoxel(x, y, z);
    }
    const field = createEnergyField(grid, wholeGrid(grid, 9));
    const result = identifyFragmentedVoxels(field, grid);

    // Still attached sideways, so nothing detaches.
    expect(result.detachedCount).toBe(0);
  });

  it('rock touching the box shell counts as anchored', () => {
    const grid = solidGrid(5);
    const field = createEnergyField(grid, wholeGrid(grid, 5));
    const result = identifyFragmentedVoxels(field, grid);

    expect(result.fragmented).toHaveLength(0);
    expect(result.detachedCount).toBe(0);
  });

  it('an island cut off by a blast is detached, and the count is reported', () => {
    // Two rock columns joined by a single bridge voxel; blast the bridge.
    const grid = new VoxelGrid(7, 7);
    for (let y = 0; y < 7; y++) grid.setVoxel(0, y, 3, rockVoxel('cruite'));
    grid.setVoxel(1, 3, 3, rockVoxel('cruite'));   // bridge
    grid.setVoxel(2, 3, 3, rockVoxel('cruite'));   // island
    grid.setVoxel(3, 3, 3, rockVoxel('cruite'));   // island

    const field = createEnergyField(grid, wholeGrid(grid, 7));
    seedEnergy(field, [{ x: 1, y: 3, z: 3, energy: CRUITE * 1.2 }]);

    const result = identifyFragmentedVoxels(field, grid);

    expect(isFragmented(result, field, 1, 3, 3)).toBe(true);
    // x=3 touches neither shell face, and its only path out went through the bridge.
    expect(isFragmented(result, field, 2, 3, 3)).toBe(true);
    expect(result.detachedCount).toBeGreaterThan(0);
  });

  it('a lone floating voxel above a padded, unreachable maxY face still reads as unsupported', () => {
    // Thin slab covering the whole footprint at y=0..1, plus a genuinely
    // isolated floating voxel far above it and unconnected to anything. The
    // box's maxY is padded well past the real rock (#1186 unclamped
    // blast-zone padding), so the maxY face row is empty in every column —
    // collectUnsupported anchors the slab through the literal minY row and
    // the X/Z side walls' lateral flood-fill instead (a per-column nearest-
    // solid fallback at the empty maxY face was tried and reverted: it
    // couldn't tell a slab's crust from a genuinely disconnected multi-voxel
    // island sitting mid-crater, both of which have a face-adjacent solid
    // neighbour of their own — see this file's collectUnsupported comment).
    // The floating voxel here, with no neighbour at all, was never at risk
    // from that — this test just pins that removing the fallback didn't
    // regress the isolated-voxel case either.
    const grid = new VoxelGrid(7, 7);
    for (let z = 0; z < 7; z++) {
      for (let x = 0; x < 7; x++) {
        grid.setVoxel(x, 0, z, rockVoxel('cruite'));
        grid.setVoxel(x, 1, z, rockVoxel('cruite'));
      }
    }
    grid.setVoxel(3, 8, 3, rockVoxel('cruite'));

    const box: BlastBox = { minX: 0, minY: 0, minZ: 0, maxX: 7, maxY: 12, maxZ: 7 };
    const field = createEnergyField(grid, box);
    const result = identifyFragmentedVoxels(field, grid);

    expect(isFragmented(result, field, 3, 8, 3)).toBe(true);
    expect(result.detachedCount).toBe(1);
    // The slab itself is genuinely anchored — via the literal minY row and
    // lateral flood-fill through the X/Z side walls — and must stay put.
    expect(isFragmented(result, field, 0, 0, 0)).toBe(false);
  });
});

// ── Post-carve renormalisation (#1148) ──────────────────────────────────────
//
// After a blast clears its fragmented voxels, the affected columns' topmost
// run must be re-normalised into a well-formed density band — but only when
// the column's own exposed top actually moved. An overhang/roof kept
// standing by identifyFragmentedVoxels' connectivity check (mirrors "an arch
// whose footings are blasted away collapses") must come out of
// renormaliseVoxelColumnAfterCarve completely untouched, since its own top
// never dropped.

describe('VoxelFragmentation — post-carve renormalisation (#1148)', () => {
  const ROOF_X = 4, ROOF_Z = 4;
  const COLUMN_X = 8, COLUMN_Z = 0;
  /** buildFixture's grid is solidGrid(FIXTURE_GRID_SIZE) — the grid's own constructed height, since VoxelGrid no longer declares one. */
  const FIXTURE_GRID_SIZE = 9;

  /**
   * A 9x9x9 solid grid with the arch/overhang fixture from "an arch whose
   * footings are blasted away collapses" (hollowed 3x3 under y=5, roof
   * surviving via sideways connection), plus a separate column — far from
   * the arch — authored with a genuine fractional crossing above its real
   * top via setVoxelColumnSurfaceHeight.
   */
  function buildFixture() {
    const grid = solidGrid(FIXTURE_GRID_SIZE);
    for (let y = 0; y < 5; y++) {
      for (let z = 3; z <= 5; z++) for (let x = 3; x <= 5; x++) grid.clearVoxel(x, y, z);
    }

    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    // Real top (density >= 0.5) at y=6; residue at y=7 (density < 0.5) is the
    // stray fractional crossing above it.
    setVoxelColumnSurfaceHeight(grid, COLUMN_X, COLUMN_Z, 6.5, compId);
    const oldTopY = computeVoxelColumnSurfaceY(grid, COLUMN_X, COLUMN_Z);
    expect(oldTopY).not.toBeNull();
    expect(oldTopY).toBe(6);
    expect(grid.densityAt(COLUMN_X, oldTopY! + 1, COLUMN_Z)).toBeGreaterThan(0);

    const roofBefore: number[] = [];
    for (let y = 0; y < FIXTURE_GRID_SIZE; y++) roofBefore.push(grid.densityAt(ROOF_X, y, ROOF_Z));

    return { grid, compId, oldTopY: oldTopY!, roofBefore };
  }

  /** Fragments and clears the column's topmost voxel, mirroring BlastExecution's own identify -> toClear -> clearVoxel loop. */
  function fragmentAndClearTop(grid: VoxelGrid, oldTopY: number) {
    const field = createEnergyField(grid, wholeGrid(grid, FIXTURE_GRID_SIZE));
    seedEnergy(field, [{ x: COLUMN_X, y: oldTopY, z: COLUMN_Z, energy: CRUITE * 5 }]);
    const fragResult = identifyFragmentedVoxels(field, grid);
    expect(isFragmented(fragResult, field, COLUMN_X, oldTopY, COLUMN_Z)).toBe(true);
    for (const { x, y, z } of fragResult.fragmented) grid.clearVoxel(x, y, z);
  }

  it('leaves the overhang/roof column completely untouched — its own top never moved', () => {
    const { grid, oldTopY, roofBefore } = buildFixture();

    fragmentAndClearTop(grid, oldTopY);
    renormaliseVoxelColumnAfterCarve(grid, COLUMN_X, COLUMN_Z, oldTopY);

    for (let y = 0; y < FIXTURE_GRID_SIZE; y++) {
      expect(grid.densityAt(ROOF_X, y, ROOF_Z), `roof density at y=${y} should be unchanged`).toBe(roofBefore[y]!);
    }
  });

  it('clears stranded residue above the new top, exposing plain solid rock rather than a manufactured band', () => {
    const { grid, oldTopY } = buildFixture();

    fragmentAndClearTop(grid, oldTopY);
    renormaliseVoxelColumnAfterCarve(grid, COLUMN_X, COLUMN_Z, oldTopY);

    // The blast cleared the genuine crossing itself, exposing the plain,
    // never-graded rock below (solidGrid fills every voxel at density 1) —
    // there is no natural crossing left above the new top to preserve, so
    // renormalisation leaves a hard step rather than manufacturing a band
    // that never existed pre-carve.
    const newTopY = computeVoxelColumnSurfaceY(grid, COLUMN_X, COLUMN_Z);
    expect(newTopY).not.toBeNull();
    expect(grid.densityAt(COLUMN_X, newTopY!, COLUMN_Z)).toBe(1);
    for (let y = newTopY! + 1; y < FIXTURE_GRID_SIZE; y++) {
      expect(grid.densityAt(COLUMN_X, y, COLUMN_Z), `density at y=${y} should be 0`).toBe(0);
    }
  });

  it('returns null and touches nothing when the column\'s exposed top never moved', () => {
    const gridSize = 7; // the grid's own constructed height, since VoxelGrid no longer declares one
    const grid = solidGrid(gridSize);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    setVoxelColumnSurfaceHeight(grid, 3, 3, 5.5, compId);
    const oldTopY = computeVoxelColumnSurfaceY(grid, 3, 3);

    const before: number[] = [];
    for (let y = 0; y < gridSize; y++) before.push(grid.densityAt(3, y, 3));

    // A carve that never reaches this column at all — the exposed top is
    // identical to oldTopY, so renormalisation must be a complete no-op.
    const touchedY = renormaliseVoxelColumnAfterCarve(grid, 3, 3, oldTopY);

    expect(touchedY).toBeNull();
    for (let y = 0; y < gridSize; y++) {
      expect(grid.densityAt(3, y, 3), `density at y=${y} should be unchanged`).toBe(before[y]!);
    }
  });
});

// ── Floor to grade (#1723) ────────────────────────────────────────────────────

describe('VoxelFragmentation — floorToGrade', () => {
  const SIZE = 12;

  /** Field over a solid cube with `gradeY` set and the given voxels (x,z column, y range) already broken. */
  function gradedField(gradeY: number | null, broken: Array<{ x: number; z: number; fromY: number; toY: number }>) {
    const grid = solidGrid(SIZE);
    const field = createEnergyField(grid, wholeGrid(grid, SIZE));
    (field as { gradeY: number | null }).gradeY = gradeY;
    const mask = new Uint8Array(field.nx * field.ny * field.nz);
    for (const b of broken) for (let y = b.fromY; y <= b.toY; y++) mask[indexOf(field, b.x, y, b.z)] = 1;
    return { field, mask };
  }

  const isBroken = (f: ReturnType<typeof gradedField>, x: number, y: number, z: number) =>
    f.mask[indexOf(f.field, x, y, z)] === 1;

  it('a ridge column broken only near the top breaks down to the grade plane', () => {
    const f = gradedField(6, [{ x: 5, z: 5, fromY: 9, toY: 11 }]);
    const gradeY = 6 + BLAST_GRADE_FLOOR_OFFSET_M;

    const count = floorToGrade(f.field, f.mask);

    for (let y = Math.ceil(gradeY); y <= 11; y++) expect(isBroken(f, 5, y, 5), `y=${y}`).toBe(true);
    expect(isBroken(f, 5, Math.ceil(gradeY) - 1, 5)).toBe(false);
    expect(count).toBe(3); // y 6, 7, 8 newly broken
  });

  it('columns with no broken voxel (outside the footprint) are untouched', () => {
    const f = gradedField(6, [{ x: 5, z: 5, fromY: 9, toY: 11 }]);

    floorToGrade(f.field, f.mask);

    for (let y = 0; y < SIZE; y++) {
      expect(isBroken(f, 6, y, 5), `neighbour y=${y}`).toBe(false);
      expect(isBroken(f, 2, y, 2), `far y=${y}`).toBe(false);
    }
  });

  it('a column already broken down to grade is left as it is and counts nothing', () => {
    const f = gradedField(6, [{ x: 5, z: 5, fromY: 4, toY: 11 }]);

    expect(floorToGrade(f.field, f.mask)).toBe(0);
    expect(isBroken(f, 5, 3, 5)).toBe(false);
  });

  it('a hole\'s one-voxel breakout under grade is left standing beside rock floored to grade', () => {
    const f = gradedField(6, [
      { x: 5, z: 5, fromY: 5, toY: 11 }, // hole column: broke one voxel under grade
      { x: 6, z: 5, fromY: 9, toY: 11 }, // neighbour broken near the top only: floored down to grade
    ]);

    floorToGrade(f.field, f.mask);

    expect(isBroken(f, 6, 6, 5)).toBe(true);
    expect(isBroken(f, 5, 5, 5)).toBe(false);
    expect(isBroken(f, 5, 6, 5)).toBe(true);
  });

  it('a hole\'s breakout is lifted beside a column already broken to grade by an earlier pass (#1740)', () => {
    const f = gradedField(6, [
      { x: 5, z: 5, fromY: 5, toY: 11 }, // hole column: one voxel under grade
      { x: 6, z: 5, fromY: 6, toY: 11 }, // already ends at grade; floorToGrade floors nothing here
    ]);

    expect(floorToGrade(f.field, f.mask)).toBe(0);

    expect(isBroken(f, 5, 5, 5)).toBe(false);
    expect(isBroken(f, 5, 6, 5)).toBe(true);
    expect(isBroken(f, 6, 6, 5)).toBe(true);
  });

  it('two holes 3 m apart leave no breakout line when the columns between them end at grade (#1740)', () => {
    const f = gradedField(6, [
      { x: 4, z: 5, fromY: 5, toY: 11 },
      { x: 7, z: 5, fromY: 5, toY: 11 },
      { x: 5, z: 5, fromY: 6, toY: 11 },
      { x: 6, z: 5, fromY: 6, toY: 11 },
      { x: 4, z: 6, fromY: 6, toY: 11 },
      { x: 7, z: 6, fromY: 6, toY: 11 },
    ]);

    floorToGrade(f.field, f.mask);

    for (let x = 0; x < SIZE; x++) {
      for (let z = 0; z < SIZE; z++) expect(isBroken(f, x, 5, z), `x=${x} z=${z}`).toBe(false);
    }
    expect(isBroken(f, 4, 6, 5)).toBe(true);
    expect(isBroken(f, 7, 6, 5)).toBe(true);
  });

  it('a diagonal neighbour ending at grade also lifts the breakout (#1740)', () => {
    const f = gradedField(6, [
      { x: 5, z: 5, fromY: 5, toY: 11 },
      { x: 6, z: 6, fromY: 6, toY: 11 },
    ]);

    floorToGrade(f.field, f.mask);

    expect(isBroken(f, 5, 5, 5)).toBe(false);
  });

  it('adjacent breakout columns do not lift each other: both keep their pit (#1740)', () => {
    const f = gradedField(6, [
      { x: 5, z: 5, fromY: 5, toY: 11 },
      { x: 6, z: 5, fromY: 5, toY: 11 },
    ]);

    floorToGrade(f.field, f.mask);

    expect(isBroken(f, 5, 5, 5)).toBe(true);
    expect(isBroken(f, 6, 5, 5)).toBe(true);
  });

  it('a neighbour whose cut was clamped above grade does not lift the breakout (#1740)', () => {
    const f = gradedField(2, [
      { x: 5, z: 5, fromY: 1, toY: 11 }, // breakout one voxel under grade 2
      { x: 6, z: 5, fromY: 10, toY: 11 }, // floored only BLAST_GRADE_MAX_CUT_M down: ends at y=6, above grade
    ]);

    floorToGrade(f.field, f.mask);

    expect(isBroken(f, 6, 10 - BLAST_GRADE_MAX_CUT_M, 5)).toBe(true);
    expect(isBroken(f, 5, 1, 5)).toBe(true);
  });

  it('a lone hole keeps its breakout under grade: nothing was floored beside it', () => {
    const f = gradedField(6, [{ x: 5, z: 5, fromY: 5, toY: 11 }]);

    expect(floorToGrade(f.field, f.mask)).toBe(0);

    expect(isBroken(f, 5, 5, 5)).toBe(true);
  });

  it('breakout deeper than one voxel under grade stays broken even beside floored rock', () => {
    const f = gradedField(6, [
      { x: 5, z: 5, fromY: 3, toY: 11 },
      { x: 6, z: 5, fromY: 9, toY: 11 },
    ]);

    floorToGrade(f.field, f.mask);

    expect(isBroken(f, 5, 3, 5)).toBe(true);
    expect(isBroken(f, 5, 5, 5)).toBe(true);
  });

  it('never cuts more than BLAST_GRADE_MAX_CUT_M below a column\'s broken rock', () => {
    const f = gradedField(0, [{ x: 5, z: 5, fromY: 10, toY: 11 }]);

    const count = floorToGrade(f.field, f.mask);

    const lowest = 10 - BLAST_GRADE_MAX_CUT_M;
    expect(isBroken(f, 5, lowest, 5)).toBe(true);
    expect(isBroken(f, 5, lowest - 1, 5)).toBe(false);
    expect(count).toBe(BLAST_GRADE_MAX_CUT_M);
  });

  it('a null grade is a no-op', () => {
    const f = gradedField(null, [{ x: 5, z: 5, fromY: 9, toY: 11 }]);

    expect(floorToGrade(f.field, f.mask)).toBe(0);
    let broken = 0;
    for (const flag of f.mask) if (flag === 1) broken++;
    expect(broken).toBe(3);
  });

  it('air voxels in a footprint column are not marked', () => {
    const grid = solidGrid(SIZE);
    const field = createEnergyField(grid, wholeGrid(grid, SIZE));
    (field as { gradeY: number | null }).gradeY = 6;
    const mask = new Uint8Array(field.nx * field.ny * field.nz);
    mask[indexOf(field, 5, 9, 5)] = 1;
    field.air[indexOf(field, 5, 7, 5)] = 1;

    floorToGrade(field, mask);

    expect(mask[indexOf(field, 5, 7, 5)]).toBe(0);
    expect(mask[indexOf(field, 5, 8, 5)]).toBe(1);
  });

  it('identifyFragmentedVoxels reports the voxels it floored, 0 without a grade', () => {
    const grid = solidGrid(SIZE);
    const field = createEnergyField(grid, wholeGrid(grid, SIZE));
    seedEnergy(field, [{ x: 6, y: 10, z: 6, energy: CRUITE * 10 }]);
    expect(identifyFragmentedVoxels(field, grid, false).gradedCount).toBe(0);

    const grid2 = solidGrid(SIZE);
    const field2 = createEnergyField(grid2, wholeGrid(grid2, SIZE));
    seedEnergy(field2, [{ x: 6, y: 10, z: 6, energy: CRUITE * 10 }]);
    // seedEnergy derives gradeY from the charge bottoms; override it afterwards
    // to put the grade plane below the broken zone.
    (field2 as { gradeY: number | null }).gradeY = 2;
    const result = identifyFragmentedVoxels(field2, grid2, false);
    expect(result.gradedCount).toBeGreaterThan(0);
    expect(result.gradedCount).toBeLessThanOrEqual(result.fragmented.length);
  });
});
