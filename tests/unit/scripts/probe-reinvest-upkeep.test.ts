// #2126: the reinvest probe keeps its fleet running (lost vehicles, stranded ore, hauling capacity, buildings out of reach).
import { describe, it, expect, beforeEach } from 'vitest';
import type { GameState } from '../../../src/core/state/GameState.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import {
  fleetRoles, lostVehicleRoles, reachableHaulableOreKg, reinvestHaulersWanted, unreachableNewestBuildOrder, REINVEST_HAUL_ORDERS_PER_HAULER,
  REINVEST_MAX_HAULERS,
} from '../../../scripts/shared/probe-strategies.js';

function fleet(...types: string[]): Pick<GameState, 'vehicles'> {
  return { vehicles: { vehicles: types.map((type, i) => ({ id: i + 1, type })) } } as unknown as Pick<GameState, 'vehicles'>;
}

function fragment(id: number, volume = 0.3): FragmentData {
  return {
    id, position: { x: 10, y: 0, z: 10 }, volume, mass: 1000, rockId: 'cruite', oreDensities: { dirtite: 0.5 },
    initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false, halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1, origin: { x: 10, y: 0, z: 10 },
  };
}

function withFragment(state: GameState, id: number, volume?: number): void {
  state.logistics.fragments.push({ fragment: fragment(id, volume), state: 'on_ground', vehicleId: null, warehouseId: null });
}

function withHaulOrder(state: GameState, fragmentId: number, blockedReason?: string): void {
  state.pendingActions.push({
    id: state.nextPendingActionId++, type: 'haul_debris', ...(blockedReason ? { blockedReason } : {}), requiredSkill: null,
    requiredVehicleRole: 'debris_hauler', targetX: 10, targetZ: 10, targetY: 0, payload: { fragmentId }, targetEmployeeId: null,
  } as unknown as GameState['pendingActions'][number]);
}

describe('fleetRoles (#2126)', () => {
  it('lists each role once, in fleet order', () => {
    expect(fleetRoles(fleet('drill_rig', 'debris_hauler', 'charging_truck', 'debris_hauler'))).toEqual(['drill_rig', 'debris_hauler', 'charging_truck']);
  });

  it('is empty for an empty fleet', () => {
    expect(fleetRoles(fleet())).toEqual([]);
  });
});

describe('lostVehicleRoles (#2126)', () => {
  it('names a kept role the fleet no longer has', () => {
    expect(lostVehicleRoles(fleet('debris_hauler', 'charging_truck'), ['drill_rig', 'debris_hauler', 'charging_truck'])).toEqual(['drill_rig']);
  });

  it('is empty while one vehicle of each kept role remains', () => {
    expect(lostVehicleRoles(fleet('drill_rig', 'debris_hauler'), ['drill_rig', 'debris_hauler'])).toEqual([]);
  });

  it('ignores roles the fleet gained and roles it never kept', () => {
    expect(lostVehicleRoles(fleet('drill_rig', 'rock_fragmenter'), ['drill_rig'])).toEqual([]);
  });
});

describe('reachableHaulableOreKg (#2126)', () => {
  let state: GameState;
  beforeEach(() => {
    state = createGame({ seed: 42 });
  });

  it('counts the ore of every haulable fragment on the ground when none is stranded', () => {
    withFragment(state, 1);
    withFragment(state, 2);
    withHaulOrder(state, 1);
    const one = reachableHaulableOreKg(state) / 2;
    expect(one).toBeGreaterThan(0);
    expect(reachableHaulableOreKg(state)).toBeCloseTo(2 * one);
  });

  it('leaves out a fragment whose haul order is out of reach', () => {
    withFragment(state, 1);
    withFragment(state, 2);
    const both = reachableHaulableOreKg(state);
    withHaulOrder(state, 2, 'debris_out_of_reach');
    expect(reachableHaulableOreKg(state)).toBeCloseTo(both / 2);
  });

  it('keeps a fragment blocked for another reason, and never counts a boulder', () => {
    withFragment(state, 1);
    withHaulOrder(state, 1, 'storage_full');
    const kept = reachableHaulableOreKg(state);
    expect(kept).toBeGreaterThan(0);
    withFragment(state, 2, 50);
    expect(reachableHaulableOreKg(state)).toBeCloseTo(kept);
  });
});

describe('reinvestHaulersWanted (#2126)', () => {
  it('wants the two haulers of old for a small backlog', () => {
    expect(reinvestHaulersWanted(0)).toBe(2);
    expect(reinvestHaulersWanted(2 * REINVEST_HAUL_ORDERS_PER_HAULER)).toBe(2);
  });

  it('adds one per REINVEST_HAUL_ORDERS_PER_HAULER open orders beyond that', () => {
    expect(reinvestHaulersWanted(2 * REINVEST_HAUL_ORDERS_PER_HAULER + 1)).toBe(3);
  });

  it('stops at REINVEST_MAX_HAULERS', () => {
    expect(reinvestHaulersWanted(100 * REINVEST_HAUL_ORDERS_PER_HAULER)).toBe(REINVEST_MAX_HAULERS);
  });
});

type BuildOrders = Parameters<typeof unreachableNewestBuildOrder>[0];

/** Planned buildings with their place_building orders; `blocked[i]` is order i's blockedReason (undefined: none). */
function buildOrders(...blocked: Array<string | undefined>): BuildOrders {
  return {
    plannedBuildings: blocked.map((_, i) => ({ id: i + 1, actionId: 100 + i, type: 'research_center', tier: 1, x: 4 * i, z: 8 })),
    pendingActions: blocked.map((reason, i) => ({ id: 100 + i, type: 'place_building', ...(reason ? { blockedReason: reason } : {}) })),
  } as unknown as BuildOrders;
}

describe('unreachableNewestBuildOrder (#2126)', () => {
  it('names the newest order when no builder can reach its site', () => {
    expect(unreachableNewestBuildOrder(buildOrders(undefined, 'target_unreachable'))).toBe(101);
  });

  it('is null with nothing planned, and for an older unreachable order under a reachable newest one', () => {
    expect(unreachableNewestBuildOrder(buildOrders())).toBeNull();
    expect(unreachableNewestBuildOrder(buildOrders('target_unreachable', undefined))).toBeNull();
  });

  it('is null for an order blocked for another reason, or whose action is gone', () => {
    expect(unreachableNewestBuildOrder(buildOrders('no_qualified_employee'))).toBeNull();
    const orders = buildOrders('target_unreachable');
    orders.pendingActions.length = 0;
    expect(unreachableNewestBuildOrder(orders)).toBeNull();
  });
});
