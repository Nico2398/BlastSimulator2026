import { describe, it, expect } from 'vitest';
import { stateCommand } from '../../../src/console/commands/state.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { TrackedFragment } from '../../../src/core/economy/Logistics.js';
import { makeEmptyGameContext } from '../../helpers/gameContext.js';

// ── Helper factories ────────────────────────────────────────────────────────

/** Create a minimal MiningContext wrapping the given GameState. */
function makeCtx(state: ReturnType<typeof createGame>): MiningContext {
  return makeEmptyGameContext({ state });
}

function makeFragment(id: number, fragState: TrackedFragment['state']): TrackedFragment {
  return {
    fragment: {
      id,
      position: { x: 0, y: 0, z: 0 },
      volume: 1,
      mass: 100,
      rockId: 'sandite',
      oreDensities: {},
      initialVelocity: { x: 0, y: 0, z: 0 },
      isProjection: false,
      halfExtents: { x: 0.4, y: 0.4, z: 0.4 },
      shapeSeed: id,
    },
    state: fragState,
    vehicleId: null,
  };
}

function dumpLogistics(ctx: MiningContext): Record<string, unknown> {
  const result = stateCommand(ctx, ['full'], {});
  expect(result.success).toBe(true);
  return (JSON.parse(result.output) as { logistics: Record<string, unknown> }).logistics;
}

// ── Tests ───────────────────────────────────────────────────────────────────
// A late-level site tracks hundreds of thousands of fragments; dumping them
// all made `state full` a 318 MB string that hung every harness read of
// __gameState() downstream (#481). The dump must stay bounded no matter how
// many fragments the site holds — and must say so when it truncates.

describe('stateCommand — logistics fragment serialization', () => {
  it('keeps small fragment lists intact and reports zero truncated', () => {
    const state = createGame({ seed: 42 });
    state.logistics.fragments = [makeFragment(1, 'on_ground'), makeFragment(2, 'stored')];
    const logistics = dumpLogistics(makeCtx(state));

    expect(logistics.fragmentCount).toBe(2);
    expect((logistics.fragments as unknown[]).length).toBe(2);
    expect(logistics.fragmentsTruncated).toBe(0);
    expect(logistics.fragmentCountsByState).toEqual({ on_ground: 1, stored: 1 });
  });

  it('caps a huge fragment list and reports the truncation explicitly', () => {
    const state = createGame({ seed: 42 });
    state.logistics.fragments = Array.from({ length: 5000 }, (_, i) =>
      makeFragment(i, i % 3 === 0 ? 'stored' : 'on_ground'),
    );
    const ctx = makeCtx(state);
    const result = stateCommand(ctx, ['full'], {});
    expect(result.success).toBe(true);
    // The whole point: the dump stays a bounded string.
    expect(result.output.length).toBeLessThan(2_000_000);

    const logistics = (JSON.parse(result.output) as { logistics: Record<string, unknown> }).logistics;
    expect(logistics.fragmentCount).toBe(5000);
    expect((logistics.fragments as unknown[]).length).toBe(200);
    expect(logistics.fragmentsTruncated).toBe(4800);
    const counts = logistics.fragmentCountsByState as Record<string, number>;
    expect(counts.stored! + counts.on_ground!).toBe(5000);
  });

  it('still reports storage capacity and stored mass alongside the summary', () => {
    const state = createGame({ seed: 42 });
    state.logistics.storageCapacityKg = 9000;
    state.logistics.storedMassKg = 1234;
    const logistics = dumpLogistics(makeCtx(state));

    expect(logistics.storageCapacityKg).toBe(9000);
    expect(logistics.storedMassKg).toBe(1234);
  });
});
