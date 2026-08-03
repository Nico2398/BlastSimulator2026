// PlayableArea — the site's claimed-chunk set and the claim/refuse contract (#473 D3/D5/D6)

import { describe, it, expect } from 'vitest';
import { PlayableArea } from '../../../src/core/world/PlayableArea.js';
import { generateTerrain, type TerrainConfig } from '../../../src/core/world/TerrainGen.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';

const CONFIG: TerrainConfig = {
  sizeX: 32, sizeY: 24, sizeZ: 32,
  seed: 42,
  climateBias: [0, 0],
};

function makeArea(overrides: Partial<TerrainConfig> = {}): { grid: VoxelGrid; area: PlayableArea } {
  const config = { ...CONFIG, ...overrides };
  const grid = generateTerrain(config);
  return { grid, area: new PlayableArea(grid, config) };
}

describe('PlayableArea.chunkAt / chunkRect', () => {
  it('maps a positive coordinate to its chunk', () => {
    expect(PlayableArea.chunkAt(0, 0)).toEqual({ cx: 0, cz: 0 });
    expect(PlayableArea.chunkAt(15, 15)).toEqual({ cx: 0, cz: 0 });
    expect(PlayableArea.chunkAt(16, 31)).toEqual({ cx: 1, cz: 1 });
  });

  it('maps a negative coordinate to the chunk west/north of the origin', () => {
    expect(PlayableArea.chunkAt(-1, -1)).toEqual({ cx: -1, cz: -1 });
    expect(PlayableArea.chunkAt(-16, -16)).toEqual({ cx: -1, cz: -1 });
    expect(PlayableArea.chunkAt(-17, 0)).toEqual({ cx: -2, cz: 0 });
  });

  it('reports a chunk rect with an exclusive max', () => {
    expect(PlayableArea.chunkRect(-1, 2)).toEqual({ minX: -16, minZ: 32, maxX: 0, maxZ: 48 });
  });
});

describe('PlayableArea.contains', () => {
  it('covers the whole starting site', () => {
    const { area } = makeArea();
    expect(area.contains(0, 0)).toBe(true);
    expect(area.contains(31, 31)).toBe(true);
  });

  it('excludes ground past the starting site on every side', () => {
    const { area } = makeArea();
    expect(area.contains(-1, 0)).toBe(false);
    expect(area.contains(32, 0)).toBe(false);
    expect(area.contains(0, -1)).toBe(false);
    expect(area.contains(0, 32)).toBe(false);
  });
});

describe('PlayableArea.claim', () => {
  it('reports an already-owned coordinate without changing anything', () => {
    const { grid, area } = makeArea();
    const before = grid.chunkCount;
    const result = area.claim(10, 10);
    expect(result.claimed).toBe(true);
    expect(result.claimed && result.alreadyOwned).toBe(true);
    expect(grid.chunkCount).toBe(before);
  });

  it('takes the chunk east of the site and generates ground in it', () => {
    const { grid, area } = makeArea();
    const result = area.claim(35, 10);

    expect(result.claimed).toBe(true);
    expect(result.claimed && result.alreadyOwned).toBe(false);
    expect(result.chunk).toEqual({ cx: 2, cz: 0 });
    expect(grid.containsColumn(35, 10)).toBe(true);
    expect(grid.maxX).toBe(48);

    // Generated, not left as a hole in the ground.
    let solid = 0;
    for (let y = 0; y < grid.sizeY; y++) if (grid.isSolidAt(35, y, 10)) solid++;
    expect(solid).toBeGreaterThan(0);
  });

  it('takes a chunk west of the origin, giving the site negative coordinates', () => {
    const { grid, area } = makeArea();
    const result = area.claim(-3, 10);

    expect(result.claimed).toBe(true);
    expect(grid.minX).toBe(-16);
    expect(grid.sizeX).toBe(48);
    expect(grid.containsColumn(-3, 10)).toBe(true);
    expect(grid.densityAt(-3, 0, 10)).toBeGreaterThan(0);
  });

  it('refuses ground that touches no part of the site', () => {
    const { grid, area } = makeArea();
    const result = area.claim(300, 300);
    expect(result.claimed).toBe(false);
    expect(!result.claimed && result.reason).toBe('not_adjacent');
    expect(grid.containsColumn(300, 300)).toBe(false);
  });

  it('lets the site walk outward one chunk at a time', () => {
    const { grid, area } = makeArea();
    expect(area.claim(35, 10).claimed).toBe(true);
    expect(area.claim(51, 10).claimed).toBe(true);
    expect(grid.maxX).toBe(64);
    expect(grid.containsColumn(51, 10)).toBe(true);
  });

  it('refuses every expansion when expansion is disabled', () => {
    const config = { ...CONFIG };
    const grid = generateTerrain(config);
    const area = new PlayableArea(grid, config, { expansionEnabled: false });

    const result = area.claim(35, 10);
    expect(result.claimed).toBe(false);
    expect(!result.claimed && result.reason).toBe('expansion_disabled');
    expect(grid.containsColumn(35, 10)).toBe(false);
  });

  it('generates a claimed chunk identically no matter when it is claimed (#473 D3)', () => {
    const early = makeArea();
    const late = makeArea();

    early.area.claim(35, 10);
    // Simulate play changing the site before the same chunk is claimed.
    for (let y = 0; y < 24; y++) late.grid.clearVoxel(5, y, 5);
    late.area.claim(35, 10);

    for (let x = 32; x < 48; x += 3) {
      for (let z = 0; z < 16; z += 3) {
        for (let y = 0; y < 24; y += 2) {
          expect(late.grid.densityAt(x, y, z)).toBe(early.grid.densityAt(x, y, z));
          expect(late.grid.dominantRockAt(x, y, z)).toBe(early.grid.dominantRockAt(x, y, z));
        }
      }
    }
  });

  it('leaves a freshly claimed chunk pristine, so a save need not store it', () => {
    const { grid, area } = makeArea();
    area.claim(35, 10);
    expect(grid.isChunkDirty(2, 0)).toBe(false);
  });

  it('marks a claimed chunk dirty once play digs into it', () => {
    const { grid, area } = makeArea();
    area.claim(35, 10);
    grid.clearVoxel(35, 5, 10);
    expect(grid.isChunkDirty(2, 0)).toBe(true);
  });
});

describe('PlayableArea — protected structures (#473 D6)', () => {
  // Villages, rivers and landmarks are all excluded from the playable rect by
  // construction, so the ground immediately around a starting site is always
  // claimable; the veto only bites further out.
  it('never protects ground inside the starting site', () => {
    const { area } = makeArea();
    expect(area.isProtected(10, 10)).toBe(false);
  });

  it('reports an empty frontier when nothing protected borders the site', () => {
    const { area } = makeArea();
    expect(area.protectedFrontier()).toEqual([]);
  });

  it('never lists an owned chunk on the frontier', () => {
    const { area } = makeArea();
    area.claim(35, 10);
    for (const entry of area.protectedFrontier()) {
      expect(entry).not.toEqual(expect.objectContaining({ cx: 2, cz: 0 }));
    }
  });
});
