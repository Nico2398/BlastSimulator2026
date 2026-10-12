// BlastSimulator2026 — Blast audio
// Plays one blast's timeline and can cut it short. The crack, boom and sub-bass
// start the moment the renderer fires the flash; everything later (tail, debris
// rain, secondary blasts, collapsing buildings) is handed to the player a
// short lookahead before it is due, with a sample-accurate delay. The player
// counts a scheduled voice as busy from the moment it is scheduled, so handing
// the whole rain over at once would exhaust its voice caps: the lookahead keeps
// only the next fraction of a second booked.

import type { SoundHandle } from '../AudioPlayer.js';
import { BLAST_AUDIO_CONFIG } from '../../core/config/audio/game.js';
import { planBlast, type BlastInfo, type PlannedCue } from './blastPlan.js';
import type { DirectorEnv } from './types.js';

interface Queued {
  readonly dueS: number;
  readonly cue: PlannedCue;
}

export class BlastAudio {
  private clockS = 0;
  private queue: Queued[] = [];
  private handles: SoundHandle[] = [];

  constructor(
    private readonly env: DirectorEnv,
    private readonly suppressWork: (seconds: number) => void,
  ) {}

  /** The blast job has started: the air holds its breath before the boom. */
  preRoll(): void {
    const { amountDb, holdS, releaseS } = BLAST_AUDIO_CONFIG.preRollDuck;
    this.env.player.duck('ambient', amountDb, holdS, releaseS);
    this.suppressWork(BLAST_AUDIO_CONFIG.preRollDuck.holdS);
  }

  /** The flash has fired: lay out and start the timeline. */
  play(info: BlastInfo, chargeKg: number): void {
    const { amountDb, holdS, releaseS } = BLAST_AUDIO_CONFIG.duck;
    this.env.player.duck('ambient', amountDb, holdS, releaseS);
    this.suppressWork(BLAST_AUDIO_CONFIG.workSuppressS);
    for (const cue of planBlast(info, chargeKg, this.env.random)) this.queue.push({ dueS: this.clockS + cue.atS, cue });
    this.queue.sort((a, b) => a.dueS - b.dueS);
    this.dispatch();
  }

  /** Advance the timeline by a real frame step. */
  update(dtS: number): void {
    this.clockS += dtS;
    this.dispatch();
  }

  /**
   * A full-screen menu hides the game: book nothing more. What is already playing (the shot, its tail) rings
   * out; the rain of debris still waiting for its turn is forgotten.
   */
  hush(): void {
    this.queue = [];
  }

  /** Cut the blast short: forget what is not yet booked and fade out what is. */
  cancel(): void {
    this.queue = [];
    for (const handle of this.handles) handle.stop(BLAST_AUDIO_CONFIG.cancelFadeS);
    this.handles = [];
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
