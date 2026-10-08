// BlastSimulator2026 — Fixture for #1414: a small site an event effect can act on.

import { createGame, type GameState } from '../../src/core/state/GameState.js';
import { hireEmployee } from '../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../src/core/entities/Vehicle.js';
import { Random } from '../../src/core/math/Random.js';
import type { EventWorld } from '../../src/core/events/TrafficJamEffects.js';
import type { ActiveModifier } from '../../src/core/events/ActiveModifiers.js';

export interface EffectFixture { state: GameState; world: EventWorld; rng: Random }

/** Roster of one of each role plus a second driller; one vehicle; no contracts. */
export function makeEffectWorld(opts: { empty?: boolean; seed?: number } = {}): EffectFixture {
  const state = createGame({ seed: opts.seed ?? 42 });
  const rng = new Random(opts.seed ?? 42);
  state.employees.employees = [];
  state.vehicles.vehicles = [];
  if (!opts.empty) {
    for (const role of ['driller', 'driller', 'blaster', 'driver', 'surveyor', 'manager'] as const) {
      hireEmployee(state.employees, role, rng, 5, 5, 0);
    }
    purchaseVehicle(state.vehicles, 'debris_hauler', 6, 6, 1);
  }
  return { state, world: { state, grid: null }, rng };
}

export function mod(partial: Partial<ActiveModifier> & Pick<ActiveModifier, 'kind'>): Omit<ActiveModifier, 'id'> {
  return {
    sourceEventId: 'test', role: null, targetId: null, category: null,
    magnitude: 1, startTick: 0, endTick: 100, ...partial,
  };
}
