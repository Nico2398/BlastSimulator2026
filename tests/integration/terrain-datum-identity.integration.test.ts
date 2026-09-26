// BlastSimulator2026 — terrain byte-identity regression guard (#1190,
// terrain-edit-storage series)
//
// #1190 replaces `TerrainConfig.sizeY` (a height) with `TerrainConfig.datum`
// (the voxel y the site centre's surface lands on) and makes `VoxelGrid`
// height-free — a pure plumbing change, not a generation-algorithm change.
// This suite locks in that every real campaign level, sandbox's own default,
// and `new_game`'s own default grid sizes generate the SAME
// strided-sample fingerprint before and after that change, via
// `fingerprintTerrainConfig` (`tests/helpers/terrainFingerprint.ts`) — a
// SHA-256 over every 8th column (`step`) at 9 fixed depth-offsets relative to
// each sampled column's own surface. That is a strong regression guard
// against any change to the sampled data, not literal byte-for-byte identity
// over every voxel: columns between stride steps and depths outside
// `SAMPLE_OFFSETS` are never compared.
//
// Each case's `datum` is `Math.floor(oldSizeY * 0.55)` — the exact conversion
// `computeGroundOffset` used to perform internally (pre-#1190) and which
// `datumFromSizeY` (`src/console/commands/world.ts`, `TODO(#1191)`) now
// performs at the one remaining console-layer call site. Passing that
// already-computed `datum` straight into `TerrainConfig` is what proves the
// two are the same number by construction, not by coincidence.
//
// ── IMPORTANT — regenerating a baseline ─────────────────────────────────
// These hashes were computed by the planner against `main`'s pre-#1190 code
// with `fingerprintTerrainConfig`'s exact sampling scheme. If a genuinely
// intentional generation change ever needs a new baseline:
//   git checkout main -- src/core/world/TerrainGen.ts src/core/world/WorldGen.ts \
//     src/core/world/VoxelGrid.ts src/core/world/Strata.ts src/core/world/OreVeins.ts
//   npx vitest run tests/integration/terrain-datum-identity.integration.test.ts
// then copy the printed/failed hash for each case into the table below.
// Never weaken the assertion (e.g. loosen it to "is a string") to make a
// diverging hash pass — that defeats the entire point of this suite.

import { describe, it, expect } from 'vitest';
import { fingerprintTerrainConfig } from '../helpers/terrainFingerprint.js';
import type { TerrainConfig } from '../../src/core/world/TerrainGen.js';

/** `Math.floor(oldSizeY * 0.55)` — the pre-#1190 vertical datum formula, applied once per case at authoring time (see file header). */
function datumFromSizeY(sizeY: number): number {
  return Math.floor(sizeY * 0.55);
}

interface Case {
  name: string;
  config: TerrainConfig;
  expectedHash: string;
}

const CASES: Case[] = [
  {
    name: 'tutorial_pit',
    config: {
      sizeX: 32, sizeZ: 32, datum: datumFromSizeY(20),
      seed: 42, climateBias: [0.7, -0.6],
    },
    expectedHash: '8a0c35f273975c1ceb2e861ee483d6a7c728e731ab2c79ef1c02acb2d1edf2e7',
  },
  {
    name: 'dusty_hollow',
    config: {
      sizeX: 96, sizeZ: 96, datum: datumFromSizeY(40),
      seed: 1138, climateBias: [0.7, -0.6],
    },
    expectedHash: '577a77e6ac072f136844c9aaebae5063a30b3ec417e9915a92ff85fdb71dfbb1',
  },
  {
    name: 'grumpstone_ridge',
    config: {
      sizeX: 128, sizeZ: 128, datum: datumFromSizeY(56),
      seed: 2277, climateBias: [-0.7, 0.1],
    },
    expectedHash: '433c6c26194101d72b5a8ed7826d1db91faa83cbacca995dcd9fad3021e64a5d',
  },
  {
    name: 'treranium_depths',
    config: {
      sizeX: 160, sizeZ: 160, datum: datumFromSizeY(64),
      seed: 3666, climateBias: [0.6, 0.7], mixedRockHardness: true,
    },
    expectedHash: '064648ae9b121c581481bf579eccd851ad6bfca198e431318e7e999f1dddbec2',
  },
  {
    name: 'sandbox_default',
    config: {
      sizeX: 64, sizeZ: 64, datum: datumFromSizeY(32),
      seed: 12345, climateBias: [0.7, -0.6],
    },
    expectedHash: '877802432f9ae73a17fe762d60ac2d047202413e8df0d1fac1e406d6d23494f6',
  },
  {
    name: 'new_game_24',
    config: {
      sizeX: 24, sizeZ: 24, datum: datumFromSizeY(24),
      seed: 42, climateBias: [0.7, -0.6], // new_game defaults, biome desert_badlands
    },
    expectedHash: '66b3726c78503c56c5b0dd1c8ac82582322b0a71b1b48813b11f8607da540054',
  },
  {
    name: 'new_game_32',
    config: {
      sizeX: 32, sizeZ: 32, datum: datumFromSizeY(32),
      seed: 42, climateBias: [0.7, -0.6], // new_game defaults
    },
    expectedHash: 'b38f54f51593dea36f8b09ae6f075308902f4fee2c89b78001e6f244cc3567c0',
  },
  {
    name: 'new_game_48',
    config: {
      sizeX: 48, sizeZ: 48, datum: datumFromSizeY(48),
      seed: 42, climateBias: [0.7, -0.6], // new_game defaults
    },
    expectedHash: '5133807d1bc7b1a44ed90e8f4096f2f896f58f4e364514963ecb4eb7b3d684d9',
  },
  {
    name: 'new_game_64',
    config: {
      sizeX: 64, sizeZ: 64, datum: datumFromSizeY(64),
      seed: 42, climateBias: [0.7, -0.6], // new_game defaults
    },
    expectedHash: 'ae083e742dfb6f91b944e49cd94f4a32630753100fa84b8e2be96d6aa7411ad3',
  },
];

describe('terrain byte-identity — datum plumbing change reproduces main exactly (#1190)', () => {
  for (const { name, config, expectedHash } of CASES) {
    it(`${name}: fingerprint matches the pre-#1190 baseline`, () => {
      expect(fingerprintTerrainConfig(config)).toBe(expectedHash);
    });
  }

  it('fingerprintTerrainConfig is a pure function of config: repeated calls on the same config agree', () => {
    const config = CASES[0]!.config;
    expect(fingerprintTerrainConfig(config)).toBe(fingerprintTerrainConfig(config));
  });

  it('fingerprintTerrainConfig distinguishes configs that actually differ (sanity: the hash is not a constant)', () => {
    const a = fingerprintTerrainConfig(CASES[0]!.config);
    const b = fingerprintTerrainConfig(CASES[1]!.config);
    expect(a).not.toBe(b);
  });
});
