// BlastSimulator2026 — a win mid-batch stops the `tick N` batch (#1313)

import { describe, it, expect, vi } from 'vitest';
import type { GameState } from '../../../src/core/state/GameState.js';

let calls = 0;
vi.mock('../../../src/core/engine/TickPipeline.js', async (orig) => {
  const actual = await orig<typeof import('../../../src/core/engine/TickPipeline.js')>();
  return {
    ...actual,
    runTick: (state: GameState, ...rest: unknown[]) => {
      calls++;
      const report = (actual.runTick as (...a: unknown[]) => ReturnType<typeof actual.runTick>)(state, ...rest);
      if (state.tickCount >= 3 && !state.levelEndReason) {
        state.levelEnded = true;
        state.levelEndReason = 'completed';
      }
      return report;
    },
  };
});

import { tickCommand } from '../../../src/console/commands/tick.js';
import { setupEvents } from '../../../src/core/events/index.js';
import { makeGameContext } from '../../helpers/gameContext.js';

describe('tick batch ends with the level (#1313)', () => {
  it('stops at the ending tick instead of running the remaining ticks', () => {
    setupEvents();
    calls = 0;
    const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 24 });
    const start = ctx.state!.tickCount;

    const result = tickCommand(ctx, ['50'], {});

    expect(result.success).toBe(true);
    expect(ctx.state!.levelEndReason).toBe('completed');
    expect(ctx.state!.tickCount).toBeLessThanOrEqual(start + 3);
    expect(calls).toBeLessThanOrEqual(3);
  });
});
