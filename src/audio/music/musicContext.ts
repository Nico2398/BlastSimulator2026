// BlastSimulator2026 — Music context from screen flags
// The only translation between the shell's own state (which overlays are up,
// which mine is loaded) and the music vocabulary, so the shell passes plain
// values and owns no music rules.

import type { MusicContext } from './resolveMusicTrack.js';

export interface MusicScreenFlags {
  /** Main menu, world map or sandbox setup is up. */
  readonly menuVisible: boolean;
  readonly loadingVisible: boolean;
  readonly levelEndVisible: boolean;
  /**
   * The state's mine type (`GameState.mineType`). Music follows this declared
   * biome, not the biome terrain generation lands on: generation resolves the
   * biome from climate noise and can pick a neighbour of `LevelDef.biome`, but
   * the declared id is the one the level author and the player name, it is
   * known without running terrain code, and a level that needs a specific
   * sound gets a level track.
   */
  readonly mineType: string | null | undefined;
  /** `GameState.campaign.activeLevelId`; null in sandbox and free play. */
  readonly activeLevelId: string | null | undefined;
}

/**
 * Loading wins over everything (a level loads behind the menu), then the
 * level-end overlay over the game; any other full-screen menu is the menu;
 * otherwise the game is on screen.
 */
export function deriveMusicContext(flags: MusicScreenFlags): MusicContext {
  const screen = flags.loadingVisible ? 'loading'
    : flags.levelEndVisible ? 'level_end'
    : flags.menuVisible ? 'menu'
    : 'game';
  return { screen, biomeId: flags.mineType ?? null, levelId: flags.activeLevelId ?? null };
}
