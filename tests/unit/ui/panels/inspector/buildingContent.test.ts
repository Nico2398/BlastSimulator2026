// @vitest-environment jsdom
// Building inspector content (#1758): live status, condition, costs, action strip.
import { describe, it, expect } from 'vitest';
import { buildingContent } from '../../../../../src/ui/panels/inspector/buildingContent.js';
import type { ActionSpec, InspectorLinks, InspectorView } from '../../../../../src/ui/panels/inspector/InspectorContent.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import type { GameState, PendingAction } from '../../../../../src/core/state/GameState.js';
import { getBuildingDef, getUpgradeCost, type Building } from '../../../../../src/core/entities/Building.js';
import { getResearchTaskDef } from '../../../../../src/core/config/balance.js';
import { hireEmployee, createEmployeeState } from '../../../../../src/core/entities/Employee.js';
import { Random } from '../../../../../src/core/math/Random.js';
import { RESERVATION_REFUSAL } from '../../../../../src/core/entities/PlacementReservations.js';
import { t } from '../../../../../src/core/i18n/I18n.js';

const links = { select: () => {} } as unknown as InspectorLinks;

function makeBuilding(overrides: Partial<Building> = {}): Building {
  return { id: 3, type: 'management_office', tier: 1, x: 17, z: 23, hp: 61, active: true, occupantIds: [], ...overrides };
}

function stateWith(b: Building | null, cash = 9_999_999): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.cash = cash;
  s.tickCount = 100;
  s.buildings.buildings = b ? [b] : [];
  return s;
}

function viewOf(s: GameState, id = 3): InspectorView {
  return buildingContent.view({ kind: 'building', id }, s, links)!;
}

function textOf(view: InspectorView): string {
  const root = document.createElement('div');
  root.append(...view.sections);
  return root.textContent ?? '';
}

function actionOf(view: InspectorView, name: ActionSpec['action']): ActionSpec | undefined {
  return view.actions.find(a => a.action === name);
}

function closeBuilding(s: GameState, id: number, endTick: number | null): void {
  s.events.activeModifiers.push({
    id: 801, kind: 'out_of_service', sourceEventId: 'evt_flood', role: null, targetId: id,
    targetKind: 'building', category: null, magnitude: 1, startTick: 50, endTick,
  });
}

function demolitionOrder(s: GameState, id: number): void {
  s.pendingActions.push({
    id: 50, type: 'demolish_building', requiredSkill: null, requiredVehicleRole: 'building_destroyer',
    targetX: 5, targetZ: 5, targetY: 0, payload: { buildingId: id }, targetEmployeeId: null,
    status: 'queued', holderId: null, queuedAtTick: 0,
  } satisfies PendingAction);
}

function addSite(s: GameState, id: number, remaining: number | null, total: number): { builderId: number | null } {
  s.plannedBuildings.push({ id: 90, buildingId: id, type: 'management_office', tier: 1, x: 17, z: 23, actionId: 60, cost: 1000 });
  const a: PendingAction = {
    id: 60, type: 'place_building', requiredSkill: null, requiredVehicleRole: null, targetX: 17, targetZ: 23, targetY: 0,
    payload: {}, targetEmployeeId: null, status: 'queued', holderId: null, queuedAtTick: 0,
  };
  s.pendingActions.push(a);
  if (remaining === null) return { builderId: null };
  const { employee } = hireEmployee(createEmployeeState(), 'driller', new Random(7), 0, 0);
  employee.name = 'Zed Builder';
  employee.activeActionId = 60;
  employee.taskTicksRemaining = remaining;
  employee.activeTaskTotalTicks = total;
  s.employees.employees.push(employee);
  a.holderId = employee.id;
  a.status = 'in_progress';
  return { builderId: employee.id };
}

describe('building inspector — status line per state', () => {
  it('operating, out of service, demolition ordered and rebuilding each read differently, with no raw keys', () => {
    const operating = viewOf(stateWith(makeBuilding())).status;

    const closed = stateWith(makeBuilding());
    closeBuilding(closed, 3, 130);
    const closedStatus = viewOf(closed).status;

    const ordered = stateWith(makeBuilding());
    demolitionOrder(ordered, 3);
    const orderedStatus = viewOf(ordered).status;

    const rebuilding = stateWith(null);
    addSite(rebuilding, 3, 60, 100);
    const rebuildStatus = viewOf(rebuilding).status;

    const all = [operating, closedStatus, orderedStatus, rebuildStatus];
    expect(new Set(all).size).toBe(4);
    for (const s of all) {
      expect(s.length).toBeGreaterThan(0);
      expect(s).not.toMatch(/^inspector\./);
    }
  });

  it('out of service status changes as the closure counts down', () => {
    const s = stateWith(makeBuilding());
    closeBuilding(s, 3, 400);
    const before = viewOf(s).status;
    s.tickCount += 60;
    expect(viewOf(s).status).not.toBe(before);
  });

  it('a lapsed closure reads like operating again', () => {
    const open = viewOf(stateWith(makeBuilding())).status;
    const s = stateWith(makeBuilding());
    closeBuilding(s, 3, 100);
    expect(viewOf(s).status).toBe(open);
  });

  it('a site under construction shows the progress percentage and links its builder', () => {
    const s = stateWith(null);
    const { builderId } = addSite(s, 8, 60, 100);
    const view = viewOf(s, 8);
    expect(view.status).toContain('40');
    const root = document.createElement('div');
    root.append(...view.sections);
    const link = root.querySelector<HTMLElement>(`[data-select-kind="employee"][data-select-id="${builderId}"]`);
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe('Zed Builder');
  });

  it('an unstarted site shows no percentage and no builder link', () => {
    const s = stateWith(null);
    addSite(s, 8, null, 100);
    const view = viewOf(s, 8);
    expect(view.status).not.toMatch(/\d+\s*%/);
    const root = document.createElement('div');
    root.append(...view.sections);
    expect(root.querySelector('[data-select-kind="employee"]')).toBeNull();
  });

  it('the signature changes when the lifecycle state changes (so the window rebuilds)', () => {
    const open = viewOf(stateWith(makeBuilding())).signature;
    const ordered = stateWith(makeBuilding());
    demolitionOrder(ordered, 3);
    expect(viewOf(ordered).signature).not.toBe(open);
  });

  it('is null for an id that is neither standing nor a site', () => {
    expect(buildingContent.view({ kind: 'building', id: 99 }, stateWith(makeBuilding()), links)).toBeNull();
  });
});

describe('building inspector — condition and costs', () => {
  it('shows HP current and max, and keeps data-live="hp"', () => {
    const b = makeBuilding({ hp: 61 });
    const view = viewOf(stateWith(b));
    const max = getBuildingDef(b.type, b.tier).maxHp;
    expect(textOf(view)).toContain('61');
    expect(textOf(view)).toContain(String(max));
    const root = document.createElement('div');
    root.append(...view.sections);
    expect(root.querySelector('[data-live="hp"]')).not.toBeNull();
  });

  it('shows upkeep per hour and the position', () => {
    const b = makeBuilding({ type: 'driving_center', tier: 3 });
    const upkeep = getBuildingDef(b.type, b.tier).operatingCostPerTick;
    const text = textOf(viewOf(stateWith(b)));
    expect(text).toContain(String(upkeep));
    expect(text).toContain('17');
    expect(text).toContain('23');
  });

  it('the upkeep surcharge appears only when the factor differs from 1', () => {
    const plain = textOf(viewOf(stateWith(makeBuilding())));
    const withFactorOne = stateWith(makeBuilding());
    withFactorOne.events.activeModifiers.push({
      id: 802, kind: 'upkeep_surcharge', sourceEventId: 'evt_x', role: null, targetId: null,
      category: null, magnitude: 1, startTick: 0, endTick: null,
    });
    expect(textOf(viewOf(withFactorOne))).toBe(plain);

    const surcharged = stateWith(makeBuilding());
    surcharged.events.activeModifiers.push({
      id: 803, kind: 'upkeep_surcharge', sourceEventId: 'evt_x', role: null, targetId: null,
      category: null, magnitude: 1.5, startTick: 0, endTick: null,
    });
    expect(textOf(viewOf(surcharged))).not.toBe(plain);
  });

  it('lists score effects for a building that has them', () => {
    const b = makeBuilding({ type: 'living_quarters', tier: 3 });
    const effects = Object.keys(getBuildingDef(b.type, b.tier).scoreEffects);
    expect(effects.length).toBeGreaterThan(0);
    const text = textOf(viewOf(stateWith(b)));
    for (const id of effects) expect(text).toContain(t(`score.${id}`));
  });
});

describe('building inspector — action strip', () => {
  it('offers upgrade, move, demolish in that order when the next tier is unlocked', () => {
    const s = stateWith(makeBuilding());
    s.buildings.unlockedTiers['management_office'] = 2;
    const view = viewOf(s);
    expect(view.actions.map(a => a.action)).toEqual(['upgrade', 'move', 'demolish']);
    for (const a of view.actions) expect(a.disabled ?? false).toBe(false);
    expect(actionOf(view, 'upgrade')!.title).toBeTruthy();
    expect(getUpgradeCost(makeBuilding(), 2)).toBeGreaterThan(0);
  });

  it('research replaces upgrade when the next tier is locked, carrying cost and duration', () => {
    const view = viewOf(stateWith(makeBuilding()));
    expect(view.actions.map(a => a.action)).toEqual(['research', 'move', 'demolish']);
    const research = actionOf(view, 'research')!;
    expect(research.disabled ?? false).toBe(false);
    const def = getResearchTaskDef('management_office', 2);
    const shown = `${research.label ?? ''} ${research.title ?? ''}`;
    expect(shown).toContain(String(def.ticks));
  });

  it('once research is queued the research action is disabled and shows live progress', () => {
    const s = stateWith(makeBuilding());
    const def = getResearchTaskDef('management_office', 2);
    s.buildings.researchQueue.push({
      targetType: 'management_office', targetTier: 2, ticksRemaining: Math.floor(def.ticks / 2), cost: def.cost, conditions: [],
    });
    const research = actionOf(viewOf(s), 'research')!;
    expect(research.disabled).toBe(true);
    expect(`${research.label ?? ''} ${research.title ?? ''}`).toMatch(/\d/);
  });

  it('upgrade is disabled with a visible reason at max tier', () => {
    const view = viewOf(stateWith(makeBuilding({ tier: 3 })));
    const up = actionOf(view, 'upgrade')!;
    expect(up.disabled).toBe(true);
    expect(up.title).toBeTruthy();
    expect(up.title).not.toMatch(/^(inspector|ui)\./);
  });

  it('upgrade is disabled for a single-tier type', () => {
    const view = viewOf(stateWith(makeBuilding({ type: 'spoil_heap' })));
    const up = actionOf(view, 'upgrade');
    expect(up === undefined || up.disabled === true).toBe(true);
    if (up) expect(up.title).toBeTruthy();
  });

  it('upgrade is disabled on short cash and move/demolish carry their own reasons', () => {
    const s = stateWith(makeBuilding(), 0);
    s.buildings.unlockedTiers['management_office'] = 2;
    const view = viewOf(s);
    for (const name of ['upgrade', 'move', 'demolish'] as const) {
      const a = actionOf(view, name)!;
      expect(a.disabled, name).toBe(true);
      expect(a.title, name).toBeTruthy();
    }
  });

  it('upgrade names the reserved-terrain refusal', () => {
    const b = makeBuilding();
    const s = stateWith(b);
    s.buildings.unlockedTiers['management_office'] = 2;
    s.builtRamps.push({
      id: 1,
      def: { originX: b.x, originZ: b.z, direction: 'south', length: 8, targetDepth: 4, width: 3 },
      width: 3,
      footprint: { minX: b.x - 1, maxX: b.x + 1, minZ: b.z, maxZ: b.z + 8 },
    });
    const up = actionOf(viewOf(s), 'upgrade')!;
    expect(up.disabled).toBe(true);
    expect(up.title).toBe(t(RESERVATION_REFUSAL.ramp.errorKey));
  });

  it('every action is disabled while demolition is ordered', () => {
    const s = stateWith(makeBuilding());
    s.buildings.unlockedTiers['management_office'] = 2;
    demolitionOrder(s, 3);
    for (const a of viewOf(s).actions) expect(a.disabled, a.action).toBe(true);
  });

  it('every action is disabled on a site that is still being built', () => {
    const s = stateWith(null);
    addSite(s, 8, 60, 100);
    const view = viewOf(s, 8);
    expect(view.actions.length).toBeGreaterThan(0);
    for (const a of view.actions) expect(a.disabled, a.action).toBe(true);
  });
});

describe('building inspector — people and activity sections (#1760)', () => {
  it('a living quarters view carries the residents section with a name link', () => {
    const b = makeBuilding({ type: 'living_quarters', occupantIds: [1] });
    const s = stateWith(b);
    const { employee } = hireEmployee(s.employees, 'driller', new Random(7), 0, 0);
    employee.name = 'Zed Sleeper';
    employee.restTicksRemaining = 20;
    b.occupantIds = [employee.id];
    const root = document.createElement('div');
    root.append(...viewOf(s).sections);
    expect(root.querySelector(`[data-select-kind="employee"][data-select-id="${employee.id}"]`)!.textContent).toContain('Zed Sleeper');
  });

  it('a school view carries the courses and a research center view carries the research line', () => {
    const school = makeBuilding({ type: 'blasting_academy' });
    const sRoot = document.createElement('div');
    sRoot.append(...viewOf(stateWith(school)).sections);
    expect(sRoot.querySelector('[data-course]')).not.toBeNull();
    const rc = makeBuilding({ type: 'research_center' });
    const rRoot = document.createElement('div');
    rRoot.append(...viewOf(stateWith(rc)).sections);
    expect(rRoot.querySelector('[data-live="research-idle"]')).not.toBeNull();
  });

  it('a plain office carries none of the three sections', () => {
    const root = document.createElement('div');
    root.append(...viewOf(stateWith(makeBuilding())).sections);
    expect(root.querySelector('[data-course], [data-live="research-idle"], [data-live="seats"]')).toBeNull();
  });

  it('the view signature changes when a trainee enrols', () => {
    const b = makeBuilding({ type: 'blasting_academy' });
    const s = stateWith(b);
    const before = viewOf(s).signature;
    const { employee } = hireEmployee(s.employees, 'driller', new Random(7), 0, 0);
    employee.pendingTrainingState = { buildingId: 3, skill: 'blasting', ticksRemaining: 50, fee: 100, grantsLevel: 1 };
    expect(viewOf(s).signature).not.toBe(before);
  });
});
