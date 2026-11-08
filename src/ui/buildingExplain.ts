// BlastSimulator2026 — Explanation texts for the build menu, placed rows and building inspector (#2171)
//
// What a tier, a badge, a utilization figure, HP and the upkeep multiplier of a building mean,
// translated through t(); every number is read from the building defs or the live modifiers.
// Callers attach the text with explainable().

import type { Building, BuildingType } from '../core/entities/Building.js';
import type { BuildingStatus } from '../core/entities/BuildingStatus.js';
import type { GameState } from '../core/state/GameState.js';

/** Which stored/occupied figure a placed row's utilization shows. */
export type UtilizationKind = 'beds' | 'kg' | 'research';

/** Compares every tier of `type`: cost, max HP and upkeep per hour, one line per tier. */
export function tierCompareExplain(_type: BuildingType): string { throw new Error('not implemented'); }

/** Translated `#id <tier name> (x,z)` title of a placed row. */
export function placedRowTitle(_b: Pick<Building, 'id' | 'type' | 'tier' | 'x' | 'z'>): string { throw new Error('not implemented'); }

/** Why a row carries `badge`: the closing event and time left, or what the status means. */
export function badgeExplain(
  _badge: 'out_of_service' | 'demolition_ordered' | 'upgrading',
  _status: Pick<BuildingStatus, 'closureEventId' | 'closureTicksRemaining'>,
): string { throw new Error('not implemented'); }

/** What the utilization figure of a placed row counts. */
export function utilizationExplain(_b: Building, _kind: UtilizationKind): string { throw new Error('not implemented'); }

/** What a building's HP means and what low HP leads to. */
export function buildingHpExplain(): string { throw new Error('not implemented'); }

/** Base upkeep, or the surcharge factor with the event(s) causing it. */
export function upkeepExplain(_state: Pick<GameState, 'events' | 'tickCount'>): string { throw new Error('not implemented'); }
