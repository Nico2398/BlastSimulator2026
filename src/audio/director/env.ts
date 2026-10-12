// BlastSimulator2026 — Director environment
// Builds the DirectorEnv the sub-directors share: positions resolve through the
// renderer first and the core state second, ranges come from the listener.

import type { AudioPlayer, Listener, WorldPoint } from '../AudioPlayer.js';
import type { GameState } from '../../core/state/GameState.js';
import type { Random } from '../../core/math/Random.js';
import { CooldownGate } from './rateLimit.js';
import { distanceM, referenceM } from './listening.js';
import type { CueSite, DirectorEnv, EntityKind, EntityPositionFn } from './types.js';

interface EnvSources {
  readonly player: AudioPlayer;
  readonly random: Random;
  readonly now: () => number;
  readonly listener: () => Listener | null;
  readonly state: () => GameState | null;
  readonly entityPosition?: EntityPositionFn | undefined;
}

/** Position recorded in the core state for an entity. A mounted employee shares its vehicle's. */
function statePosition(state: GameState, kind: EntityKind, id: number): WorldPoint | null {
  const found = kind === 'employee'
    ? state.employees.employees.find(e => e.id === id)
    : kind === 'vehicle'
      ? state.vehicles.vehicles.find(v => v.id === id)
      : state.buildings.buildings.find(b => b.id === id);
  return found ? { x: found.x, z: found.z } : null;
}

export function createDirectorEnv(sources: EnvSources): DirectorEnv {
  const positionOf = (kind: EntityKind, id: number): WorldPoint | null => {
    const live = sources.entityPosition?.(kind, id);
    if (live) return live;
    const state = sources.state();
    return state ? statePosition(state, kind, id) : null;
  };
  const distanceToListener = (point: WorldPoint): number => {
    const listener = sources.listener();
    return listener ? distanceM(listener, point) : 0;
  };
  return {
    player: sources.player,
    random: sources.random,
    gate: new CooldownGate(sources.now),
    now: sources.now,
    listener: sources.listener,
    positionOf,
    resolve: (site: CueSite): WorldPoint => (site.entity ? positionOf(site.entity.kind, site.entity.id) : null) ?? site.point,
    isNear: (point, rangeFactor) => {
      const listener = sources.listener();
      return listener === null || distanceM(listener, point) <= referenceM(listener.viewDistance) * rangeFactor;
    },
    distanceToListener,
  };
}
