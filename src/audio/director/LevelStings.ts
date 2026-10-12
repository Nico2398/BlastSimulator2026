// BlastSimulator2026 — Level-end stings
// The win or lose sting, played once per level. Two feeds can announce a level
// ending (the core event and the state diff); whichever comes first wins.

import { LEVEL_END_CONFIG } from '../../core/config/audio/game.js';
import { playCue } from './playCue.js';
import type { DirectorEnv } from './types.js';

export class LevelStings {
  private played = false;

  constructor(private readonly env: DirectorEnv) {}

  play(outcome: 'win' | 'lose'): void {
    if (this.played) return;
    this.played = true;
    const { amountDb, holdS, releaseS } = LEVEL_END_CONFIG.duck;
    this.env.player.duck('ambient', amountDb, holdS, releaseS);
    playCue(this.env, { sound: outcome === 'win' ? 'level_win' : 'level_lose', key: 'level_end', cooldownS: 0 });
  }

  /** A new level may end again. */
  reset(): void {
    this.played = false;
  }
}
