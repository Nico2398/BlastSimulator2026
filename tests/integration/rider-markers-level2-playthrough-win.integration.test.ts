// BlastSimulator2026 — Integration: vehicle rider markers over the level2-playthrough-win replay (#2224)
// Every driver board/alight leaves a rider marker on the vehicle trail whose riderArc matches the rider
// trail, at tick batches of 1, 2, 4 and 8. The full scenario replays in minutes under coverage, so each batch size
// replays the prefix that has compared a handful of boards and alights (the level1 and tutorial files replay their scenarios in full).

import { describe, it } from 'vitest';
import { replayRiderMarkers } from '../helpers/riderMarkerReplay.js';

/** Board and alight markers each batch size must compare before its replay may stop. */
const VERIFIED_TRANSITIONS = 10;

describe.each([1, 2, 4, 8])('vehicle rider markers over the level2-playthrough-win replay, batches of %i ticks (#2224)', (batchSize) => {
  it('leaves consistent rider markers', () => {
    replayRiderMarkers('level2-playthrough-win', batchSize, VERIFIED_TRANSITIONS);
  }, 600_000);
});
