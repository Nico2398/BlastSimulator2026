// BlastSimulator2026 — Shared shapes of the game audio director
// What the sub-directors are allowed to know: the AudioPlayer, a random source,
// a real-time clock, a cooldown gate and where things are. No AudioContext.

import type { AudioPlayer, Listener, WorldPoint } from '../AudioPlayer.js';
import type { Random } from '../../core/math/Random.js';
import type { CooldownGate } from './rateLimit.js';

export type EntityKind = 'employee' | 'vehicle' | 'building';

/** The renderer's live (interpolated) position of an entity, or null when it has no mesh. */
export type EntityPositionFn = (kind: EntityKind, id: number) => WorldPoint | null;

/** Where a cue happens: an entity followed live, with the core state's position as a fallback. */
export interface CueSite {
  readonly entity?: { readonly kind: EntityKind; readonly id: number };
  readonly point: WorldPoint;
}

export interface DirectorEnv {
  readonly player: AudioPlayer;
  readonly random: Random;
  readonly gate: CooldownGate;
  /** Real seconds since the director was created; advanced only by `update`. */
  now(): number;
  listener(): Listener | null;
  /** Live position of an entity (renderer first, core state second); null when unknown. */
  positionOf(kind: EntityKind, id: number): WorldPoint | null;
  /** Where a cue site is right now. */
  resolve(site: CueSite): WorldPoint;
  /** True when `point` is within `rangeFactor` times the listener's reference distance (always true without a listener). */
  isNear(point: WorldPoint, rangeFactor: number): boolean;
  /** Metres from the listener; 0 without one. */
  distanceToListener(point: WorldPoint): number;
}
