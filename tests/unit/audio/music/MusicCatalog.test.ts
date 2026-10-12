// BlastSimulator2026 — MusicCatalog validity
// The catalog ships empty; these checks guard every entry added later. Ids that
// are plain strings in the biome and level catalogs are verified here instead
// of by the compiler.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MUSIC_CONFIG } from '../../../../src/core/config/audio/music.js';
import { getAllLevels } from '../../../../src/core/campaign/Level.js';
import { getAllBiomes } from '../../../../src/core/world/BiomeCatalog.js';
import { MUSIC_TRACKS } from '../../../../src/audio/music/MusicCatalog.js';

const MUSIC_DIR = resolve(import.meta.dirname, '../../../../public/audio/music');

describe('MUSIC_TRACKS', () => {
  it('has unique track ids', () => {
    const ids = MUSIC_TRACKS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names real biomes and levels', () => {
    const biomes = new Set(getAllBiomes().map(b => b.id));
    const levels = new Set(getAllLevels().map(l => l.id));
    for (const track of MUSIC_TRACKS) {
      if (track.scope.kind === 'biome') expect(biomes.has(track.scope.biomeId), `${track.id}: biome`).toBe(true);
      if (track.scope.kind === 'level') expect(levels.has(track.scope.levelId), `${track.id}: level`).toBe(true);
    }
  });

  it('points at a bare basename whose mp3 is in public/audio/music', () => {
    for (const track of MUSIC_TRACKS) {
      expect(track.file, `${track.id}: file`).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(existsSync(resolve(MUSIC_DIR, `${track.file}${MUSIC_CONFIG.fileExtension}`)), `${track.id}: missing file`).toBe(true);
    }
  });

  it('serves from the folder the README documents', () => {
    expect(MUSIC_CONFIG.assetBase).toBe('/audio/music/');
    expect(existsSync(resolve(MUSIC_DIR, 'README.md'))).toBe(true);
  });
});
