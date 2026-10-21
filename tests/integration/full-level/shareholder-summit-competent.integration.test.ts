// BlastSimulator2026 — Full-level integration test: Shareholder Summit, competent run (#1949)
// A competent player (the probe's `ladder` strategy, console commands only) completes the
// profit target before the board runs out of patience.
//
// Its own file so vitest.coverage.config.ts can leave it out: the run steps the simulation
// ~8,000 ticks, so hot Pathfinding branches pass 2^31 hits and v8's int32 counters wrap
// negative, which istanbul reports as uncovered (#1949). It still runs in `npm run test`.

import { describe, it, expect } from 'vitest';
import { _unlockShareholderSummit } from './helpers.js';
import { runCommand } from '../../../src/console/createRunner.js';
import { runProbe } from '../../../scripts/shared/probe-strategies.js';
import { SHAREHOLDER_SUMMIT_BOARD } from '../../../src/core/config/balance.js';

const LEVEL_ID = 'shareholder_summit';

/**
 * Tick budget of the competent run: the level is meant to be won in about six quarters;
 * twice that leaves slack for variance while still bounding the test.
 * The run stops at the first terminal state, so a win ends it early.
 */
const COMPETENT_HORIZON_QUARTERS = 12;
/** A competent run is ~minutes of simulation; fixed, deterministic seed. */
const COMPETENT_TIMEOUT_MS = 900_000;

describe('Shareholder Summit — competent strategy wins', () => {
  it('the scripted ladder player reaches the profit target (levelEndReason completed)', () => {
    const horizon = SHAREHOLDER_SUMMIT_BOARD.quarterTicks * COMPETENT_HORIZON_QUARTERS;
    const result = runProbe(
      { seed: 42, biome: 'volcanic_flats', kit: 'digger', strategy: 'ladder', horizon },
      (engine) => {
        _unlockShareholderSummit(engine.ctx.campaignProfile.campaign);
        return runCommand(engine, `campaign start level:${LEVEL_ID}`).success;
      },
    );

    // 'game_over:completed' is the run loop's name for a win; null would mean the horizon passed first.
    expect(result.endReason).toBe('game_over:completed');
    expect(result.endTick).toBeGreaterThan(0);
    expect(result.endTick).toBeLessThanOrEqual(horizon);
  }, COMPETENT_TIMEOUT_MS);
});
