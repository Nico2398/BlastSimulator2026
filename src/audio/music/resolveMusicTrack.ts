// BlastSimulator2026 — Which music track fits the moment
// Pure: what the player sees (screen, biome, level) in, a track out.

import type { MusicTrack } from './MusicCatalog.js';

export type MusicScreen = 'menu' | 'loading' | 'game' | 'level_end';

export interface MusicContext {
  readonly screen: MusicScreen;
  readonly biomeId: string | null;
  readonly levelId: string | null;
}

/** Leave whatever is playing alone (loading and level-end screens). */
export const MUSIC_KEEP = 'keep';

type MusicResolution = MusicTrack | null | typeof MUSIC_KEEP;

/**
 * Menu: the menu track. Loading and level end: keep the current music so the
 * transition between screens never restarts it. In a game: the level's own
 * track, else its biome's, else the generic game track. `null` means silence.
 * Ids that match no track fall through to the next rule; with several tracks
 * for one scope the first listed wins.
 */
export function resolveMusicTrack(context: MusicContext, tracks: readonly MusicTrack[]): MusicResolution {
  switch (context.screen) {
    case 'loading':
    case 'level_end':
      return MUSIC_KEEP;
    case 'menu':
      return tracks.find(t => t.scope.kind === 'menu') ?? null;
    case 'game':
      return (
        tracks.find(t => t.scope.kind === 'level' && t.scope.levelId === context.levelId)
        ?? tracks.find(t => t.scope.kind === 'biome' && t.scope.biomeId === context.biomeId)
        ?? tracks.find(t => t.scope.kind === 'game')
        ?? null
      );
  }
}
