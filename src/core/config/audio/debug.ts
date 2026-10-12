// BlastSimulator2026 — Audio debug tuning (pure data)
// The URL flag and the bounds of the play log that `npm run audio:smoke` reads from the page.

export const AUDIO_DEBUG_CONFIG = {
  /** `?audioLog=1` turns the play log and `window.__audioStatus` on. */
  urlFlag: 'audioLog',
  /** Newest records kept; older ones are dropped so a long session cannot grow the log without bound. */
  logCapacity: 4000,
} as const;
