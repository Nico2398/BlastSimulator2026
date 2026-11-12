// BlastSimulator2026 — Integration: vehicle rider markers over the tutorial-interactive replay (#2224)
// Every driver board/alight leaves a rider marker on the vehicle trail whose riderArc matches the rider
// trail, at tick batches of 1, 2, 4 and 8.

import { describe, it } from 'vitest';
import { replayRiderMarkers } from '../helpers/riderMarkerReplay.js';

describe.each([1, 2, 4, 8])('vehicle rider markers over the tutorial-interactive replay, batches of %i ticks (#2224)', (batchSize) => {
  it('leaves consistent rider markers', () => {
    replayRiderMarkers('tutorial-interactive', batchSize);
  }, 600_000);
});
