// BlastSimulator2026 — Typed event emitter for core→renderer communication
// Pure TypeScript, no DOM. Core emits events; renderer/UI/audio subscribe.

/** Map of all game events and their payload types. */
export interface GameEventMap {
  'terrain:updated': undefined;
  'blast:started': undefined;
  'blast:ended': undefined;
  'fragment:created': { count: number };
  'time:tick': { dt: number };
}

type EventHandler<T> = (data: T) => void;

/**
 * Typed event emitter.
 * Usage:
 *   emitter.on('time:tick', ({ dt }) => { ... });
 *   emitter.emit('time:tick', { dt: 100 });
 */
export class EventEmitter {
  private readonly listeners = new Map<string, Set<EventHandler<unknown>>>();

  /** Subscribe to an event. */
  on<K extends keyof GameEventMap>(event: K, handler: EventHandler<GameEventMap[K]>): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as EventHandler<unknown>);
  }

  /** Unsubscribe from an event. */
  off<K extends keyof GameEventMap>(event: K, handler: EventHandler<GameEventMap[K]>): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(handler as EventHandler<unknown>);
    }
  }

  /** Emit an event to all subscribers. */
  emit<K extends keyof GameEventMap>(event: K, data: GameEventMap[K]): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const handler of set) {
        handler(data);
      }
    }
  }
}
