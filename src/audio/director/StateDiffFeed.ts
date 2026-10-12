// BlastSimulator2026 — State diff feed
// Looks at the world after every command and tick, plays the cues the changes
// call for, and reports the flags other directors need (a blast landed, the
// level ended). The first look is only a baseline, and so is any look taken
// while a menu hides the game: nothing plays for "everything is new".

import type { GameState } from '../../core/state/GameState.js';
import { DIFF_CONFIG } from '../../core/config/audio/game.js';
import { blastLosses, type BlastLossReport } from './blastLosses.js';
import type { BlastLosses } from './blastPlan.js';
import { playCue } from './playCue.js';
import type { DirectorEnv } from './types.js';
import { diffWorld, type WorldDiff } from './worldDiff.js';
import { takeSnapshot, type WorldSnapshot } from './worldSnapshot.js';

export class StateDiffFeed {
  private snapshot: WorldSnapshot | null = null;
  private firedChargeKg = 0;

  constructor(
    private readonly env: DirectorEnv,
    private readonly categoryOf: (eventId: string) => string | undefined,
  ) {}

  /** Tick of the last look; null before the first. */
  get lastTick(): number | null {
    return this.snapshot ? this.snapshot.tick : null;
  }

  /**
   * Charge (kg) that was loaded when the last blast fired, then forgotten. A
   * blast clears the charges before the renderer asks for its sound, so the
   * mass has to be remembered from before.
   */
  takeBlastChargeKg(): number {
    const kg = this.firedChargeKg;
    this.firedChargeKg = 0;
    return kg;
  }

  /**
   * Buildings and vehicles the blast destroyed that its report does not list, where they stood. Asked at the
   * instant the flash starts, before the next look at the world: the last snapshot still has them.
   */
  lossesOf(report: BlastLossReport | null): BlastLosses {
    return blastLosses(report, this.snapshot);
  }

  /** Forget everything: the next look is a baseline. */
  forget(): void {
    this.snapshot = null;
    this.firedChargeKg = 0;
  }

  /** Look at the world. Cues play unless `silent`; flags are returned either way. */
  observe(state: GameState, silent: boolean): WorldDiff {
    const prev = this.snapshot;
    const next = takeSnapshot(state);
    this.snapshot = next;
    if (prev === null) {
      this.firedChargeKg = next.chargeKg;
      return { cues: [], blastLanded: false, levelEnd: null, levelReopened: false, eventAlert: false };
    }
    const diff = diffWorld(prev, state, this.categoryOf);
    if (next.chargeKg > 0) this.firedChargeKg = next.chargeKg;
    else if (!diff.blastLanded) this.firedChargeKg = 0;
    if (!silent) {
      for (const cue of diff.cues) playCue(this.env, cue);
      if (diff.eventAlert) {
        const { amountDb, holdS, releaseS } = DIFF_CONFIG.eventAlert.duck;
        this.env.player.duck('ambient', amountDb, holdS, releaseS);
      }
    }
    return diff;
  }
}
