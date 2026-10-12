// BlastSimulator2026 — Isolated emitter subscriptions
// The core emitter calls its handlers synchronously inside the simulation tick,
// so a throwing audio handler would abort the tick. Every handler registered
// here is wrapped: an error is reported and swallowed, never propagated.

import type { EventEmitter, GameEventMap } from '../../core/state/EventEmitter.js';

export class Subscriptions {
  private readonly detachers: Array<() => void> = [];

  constructor(
    private readonly emitter: EventEmitter,
    private readonly onError: (error: unknown) => void,
  ) {}

  on<K extends keyof GameEventMap>(event: K, handler: (data: GameEventMap[K]) => void): void {
    const guarded = (data: GameEventMap[K]): void => {
      try {
        handler(data);
      } catch (error) {
        this.onError(error);
      }
    };
    this.emitter.on(event, guarded);
    this.detachers.push(() => this.emitter.off(event, guarded));
  }

  dispose(): void {
    for (const detach of this.detachers) detach();
    this.detachers.length = 0;
  }
}
