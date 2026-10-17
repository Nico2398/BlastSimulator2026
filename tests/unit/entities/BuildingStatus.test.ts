import { describe, it, expect } from 'vitest';
import { computeBuildingStatus } from '../../../src/core/entities/BuildingStatus.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState, PendingAction, PlannedBuilding } from '../../../src/core/state/GameState.js';
import type { Building } from '../../../src/core/entities/Building.js';
import type { ActiveModifier } from '../../../src/core/events/ActiveModifiers.js';
import { hireEmployee, createEmployeeState } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { buildCommand } from '../../../src/console/commands/entities.js';
import { tickCommand } from '../../../src/console/commands/events.js';
import { makeGameContext } from '../../helpers/gameContext.js';

// #1758: lifecycle status of a building id — pure core, locale-agnostic.

function makeBuilding(overrides: Partial<Building> = {}): Building {
  return { id: 3, type: 'management_office', tier: 1, x: 5, z: 5, hp: 100, active: true, occupantIds: [], ...overrides };
}

function stateWith(buildings: Building[] = [makeBuilding()]): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.buildings.buildings = buildings;
  s.tickCount = 100;
  return s;
}

function outOfService(id: number, endTick: number | null, eventId = 'evt_a', extra: Partial<ActiveModifier> = {}): ActiveModifier {
  return {
    id: 900 + id + (endTick ?? 0), kind: 'out_of_service', sourceEventId: eventId, role: null,
    targetId: id, targetKind: 'building', category: null, magnitude: 1, startTick: 50, endTick, ...extra,
  };
}

function site(buildingId: number, actionId: number, tier: 1 | 2 | 3 = 1): PlannedBuilding {
  return { id: 70 + buildingId, buildingId, type: 'management_office', tier, x: 5, z: 5, actionId, cost: 1000 };
}

function action(over: Partial<PendingAction> & Pick<PendingAction, 'id' | 'type'>): PendingAction {
  return {
    requiredSkill: null, requiredVehicleRole: null, targetX: 5, targetZ: 5, targetY: 0,
    payload: {}, targetEmployeeId: null, status: 'queued', holderId: null, queuedAtTick: 0, ...over,
  };
}

function withBuilder(s: GameState, actionId: number, remaining: number | null, total: number | undefined): number {
  const { employee } = hireEmployee(createEmployeeState(), 'driller', new Random(7), 0, 0);
  employee.activeActionId = actionId;
  employee.taskTicksRemaining = remaining;
  if (total !== undefined) employee.activeTaskTotalTicks = total;
  s.employees.employees.push(employee);
  const a = s.pendingActions.find(p => p.id === actionId)!;
  a.holderId = employee.id;
  a.status = 'in_progress';
  return employee.id;
}

describe('computeBuildingStatus — standing building', () => {
  it('reports operating with every detail field null', () => {
    expect(computeBuildingStatus(stateWith(), 3)).toEqual({
      kind: 'operating', closureTicksRemaining: null, closureEventId: null, progress: null, builderId: null, targetTier: null,
    });
  });

  it('returns null for an unknown id', () => {
    expect(computeBuildingStatus(stateWith(), 999)).toBeNull();
  });

  it('a modifier aimed at another building does not close this one', () => {
    const s = stateWith();
    s.events.activeModifiers.push(outOfService(4, 200));
    expect(computeBuildingStatus(s, 3)!.kind).toBe('operating');
  });

  it('a vehicle out_of_service modifier with the same numeric id does not close the building', () => {
    const s = stateWith();
    s.events.activeModifiers.push(outOfService(3, 200, 'evt_v', { targetKind: 'vehicle' }));
    expect(computeBuildingStatus(s, 3)!.kind).toBe('operating');
  });
});

describe('computeBuildingStatus — out of service', () => {
  it('names the event and counts the ticks left', () => {
    const s = stateWith();
    s.events.activeModifiers.push(outOfService(3, 130, 'evt_flood'));
    const st = computeBuildingStatus(s, 3)!;
    expect(st.kind).toBe('out_of_service');
    expect(st.closureEventId).toBe('evt_flood');
    expect(st.closureTicksRemaining).toBe(30);
  });

  it('a permanent closure has no remaining ticks', () => {
    const s = stateWith();
    s.events.activeModifiers.push(outOfService(3, null, 'evt_forever'));
    const st = computeBuildingStatus(s, 3)!;
    expect(st.kind).toBe('out_of_service');
    expect(st.closureTicksRemaining).toBeNull();
    expect(st.closureEventId).toBe('evt_forever');
  });

  it('a lapsed modifier (endTick <= tick) reads operating', () => {
    const s = stateWith();
    s.events.activeModifiers.push(outOfService(3, 100));
    const st = computeBuildingStatus(s, 3)!;
    expect(st.kind).toBe('operating');
    expect(st.closureTicksRemaining).toBeNull();
    expect(st.closureEventId).toBeNull();
  });

  it('one tick before lapsing still counts 1', () => {
    const s = stateWith();
    s.events.activeModifiers.push(outOfService(3, 101));
    expect(computeBuildingStatus(s, 3)!.closureTicksRemaining).toBe(1);
  });

  it('several live closures report the latest end', () => {
    const s = stateWith();
    s.events.activeModifiers.push(outOfService(3, 120, 'evt_short'), outOfService(3, 160, 'evt_long'));
    const st = computeBuildingStatus(s, 3)!;
    expect(st.closureTicksRemaining).toBe(60);
    expect(st.closureEventId).toBe('evt_long');
  });

  it('other modifier kinds do not close a building', () => {
    const s = stateWith();
    s.events.activeModifiers.push(outOfService(3, 200, 'evt_x', { kind: 'work_stoppage' }));
    expect(computeBuildingStatus(s, 3)!.kind).toBe('operating');
  });
});

describe('computeBuildingStatus — demolition ordered', () => {
  it('a pending demolish_building action for the id reads demolition_ordered', () => {
    const s = stateWith();
    s.pendingActions.push(action({ id: 11, type: 'demolish_building', payload: { buildingId: 3 } }));
    const st = computeBuildingStatus(s, 3)!;
    expect(st.kind).toBe('demolition_ordered');
    expect(st.progress).toBeNull();
    expect(st.closureTicksRemaining).toBeNull();
  });

  it('a demolition ordered for another building does not matter', () => {
    const s = stateWith([makeBuilding(), makeBuilding({ id: 4, x: 20, z: 20 })]);
    s.pendingActions.push(action({ id: 11, type: 'demolish_building', payload: { buildingId: 4 } }));
    expect(computeBuildingStatus(s, 3)!.kind).toBe('operating');
    expect(computeBuildingStatus(s, 4)!.kind).toBe('demolition_ordered');
  });

  it('demolition ordered outranks out_of_service', () => {
    const s = stateWith();
    s.events.activeModifiers.push(outOfService(3, 200));
    s.pendingActions.push(action({ id: 11, type: 'demolish_building', payload: { buildingId: 3 } }));
    expect(computeBuildingStatus(s, 3)!.kind).toBe('demolition_ordered');
  });

  it('an upgrade order (standing building + site under the same id) still reads demolition_ordered', () => {
    const s = stateWith();
    s.plannedBuildings.push(site(3, 20, 2));
    s.pendingActions.push(action({ id: 11, type: 'demolish_building', payload: { buildingId: 3, rebuildOrderId: 73 } }));
    expect(computeBuildingStatus(s, 3)!.kind).toBe('demolition_ordered');
  });
});

describe('computeBuildingStatus — planned site', () => {
  it('a fresh site (no standing building) is under_construction with its target tier', () => {
    const s = stateWith([]);
    s.plannedBuildings.push(site(8, 21, 1));
    s.pendingActions.push(action({ id: 21, type: 'place_building' }));
    const st = computeBuildingStatus(s, 8)!;
    expect(st.kind).toBe('under_construction');
    expect(st.targetTier).toBe(1);
    expect(st.closureTicksRemaining).toBeNull();
  });

  it('progress is null while the action is queued with no holder', () => {
    const s = stateWith([]);
    s.plannedBuildings.push(site(8, 21));
    s.pendingActions.push(action({ id: 21, type: 'place_building' }));
    const st = computeBuildingStatus(s, 8)!;
    expect(st.progress).toBeNull();
    expect(st.builderId).toBeNull();
  });

  it('progress follows the holder: 1 - remaining/total, and names the builder', () => {
    const s = stateWith([]);
    s.plannedBuildings.push(site(8, 21));
    s.pendingActions.push(action({ id: 21, type: 'place_building' }));
    const builderId = withBuilder(s, 21, 30, 120);
    const st = computeBuildingStatus(s, 8)!;
    expect(st.progress).toBeCloseTo(0.75, 5);
    expect(st.builderId).toBe(builderId);
  });

  it('progress is 0 at the start of the task and approaches 1 at the end', () => {
    const s = stateWith([]);
    s.plannedBuildings.push(site(8, 21));
    s.pendingActions.push(action({ id: 21, type: 'place_building' }));
    withBuilder(s, 21, 100, 100);
    expect(computeBuildingStatus(s, 8)!.progress).toBe(0);
    s.employees.employees[s.employees.employees.length - 1]!.taskTicksRemaining = 0;
    expect(computeBuildingStatus(s, 8)!.progress).toBe(1);
  });

  it('progress is null when the holder is still walking (no task ticks yet)', () => {
    const s = stateWith([]);
    s.plannedBuildings.push(site(8, 21));
    s.pendingActions.push(action({ id: 21, type: 'place_building' }));
    const builderId = withBuilder(s, 21, null, undefined);
    const st = computeBuildingStatus(s, 8)!;
    expect(st.progress).toBeNull();
    expect(st.builderId).toBe(builderId);
  });

  it('progress is null when the holder lacks a task total', () => {
    const s = stateWith([]);
    s.plannedBuildings.push(site(8, 21));
    s.pendingActions.push(action({ id: 21, type: 'place_building' }));
    withBuilder(s, 21, 30, undefined);
    expect(computeBuildingStatus(s, 8)!.progress).toBeNull();
  });
});

describe('computeBuildingStatus — upgrading in place (#1875)', () => {
  function tick(ctx: ReturnType<typeof makeGameContext>, n = 1): void {
    for (let i = 0; i < n; i++) tickCommand(ctx, ['1'], {});
  }

  it('a standing building with an upgrade site reads upgrading with target tier, progress and builder', () => {
    const s = stateWith();
    s.plannedBuildings.push({ ...site(3, 21, 2), upgrade: true });
    s.pendingActions.push(action({ id: 21, type: 'place_building' }));
    const builderId = withBuilder(s, 21, 25, 100);
    const st = computeBuildingStatus(s, 3)!;
    expect(st.kind).toBe('upgrading');
    expect(st.targetTier).toBe(2);
    expect(st.progress).toBeCloseTo(0.75);
    expect(st.builderId).toBe(builderId);
  });

  it('an upgrade site with no worker yet has null progress and builder', () => {
    const s = stateWith();
    s.plannedBuildings.push({ ...site(3, 21, 2), upgrade: true });
    s.pendingActions.push(action({ id: 21, type: 'place_building' }));
    const st = computeBuildingStatus(s, 3)!;
    expect(st).toMatchObject({ kind: 'upgrading', progress: null, builderId: null });
  });

  it('a site without the upgrade flag and no standing building stays under_construction', () => {
    const s = stateWith([]);
    s.plannedBuildings.push(site(8, 21));
    s.pendingActions.push(action({ id: 21, type: 'place_building' }));
    expect(computeBuildingStatus(s, 8)!.kind).toBe('under_construction');
  });

  it('a real upgrade order walks operating -> upgrading (building always standing) -> operating at tier 2', () => {
    const ctx = makeGameContext({ mineType: 'desert', seed: 42, size: 32, staffed: true });
    const s = ctx.state!;
    expect(buildCommand(ctx, ['living_quarters'], { at: '9,14' }).success).toBe(true);
    for (let i = 0; i < 400 && s.plannedBuildings.length > 0; i++) tick(ctx);
    const id = s.buildings.buildings[s.buildings.buildings.length - 1]!.id;
    s.buildings.unlockedTiers['living_quarters'] = 2;
    expect(computeBuildingStatus(s, id)!.kind).toBe('operating');
    const up = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(up.success, up.output).toBe(true);

    expect(computeBuildingStatus(s, id)).toMatchObject({ kind: 'upgrading', targetTier: 2 });
    for (let i = 0; i < 1500 && s.plannedBuildings.length > 0; i++) {
      tick(ctx);
      expect(s.buildings.buildings.some(b => b.id === id)).toBe(true);
    }
    const done = computeBuildingStatus(s, id)!;
    expect(done.kind).toBe('operating');
    expect(s.buildings.buildings.find(b => b.id === id)!.tier).toBe(2);
  });
});
