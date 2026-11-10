// BlastSimulator2026 — HoleFailures unit tests (#2202)
// Why a charged hole did not open its rock: read off the finished energy field
// and fragmentation mask, one entry per failing hole, nothing for a hole that
// opened or was never charged.

import { describe, it, expect, beforeEach } from 'vitest';
import { VoxelGrid, firstEmptyLayerAboveGround } from '../../../src/core/world/VoxelGrid.js';
import { createGridPlan, type DrillHole } from '../../../src/core/mining/DrillPlan.js';
import { assembleBlastPlan, type BlastPlan } from '../../../src/core/mining/BlastPlan.js';
import { buildPlanEnergyField } from '../../../src/core/mining/BlastExecution.js';
import { identifyFragmentedVoxels } from '../../../src/core/mining/VoxelFragmentation.js';
import { analyseHoleFailures, type HoleFailure } from '../../../src/core/mining/HoleFailures.js';

const holeCounter = { nextHoleId: 1 };
beforeEach(() => { holeCounter.nextHoleId = 1; });

/** Solid rock of one kind from y=0 to `topY` inclusive over [lo, hi] in x and z. */
function solidBlock(rock: string, topY: number, lo = 2, hi = 30): VoxelGrid {
  const grid = new VoxelGrid(40, 40);
  for (let z = lo; z <= hi; z++) {
    for (let y = 0; y <= topY; y++) {
      for (let x = lo; x <= hi; x++) {
        grid.setVoxel(x, y, z, {
          composition: { rocks: [{ rockId: rock, coefficient: 1.0 }] },
          density: 1.0,
          oreDensities: {},
          fractureModifier: 1.0,
        });
      }
    }
  }
  return grid;
}

interface HoleSpec {
  x: number;
  z: number;
  depth: number;
  /** Omitted = the hole is drilled but never charged. */
  charge?: { explosiveId: string; amountKg: number };
}

/** One 1×1 hole per spec; ids come from the shared counter in spec order. */
function planOf(specs: HoleSpec[]): { plan: BlastPlan; holes: DrillHole[] } {
  const holes = specs.map(s => createGridPlan(holeCounter, { x: s.x, z: s.z }, 1, 1, 4, s.depth, 0.089)[0]!);
  const charges: BlastPlan['charges'] = {};
  specs.forEach((s, i) => {
    if (s.charge) charges[holes[i]!.id] = { ...s.charge, stemmingM: 2 };
  });
  return { plan: assembleBlastPlan(holes, charges), holes };
}

function analyse(plan: BlastPlan, grid: VoxelGrid, wet: ReadonlySet<string> = new Set()): HoleFailure[] {
  const field = buildPlanEnergyField(plan, grid, wet);
  expect(field).not.toBeNull();
  const fragmentation = identifyFragmentedVoxels(field!, grid, false);
  const holeSurfaceYs: Record<string, number> = {};
  for (const h of plan.holes) holeSurfaceYs[h.id] = firstEmptyLayerAboveGround(grid, h.x, h.z);
  return analyseHoleFailures({ plan, field: field!, fragmentation, holeSurfaceYs, wetHoleIds: wet });
}

const boomite = (amountKg: number) => ({ explosiveId: 'boomite', amountKg });
const krackle = (amountKg: number) => ({ explosiveId: 'krackle', amountKg });

describe('analyseHoleFailures — holes that opened', () => {
  it('reports nothing for a hole whose charge broke out to the surface', () => {
    const grid = solidBlock('molite', 10);
    const { plan } = planOf([{ x: 12, z: 12, depth: 4, charge: boomite(8) }]);
    expect(analyse(plan, grid)).toEqual([]);
  });

  it('reports nothing for a deeper hole that still opened its column', () => {
    const grid = solidBlock('molite', 10);
    const { plan } = planOf([{ x: 12, z: 12, depth: 8, charge: boomite(8) }]);
    expect(analyse(plan, grid)).toEqual([]);
  });

  it('reports nothing for a water-resistant charge in a wet hole that still broke', () => {
    const grid = solidBlock('molite', 10);
    const { plan, holes } = planOf([{ x: 12, z: 12, depth: 4, charge: krackle(2) }]);
    expect(analyse(plan, grid, new Set([holes[0]!.id]))).toEqual([]);
  });
});

describe('analyseHoleFailures — below_threshold (C2)', () => {
  it('flags a hole whose charge was far too small to break anything', () => {
    const grid = solidBlock('molite', 10);
    const { plan, holes } = planOf([{ x: 12, z: 12, depth: 8, charge: boomite(0.05) }]);
    const failures = analyse(plan, grid);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.holeId).toBe(holes[0]!.id);
    expect(failures[0]!.kind).toBe('below_threshold');
  });

  it('gives the shortfall as a whole percent above zero', () => {
    const grid = solidBlock('molite', 10);
    const { plan } = planOf([{ x: 12, z: 12, depth: 8, charge: boomite(0.05) }]);
    const pct = analyse(plan, grid)[0]!.moreEnergyPct;
    expect(pct).toBeDefined();
    expect(Number.isInteger(pct)).toBe(true);
    expect(pct!).toBeGreaterThan(0);
  });

  it('carries no rockAboveM on a below_threshold entry', () => {
    const grid = solidBlock('molite', 10);
    const { plan } = planOf([{ x: 12, z: 12, depth: 8, charge: boomite(0.05) }]);
    expect(analyse(plan, grid)[0]!.rockAboveM).toBeUndefined();
  });

  it('asks for more extra energy from a weaker charge than from a stronger one', () => {
    const weak = analyse(planOf([{ x: 12, z: 12, depth: 8, charge: boomite(0.01) }]).plan, solidBlock('molite', 10));
    holeCounter.nextHoleId = 1;
    const stronger = analyse(planOf([{ x: 12, z: 12, depth: 8, charge: boomite(0.05) }]).plan, solidBlock('molite', 10));
    expect(weak[0]!.kind).toBe('below_threshold');
    expect(stronger[0]!.kind).toBe('below_threshold');
    expect(weak[0]!.moreEnergyPct!).toBeGreaterThan(stronger[0]!.moreEnergyPct!);
  });

  it('flags a dry water-sensitive charge too weak to break rock as below_threshold, not fizzled', () => {
    const grid = solidBlock('molite', 10);
    const { plan } = planOf([{ x: 12, z: 12, depth: 4, charge: boomite(0.05) }]);
    expect(analyse(plan, grid)[0]!.kind).toBe('below_threshold');
  });

  it('flags a wet hole with a water-resistant explosive as below_threshold, not fizzled', () => {
    const grid = solidBlock('molite', 10);
    const { plan, holes } = planOf([{ x: 12, z: 12, depth: 8, charge: krackle(0.05) }]);
    const failures = analyse(plan, grid, new Set([holes[0]!.id]));
    expect(failures).toHaveLength(1);
    expect(failures[0]!.kind).toBe('below_threshold');
  });
});

describe('analyseHoleFailures — fizzled (C3)', () => {
  it('flags a wet hole with a water-sensitive charge that broke nothing', () => {
    const grid = solidBlock('molite', 10);
    const { plan, holes } = planOf([{ x: 12, z: 12, depth: 4, charge: boomite(0.2) }]);
    const failures = analyse(plan, grid, new Set([holes[0]!.id]));
    expect(failures).toHaveLength(1);
    expect(failures[0]!.holeId).toBe(holes[0]!.id);
    expect(failures[0]!.kind).toBe('fizzled');
    expect(failures[0]!.moreEnergyPct).toBeUndefined();
    expect(failures[0]!.rockAboveM).toBeUndefined();
  });

  it('the same charge dry opens its rock, so it is the water that fizzled it', () => {
    const grid = solidBlock('molite', 10);
    const { plan } = planOf([{ x: 12, z: 12, depth: 4, charge: boomite(0.2) }]);
    expect(analyse(plan, grid)).toEqual([]);
  });

  it('takes precedence over below_threshold when the dry charge would not have broken either', () => {
    const wetGrid = solidBlock('molite', 10);
    const wetPlan = planOf([{ x: 12, z: 12, depth: 8, charge: boomite(0.05) }]);
    const wet = analyse(wetPlan.plan, wetGrid, new Set([wetPlan.holes[0]!.id]));

    holeCounter.nextHoleId = 1;
    const dryPlan = planOf([{ x: 12, z: 12, depth: 8, charge: boomite(0.05) }]);
    const dry = analyse(dryPlan.plan, solidBlock('molite', 10));

    expect(wet[0]!.kind).toBe('fizzled');
    expect(dry[0]!.kind).toBe('below_threshold');
  });

  it('ignores wet ids that are not holes of the plan', () => {
    const grid = solidBlock('molite', 10);
    const { plan } = planOf([{ x: 12, z: 12, depth: 4, charge: boomite(0.2) }]);
    expect(analyse(plan, grid, new Set(['hole-not-in-this-plan']))).toEqual([]);
  });
});

describe('analyseHoleFailures — buried (C4)', () => {
  /** One light charge at the bottom of a hole under a thick intact cap. */
  function buried(depth: number, topY: number) {
    const grid = solidBlock('molite', topY);
    const { plan, holes } = planOf([{ x: 15, z: 15, depth, charge: boomite(0.2) }]);
    return { failures: analyse(plan, grid), holeId: holes[0]!.id };
  }

  it('flags a charge that broke rock but left its column sealed under intact rock', () => {
    const { failures, holeId } = buried(28, 30);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.holeId).toBe(holeId);
    expect(failures[0]!.kind).toBe('buried');
    expect(failures[0]!.moreEnergyPct).toBeUndefined();
  });

  it('gives the metres of intact rock left above the charge: positive, less than the hole depth', () => {
    const rock = buried(28, 30).failures[0]!.rockAboveM;
    expect(rock).toBeDefined();
    expect(rock!).toBeGreaterThan(28 / 2);
    expect(rock!).toBeLessThan(28);
  });

  it('a shallower hole leaves less rock above its charge than a deeper one', () => {
    const deep = buried(28, 30).failures[0]!;
    holeCounter.nextHoleId = 1;
    const shallow = buried(8, 10).failures[0]!;
    expect(deep.kind).toBe('buried');
    expect(shallow.kind).toBe('buried');
    expect(shallow.rockAboveM!).toBeGreaterThan(0);
    expect(shallow.rockAboveM!).toBeLessThan(deep.rockAboveM!);
  });
});

describe('analyseHoleFailures — plans of several holes', () => {
  it('names only the failing hole when its neighbour opened normally', () => {
    const grid = solidBlock('molite', 10);
    const { plan, holes } = planOf([
      { x: 6, z: 6, depth: 4, charge: boomite(8) },
      { x: 24, z: 24, depth: 4, charge: boomite(0.05) },
    ]);
    const failures = analyse(plan, grid);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.holeId).toBe(holes[1]!.id);
    expect(failures[0]!.kind).toBe('below_threshold');
  });

  it('gives one entry per failing hole, each hole once, with its own kind', () => {
    const grid = solidBlock('molite', 10);
    const { plan, holes } = planOf([
      { x: 6, z: 6, depth: 4, charge: boomite(0.05) },
      { x: 24, z: 6, depth: 4, charge: boomite(0.2) },
      { x: 15, z: 24, depth: 4, charge: boomite(8) },
    ]);
    const wet = new Set([holes[1]!.id]);
    const failures = analyse(plan, grid, wet);
    const byHole = new Map(failures.map(f => [f.holeId, f.kind]));
    expect(failures).toHaveLength(2);
    expect(byHole.get(holes[0]!.id)).toBe('below_threshold');
    expect(byHole.get(holes[1]!.id)).toBe('fizzled');
    expect(byHole.has(holes[2]!.id)).toBe(false);
  });

  it('produces no entry for a drilled hole that was never charged', () => {
    const grid = solidBlock('molite', 10);
    const { plan, holes } = planOf([
      { x: 6, z: 6, depth: 4 },
      { x: 24, z: 24, depth: 4, charge: boomite(0.05) },
    ]);
    const failures = analyse(plan, grid);
    expect(failures.map(f => f.holeId)).toEqual([holes[1]!.id]);
  });

  it('is deterministic: the same input yields the same entries', () => {
    const grid = solidBlock('molite', 10);
    const { plan } = planOf([
      { x: 6, z: 6, depth: 4, charge: boomite(0.05) },
      { x: 24, z: 24, depth: 4, charge: boomite(8) },
    ]);
    const field = buildPlanEnergyField(plan, grid)!;
    const fragmentation = identifyFragmentedVoxels(field, grid, false);
    const holeSurfaceYs: Record<string, number> = {};
    for (const h of plan.holes) holeSurfaceYs[h.id] = firstEmptyLayerAboveGround(grid, h.x, h.z);
    const input = { plan, field, fragmentation, holeSurfaceYs, wetHoleIds: new Set<string>() };
    expect(analyseHoleFailures(input)).toEqual(analyseHoleFailures(input));
  });
});
