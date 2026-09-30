// BlastSimulator2026 — GameRendererPicking ramp helpers (#1298)
import { describe, it, expect } from 'vitest';
import { entityWorldPosition, rampIdAtTile, type PickingDeps } from '../../../src/renderer/GameRendererPicking.js';
import type { BuiltRamp } from '../../../src/core/state/GameState.js';

function ramp(id: number, minX: number, maxX: number, minZ: number, maxZ: number): BuiltRamp {
  return { id, footprint: { minX, maxX, minZ, maxZ } } as unknown as BuiltRamp;
}

function deps(builtRamps?: readonly BuiltRamp[]): PickingDeps {
  return { builtRamps, getTerrainSurfaceY: () => 7 } as unknown as PickingDeps;
}

describe('GameRendererPicking ramp helpers (#1298)', () => {
  it('rampIdAtTile returns the covering ramp id', () => {
    expect(rampIdAtTile(deps([ramp(3, 2, 5, 2, 4)]), 4, 3)).toBe(3);
  });

  it('rampIdAtTile returns null outside every footprint', () => {
    expect(rampIdAtTile(deps([ramp(3, 2, 5, 2, 4)]), 9, 9)).toBeNull();
  });

  it('rampIdAtTile returns null when no ramps are loaded', () => {
    expect(rampIdAtTile(deps(), 1, 1)).toBeNull();
  });

  it('entityWorldPosition centres on the ramp footprint at terrain height', () => {
    const p = entityWorldPosition(deps([ramp(3, 2, 5, 2, 4)]), 'ramp', 3);
    expect(p?.x).toBe(4);
    expect(p?.y).toBe(7);
    expect(p?.z).toBe(3.5);
  });

  it('entityWorldPosition returns null for an unknown ramp id', () => {
    expect(entityWorldPosition(deps([ramp(3, 2, 5, 2, 4)]), 'ramp', 99)).toBeNull();
  });

  it('entityWorldPosition returns null for a ramp when none are loaded', () => {
    expect(entityWorldPosition(deps(), 'ramp', 1)).toBeNull();
  });
});
