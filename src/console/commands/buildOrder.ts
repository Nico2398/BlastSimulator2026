// BlastSimulator2026 — Console command for ordering a new building (#556)
// Skeleton only: confirming a placement validates/charges as today, then
// queues a `place_building` action at the target instead of creating the
// building immediately. Body filled in during the implementation phase.

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import type { BuildingType, BuildingTier } from '../../core/entities/Building.js';

/** Payload carried by a queued `place_building` PendingAction (#556). */
export interface PlaceBuildingActionPayload {
  buildingOrderId: number;
  cost: number;
  footprint: ReadonlyArray<readonly [number, number]>;
  durationTicks: number;
}

/**
 * Order a new building at (x, z): validates and charges as `buildCommand`'s
 * default case does today, then queues one `place_building` action instead
 * of placing the building immediately.
 */
export function orderBuildingCommand(
  _ctx: GameContext,
  _type: BuildingType,
  _x: number,
  _z: number,
  _tier: BuildingTier,
): CommandResult {
  return { success: false, output: 'not implemented' };
}
