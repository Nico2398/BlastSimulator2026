// BlastSimulator2026 — terrain byte-identity regression guard (#1190,
// terrain-edit-storage series)
//
// #1190 replaces `TerrainConfig.sizeY` (a height) with `TerrainConfig.datum`
// (the voxel y the site centre's surface lands on) and makes `VoxelGrid`
// height-free — a pure plumbing change, not a generation-algorithm change.
// This suite locks in that every real campaign level, sandbox's own default,
// and `new_game`'s own default grid sizes generate BYTE-IDENTICAL terrain
// before and after that change, via `fingerprintTerrainConfig`
// (`tests/helpers/terrainFingerprint.ts`).
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
    expectedHash: 'c73380071941a68ce3b5f1f06092e1aa65fcc69df09773e793ba2d418b6d5750',
  },
  {
    name: 'dusty_hollow',
    config: {
      sizeX: 96, sizeZ: 96, datum: datumFromSizeY(40),
      seed: 1138, climateBias: [0.7, -0.6],
    },
    expectedHash: 'ce507d57d3a265a404ec824a0444626a431dfa734581fa2e7e4007929a7d0e2d',
  },
  {
    name: 'grumpstone_ridge',
    config: {
      sizeX: 128, sizeZ: 128, datum: datumFromSizeY(56),
      seed: 2277, climateBias: [-0.7, 0.1],
    },
    expectedHash: '39b3f768019324e88d3cfddcce1c87fcc1ed5ad51adf7831aed9731985ec50fe',
  },
  {
    name: 'treranium_depths',
    config: {
      sizeX: 160, sizeZ: 160, datum: datumFromSizeY(64),
      seed: 3666, climateBias: [0.6, 0.7], mixedRockHardness: true,
    },
    expectedHash: 'cfb72a9269f1032837b8b123aec79df0f2339e539d7070c67f9b7e12b624f351',
  },
  {
    name: 'sandbox_default',
    config: {
      sizeX: 64, sizeZ: 64, datum: datumFromSizeY(32),
      seed: 12345, climateBias: [0.7, -0.6],
    },
    expectedHash: '17af763b7dca7620e4f6d93dba8b8265c90cebe18cfc320aca015fa66151ee70',
  },
  {
    name: 'new_game_24',
    config: {
      sizeX: 24, sizeZ: 24, datum: datumFromSizeY(24),
      seed: 42, climateBias: [0.7, -0.6], // new_game defaults, biome desert_badlands
    },
    expectedHash: '63120b3f31a7ea53e2ba5ccda54a15fc9a754b19dc0792c04b0356640b69673b',
  },
  {
    name: 'new_game_32',
    config: {
      sizeX: 32, sizeZ: 32, datum: datumFromSizeY(32),
      seed: 42, climateBias: [0.7, -0.6], // new_game defaults
    },
    expectedHash: '7edd255afd6cecdfd190963881e03f3e6dbef5a54c9876e89a8b51c2fa59bb1e',
  },
  {
    name: 'new_game_48',
    config: {
      sizeX: 48, sizeZ: 48, datum: datumFromSizeY(48),
      seed: 42, climateBias: [0.7, -0.6], // new_game defaults
    },
    expectedHash: 'f9beba473e7ec37c1394d9679e4f47693a24a9a9457e9d8888007cb7545b0227',
  },
  {
    name: 'new_game_64',
    config: {
      sizeX: 64, sizeZ: 64, datum: datumFromSizeY(64),
      seed: 42, climateBias: [0.7, -0.6], // new_game defaults
    },
    expectedHash: 'c708fd6c6a9395bb2947be246797794a7afa8002350217cb0abf73ba81232057',
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
