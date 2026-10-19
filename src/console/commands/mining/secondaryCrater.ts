// BlastSimulator2026 — Carves craters for detonated explosive warehouses via the blast pipeline (#1896)

import type { MiningContext } from './types.js';
import type { Steps } from '../../../core/engine/Steps.js';
import type { SecondaryBlastOutcome } from '../../../core/entities/SecondaryBlast.js';
import type { VillagePosition } from '../../../core/mining/BlastExecution.js';

export interface SecondaryCraterReport {
  warehouseId: number;
  explosivesKg: number;
  craterVoxels: number;
  craterFragments: number;
}

/** Fire each outcome's crater plan through the blast pipeline; one report per carved crater. */
export function* carveSecondaryCraters(
  _ctx: MiningContext,
  _outcomes: readonly SecondaryBlastOutcome[],
  _villages: readonly VillagePosition[],
  _wetHoleIds: ReadonlySet<string>,
): Steps<SecondaryCraterReport[]> {
  // TODO: implement
  return [];
}
