// BlastSimulator2026 — Coverage for the console-facing siteBounds(ctx) wrapper.
// The pure logic (siteBoundsForGrid) is tested in
// tests/unit/engine/BuildingTaskHelpers.test.ts; this file only exercises the
// GameContext → grid unwrap that lives here (#1086).

import { describe, it, expect } from 'vitest';
import { siteBounds } from '../../../src/console/commands/buildingHelpers.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { DEFAULT_GRID_SIZE } from '../../../src/core/config/balance.js';
import type { GameContext } from '../../../src/console/commands/world.js';

function emptyContext(): GameContext {
  return {
    state: null,
    grid: null,
    landscape: null,
    playableArea: null,
    emitter: new EventEmitter(),
  };
}

describe('siteBounds', () => {
  it('falls back to a DEFAULT_GRID_SIZE square at the origin when ctx.grid is null', () => {
    const ctx = emptyContext();
    expect(siteBounds(ctx)).toEqual({
      width: DEFAULT_GRID_SIZE,
      depth: DEFAULT_GRID_SIZE,
      originX: 0,
      originZ: 0,
    });
  });
});
