import type { GameState } from '../../core/state/GameState.js';

/** Selection kinds whose on-screen anchor may be a host (building, vehicle, site) rather than the entity itself. */
export type HostResolvedKind = 'employee' | 'vehicle' | 'building' | 'fragment';

/** Inclusive tile rectangle. */
export interface SiteFootprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type SelectionAnchor =
  | { type: 'self' }
  | { type: 'host'; kind: 'building' | 'vehicle'; id: number }
  | { type: 'site'; footprint: SiteFootprint };

export type SelectionResolution = { exists: false } | { exists: true; anchor: SelectionAnchor };

export type SelectionWorld = Pick<
  GameState,
  'employees' | 'vehicles' | 'buildings' | 'plannedBuildings' | 'logistics'
>;

export function isHostResolvedKind(_kind: string): _kind is HostResolvedKind {
  // TODO: implement
  return false;
}

export function resolveSelection(
  _world: SelectionWorld,
  _kind: HostResolvedKind,
  _id: number,
): SelectionResolution {
  // TODO: implement
  return { exists: false };
}

export function isUnderRebuild(
  _world: Pick<GameState, 'buildings' | 'plannedBuildings'>,
  _id: number,
): boolean {
  // TODO: implement
  return false;
}
