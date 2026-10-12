// BlastSimulator2026 — Evacuation siren
// While a detonation is armed the site wails a siren and beeps a countdown that
// quickens as the danger zone empties. It runs on real time, keyed off the
// armed state: the evacuation advances per tick but the alarm must not stutter
// with the tick rate. When the armed state clears it is either a detonation
// (silence, the boom follows) or a cancel (a falling blip); the blast announces
// itself a moment after the state clears, so a short grace period decides.

import { detonationPhase } from '../../core/engine/DetonationSequence.js';
import type { GameState } from '../../core/state/GameState.js';
import { SIREN_CONFIG } from '../../core/config/audio/game.js';
import { clamp } from '../engine/units.js';
import { BedFeed } from './BedFeed.js';
import { lerp } from './scalar.js';
import type { DirectorEnv } from './types.js';

interface SirenInput {
  readonly armed: boolean;
  /** People and vehicles still in the danger zone; null when unknown. */
  readonly remaining: number | null;
  /** A menu, a pause or the level end hides or freezes the game: stay silent without forgetting the state. */
  readonly muted: boolean;
}

/** How many still have to clear the danger zone, or null when no detonation is armed. */
export function evacuationRemaining(state: GameState): number | null {
  const phase = detonationPhase(state);
  switch (phase.kind) {
    case 'evacuating': return phase.remaining;
    case 'stranded': return phase.names.length;
    case 'ready': return 0;
    case 'idle': return null;
  }
}

export class EvacuationSiren {
  /** Created with the first level sent: a mine that never arms a detonation never opens the siren loop. */
  private readonly bed: BedFeed;
  private armed = false;
  private startRemaining = 1;
  private beepTimerS = 0;
  private fired = false;
  private cancelRequested = false;
  private graceS: number | null = null;

  constructor(private readonly env: DirectorEnv) {
    this.bed = new BedFeed(() => env.player.loop('blast_siren'), 0);
  }

  /** The blast is under way: the armed state clearing now is a detonation, not a cancel. */
  notifyDetonation(): void {
    this.fired = true;
    this.graceS = null;
  }

  /** The player cancelled the detonation; the cue plays when the armed state clears. */
  notifyCancelled(): void {
    if (this.armed) this.cancelRequested = true;
  }

  update(dtS: number, input: SirenInput): void {
    if (input.armed && !this.armed) this.arm(input.remaining);
    else if (!input.armed && this.armed) this.disarm();
    this.armed = input.armed;
    this.runGrace(dtS);
    if (!input.armed) return;

    this.setLevel(input.muted ? 0 : 1);
    if (input.muted) return;
    const fraction = this.fractionRemaining(input.remaining);
    this.beepTimerS -= dtS;
    if (this.beepTimerS > 0) return;
    this.beepTimerS = lerp(SIREN_CONFIG.fastIntervalS, SIREN_CONFIG.slowIntervalS, fraction);
    this.env.player.play('blast_beep', { pitchCents: (1 - fraction) * SIREN_CONFIG.maxPitchRiseCents, key: 'blast:beep' });
  }

  /** Silence the siren and forget the armed state. */
  clear(): void {
    this.setLevel(0);
    this.armed = false;
    this.fired = false;
    this.cancelRequested = false;
    this.graceS = null;
  }

  private arm(remaining: number | null): void {
    this.fired = false;
    this.cancelRequested = false;
    this.graceS = null;
    this.startRemaining = Math.max(remaining ?? 1, 1);
    this.beepTimerS = 0;
  }

  private disarm(): void {
    this.setLevel(0, SIREN_CONFIG.rampOutS);
    if (this.cancelRequested) this.playCancel();
    else if (!this.fired) this.graceS = SIREN_CONFIG.cancelGraceS;
    this.cancelRequested = false;
  }

  private runGrace(dtS: number): void {
    if (this.graceS === null) return;
    this.graceS -= dtS;
    if (this.graceS > 0) return;
    this.graceS = null;
    this.playCancel();
  }

  private playCancel(): void {
    this.env.player.play('blast_cancel', { key: 'blast:cancel' });
  }

  /** 1 with the zone as full as it was when armed, 0 with nobody left. */
  private fractionRemaining(remaining: number | null): number {
    if (remaining === null) return 1;
    this.startRemaining = Math.max(this.startRemaining, remaining);
    return clamp(remaining / this.startRemaining, 0, 1);
  }

  private setLevel(level: number, rampS: number = SIREN_CONFIG.rampInS): void {
    this.bed.set(level, rampS);
  }
}
