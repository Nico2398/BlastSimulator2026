import { describe, it, expect } from 'vitest';
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

  it('every ore a sandbox row adds starts at 15 m or deeper', () => {
    for (const id of sandboxOresYieldedByRocks(['cruite', 'sandite', 'molite', 'grumpite', 'clunkite', 'obstiite', 'gnarlite', 'absurdite', 'titanite'])) {
      if (['dirtite', 'rustite', 'blingite', 'gloomium'].includes(id)) continue;
      expect(sandboxOreWindow(getOre(id)!)[0], id).toBeGreaterThanOrEqual(15);
    }
  });
});
