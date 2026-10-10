// BlastSimulator2026 — Integration: starting buildings stand on levelled pads (#1583)
// Every level with a startingSite: after `campaign start`, each pre-placed
// building's footprint is flat and the rendered base sits on the ground.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { recordProfit } from '../../src/core/campaign/Campaign.js';
import { getAllLevels } from '../../src/core/campaign/Level.js';
import { getBuildingDef } from '../../src/core/entities/Building.js';
import { getSmoothTerrainSurfaceY } from '../../src/core/world/VoxelGrid.js';
import { buildingFootprintSurfaceY } from '../../src/renderer/EntitySync.js';

const LEVELS_WITH_SITE = getAllLevels().filter((l) => l.startingSite !== undefined);

function startLevel(levelId: string) {
  const { runner, ctx } = createRunner();
  recordProfit(ctx.campaignProfile.campaign, 'tutorial_pit', 5000);
  recordProfit(ctx.campaignProfile.campaign, 'dusty_hollow', 80000);
  const result = runner.run(`campaign start level:${levelId}`);
  expect(result.success, result.output).toBe(true);
  return { grid: ctx.grid!, state: ctx.state! };
}

describe('starting buildings are levelled (#1583)', () => {
  it('covers the tutorial and Dusty Hollow (non-vacuous)', () => {
    const ids = LEVELS_WITH_SITE.map((l) => l.id);
    expect(ids).toContain('tutorial_pit');
    expect(ids).toContain('dusty_hollow');
  });

  for (const level of LEVELS_WITH_SITE) {
    describe(level.id, () => {
      const { grid, state } = startLevel(level.id);
      const expectedCount = level.startingSite!.buildings.length;

      it('places every declared starting building', () => {
        expect(expectedCount).toBeGreaterThan(0);
        expect(state.buildings.buildings.length).toBe(expectedCount);
      });

      for (const b of state.buildings.buildings) {
        const cells = getBuildingDef(b.type, b.tier).footprint.map(([dx, dz]) => ({ x: b.x + dx, z: b.z + dz }));

        it(`${b.type} at (${b.x},${b.z}): integer column heights are equal`, () => {
          const heights = cells.map((c) => Math.floor(getSmoothTerrainSurfaceY(grid, c.x, c.z)));
          expect(Math.max(...heights) - Math.min(...heights)).toBe(0);
        });

        it(`${b.type} at (${b.x},${b.z}): continuous surface spread < 1e-6`, () => {
          const heights = cells.map((c) => getSmoothTerrainSurfaceY(grid, c.x, c.z));
          expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1e-6);
        });

        it(`${b.type} at (${b.x},${b.z}): render base is not below any footprint cell`, () => {
          const y = buildingFootprintSurfaceY(b, (x, z) => getSmoothTerrainSurfaceY(grid, x, z));
          for (const c of cells) expect(y).toBeGreaterThanOrEqual(getSmoothTerrainSurfaceY(grid, c.x, c.z) - 1e-6);
        });
      }
    });
  }
});
