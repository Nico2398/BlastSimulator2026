// BlastSimulator2026 — Vehicle panel "Haul" button and its per-tick eligibility cache.
//
// Split out of VehiclePanel.ts to keep it under the 300-line file-size
// convention (dev-coding-conventions). Follows this codebase's helper-file
// pattern (employeeTrainingSection.ts, employeeDetailSections.ts): plain
// exported functions taking the console-dispatch callback as a parameter
// instead of importing VehiclePanel's type.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import type { Vehicle } from '../core/entities/Vehicle.js';
import { findReachableGroundFragment, isHaulEligibleVehicle } from '../core/economy/HaulingTask.js';

/**
 * Caches each eligible vehicle's best reachable fragment for one game tick.
 * `refreshHaulButtons` runs from `update()`, which UIManager drives every
 * rendered animation frame (~60/sec) regardless of pause state — recomputing
 * NavGrid.computeReachableSet's flood fill that often is wasted work, since
 * eligibility only changes once per game tick. `refresh` is a no-op once
 * already computed for the current `state.tickCount`.
 */
export class HaulEligibilityCache {
  private tick = -1;
  private readonly fragmentIdByVehicle = new Map<number, number | null>();

  /** Recompute every eligible vehicle's best fragment; no-op if already done this tick. */
  refresh(state: GameState): void {
    if (state.tickCount === this.tick) return;
    this.tick = state.tickCount;
    this.fragmentIdByVehicle.clear();
    for (const v of state.vehicles.vehicles) {
      if (!isHaulEligibleVehicle(v)) continue;
      this.fragmentIdByVehicle.set(v.id, findReachableGroundFragment(state, v.id));
    }
  }

  /** Cached best fragment for `vehicleId` — null if ineligible or no reachable fragment. */
  fragmentIdFor(vehicleId: number): number | null {
    return this.fragmentIdByVehicle.get(vehicleId) ?? null;
  }
}

/**
 * "Haul" button for a debris_hauler with a driver, no in-progress haul, and a
 * reachable on-ground fragment right now. Returns null (renders nothing) for
 * any other vehicle — there is no disabled/greyed state, only present or
 * absent, mirroring how the driver row hides its assign control once a
 * driver is already aboard.
 */
export function makeHaulButton(
  v: Vehicle,
  cache: HaulEligibilityCache,
  gameConsole: ((cmd: string) => unknown) | undefined,
): HTMLElement | null {
  if (cache.fragmentIdFor(v.id) === null) return null;

  const wrap = document.createElement('div');
  wrap.className = 'bs-vehicle-haul-wrap';
  wrap.dataset['vehicleId'] = String(v.id);
  wrap.style.cssText = 'display:flex;align-items:center;gap:4px;margin-top:3px';

  const haulBtn = document.createElement('button');
  haulBtn.className = 'bs-btn bs-btn-primary bs-vehicle-haul-btn';
  haulBtn.style.cssText = 'padding:1px 6px;font-size:10px';
  haulBtn.textContent = t('ui.vehicles.haul');
  haulBtn.addEventListener('click', () => {
    const fragmentId = cache.fragmentIdFor(v.id);
    if (fragmentId === null) return;
    gameConsole?.(`vehicle haul ${v.id} fragment:${fragmentId}`);
  });

  wrap.appendChild(haulBtn);
  return wrap;
}

/**
 * Adds/removes each vehicle's Haul button wrapper in place as reachable-
 * fragment eligibility changes tick to tick, without touching the rest of
 * the row — a full row rebuild would discard the driver <select>'s
 * in-progress choice (see VehiclePanel.update()'s signature-gated rebuild).
 * `col` elements are tagged with data-vehicle-id by makeVehicleRow.
 */
export function refreshHaulButtons(
  listEl: HTMLElement,
  state: GameState,
  cache: HaulEligibilityCache,
  gameConsole: ((cmd: string) => unknown) | undefined,
): void {
  const cols = listEl.querySelectorAll<HTMLElement>('.bs-vehicle-col');
  cols.forEach(col => {
    const vehicleId = Number(col.dataset['vehicleId']);
    const existing = col.querySelector<HTMLElement>('.bs-vehicle-haul-wrap');
    const eligible = cache.fragmentIdFor(vehicleId) !== null;

    if (eligible && !existing) {
      const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId);
      const btn = vehicle ? makeHaulButton(vehicle, cache, gameConsole) : null;
      if (btn) col.appendChild(btn);
    } else if (!eligible && existing) {
      existing.remove();
    }
  });
}
