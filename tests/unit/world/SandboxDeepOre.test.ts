import { describe, it, expect } from 'vitest';
import { SANDBOX_DEEP_ORE_AFFINITY, SANDBOX_ORE_DEPTH_WINDOWS } from '../../../src/core/config/balance.js';
import { sandboxHostProbability, sandboxOreWindow, sandboxOresYieldedByRocks } from '../../../src/core/world/SandboxDeepOre.js';
import { oresYieldedByRocks, getRock } from '../../../src/core/world/RockCatalog.js';
import { getOre } from '../../../src/core/world/OreCatalog.js';

describe('sandbox deep ore content (#1933)', () => {
  it('overrides the catalog host probability where a row exists and falls back otherwise', () => {
    expect(sandboxHostProbability('sandite', 'sparkium')).toBeGreaterThan(0);
    expect(getRock('sandite')!.oreProbabilities['sparkium']).toBeUndefined();
    expect(sandboxHostProbability('sandite', 'dirtite')).toBe(getRock('sandite')!.oreProbabilities['dirtite']);
    expect(sandboxHostProbability('nope', 'dirtite')).toBe(0);
  });

  it('leaves the shared catalog and Level 1 ores alone', () => {
    expect(oresYieldedByRocks(['cruite', 'sandite', 'molite'])).toEqual(['dirtite', 'rustite', 'blingite']);
    expect(sandboxOresYieldedByRocks(['cruite', 'sandite', 'molite'])).toContain('sparkium');
  });

  it('no override changes what a sandbox rock yields at 10 m or shallower', () => {
    for (const [rockId, row] of Object.entries(SANDBOX_DEEP_ORE_AFFINITY)) {
      for (const [oreId, p] of Object.entries(row)) {
        const catalogP = getRock(rockId)!.oreProbabilities[oreId] ?? 0;
        const ore = getOre(oreId)!;
        const changed = p !== catalogP;
        // an override that changes the host probability must only act on an ore that starts at 15 m or deeper
        if (changed) expect(sandboxOreWindow(ore)[0], `${rockId}/${oreId}`).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it('every sandbox window starts at or below the catalog start only for ores that are deeper than 15 m', () => {
    for (const [oreId, [min]] of Object.entries(SANDBOX_ORE_DEPTH_WINDOWS)) {
      const ore = getOre(oreId)!;
      expect(min, oreId).toBeGreaterThanOrEqual(ore.depthMin);
      expect(min, oreId).toBeGreaterThanOrEqual(15);
    }
  });
});
