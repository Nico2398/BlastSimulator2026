// BlastSimulator2026 — shared test fixture for Software.ts / SoftwarePreview.ts unit tests.

import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { createGridPlan } from '../../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../../src/core/mining/ChargePlan.js';
import { autoVPattern } from '../../../src/core/mining/Sequence.js';
import { assembleBlastPlan, type BlastPlan } from '../../../src/core/mining/BlastPlan.js';

/** A filled 30x15x30 grid with a 4x4 hole pattern, charged and sequenced. */
export function makeTestPlan(): { grid: VoxelGrid; plan: BlastPlan } {
  const grid = new VoxelGrid(30, 15, 30);
  for (let z = 5; z <= 20; z++)
    for (let y = 0; y <= 8; y++)
      for (let x = 5; x <= 20; x++)
        grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId: 'molite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });

  const holes = createGridPlan({ x: 10, z: 10 }, 2, 2, 3, 6, 0.15);
  const holeIds = holes.map(h => h.id);
  const holeDepths: Record<string, number> = {};
  for (const h of holes) holeDepths[h.id] = h.depth;
  const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 5, 2);
  const delays = autoVPattern(holes, 25);
  const plan = assembleBlastPlan(holes, charges, delays);
  return { grid, plan };
}
