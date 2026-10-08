// BlastSimulator2026 — Fixtures for the queued demolition flow (#1392).
//
// `build destroy` / `build upgrade` are orders now: a building_destroyer
// vehicle and a truck-licensed driver do the work. Tests that only need the
// building gone call `equipDemolition` once, then `tickUntilDemolished`.

import type { GameContext } from '../../src/console/commands/world.js';
import { vehicleCommand } from '../../src/console/commands/vehicle.js';
import { employeeCommand } from '../../src/console/commands/entities.js';
import { tickCommand } from '../../src/console/commands/events.js';
import { isLicensedForRole } from '../../src/core/engine/VehicleReservation.js';
import type { VehicleTier } from '../../src/core/entities/Vehicle.js';
import { ROLE_LICENCE_REQUIRED } from '../../src/core/entities/VehicleDriverAssignment.js';

/**
 * Give the site a building_destroyer of `vehicleTier` and (when nobody on the
 * roster holds the truck licence yet) hire a driver, who arrives licensed. One
 * licensed operator is raised to licence level `vehicleTier`.
 * Spends cash — call before sampling a cash baseline.
 */
export function equipDemolition(ctx: GameContext, vehicleTier: VehicleTier = 1): void {
  const state = ctx.state!;
  if (state.cash < 500_000) state.cash = 500_000;
  const buy = vehicleCommand(ctx, ['buy', 'building_destroyer'], { tier: String(vehicleTier) });
  if (!buy.success) throw new Error(`equipDemolition: buy failed: ${buy.output}`);
  const licensed = state.employees.employees.some(e => e.alive && isLicensedForRole(e, 'building_destroyer'));
  if (!licensed) {
    const hire = employeeCommand(ctx, ['hire'], { role: 'driver' });
    if (!hire.success) throw new Error(`equipDemolition: hire failed: ${hire.output}`);
  }
  // Driving a tier-N vehicle needs licence level >= N (#1524): raise one licensed operator to match.
  const operator = state.employees.employees.find(e => e.alive && isLicensedForRole(e, 'building_destroyer'));
  const held = operator?.qualifications.find(q => q.category === ROLE_LICENCE_REQUIRED['building_destroyer']);
  if (held && (held.licenceLevel ?? 1) < vehicleTier) held.licenceLevel = vehicleTier;
}

/** True while any demolition (or rebuild site it queued) is still outstanding. */
export function demolitionPending(ctx: GameContext): boolean {
  const state = ctx.state!;
  return state.pendingActions.some(a => a.type === 'demolish_building')
    || state.plannedBuildings.length > 0;
}

/** Tick until every demolish_building order and any queued rebuild has finished. Throws if it never does. */
export function tickUntilDemolished(ctx: GameContext, maxTicks = 1500): number {
  let ticks = 0;
  while (ticks < maxTicks && demolitionPending(ctx)) {
    tickCommand(ctx, ['1'], {});
    ticks++;
  }
  if (demolitionPending(ctx)) throw new Error(`tickUntilDemolished: still pending after ${maxTicks} ticks`);
  return ticks;
}
