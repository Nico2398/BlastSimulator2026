// BlastSimulator2026 — Haul-button eligibility cache (redesign P6)
//
// Shared by FleetPanel (and, until the P6 cleanup deletes it, the old
// VehiclePanel via its own vehicleHaulButton.ts copy). Plain exported
// functions taking the console-dispatch callback as a parameter rather than
// a panel type, matching this codebase's helper-file convention
// (employeeTrainingSection.ts, crewDetailSections.ts).

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
  wrap.style.cssText = 'display:flex;align-items:center;gap:4px';

  const haulBtn = document.createElement('button');
  haulBtn.className = 'bsx-btn bsx-btn-primary bs-vehicle-haul-btn';
  haulBtn.style.cssText = 'flex:1;height:28px';
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
 * the card — a full rebuild would discard the driver picker's in-progress
 * selection. Looks for a `[data-haul-slot]` element carrying the vehicle's
 * id — the caller decides where that slot sits in its own layout.
 */
export function refreshHaulButtons(
  containerEl: HTMLElement,
  state: GameState,
  cache: HaulEligibilityCache,
  gameConsole: ((cmd: string) => unknown) | undefined,
): void {
  const slots = containerEl.querySelectorAll<HTMLElement>('[data-haul-slot]');
  slots.forEach(slot => {
    const vehicleId = Number(slot.dataset['haulSlot']);
    const existing = slot.querySelector<HTMLElement>('.bs-vehicle-haul-wrap');
    const eligible = cache.fragmentIdFor(vehicleId) !== null;

    if (eligible && !existing) {
      const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId);
      const btn = vehicle ? makeHaulButton(vehicle, cache, gameConsole) : null;
      if (btn) slot.prepend(btn);
    } else if (!eligible && existing) {
      existing.remove();
    }
  });
}
