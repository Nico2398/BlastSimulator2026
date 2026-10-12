// BlastSimulator2026 — Music director
// Picks the track that fits the screen and hands it to the player. Called every
// frame, so an update that changes nothing is three comparisons. With an empty
// catalog it does nothing at all. Music is garnish: whatever the player or the
// audio graph throws stays in here, never in the render loop or the blast handler.

import { MUSIC_CONFIG, type MusicConfig } from '../../core/config/audio/music.js';
import { MUSIC_TRACKS, type MusicTrack } from './MusicCatalog.js';
import { MusicPlayer, type MusicOutput, type MusicPlayback, type MusicPlayerOptions } from './MusicPlayer.js';
import { MUSIC_KEEP, resolveMusicTrack, type MusicContext, type MusicScreen } from './resolveMusicTrack.js';

interface MusicDirectorDeps {
  readonly player: MusicPlayback;
  readonly output: Pick<MusicOutput, 'duck'>;
  readonly tracks: readonly MusicTrack[];
  readonly config: MusicConfig;
}

export class MusicDirector {
  private applied = false;
  /** Last track handed to the player; undefined before the first request. */
  private requested: MusicTrack | null | undefined;
  private screen: MusicScreen = 'menu';
  private biomeId: string | null = null;
  private levelId: string | null = null;

  constructor(private readonly deps: MusicDirectorDeps) {}

  /** Follow the screen; per frame. Only a change of screen, biome or level touches the player. */
  update(context: MusicContext): void {
    if (this.deps.tracks.length === 0) return;
    try {
      this.follow(context);
    } catch {
      // a failing player must not break the frame
    }
  }

  private follow(context: MusicContext): void {
    if (!this.applied || context.screen !== this.screen || context.biomeId !== this.biomeId || context.levelId !== this.levelId) {
      this.applied = true;
      this.screen = context.screen;
      this.biomeId = context.biomeId;
      this.levelId = context.levelId;
      const track = resolveMusicTrack(context, this.deps.tracks);
      if (track !== MUSIC_KEEP && track !== this.requested) {
        this.requested = track;
        this.deps.player.setTrack(track);
      }
    }
    this.deps.player.tick();
  }

  /** First user gesture: start music the browser held back. */
  unlock(): void {
    this.deps.player.unlock();
  }

  /** Dip the music, by default as little as a blast needs. */
  duck(
    amountDb: number = this.deps.config.duck.amountDb,
    holdS: number = this.deps.config.duck.holdS,
    releaseS: number = this.deps.config.duck.releaseS,
  ): void {
    if (this.deps.tracks.length === 0) return;
    try {
      this.deps.output.duck('music', amountDb, holdS, releaseS);
    } catch {
      // a failing duck must not break the blast that asked for it
    }
  }

  dispose(): void {
    this.deps.player.dispose();
  }
}

interface MusicDirectorOptions extends MusicPlayerOptions {
  readonly tracks?: readonly MusicTrack[];
}

/** The director wired to a real player on `output` (the audio manager). */
export function createMusicDirector(output: MusicOutput, options: MusicDirectorOptions = {}): MusicDirector {
  return new MusicDirector({
    player: new MusicPlayer(output, options),
    output,
    tracks: options.tracks ?? MUSIC_TRACKS,
    config: options.config ?? MUSIC_CONFIG,
  });
}
