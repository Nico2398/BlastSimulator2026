// BlastSimulator2026 — Vehicle panel "Break" button and its per-tick eligibility cache.
//
// Stub (issue #484), mirrors vehicleHaulButton.ts's shape for the boulder-
// breaking workflow instead of hauling. Split out of VehiclePanel.ts to keep
// it under the 300-line file-size convention (dev-coding-conventions).

import type { GameState } from '../core/state/GameState.js';
import type { Vehicle } from '../core/entities/Vehicle.js';

/**
 * Caches each eligible vehicle's best reachable oversized fragment for one
 * game tick — mirrors HaulEligibilityCache.
 */
export class BreakEligibilityCache {
  refresh(_state: GameState): void {
    throw new Error('not implemented');
  }

  /** Cached best oversized fragment for `vehicleId` — null if ineligible or no reachable fragment. */
  fragmentIdFor(_vehicleId: number): number | null {
    throw new Error('not implemented');
  }
}

/**
 * "Break" button for a rock_fragmenter with a driver, no in-progress break,
 * and a reachable oversized fragment right now. Returns null (renders
 * nothing) for any other vehicle.
 */
export function makeBreakButton(
  _v: Vehicle, _cache: BreakEligibilityCache, _gameConsole: ((cmd: string) => unknown) | undefined,
): HTMLElement | null {
  throw new Error('not implemented');
}

/**
 * Adds/removes each vehicle's Break button wrapper in place as reachable-
 * fragment eligibility changes tick to tick — mirrors refreshHaulButtons.
 */
export function refreshBreakButtons(
  _listEl: HTMLElement, _state: GameState, _cache: BreakEligibilityCache,
  _gameConsole: ((cmd: string) => unknown) | undefined,
): void {
  throw new Error('not implemented');
}
