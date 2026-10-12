// BlastSimulator2026 — Audio debug hook
// With `?audioLog=1` in the URL, the page records every sound request in `window.__audioLog` and answers
// `window.__audioStatus()`, which is what the browser smoke test (`npm run audio:smoke`) asserts on. Without the
// flag nothing is created, installed or wrapped.

import { AUDIO_DEBUG_CONFIG } from '../../core/config/audio/debug.js';
import type { AudioPlayer } from '../AudioPlayer.js';
import { createPlayLog, recordAudioPlayer, type PlayRecord } from './playLog.js';

/** What the smoke test reads from the page. */
export interface AudioStatus {
  /** The interface and blast cues are decoded; plays are dropped before that. */
  readonly ready: boolean;
  /** Every sample and synth recipe has been tried (loaded or failed). */
  readonly preloaded: boolean;
  /**
   * The Web Audio context state, or `none` when the browser has no Web Audio. A scenario run still builds the
   * manager (and so a context, suspended for want of a gesture) but no engine, so `ready` stays false there.
   */
  readonly contextState: string;
  /** Sample files and synth recipes that could not be loaded. */
  readonly failedAssets: readonly string[];
}

/** The slice of the engine and manager the status needs. */
export interface AudioStatusSource {
  readonly ready: boolean;
  readonly preloaded: boolean;
  readonly failedAssets: readonly string[];
  readonly contextState: string;
}

/** The window members this module writes; the page's `Window` satisfies it. */
export interface AudioDebugWindow {
  __audioLog?: PlayRecord[];
  __audioStatus?: () => AudioStatus;
}

export function isAudioLogRequested(search: string): boolean {
  return new URLSearchParams(search).get(AUDIO_DEBUG_CONFIG.urlFlag) === '1';
}

/**
 * Returns `player` unchanged unless the URL asks for the log; otherwise a recording wrapper, with the log and
 * the status reader published on `win`. `source` is read lazily on every status call.
 */
export function installAudioDebug(
  win: AudioDebugWindow,
  search: string,
  player: AudioPlayer,
  source: () => AudioStatusSource,
  now: () => number = () => performance.now(),
): AudioPlayer {
  if (!isAudioLogRequested(search)) return player;
  const log = createPlayLog(AUDIO_DEBUG_CONFIG.logCapacity, now);
  win.__audioLog = log.records;
  win.__audioStatus = () => {
    const status = source();
    return { ready: status.ready, preloaded: status.preloaded, contextState: status.contextState, failedAssets: [...status.failedAssets] };
  };
  return recordAudioPlayer(player, log);
}
