// BlastSimulator2026 — MusicCatalog validity
// The catalog ships empty; the rules (tests/helpers/musicCatalogChecks.ts, proven on bad fixtures in
// musicCatalogChecks.test.ts) guard every entry added later. Ids that are plain strings in the biome and
// level catalogs are verified there instead of by the compiler.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MUSIC_CONFIG } from '../../../../src/core/config/audio/music.js';
import { getAllLevels } from '../../../../src/core/campaign/Level.js';
import { getAllBiomes } from '../../../../src/core/world/BiomeCatalog.js';
import { MUSIC_TRACKS } from '../../../../src/audio/music/MusicCatalog.js';
import { musicTrackProblems } from '../../../helpers/musicCatalogChecks.js';

const MUSIC_DIR = resolve(import.meta.dirname, '../../../../public/audio/music');

describe('MUSIC_TRACKS', () => {
  it('is valid: unique ids, real biomes and levels, every mp3 in public/audio/music', () => {
    const problems = musicTrackProblems(MUSIC_TRACKS, {
      biomeIds: new Set(getAllBiomes().map(b => b.id)),
      levelIds: new Set(getAllLevels().map(l => l.id)),
      fileExists: file => existsSync(resolve(MUSIC_DIR, `${file}${MUSIC_CONFIG.fileExtension}`)),
    });
    expect(problems).toEqual([]);
  });

  it('serves from the folder the README documents', () => {
    expect(MUSIC_CONFIG.assetBase).toBe('/audio/music/');
    expect(existsSync(resolve(MUSIC_DIR, 'README.md'))).toBe(true);
  });
});
