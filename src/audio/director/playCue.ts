// BlastSimulator2026 — Playing one cue through the shared rules
// Range check, cooldown, then the player. Every feed that fires a one-off cue
// goes through here so the order of those checks is decided once.

import type { OneShotId } from '../SoundCatalog.js';
import type { PlayOptions } from '../AudioPlayer.js';
import { SPATIAL_CONFIG } from '../../core/config/audio/engine.js';
import type { CueSite, DirectorEnv } from './types.js';

export interface Cue {
  readonly sound: OneShotId;
  /** Where it happens; omitted for interface-level cues that are heard everywhere. */
  readonly site?: CueSite | null;
  readonly gainDb?: number;
  readonly pitchCents?: number;
  readonly delayS?: number;
  /** Cooldown key, and the key the player rate-limits on. */
  readonly key: string;
  /** Real seconds before the same key may play again; 0 for none. */
  readonly cooldownS: number;
  /** Positional cues farther than this multiple of the reference distance are skipped (default: the engine's cull distance). */
  readonly rangeFactor?: number;
}

/** True when the cue was handed to the player (it may still drop it for its own budget). */
export function playCue(env: DirectorEnv, cue: Cue): boolean {
  let at: PlayOptions['at'];
  if (cue.site) {
    at = env.resolve(cue.site);
    if (!env.isNear(at, cue.rangeFactor ?? SPATIAL_CONFIG.cullDistanceFactor)) return false;
  }
  if (cue.cooldownS > 0 && !env.gate.tryPass(cue.key, cue.cooldownS)) return false;
  const options: PlayOptions = {
    key: cue.key,
    ...(at ? { at } : {}),
    ...(cue.gainDb !== undefined ? { gainDb: cue.gainDb } : {}),
    ...(cue.pitchCents !== undefined ? { pitchCents: cue.pitchCents } : {}),
    ...(cue.delayS !== undefined ? { delayS: cue.delayS } : {}),
  };
  env.player.play(cue.sound, options);
  return true;
}
