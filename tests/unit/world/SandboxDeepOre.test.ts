import { describe, it, expect } from 'vitest';
import * as balance from '../../../src/core/config/balance.js';
import {
  SANDBOX_DEEP_ORE_AFFINITY,
  ORE_G0_LAYER_DEPTH_M,
  ORE_G1_DEPOSIT_CUTOFF,
  ORE_PROGRESSION_HOST_FLOOR,
  ORE_DEPOSIT_RARITY_COVERAGE,
  DRILL_GRID_DEFAULT_DEPTH_BY_GRADE_M,
} from '../../../src/core/config/balance.js';
import { sandboxHostProbability, sandboxOreWindow, sandboxOresYieldedByRocks } from '../../../src/core/world/SandboxDeepOre.js';
import { oresYieldedByRocks, getRock, getAllRocks } from '../../../src/core/world/RockCatalog.js';
import { getOre, getAllOres, orePermitGrade } from '../../../src/core/world/OreCatalog.js';
import { getAllBiomes } from '../../../src/core/world/BiomeCatalog.js';

const G0 = ['dirtite', 'rustite'];
const G1 = ['blingite', 'gloomium', 'sparkium'];
const G2_G3 = ['craktonite', 'absurdium', 'treranium'];
const ALL_ROCK_IDS = getAllRocks().map(r => r.id);

describe('sandbox ore grade layers: constants (#2281)', () => {
  it('C7 the G0 layer is 5 m and is the grade 0 default hole depth', () => {
    expect(ORE_G0_LAYER_DEPTH_M).toBe(5);
    expect(DRILL_GRID_DEFAULT_DEPTH_BY_GRADE_M[0]).toBe(ORE_G0_LAYER_DEPTH_M);
  });

  it('the host floor is a probability strictly between 0 and 1', () => {
    expect(ORE_PROGRESSION_HOST_FLOOR).toBeGreaterThan(0);
    expect(ORE_PROGRESSION_HOST_FLOOR).toBeLessThan(1);
  });

  it('the G1 deposit cutoff sits below the uncommon and rare rarity cutoffs, so G1 deposits are wide', () => {
    expect(ORE_G1_DEPOSIT_CUTOFF).toBeGreaterThan(0);
    expect(ORE_G1_DEPOSIT_CUTOFF).toBeLessThan(ORE_DEPOSIT_RARITY_COVERAGE['uncommon']!);
    expect(ORE_G1_DEPOSIT_CUTOFF).toBeLessThan(ORE_DEPOSIT_RARITY_COVERAGE['rare']!);
  });

  it('the per-ore depth window table is gone: G0 and G2/G3 are decided by grade, not by an override table', () => {
    expect('SANDBOX_ORE_DEPTH_WINDOWS' in balance).toBe(false);
  });

  it('the catalog assigns the grades the layers rely on', () => {
    for (const id of G0) expect(orePermitGrade(id), id).toBe(0);
    for (const id of G1) expect(orePermitGrade(id), id).toBe(1);
    expect(orePermitGrade('craktonite')).toBe(2);
    expect(orePermitGrade('absurdium')).toBe(2);
    expect(orePermitGrade('treranium')).toBe(3);
  });
});

describe('sandboxHostProbability (#2281)', () => {
  it('every known rock hosts every G0 and G1 ore at no less than the progression floor', () => {
    for (const rockId of ALL_ROCK_IDS) {
      for (const oreId of [...G0, ...G1]) {
        expect(sandboxHostProbability(rockId, oreId), `${rockId}/${oreId}`).toBeGreaterThanOrEqual(ORE_PROGRESSION_HOST_FLOOR);
      }
    }
  });

  it('a probability is never above 1', () => {
    for (const rockId of ALL_ROCK_IDS) {
      for (const ore of getAllOres()) {
        expect(sandboxHostProbability(rockId, ore.id), `${rockId}/${ore.id}`).toBeLessThanOrEqual(1);
        expect(sandboxHostProbability(rockId, ore.id), `${rockId}/${ore.id}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('no rock hosts a G2 or G3 ore, even where the catalog does', () => {
    // the catalog hosts craktonite in obstiite and gnarlite, treranium in titanite and absurdite
    expect(getRock('titanite')!.oreProbabilities['treranium']).toBeGreaterThan(0);
    for (const rockId of ALL_ROCK_IDS) {
      for (const oreId of G2_G3) expect(sandboxHostProbability(rockId, oreId), `${rockId}/${oreId}`).toBe(0);
    }
  });

  it('an unknown rock hosts no G2 or G3 ore', () => {
    for (const oreId of G2_G3) expect(sandboxHostProbability('nope', oreId)).toBe(0);
  });

  it('a G1 ore the catalog does not host in a rock is still hosted there on a sandbox site', () => {
    expect(getRock('sandite')!.oreProbabilities['sparkium']).toBeUndefined();
    expect(sandboxHostProbability('sandite', 'sparkium')).toBeGreaterThan(0);
  });

  it('a rock the catalog already hosts a G0 ore in keeps at least the catalog probability', () => {
    expect(sandboxHostProbability('sandite', 'dirtite')).toBeGreaterThanOrEqual(getRock('sandite')!.oreProbabilities['dirtite']!);
    expect(sandboxHostProbability('cruite', 'dirtite')).toBeGreaterThanOrEqual(getRock('cruite')!.oreProbabilities['dirtite']!);
  });
});

describe('SANDBOX_DEEP_ORE_AFFINITY (#2281)', () => {
  it('holds only G1 rows: no G0, G2 or G3 override', () => {
    for (const [rockId, row] of Object.entries(SANDBOX_DEEP_ORE_AFFINITY)) {
      expect(getRock(rockId), rockId).toBeDefined();
      for (const oreId of Object.keys(row)) {
        expect(orePermitGrade(oreId), `${rockId}/${oreId}`).toBe(1);
      }
    }
  });

  it('keeps at least one G1 row', () => {
    expect(Object.keys(SANDBOX_DEEP_ORE_AFFINITY).length).toBeGreaterThan(0);
  });
});

describe('sandboxOreWindow (#2281)', () => {
  it('a G0 ore lives in the top layer, [0, ORE_G0_LAYER_DEPTH_M]', () => {
    for (const id of G0) {
      expect(sandboxOreWindow(getOre(id)!), id).toEqual([0, ORE_G0_LAYER_DEPTH_M]);
    }
  });

  it('a G1 ore keeps its catalog window, which starts at or below the G0 layer', () => {
    for (const id of G1) {
      const ore = getOre(id)!;
      const w = sandboxOreWindow(ore)!;
      expect(w, id).not.toBeNull();
      expect(w, id).toEqual([ore.depthMin, ore.depthMax]);
      expect(w[0], id).toBeGreaterThanOrEqual(ORE_G0_LAYER_DEPTH_M);
      expect(w[1], id).toBeGreaterThan(w[0]);
    }
  });

  it('C4 blingite starts right below the layer, gloomium at 8 m, sparkium at 15 m', () => {
    expect(sandboxOreWindow(getOre('blingite')!)![0]).toBe(ORE_G0_LAYER_DEPTH_M);
    expect(sandboxOreWindow(getOre('gloomium')!)![0]).toBe(8);
    expect(sandboxOreWindow(getOre('sparkium')!)![0]).toBe(15);
  });

  it('C2 a G2 or G3 ore has no window at all', () => {
    for (const id of G2_G3) expect(sandboxOreWindow(getOre(id)!), id).toBeNull();
  });

  it('the G0 window and every G1 window touch or leave a gap: no overlap deeper than the layer boundary', () => {
    for (const g0 of G0) {
      for (const g1 of G1) {
        expect(sandboxOreWindow(getOre(g0)!)![1]).toBeLessThanOrEqual(sandboxOreWindow(getOre(g1)!)![0]);
      }
    }
  });
});

describe('sandboxOresYieldedByRocks (#2281)', () => {
  const EXPECTED = [...G0, ...G1];

  it('every single rock yields the G0 and G1 ores in catalog order', () => {
    for (const rockId of ALL_ROCK_IDS) {
      expect(sandboxOresYieldedByRocks([rockId]), rockId).toEqual(EXPECTED);
    }
  });

  it('every biome yields the G0 and G1 ores from its dominant rocks, and no G2 or G3 ore', () => {
    for (const b of getAllBiomes()) {
      const ores = sandboxOresYieldedByRocks(b.dominantRocks);
      expect(ores, b.id).toEqual(EXPECTED);
      for (const id of G2_G3) expect(ores, b.id).not.toContain(id);
    }
  });

  it('an empty rock set yields nothing', () => {
    expect(sandboxOresYieldedByRocks([])).toEqual([]);
  });

  it('a known rock mixed with an unknown one still yields the G0 and G1 ores', () => {
    expect(sandboxOresYieldedByRocks(['nope', 'cruite'])).toEqual(EXPECTED);
  });

  it('the shared catalog and Level 1 ores are left alone', () => {
    expect(oresYieldedByRocks(['cruite', 'sandite', 'molite'])).toEqual(['dirtite', 'rustite', 'blingite']);
    expect(oresYieldedByRocks(['titanite'])).toContain('treranium');
    expect(getRock('titanite')!.oreProbabilities['treranium']).toBeGreaterThan(0);
  });
});
