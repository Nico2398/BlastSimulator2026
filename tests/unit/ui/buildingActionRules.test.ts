import { describe, it, expect } from 'vitest';
import { buildingActionRules } from '../../../src/ui/buildingActionRules.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import {
  getUpgradeCost, getMoveCost, getDemolishCost, isSingleTierType, getBuildingDef, type Building, type BuildingType,
} from '../../../src/core/entities/Building.js';
import { getResearchTaskDef } from '../../../src/core/config/balance.js';
import { purchaseVehicle, ROLE_LICENCE_REQUIRED } from '../../../src/core/entities/Vehicle.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { RESERVATION_REFUSAL } from '../../../src/core/entities/PlacementReservations.js';

// #1758: one rule, one implementation — the inspector asks this for which
// building actions to offer and why one is not.

function makeBuilding(overrides: Partial<Building> = {}): Building {
  return { id: 3, type: 'management_office', tier: 1, x: 5, z: 5, hp: 100, active: true, occupantIds: [], ...overrides };
}

function stateWith(b: Building, cash = 9_999_999): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.cash = cash;
  s.buildings.buildings = [b];
  return s;
}

function addRampOver(s: GameState, b: Building): void {
  s.builtRamps.push({
    id: 1,
    def: { originX: b.x, originZ: b.z, direction: 'south', length: 8, targetDepth: 4, width: 3 },
    width: 3,
    footprint: { minX: b.x - 1, maxX: b.x + 1, minZ: b.z, maxZ: b.z + 8 },
  });
}

function demolitionOrder(s: GameState, id: number): void {
  s.pendingActions.push({
    id: 50, type: 'demolish_building', requiredSkill: null, requiredVehicleRole: 'building_destroyer',
    targetX: 5, targetZ: 5, targetY: 0, payload: { buildingId: id }, targetEmployeeId: null,
    status: 'queued', holderId: null, queuedAtTick: 0,
  });
}

describe('buildingActionRules — upgrade', () => {
  it('is available with its cost when the next tier is unlocked and cash covers it', () => {
    const b = makeBuilding();
    const s = stateWith(b);
    s.buildings.unlockedTiers['management_office'] = 2;
    const r = buildingActionRules(s, b);
    expect(r.upgrade).toMatchObject({ kind: 'available', nextTier: 2, cost: getUpgradeCost(b, 2), reasonKey: null });
    expect(r.research).toBeNull();
  });

  it('is locked (not refused) when the next tier still needs research, and offers research', () => {
    const b = makeBuilding();
    const s = stateWith(b);
    const r = buildingActionRules(s, b);
    expect(r.upgrade.kind).toBe('locked');
    expect(r.upgrade.nextTier).toBe(2);
    const def = getResearchTaskDef('management_office', 2);
    expect(r.research).toMatchObject({ type: 'management_office', tier: 2, cost: def.cost, duration: def.ticks, queued: null });
  });

  it('shows live progress once research is queued', () => {
    const b = makeBuilding({ tier: 2 });
    const s = stateWith(b);
    const def = getResearchTaskDef('management_office', 3);
    s.buildings.researchQueue.push({
      targetType: 'management_office', targetTier: 3, ticksRemaining: Math.floor(def.ticks / 2), cost: def.cost, conditions: [],
    });
    const q = buildingActionRules(s, b).research!.queued!;
    expect(q.remaining).toBe(Math.floor(def.ticks / 2));
    expect(q.fraction).toBeGreaterThan(0);
    expect(q.fraction).toBeLessThan(1);
  });

  it('research is null once the tier is unlocked', () => {
    const b = makeBuilding();
    const s = stateWith(b);
    s.buildings.unlockedTiers['management_office'] = 3;
    expect(buildingActionRules(s, b).research).toBeNull();
  });

  it('is refused at max tier with a reason, no next tier, no cost, no research', () => {
    const b = makeBuilding({ tier: 3 });
    const r = buildingActionRules(stateWith(b), b);
    expect(r.upgrade.kind).toBe('refused');
    expect(r.upgrade.nextTier).toBeNull();
    expect(r.upgrade.cost).toBeNull();
    expect(r.upgrade.reasonKey).toBeTruthy();
    expect(r.research).toBeNull();
  });

  it('is refused for a single-tier type (spoil heap)', () => {
    const type: BuildingType = 'spoil_heap';
    expect(isSingleTierType(type)).toBe(true);
    const b = makeBuilding({ type });
    const r = buildingActionRules(stateWith(b), b);
    expect(r.upgrade.kind).toBe('refused');
    expect(r.upgrade.nextTier).toBeNull();
    expect(r.research).toBeNull();
  });

  it('is refused on short cash, with a reason distinct from the max-tier one', () => {
    const b = makeBuilding();
    const s = stateWith(b, 0);
    s.buildings.unlockedTiers['management_office'] = 2;
    const cashRefusal = buildingActionRules(s, b).upgrade;
    expect(cashRefusal.kind).toBe('refused');
    expect(cashRefusal.reasonKey).toBeTruthy();
    expect(cashRefusal.cost).toBe(getUpgradeCost(b, 2));
    const maxB = makeBuilding({ tier: 3 });
    expect(cashRefusal.reasonKey).not.toBe(buildingActionRules(stateWith(maxB), maxB).upgrade.reasonKey);
  });

  it('cash exactly equal to the cost is not a refusal', () => {
    const b = makeBuilding();
    const s = stateWith(b, getUpgradeCost(b, 2));
    s.buildings.unlockedTiers['management_office'] = 2;
    expect(buildingActionRules(s, b).upgrade.kind).toBe('available');
  });

  it('is refused when the next-tier footprint covers a ramp reservation, naming the reservation', () => {
    const b = makeBuilding();
    const s = stateWith(b);
    s.buildings.unlockedTiers['management_office'] = 2;
    addRampOver(s, b);
    const r = buildingActionRules(s, b);
    expect(r.upgrade.kind).toBe('refused');
    expect(r.upgrade.reasonKey).toBe(RESERVATION_REFUSAL.ramp.errorKey);
  });

  it('is refused while a demolition is already ordered', () => {
    const b = makeBuilding();
    const s = stateWith(b);
    s.buildings.unlockedTiers['management_office'] = 2;
    demolitionOrder(s, b.id);
    expect(buildingActionRules(s, b).upgrade.kind).toBe('refused');
  });

  it('refusal order: max tier beats demolition ordered', () => {
    const b = makeBuilding({ tier: 3 });
    const s = stateWith(b);
    const maxOnly = buildingActionRules(s, b).upgrade.reasonKey;
    demolitionOrder(s, b.id);
    expect(buildingActionRules(s, b).upgrade.reasonKey).toBe(maxOnly);
  });

  it('refusal order: demolition ordered beats locked, locked beats reserved, reserved beats cash', () => {
    const b = makeBuilding();
    // locked beats reserved: a locked tier stays "locked" even with a ramp in the way.
    const s1 = stateWith(b);
    addRampOver(s1, b);
    expect(buildingActionRules(s1, b).upgrade.kind).toBe('locked');
    // demolition ordered beats locked.
    const s2 = stateWith(b);
    demolitionOrder(s2, b.id);
    const ordered = buildingActionRules(s2, b).upgrade;
    expect(ordered.kind).toBe('refused');
    expect(ordered.nextTier).not.toBeNull();
    // reserved beats cash: broke and blocked reports the reservation.
    const s3 = stateWith(b, 0);
    s3.buildings.unlockedTiers['management_office'] = 2;
    addRampOver(s3, b);
    expect(buildingActionRules(s3, b).upgrade.reasonKey).toBe(RESERVATION_REFUSAL.ramp.errorKey);
  });
});

describe('buildingActionRules — move and demolish', () => {
  it('carry their costs and no disabled reason when cash covers them', () => {
    const b = makeBuilding();
    const r = buildingActionRules(stateWith(b), b);
    expect(r.move).toEqual({ cost: getMoveCost(b), disabledReasonKey: null });
    expect(r.demolish).toMatchObject({ cost: getDemolishCost(b), disabledReasonKey: null });
  });

  it('are disabled with a reason on short cash', () => {
    const b = makeBuilding();
    const r = buildingActionRules(stateWith(b, 0), b);
    expect(r.move.disabledReasonKey).toBeTruthy();
    expect(r.demolish.disabledReasonKey).toBeTruthy();
    expect(r.move.cost).toBe(getMoveCost(b));
  });

  it('cash equal to the cost enables the action', () => {
    const b = makeBuilding();
    const cost = getDemolishCost(b);
    expect(getBuildingDef(b.type, b.tier).demolishCost).toBe(cost);
    expect(buildingActionRules(stateWith(b, cost), b).demolish.disabledReasonKey).toBeNull();
    expect(buildingActionRules(stateWith(b, cost - 1), b).demolish.disabledReasonKey).toBeTruthy();
  });

  it('demolish is disabled once a demolition is already ordered', () => {
    const b = makeBuilding();
    const s = stateWith(b);
    demolitionOrder(s, b.id);
    expect(buildingActionRules(s, b).demolish.disabledReasonKey).toBeTruthy();
  });
});

function addResearchCenter(s: GameState): void {
  s.buildings.buildings.push(makeBuilding({ id: 90, type: 'research_center', tier: 1, x: 30, z: 30 }));
}

describe('buildingActionRules — research prerequisite (#1820)', () => {
  it('tier 2 without a Research Center is blocked naming the Research Center', () => {
    const b = makeBuilding();
    const r = buildingActionRules(stateWith(b), b).research!;
    expect(r.blocked).toEqual({ reasonKey: 'inspector.reason.research_no_center' });
  });

  it('tier 2 with an operating Research Center is not blocked', () => {
    const b = makeBuilding();
    const s = stateWith(b);
    addResearchCenter(s);
    expect(buildingActionRules(s, b).research!.blocked).toBeNull();
  });

  it('a Research Center that is not operating does not count', () => {
    const b = makeBuilding();
    const s = stateWith(b);
    addResearchCenter(s);
    s.buildings.buildings.find(x => x.id === 90)!.active = false;
    expect(buildingActionRules(s, b).research!.blocked).toEqual({ reasonKey: 'inspector.reason.research_no_center' });
  });

  it('tier 3 with a Research Center but no tier-2 research names the missing tier', () => {
    const b = makeBuilding({ tier: 2 });
    const s = stateWith(b);
    addResearchCenter(s);
    expect(buildingActionRules(s, b).research!.blocked).toEqual({
      reasonKey: 'inspector.reason.research_needs_tier', reasonParams: { tier: 2 },
    });
  });

  it('tier 3 with the tier-2 research done and a Research Center is not blocked', () => {
    const b = makeBuilding({ tier: 2 });
    const s = stateWith(b);
    addResearchCenter(s);
    s.buildings.unlockedTiers['management_office'] = 2;
    expect(buildingActionRules(s, b).research!.blocked).toBeNull();
  });

  it('tier 3 with no Research Center reports the Research Center first', () => {
    const b = makeBuilding({ tier: 2 });
    expect(buildingActionRules(stateWith(b), b).research!.blocked).toEqual({ reasonKey: 'inspector.reason.research_no_center' });
  });
});

describe('buildingActionRules — wait for a Building Destroyer (#1820)', () => {
  function unlockedState(b: Building): GameState {
    const s = stateWith(b);
    s.buildings.unlockedTiers['management_office'] = 2;
    return s;
  }

  function licensedDriver(s: GameState): void {
    const { employee } = hireEmployee(s.employees, 'driver', new Random(5), 0, 0);
    assignSkill(s.employees, employee.id, ROLE_LICENCE_REQUIRED.building_destroyer, 1);
  }

  it('no building destroyer in the fleet: upgrade and demolish wait for a vehicle', () => {
    const b = makeBuilding();
    const r = buildingActionRules(unlockedState(b), b);
    expect(r.upgrade.waitKey).toBe('inspector.wait.no_vehicle');
    expect(r.demolish.waitKey).toBe('inspector.wait.no_vehicle');
  });

  it('a destroyer but no licensed eligible employee: wait for a driver', () => {
    const b = makeBuilding();
    const s = unlockedState(b);
    purchaseVehicle(s.vehicles, 'building_destroyer');
    hireEmployee(s.employees, 'driller', new Random(5), 0, 0);
    const r = buildingActionRules(s, b);
    expect(r.upgrade.waitKey).toBe('inspector.wait.no_driver');
    expect(r.demolish.waitKey).toBe('inspector.wait.no_driver');
  });

  it('a licensed employee who is not eligible for work does not count', () => {
    const b = makeBuilding();
    const s = unlockedState(b);
    purchaseVehicle(s.vehicles, 'building_destroyer');
    licensedDriver(s);
    s.employees.employees[s.employees.employees.length - 1]!.injured = true;
    expect(buildingActionRules(s, b).upgrade.waitKey).toBe('inspector.wait.no_driver');
  });

  it('a destroyer and a licensed eligible employee: nothing to wait for', () => {
    const b = makeBuilding();
    const s = unlockedState(b);
    purchaseVehicle(s.vehicles, 'building_destroyer');
    licensedDriver(s);
    const r = buildingActionRules(s, b);
    expect(r.upgrade.waitKey).toBeNull();
    expect(r.demolish.waitKey).toBeNull();
  });

  it('a demolition already ordered leaves demolish with no wait note (it is disabled instead)', () => {
    const b = makeBuilding();
    const s = unlockedState(b);
    demolitionOrder(s, b.id);
    const r = buildingActionRules(s, b);
    expect(r.demolish.waitKey).toBeNull();
    expect(r.demolish.disabledReasonKey).toBeTruthy();
  });

  it('a refused upgrade carries no wait key', () => {
    const b = makeBuilding({ tier: 3 });
    expect(buildingActionRules(stateWith(b), b).upgrade.waitKey).toBeNull();
  });
});
