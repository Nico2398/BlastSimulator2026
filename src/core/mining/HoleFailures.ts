// BlastSimulator2026 — Why a charged hole did not open its rock (#2202)
//
// A shot that broke nothing, or broke rock that stayed sealed, used to rate
// "bad" with no explanation. This reads the finished energy field and the
// fragmentation mask and names, per charged hole, what went wrong.

import { VoxelGrid } from '../world/VoxelGrid.js';
import { isWaterSensitiveCharge } from './WetHoles.js';
import { buildHoleSeeds, contains, indexOf } from './EnergyPropagation.js';
import type { BlastPlan } from './BlastPlan.js';
import type { EnergyField } from './EnergyPropagation.js';
import type { FragmentationResult } from './VoxelFragmentation.js';

type HoleFailureKind = 'below_threshold' | 'fizzled' | 'buried';

export interface HoleFailure {
  holeId: string;
  kind: HoleFailureKind;
  /** `below_threshold`: whole percent more energy the hole would have needed. */
  moreEnergyPct?: number;
  /** `buried`: metres of intact rock left above the charge in the hole's column. */
  rockAboveM?: number;
}

interface HoleFailureInput {
  plan: BlastPlan;
  field: EnergyField;
  fragmentation: FragmentationResult;
  holeSurfaceYs: Record<string, number>;
  wetHoleIds: ReadonlySet<string>;
}

/** One entry per charged hole that broke no rock at its charge, or left its column sealed. */
export function analyseHoleFailures(input: HoleFailureInput): HoleFailure[] {
  const { plan, field, fragmentation, holeSurfaceYs, wetHoleIds } = input;
  const failures: HoleFailure[] = [];
  for (const hole of plan.holes) {
    const charge = plan.charges[hole.id];
    if (!charge || charge.amountKg <= 0) continue;
    const surfaceY = holeSurfaceYs[hole.id] ?? 0;
    const hx = Math.floor(hole.x);
    const hz = Math.floor(hole.z);
    const cells = buildHoleSeeds(surfaceY, hole.depth, charge.amountKg, 1, hx, hz, field.box.minY, hole.diameter, charge.explosiveId);
    if (cells.length === 0) continue;

    let chargeBroke = false;
    let bestRatio = 0;
    let topY = -Infinity;
    for (const { y } of cells) {
      topY = Math.max(topY, y);
      if (!contains(field, hx, y, hz)) continue;
      const i = indexOf(field, hx, y, hz);
      if (fragmentation.mask[i]) chargeBroke = true;
      const threshold = field.threshold[i] ?? 0;
      if (threshold > 0) bestRatio = Math.max(bestRatio, (field.effective[i] ?? 0) / threshold);
    }

    if (!chargeBroke) {
      const fizzled = wetHoleIds.has(hole.id) && isWaterSensitiveCharge(charge);
      if (fizzled) {
        failures.push({ holeId: hole.id, kind: 'fizzled' });
      } else {
        const moreEnergyPct = bestRatio > 0 ? Math.max(1, Math.round((1 / bestRatio - 1) * 100)) : undefined;
        failures.push({ holeId: hole.id, kind: 'below_threshold', ...(moreEnergyPct !== undefined ? { moreEnergyPct } : {}) });
      }
      continue;
    }

    const collarY = surfaceY - 1;
    if (!contains(field, hx, collarY, hz)) continue;
    const collar = indexOf(field, hx, collarY, hz);
    if (field.air[collar] || fragmentation.mask[collar]) continue;
    let rock = 0;
    for (let y = topY + 1; y <= collarY; y++) {
      if (!contains(field, hx, y, hz)) continue;
      const i = indexOf(field, hx, y, hz);
      if (!field.air[i] && !fragmentation.mask[i]) rock++;
    }
    failures.push({ holeId: hole.id, kind: 'buried', rockAboveM: rock * VoxelGrid.CELL_SIZE });
  }
  return failures;
}
