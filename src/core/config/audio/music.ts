// BlastSimulator2026 — Music tuning (pure data)
// Where the music files are served from and how tracks blend into each other.
// The track list itself lives in src/audio/music/MusicCatalog.ts.

export interface MusicConfig {
  /** URL prefix of the streamed tracks (served from public/audio/music/). */
  readonly assetBase: string;
  readonly fileExtension: string;
  /** Equal-power blend between two tracks (s). */
  readonly crossfadeS: number;
  /** Fade-in of a track that starts from silence (s). */
  readonly fadeInS: number;
  /** Fade to silence when no track applies (s). */
  readonly fadeOutS: number;
  /** Samples of the equal-power curve handed to the audio clock per fade. */
  readonly curvePoints: number;
  /** The light dip a blast gives the music bus when the caller names no values. */
  readonly duck: {
    readonly amountDb: number;
    readonly holdS: number;
    readonly releaseS: number;
  };
}

export const MUSIC_CONFIG: MusicConfig = {
  assetBase: '/audio/music/',
  fileExtension: '.mp3',
  crossfadeS: 2.5,
  fadeInS: 1.5,
  fadeOutS: 2,
  curvePoints: 64,
  duck: { amountDb: -4, holdS: 0.6, releaseS: 1.8 },
};
