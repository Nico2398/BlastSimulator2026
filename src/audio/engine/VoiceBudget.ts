// BlastSimulator2026 — Voice budget
// Decides which sounds may start: a cooldown per key, a cap per sound, and a
// global cap where a higher-priority newcomer steals the slot of the
// lowest-priority, oldest voice. Pure bookkeeping on an injected millisecond
// clock, so it is tested without any audio.

import { CooldownGate } from './cooldown.js';

export interface VoiceRequest {
  /** Sound id: the per-sound voice cap counts voices sharing it. */
  readonly sound: string;
  /** Cooldown key (default: the sound id, chosen by the caller). */
  readonly key: string;
  readonly cooldownMs: number;
  /** Concurrent voices of this sound; Infinity for no cap. */
  readonly maxVoices: number;
  readonly priority: number;
}

export interface VoiceTicket {
  /** Give the slot back (idempotent). */
  release(): void;
}

interface ActiveVoice {
  readonly sound: string;
  readonly priority: number;
  readonly serial: number;
  readonly onSteal: () => void;
}

export class VoiceBudget {
  private readonly active = new Set<ActiveVoice>();
  /** Catalog cooldowns, on the same millisecond clock as the budget. */
  private readonly cooldowns: CooldownGate;
  private serial = 0;

  constructor(
    private readonly globalCap: number,
    clock: () => number,
    sweepThreshold: number,
  ) {
    this.cooldowns = new CooldownGate(clock, sweepThreshold);
  }

  get activeCount(): number { return this.active.size; }

  /**
   * Try to start a voice. Returns a ticket to release when the voice ends, or
   * null when the request is dropped. `onSteal` runs when a higher-priority
   * sound takes this voice's slot; the voice must stop itself there.
   */
  acquire(request: VoiceRequest, onSteal: () => void): VoiceTicket | null {
    if (request.cooldownMs > 0 && !this.cooldowns.isReady(request.key)) return null;
    if (this.countOf(request.sound) >= request.maxVoices) return null;
    if (this.active.size >= this.globalCap) {
      const victim = this.pickVictim(request.priority);
      if (!victim) return null;
      this.active.delete(victim);
      victim.onSteal();
    }
    if (request.cooldownMs > 0) this.cooldowns.start(request.key, request.cooldownMs);
    return this.admit(request, onSteal);
  }

  private admit(request: VoiceRequest, onSteal: () => void): VoiceTicket {
    const voice: ActiveVoice = { sound: request.sound, priority: request.priority, serial: this.serial++, onSteal };
    this.active.add(voice);
    return { release: () => { this.active.delete(voice); } };
  }

  private countOf(sound: string): number {
    let count = 0;
    for (const voice of this.active) if (voice.sound === sound) count++;
    return count;
  }

  /** Lowest priority first, oldest first among equals; only strictly lower priority than the newcomer qualifies. */
  private pickVictim(priority: number): ActiveVoice | null {
    let victim: ActiveVoice | null = null;
    for (const voice of this.active) {
      if (voice.priority >= priority) continue;
      if (!victim || voice.priority < victim.priority || (voice.priority === victim.priority && voice.serial < victim.serial)) {
        victim = voice;
      }
    }
    return victim;
  }
}
