// BlastSimulator2026 — Break-button eligibility cache (redesign P6 conventions)
//
// Boulder-breaking button for the Fleet panel (#484 rock_fragmenter feature).
// Hauling's own equivalent (haulEligibility.ts) was retired in #552 — hauling
// is self-dispatching now, so this is the only eligibility-cache/button pair
// left on the panel.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import type { Vehicle } from '../core/entities/Vehicle.js';
import { findReachableOversizedFragment, isBreakEligibleVehicle } from '../core/economy/BoulderBreaking.js';

/**
 * Caches each eligible vehicle's best reachable oversized fragment for one
 * game tick — mirrors HaulEligibilityCache.
 */
export class BreakEligibilityCache {
  private tick = -1;
  private readonly fragmentIdByVehicle = new Map<number, number | null>();

  /** Recompute every eligible vehicle's best oversized fragment; no-op if already done this tick. */
  refresh(state: GameState): void {
    if (state.tickCount === this.tick) return;
    this.tick = state.tickCount;
    this.fragmentIdByVehicle.clear();
    for (const v of state.vehicles.vehicles) {
      if (!isBreakEligibleVehicle(v)) continue;
      this.fragmentIdByVehicle.set(v.id, findReachableOversizedFragment(state, v.id));
    }
  }

  /** Cached best oversized fragment for `vehicleId` — null if ineligible or no reachable fragment. */
  fragmentIdFor(vehicleId: number): number | null {
    return this.fragmentIdByVehicle.get(vehicleId) ?? null;
  }
}

/**
 * "Break" button for a rock_fragmenter with a driver, no in-progress break,
 * and a reachable oversized fragment right now. Returns null (renders
 * nothing) for any other vehicle — mirrors makeHaulButton.
 */
export function makeBreakButton(
  v: Vehicle,
  cache: BreakEligibilityCache,
  gameConsole: ((cmd: string) => unknown) | undefined,
): HTMLElement | null {
  if (cache.fragmentIdFor(v.id) === null) return null;

  const wrap = document.createElement('div');
  wrap.className = 'bs-vehicle-break-wrap';
  wrap.dataset['vehicleId'] = String(v.id);
  wrap.style.cssText = 'display:flex;align-items:center;gap:4px';

  const breakBtn = document.createElement('button');
  breakBtn.className = 'bsx-btn bsx-btn-primary bs-vehicle-break-btn';
  breakBtn.style.cssText = 'flex:1;height:28px';
  breakBtn.textContent = t('ui.vehicles.break');
  breakBtn.addEventListener('click', () => {
    const fragmentId = cache.fragmentIdFor(v.id);
    if (fragmentId === null) return;
    gameConsole?.(`vehicle break ${v.id} fragment:${fragmentId}`);
  });

  wrap.appendChild(breakBtn);
  return wrap;
}

/**
 * Adds/removes each vehicle's Break button wrapper in place as reachable-
 * fragment eligibility changes tick to tick, without touching the rest of
 * the card. Looks for a `[data-break-slot]` element carrying the vehicle's
 * id — the caller decides where that slot sits in its own layout. Mirrors
 * refreshHaulButtons exactly.
 */
export function refreshBreakButtons(
  containerEl: HTMLElement,
  state: GameState,
  cache: BreakEligibilityCache,
  gameConsole: ((cmd: string) => unknown) | undefined,
): void {
  const slots = containerEl.querySelectorAll<HTMLElement>('[data-break-slot]');
  slots.forEach(slot => {
    const vehicleId = Number(slot.dataset['breakSlot']);
    const existing = slot.querySelector<HTMLElement>('.bs-vehicle-break-wrap');
    const eligible = cache.fragmentIdFor(vehicleId) !== null;

    if (eligible && !existing) {
      const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId);
      const btn = vehicle ? makeBreakButton(vehicle, cache, gameConsole) : null;
      if (btn) slot.prepend(btn);
    } else if (!eligible && existing) {
      existing.remove();
    }
  });
}
