// BlastSimulator2026 — what makes a music catalogue valid
// The catalogue ships empty, so a check that only loops over MUSIC_TRACKS asserts nothing today. The rules live
// here as a pure function over any track list, so they are proven on bad fixtures now and guard the real
// catalogue the day its first track lands.

import type { MusicTrack } from '../../src/audio/music/MusicCatalog.js';

/** What the rules need to know about the rest of the game. */
export interface MusicCatalogContext {
  readonly biomeIds: ReadonlySet<string>;
  readonly levelIds: ReadonlySet<string>;
  /** True when `<file>.mp3` exists under public/audio/music/. */
  readonly fileExists: (file: string) => boolean;
}

const BARE_BASENAME = /^[A-Za-z0-9_-]+$/;

/** Every reason this track list is invalid, one line each; empty when it is fine. */
export function musicTrackProblems(tracks: readonly MusicTrack[], context: MusicCatalogContext): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const track of tracks) {
    if (track.id === '') problems.push('a track has an empty id');
    if (seen.has(track.id)) problems.push(`${track.id}: duplicate id`);
    seen.add(track.id);
    if (!BARE_BASENAME.test(track.file)) problems.push(`${track.id}: file "${track.file}" is not a bare basename`);
    else if (!context.fileExists(track.file)) problems.push(`${track.id}: ${track.file}.mp3 is missing from public/audio/music`);
    if (track.scope.kind === 'biome' && !context.biomeIds.has(track.scope.biomeId)) {
      problems.push(`${track.id}: unknown biome "${track.scope.biomeId}"`);
    }
    if (track.scope.kind === 'level' && !context.levelIds.has(track.scope.levelId)) {
      problems.push(`${track.id}: unknown level "${track.scope.levelId}"`);
    }
  }
  return problems;
}
