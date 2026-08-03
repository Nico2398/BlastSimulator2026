// BlastSimulator2026 — Typed event emitter for core→renderer communication
// Pure TypeScript, no DOM. Core emits events; renderer/UI/audio subscribe.

import type { SkillCategory } from '../entities/Employee.js';

/** Map of all game events and their payload types. */
export interface GameEventMap {
  /** Fired after any voxel mutation (generation, blast, drill, ramp) with the affected AABB, inclusive voxel coords. */
  'terrain:updated': { region: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } };
  'blast:started': { originX: number; originY: number; originZ: number };
  'blast:ended': undefined;
  'fragment:created': { count: number };
  'time:tick': { dt: number };

  // Phase 7 — Campaign events
  'level:complete': { levelId: string; totalProfit: number; blastsPerformed: number; casualties: number; finalWellBeing: number; finalEcology: number; finalSafety: number };
  'bankruptcy:warning': { cash: number; ticksRemaining: number };
  'bankruptcy:triggered': { cash: number };
  'arrest:triggered': { exposure: number };
  'ecology:warning': { ticksRemaining: number };
  'ecology:shutdown': Record<string, never>;
  'revolt:warning': { ticksRemaining: number };
  'revolt:triggered': Record<string, never>;
  'employee:levelup': { employeeId: number; category: SkillCategory; oldLevel: number; newLevel: number };

  // Phase 8 — Employee need events
  'employee:trained': { employeeId: number; skill: SkillCategory; level: number; isNew: boolean };
  'employee:need_warning': { employeeId: number; needKey: string };
  'employee:collapsed': { employeeId: number; needKey: string };
  'employee:shift_change': { employeeId: number };

  // Phase 9 — Navmesh path-following
  'agent:stuck': { employeeId: number };
  'vehicle:stuck': { vehicleId: number };

  // Arrival-gated vehicle actions
  'vehicle:driver_boarded': { employeeId: number; vehicleId: number };
  'vehicle:haul_loaded': { vehicleId: number; fragmentId: number };
  'vehicle:haul_delivered': { vehicleId: number; fragmentId: number };
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
