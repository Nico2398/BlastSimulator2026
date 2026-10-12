// BlastSimulator2026 — Blast audio
// Plays one blast's timeline and can cut it short. The crack, boom and sub-bass
// start the moment the renderer fires the flash; everything later (tail, debris
// rain, secondary blasts, collapsing buildings) is handed to the player a
// short lookahead before it is due, with a sample-accurate delay. The player
// counts a scheduled voice as busy from the moment it is scheduled, so handing
// the whole rain over at once would exhaust its voice caps: the lookahead keeps
// only the next fraction of a second booked.
//
// Before the flash the air holds its breath: the ambience dips and work sounds stop. A big
// blast is resolved over several frames, and the flash comes when it is done, so that hold
// lasts until the flash (renewed in short steps), not for a guessed time.

import type { SoundHandle } from '../AudioPlayer.js';
import { BLAST_AUDIO_CONFIG } from '../../core/config/audio/game.js';
import { planBlast, type BlastInfo, type BlastLosses, type PlannedCue } from './blastPlan.js';
import type { DirectorEnv } from './types.js';

interface Queued {
  readonly dueS: number;
  readonly cue: PlannedCue;
}

export class BlastAudio {
  private clockS = 0;
  private queue: Queued[] = [];
  private handles: SoundHandle[] = [];
  /** Real seconds the pre-roll hold has lasted; null when none is held. */
  private preRollHeldS: number | null = null;
  private preRollRenewS = 0;

  constructor(
    private readonly env: DirectorEnv,
    private readonly suppressWork: (seconds: number) => void,
  ) {}

  /** The blast job has started: the air holds its breath until the flash (or the safety limit). */
  preRoll(): void {
    this.preRollHeldS = 0;
    this.holdBreath();
  }

  /** The flash has fired: lay out and start the timeline. `losses` are what the blast destroyed beyond what its report lists. */
  play(info: BlastInfo, chargeKg: number, losses?: BlastLosses): void {
    this.preRollHeldS = null;
    const { amountDb, holdS, releaseS } = BLAST_AUDIO_CONFIG.duck;
    this.env.player.duck('ambient', amountDb, holdS, releaseS);
    this.suppressWork(BLAST_AUDIO_CONFIG.workSuppressS);
    for (const cue of planBlast(info, chargeKg, this.env.random, losses)) this.queue.push({ dueS: this.clockS + cue.atS, cue });
    this.queue.sort((a, b) => a.dueS - b.dueS);
    this.dispatch();
  }

  /** Advance the timeline by a real frame step. */
  update(dtS: number): void {
    this.clockS += dtS;
    this.renewPreRoll(dtS);
    this.dispatch();
  }

  /**
   * A full-screen menu hides the game: the rain of debris still waiting for its turn is forgotten. The shot,
   * its tail, the secondary blasts and the collapses keep their turn, like what is already playing.
   */
  hush(): void {
    this.preRollHeldS = null;
    this.queue = this.queue.filter(entry => !entry.cue.rain);
  }

  /** Cut the blast short: forget what is not yet booked and fade out what is. */
  cancel(): void {
    this.preRollHeldS = null;
    this.queue = [];
    for (const handle of this.handles) handle.stop(BLAST_AUDIO_CONFIG.cancelFadeS);
    this.handles = [];
  }

  /** Dip the ambience and quiet the work sites for one more hold. */
  private holdBreath(): void {
    const { amountDb, holdS, releaseS, refreshS } = BLAST_AUDIO_CONFIG.preRollDuck;
    this.env.player.duck('ambient', amountDb, holdS, releaseS);
    this.suppressWork(holdS);
    this.preRollRenewS = refreshS;
  }

  /** While the flash has not come, renew the hold each `refreshS`, and let go at the safety limit. */
  private renewPreRoll(dtS: number): void {
    if (this.preRollHeldS === null) return;
    this.preRollHeldS += dtS;
    if (this.preRollHeldS >= BLAST_AUDIO_CONFIG.preRollDuck.maxHoldS) {
      this.preRollHeldS = null;
      return;
    }
    this.preRollRenewS -= dtS;
    if (this.preRollRenewS <= 0) this.holdBreath();
  }

  private dispatch(): void {
    while (this.queue.length > 0 && (this.queue[0]?.dueS ?? Infinity) <= this.clockS + BLAST_AUDIO_CONFIG.lookaheadS) {
      const next = this.queue.shift();
      if (!next || this.clockS - next.dueS > BLAST_AUDIO_CONFIG.lateSkipS) continue;
      const handle = this.env.player.play(next.cue.sound, { ...next.cue.options, delayS: Math.max(0, next.dueS - this.clockS) });
      if (handle) this.retain(handle);
    }
  }

  private retain(handle: SoundHandle): void {
    this.handles.push(handle);
    const excess = this.handles.length - BLAST_AUDIO_CONFIG.maxRetainedHandles;
    if (excess > 0) this.handles.splice(0, excess);
  }
}
