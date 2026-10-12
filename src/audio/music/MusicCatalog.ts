// BlastSimulator2026 — Music catalog
// The one table of streamed music tracks. Empty until the owner ships tracks:
// the music system does nothing and costs nothing while it is.
//
// To add a track, drop `<file>.mp3` into public/audio/music/ and add an entry
// below (see public/audio/music/README.md). Biome ids come from the biome
// catalog in src/core/world/BiomeCatalog.ts, level ids from the campaign
// levels in src/core/campaign/Level.ts; tests/unit/audio/music/MusicCatalog.test.ts
// fails on an id that matches neither, on a duplicate id and on a missing file.

type MusicScope =
  /** Main menu, world map and sandbox setup. */
  | { readonly kind: 'menu' }
  /** Any game that has no more specific track. */
  | { readonly kind: 'game' }
  | { readonly kind: 'biome'; readonly biomeId: string }
  | { readonly kind: 'level'; readonly levelId: string };

export interface MusicTrack {
  /** Unique; a track keeps playing across updates while its id stays selected. */
  readonly id: string;
  /** File basename under public/audio/music/, without the extension (mp3). */
  readonly file: string;
  readonly scope: MusicScope;
  /** Trim in dB against a track mastered to -16 LUFS. */
  readonly gainDb?: number;
  /** Loop until replaced (default true). A track that does not loop ends in silence. */
  readonly loop?: boolean;
}

export const MUSIC_TRACKS: readonly MusicTrack[] = [];
