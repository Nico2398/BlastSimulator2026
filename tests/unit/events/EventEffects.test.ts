// BlastSimulator2026 — #1568: timed survey_cost / research_cost / out_of_service
// modifiers take effect in the systems they name.

import { describe, it, expect } from 'vitest';
import { createGame, type GameState, type PendingAction } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, ROLE_LICENCE_REQUIRED } from '../../../src/core/entities/Vehicle.js';
import {
  placeBuilding, createBuildingState, isOperating, syncBuildingServiceFlags,
  findNearestActiveBuildingOfType, getStorageCapacity, getBuildingDef, queueResearchTask,
  getQueueBlockCode, type Building,
} from '../../../src/core/entities/Building.js';
import { hasActiveResearchCenter, tickResearch } from '../../../src/core/entities/BuildingResearch.js';
import { getExplosivesCapacity, freightWarehouseSites } from '../../../src/core/entities/BuildingWarehouse.js';
import { enrolInTraining, availableTrainingOffers } from '../../../src/core/entities/EmployeeTraining.js';
import { addModifier, pruneExpired, type ActiveModifier } from '../../../src/core/events/ActiveModifiers.js';
import { runSurvey, surveyCostFor } from '../../../src/core/mining/SurveyCalc.js';
import { cancelAction } from '../../../src/core/engine/TaskCancellation.js';
import { findFreeVehicleForRole, findVehicleForClaim, reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';
import { runTick } from '../../../src/core/engine/TickPipeline.js';
import { researchCommand } from '../../../src/console/commands/research.js';
import { getResearchTaskDef, SURVEY_COSTS } from '../../../src/core/config/balance.js';
import { mod } from '../../helpers/eventEffectWorld.js';
import { makeGameContext } from '../../helpers/gameContext.js';

const SEED = 42;

function addMod(state: GameState, partial: Parameters<typeof mod>[0]): void {
  addModifier(state.events.activeModifiers, mod(partial), state.events.activeModifiers.length + 1);
}

function building(overrides: Partial<Building> = {}): Building {
  return { id: 1, type: 'geology_lab', tier: 1, x: 10, z: 10, hp: 100, active: true, occupantIds: [], ...overrides };
}

function surveyState(cash = 100_000): GameState {
  const state = createGame({ seed: SEED });
  state.cash = cash;
  const { employee } = hireEmployee(state.employees, 'surveyor', new Random(SEED), 5, 5);
  assignSkill(state.employees, employee.id, 'geology', 3);
  return state;
}

describe('surveyCostFor (#1568)', () => {
  it('is the base price without modifiers', () => {
    expect(surveyCostFor('seismic', [], 0)).toBe(SURVEY_COSTS.seismic);
  });

  it('scales the base by a live survey_cost modifier', () => {
    const list: ActiveModifier[] = [];
    addModifier(list, mod({ kind: 'survey_cost', magnitude: 1.5 }), 1);
    expect(surveyCostFor('core_sample', list, 10)).toBe(Math.round(SURVEY_COSTS.core_sample * 1.5));
  });

  it('ignores a lapsed modifier', () => {
    const list: ActiveModifier[] = [];
    addModifier(list, mod({ kind: 'survey_cost', magnitude: 3, endTick: 20 }), 1);
    expect(surveyCostFor('aerial', list, 20)).toBe(SURVEY_COSTS.aerial);
  });
});

describe('runSurvey under survey_cost (#1568)', () => {
  const surveyAction = (s: GameState) => s.pendingActions.find(a => a.type === 'survey')!;

  it('charges 2x base, books the same expense and records orderCost', () => {
    const state = surveyState();
    addMod(state, { kind: 'survey_cost', magnitude: 2 });
    const before = state.cash;
    const res = runSurvey(state, { method: 'seismic', centerX: 8, centerZ: 8 });
    expect(res.success).toBe(true);
    const scaled = SURVEY_COSTS.seismic * 2;
    expect(state.cash).toBe(before - scaled);
    const tx = state.finances.transactions.filter(t => t.type === 'expense').at(-1)!;
    expect(tx.amount).toBe(scaled);
    expect(surveyAction(state).payload['orderCost']).toBe(scaled);
  });

  it('is unchanged without a modifier', () => {
    const state = surveyState();
    const before = state.cash;
    runSurvey(state, { method: 'seismic', centerX: 8, centerZ: 8 });
    expect(state.cash).toBe(before - SURVEY_COSTS.seismic);
  });

  it('refuses with insufficient_funds when cash covers base but not the scaled price', () => {
    const state = surveyState(SURVEY_COSTS.seismic + 1);
    addMod(state, { kind: 'survey_cost', magnitude: 2 });
    const res = runSurvey(state, { method: 'seismic', centerX: 8, centerZ: 8 });
    expect(res).toEqual({ success: false, error: 'insufficient_funds' });
    expect(state.cash).toBe(SURVEY_COSTS.seismic + 1);
    expect(state.pendingActions).toHaveLength(0);
  });

  it('a lapsed modifier no longer raises the price', () => {
    const state = surveyState();
    addMod(state, { kind: 'survey_cost', magnitude: 2, endTick: 0 });
    const before = state.cash;
    runSurvey(state, { method: 'seismic', centerX: 8, centerZ: 8 });
    expect(state.cash).toBe(before - SURVEY_COSTS.seismic);
  });

  it('cancel refunds exactly the charged price, even after the modifier was pruned', () => {
    const state = surveyState();
    addMod(state, { kind: 'survey_cost', magnitude: 2 });
    const before = state.cash;
    const res = runSurvey(state, { method: 'seismic', centerX: 8, centerZ: 8 });
    pruneExpired(state.events.activeModifiers, 10_000);
    expect(state.events.activeModifiers).toHaveLength(0);
    const cancel = cancelAction(state, res.actionId!);
    expect(cancel.success).toBe(true);
    expect(cancel.refunded).toBe(SURVEY_COSTS.seismic * 2);
    expect(state.cash).toBe(before);
  });

  it('cancel of an old action without orderCost refunds the base price', () => {
    const state = surveyState();
    const res = runSurvey(state, { method: 'seismic', centerX: 8, centerZ: 8 });
    delete surveyAction(state).payload['orderCost'];
    const cancel = cancelAction(state, res.actionId!);
    expect(cancel.refunded).toBe(SURVEY_COSTS.seismic);
  });
});

describe('research_cost (#1568)', () => {
  function researchCtx(cash = 500_000) {
    const ctx = makeGameContext({ mineType: 'desert', seed: '42', size: '32', cash: String(cash) });
    const placed = placeBuilding(ctx.state!.buildings, 'research_center', 20, 20, 32, 32, 1, 0, 0);
    if (!placed.success) throw new Error(placed.error);
    return ctx;
  }
  const args = { type: 'driving_center', tier: '2' };
  const baseCost = getResearchTaskDef('driving_center', 2).cost;

  it('queueResearchTask sets cost = scaledCost and returns it', () => {
    const ctx = researchCtx();
    const res = queueResearchTask(ctx.state!.buildings, 'driving_center', 2, 2);
    expect(res.success).toBe(true);
    expect(res.cost).toBe(Math.round(baseCost * 2));
    expect(ctx.state!.buildings.researchQueue[0]!.cost).toBe(Math.round(baseCost * 2));
  });

  it('queueResearchTask defaults to factor 1', () => {
    const ctx = researchCtx();
    expect(queueResearchTask(ctx.state!.buildings, 'driving_center', 2).cost).toBe(baseCost);
  });

  it('console queue charges round(cost * factor) and the task records it', () => {
    const ctx = researchCtx();
    addMod(ctx.state!, { kind: 'research_cost', magnitude: 1.5 });
    const before = ctx.state!.cash;
    const res = researchCommand(ctx, ['queue'], args);
    expect(res.success, res.output).toBe(true);
    const charged = Math.round(baseCost * 1.5);
    expect(ctx.state!.cash).toBe(before - charged);
    expect(ctx.state!.buildings.researchQueue[0]!.cost).toBe(charged);
    expect(ctx.state!.finances.transactions.filter(t => t.type === 'expense').at(-1)!.amount).toBe(charged);
  });

  it('console queue is unchanged without a modifier', () => {
    const ctx = researchCtx();
    const before = ctx.state!.cash;
    researchCommand(ctx, ['queue'], args);
    expect(ctx.state!.cash).toBe(before - baseCost);
  });

  it('console queue refuses insufficient_funds when cash is below the scaled price only', () => {
    const ctx = researchCtx(baseCost + 1);
    addMod(ctx.state!, { kind: 'research_cost', magnitude: 2 });
    const res = researchCommand(ctx, ['queue'], args);
    expect(res.success).toBe(false);
    expect(res.code).toBe('insufficient_funds');
    expect(ctx.state!.cash).toBe(baseCost + 1);
    expect(ctx.state!.buildings.researchQueue).toHaveLength(0);
  });

  it('queue stores the scaled cost on the task (what a cancel refunds)', () => {
    // baseCost > 0 is required for the factor to be observable
    expect(baseCost).toBeGreaterThan(0);
    const ctx = researchCtx();
    addMod(ctx.state!, { kind: 'research_cost', magnitude: 2 });
    const before = ctx.state!.cash;
    researchCommand(ctx, ['queue'], args);
    expect(ctx.state!.buildings.researchQueue[0]!.cost).toBe(baseCost * 2);
    expect(before - ctx.state!.cash).toBe(baseCost * 2);
  });
});

describe('out_of_service vehicles (#1568)', () => {
  function fleet() {
    const state = createGame({ seed: SEED });
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 0, 0);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 1, 1, 1);
    return { state, employee, vehicle };
  }
  const action = (id: number): PendingAction => ({
    id, type: 'general_work', requiredSkill: null, requiredVehicleRole: 'drill_rig',
    targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: null,
    status: 'queued', holderId: null, queuedAtTick: 0,
  });

  it('findFreeVehicleForRole skips a vehicle with a live out_of_service modifier', () => {
    const { state, employee, vehicle } = fleet();
    expect(findFreeVehicleForRole(state, 'drill_rig', employee)?.id).toBe(vehicle.id);
    addMod(state, { kind: 'out_of_service', targetId: vehicle.id, targetKind: 'vehicle' });
    expect(findFreeVehicleForRole(state, 'drill_rig', employee)).toBeNull();
  });

  it('prefers another working vehicle over the closed one', () => {
    const { state, employee, vehicle } = fleet();
    const { vehicle: other } = purchaseVehicle(state.vehicles, 'drill_rig', 30, 30, 1);
    addMod(state, { kind: 'out_of_service', targetId: vehicle.id, targetKind: 'vehicle' });
    expect(findFreeVehicleForRole(state, 'drill_rig', employee)?.id).toBe(other.id);
  });

  it('is claimable again once the modifier lapses', () => {
    const { state, employee, vehicle } = fleet();
    addMod(state, { kind: 'out_of_service', targetId: vehicle.id, targetKind: 'vehicle', endTick: 5 });
    state.tickCount = 4;
    expect(findFreeVehicleForRole(state, 'drill_rig', employee)).toBeNull();
    state.tickCount = 5;
    expect(findFreeVehicleForRole(state, 'drill_rig', employee)?.id).toBe(vehicle.id);
  });

  it('a building modifier with the same id does not close the vehicle', () => {
    const { state, employee, vehicle } = fleet();
    addMod(state, { kind: 'out_of_service', targetId: vehicle.id, targetKind: 'building' });
    expect(findFreeVehicleForRole(state, 'drill_rig', employee)?.id).toBe(vehicle.id);
  });

  it('findVehicleForClaim answers ok:false for a closed vehicle', () => {
    const { state, employee, vehicle } = fleet();
    addMod(state, { kind: 'out_of_service', targetId: vehicle.id, targetKind: 'vehicle' });
    expect(findVehicleForClaim(state, action(1), employee)).toEqual({ ok: false });
  });

  it('findVehicleForClaim refuses an already-reserved vehicle that went out of service', () => {
    const { state, employee, vehicle } = fleet();
    const a = action(2);
    state.pendingActions.push(a);
    reserveVehicle(state.vehicles, vehicle.id, a.id);
    expect(findVehicleForClaim(state, a, employee)).toEqual({ ok: true, vehicle: expect.objectContaining({ id: vehicle.id }) });
    addMod(state, { kind: 'out_of_service', targetId: vehicle.id, targetKind: 'vehicle' });
    expect(findVehicleForClaim(state, a, employee)).toEqual({ ok: false });
  });

  it('a modifier on a non-existent vehicle id is harmless', () => {
    const { state, employee, vehicle } = fleet();
    addMod(state, { kind: 'out_of_service', targetId: 9999, targetKind: 'vehicle' });
    expect(findFreeVehicleForRole(state, 'drill_rig', employee)?.id).toBe(vehicle.id);
  });
});

describe('isOperating / syncBuildingServiceFlags (#1568)', () => {
  it('isOperating needs active and not outOfService', () => {
    expect(isOperating({ active: true })).toBe(true);
    expect(isOperating({ active: true, outOfService: false })).toBe(true);
    expect(isOperating({ active: true, outOfService: true })).toBe(false);
    expect(isOperating({ active: false, outOfService: false })).toBe(false);
  });

  it('sync sets the flag for closed ids and clears it for the rest', () => {
    const bs = [building({ id: 1 }), building({ id: 2, outOfService: true }), building({ id: 3 })];
    syncBuildingServiceFlags(bs, new Set([1]));
    expect(bs.map(b => b.outOfService === true)).toEqual([true, false, false]);
  });

  it('sync leaves the player-chosen active switch alone', () => {
    const bs = [building({ id: 1, active: false })];
    syncBuildingServiceFlags(bs, new Set([1]));
    expect(bs[0]!.active).toBe(false);
    syncBuildingServiceFlags(bs, new Set());
    expect(bs[0]!.active).toBe(false);
    expect(bs[0]!.outOfService).toBeFalsy();
  });

  it('sync ignores ids of non-existent buildings', () => {
    const bs = [building({ id: 1 })];
    expect(() => syncBuildingServiceFlags(bs, new Set([99]))).not.toThrow();
    expect(bs[0]!.outOfService).toBeFalsy();
  });
});

describe('closed buildings are skipped (#1568)', () => {
  it('findNearestActiveBuildingOfType passes over a closed building to a farther open one', () => {
    const bs = createBuildingState();
    bs.buildings.push(building({ id: 1, type: 'living_quarters', x: 1, z: 1, outOfService: true }));
    bs.buildings.push(building({ id: 2, type: 'living_quarters', x: 40, z: 40 }));
    expect(findNearestActiveBuildingOfType(bs, 'living_quarters', 0, 0)?.id).toBe(2);
  });

  it('findNearestActiveBuildingOfType returns null when every match is closed', () => {
    const bs = createBuildingState();
    bs.buildings.push(building({ id: 1, type: 'living_quarters', outOfService: true }));
    expect(findNearestActiveBuildingOfType(bs, 'living_quarters', 0, 0)).toBeNull();
  });

  it('enrolInTraining refuses a closed school with employees.train_school_closed', () => {
    const state = createGame({ seed: SEED });
    hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    const school = building({ type: 'geology_lab', outOfService: true });
    state.buildings.buildings.push(school);
    const res = enrolInTraining(state, state.employees.employees[0]!.id, school, 'geology');
    expect(res.success).toBe(false);
    if (!res.success) expect(res.errorKey).toBe('employees.train_school_closed');
    expect(state.employees.employees[0]!.pendingTrainingState).toBeNull();
  });

  it('availableTrainingOffers leaves out a closed school', () => {
    const closed = building({ type: 'geology_lab', outOfService: true });
    expect(availableTrainingOffers([closed])).toEqual([]);
    expect(availableTrainingOffers([building({ type: 'geology_lab' })])).toHaveLength(1);
  });

  it('availableTrainingOffers falls back to a lower-tier open school', () => {
    const offers = availableTrainingOffers([
      building({ id: 1, type: 'geology_lab', tier: 2, outOfService: true }),
      building({ id: 2, type: 'geology_lab', tier: 1 }),
    ]);
    expect(offers.find(o => o.skill === 'geology')?.building.id).toBe(2);
  });

  it('a closed Research Center blocks queueing with no_research_center', () => {
    const bs = createBuildingState();
    bs.buildings.push(building({ type: 'research_center', outOfService: true }));
    expect(hasActiveResearchCenter(bs)).toBe(false);
    expect(getQueueBlockCode(bs, 'driving_center', 2)).toBe('no_research_center');
    const res = queueResearchTask(bs, 'driving_center', 2);
    expect(res).toMatchObject({ success: false, code: 'no_research_center' });
  });

  it('a closed Research Center pauses research without cancelling the queue', () => {
    const bs = createBuildingState();
    bs.buildings.push(building({ type: 'research_center', outOfService: true }));
    bs.researchQueue.push({ targetType: 'driving_center', targetTier: 2, ticksRemaining: 5, cost: 100, conditions: [] });
    expect(tickResearch(bs)).toBeUndefined();
    expect(bs.researchQueue).toHaveLength(1);
    expect(bs.researchQueue[0]!.ticksRemaining).toBe(5);
    delete bs.buildings[0]!.outOfService;
    tickResearch(bs);
    expect(bs.researchQueue[0]!.ticksRemaining).toBe(4);
  });

  it('an open Research Center still counts', () => {
    const bs = createBuildingState();
    bs.buildings.push(building({ type: 'research_center' }));
    expect(hasActiveResearchCenter(bs)).toBe(true);
  });

  it('a closed freight warehouse adds no storage capacity or site', () => {
    const bs = createBuildingState();
    bs.buildings.push(building({ id: 1, type: 'freight_warehouse', outOfService: true }));
    bs.buildings.push(building({ id: 2, type: 'freight_warehouse' }));
    expect(getStorageCapacity(bs)).toBe(getBuildingDef('freight_warehouse', 1).capacity);
    expect(freightWarehouseSites(bs).map(s => s.id)).toEqual([2]);
  });

  it('a closed explosive warehouse adds no capacity', () => {
    const bs = createBuildingState();
    bs.buildings.push(building({ type: 'explosive_warehouse', outOfService: true }));
    expect(getExplosivesCapacity(bs)).toBe(0);
  });
});

describe('tick pipeline syncs building closures (#1568)', () => {
  function tickOnce(state: GameState) {
    return runTick(state, null, new Random(state.seed + state.tickCount), new EventEmitter(), { checkInvariants: false });
  }

  it('closes the named building while the modifier is live and reopens it after it lapses', () => {
    const state = createGame({ seed: SEED });
    const placed = placeBuilding(state.buildings, 'geology_lab', 20, 20, 64, 64, 1, 0, 0);
    expect(placed.success).toBe(true);
    const target = state.buildings.buildings[0]!;
    addMod(state, { kind: 'out_of_service', targetId: target.id, targetKind: 'building', endTick: state.tickCount + 3 });

    tickOnce(state);
    expect(isOperating(target)).toBe(false);
    expect(target.outOfService).toBe(true);

    for (let i = 0; i < 4; i++) tickOnce(state);
    expect(target.outOfService).toBeFalsy();
    expect(isOperating(target)).toBe(true);
  });

  it('does not close a building named by a vehicle-kind modifier', () => {
    const state = createGame({ seed: SEED });
    placeBuilding(state.buildings, 'geology_lab', 20, 20, 64, 64, 1, 0, 0);
    const target = state.buildings.buildings[0]!;
    addMod(state, { kind: 'out_of_service', targetId: target.id, targetKind: 'vehicle' });
    tickOnce(state);
    expect(target.outOfService).toBeFalsy();
  });
});
