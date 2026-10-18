// @vitest-environment jsdom
// Building inspector content (#1758): live status, condition, costs, action strip.
import { describe, it, expect, afterEach } from 'vitest';
import { buildingContent } from '../../../../../src/ui/panels/inspector/buildingContent.js';
import type { ActionSpec, InspectorLinks, InspectorView } from '../../../../../src/ui/panels/inspector/InspectorContent.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import type { GameState, PendingAction } from '../../../../../src/core/state/GameState.js';
import { getBuildingDef, getUpgradeCost, getMoveCost, getDemolishCost, type Building } from '../../../../../src/core/entities/Building.js';
import { getResearchTaskDef } from '../../../../../src/core/config/balance.js';
import { hireEmployee, createEmployeeState } from '../../../../../src/core/entities/Employee.js';
import { Random } from '../../../../../src/core/math/Random.js';
import { RESERVATION_REFUSAL } from '../../../../../src/core/entities/PlacementReservations.js';
import { t, setLocale } from '../../../../../src/core/i18n/I18n.js';
import { formatMoney } from '../../../../../src/core/economy/formatMoney.js';
import { purchaseVehicle, ROLE_LICENCE_REQUIRED } from '../../../../../src/core/entities/Vehicle.js';
import { assignSkill } from '../../../../../src/core/entities/Employee.js';

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

function addResearchCenter(s: GameState): void {
  s.buildings.buildings.push(makeBuilding({ id: 90, type: 'research_center', x: 40, z: 40 }));
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
    expect(getUpgradeCost('management_office', 2)).toBeGreaterThan(0);
  });

  it('research replaces upgrade when the next tier is locked, carrying cost and duration', () => {
    const withLab = stateWith(makeBuilding());
    addResearchCenter(withLab);
    const view = viewOf(withLab);
    expect(view.actions.map(a => a.action)).toEqual(['research', 'move', 'demolish']);
    const research = actionOf(view, 'research')!;
    expect(research.disabled ?? false).toBe(false);
    const def = getResearchTaskDef('management_office', 2);
    const shown = `${research.label ?? ''} ${research.title ?? ''}`;
    expect(shown).toContain(String(def.ticks));
  });

  it('once research is queued the research action is disabled and shows live progress', () => {
    const s = stateWith(makeBuilding());
    addResearchCenter(s);
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

  it('a building that is neither home, school nor lab carries none of the three sections', () => {
    const root = document.createElement('div');
    root.append(...viewOf(stateWith(makeBuilding({ type: 'freight_warehouse' }))).sections);
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

describe('building inspector — money carries the currency sign (#1820)', () => {
  afterEach(() => setLocale('en'));

  const warehouse = () => makeBuilding({ type: 'freight_warehouse', tier: 1 });
  const upkeepOf = (view: InspectorView): string => {
    const root = document.createElement('div');
    root.append(...view.sections);
    return root.querySelector('[data-live="upkeep"]')!.textContent ?? '';
  };

  function labelled(s: GameState): InspectorView {
    addResearchCenter(s);
    return viewOf(s);
  }

  it('upkeep reads $cost/h', () => {
    const b = warehouse();
    const upkeep = getBuildingDef(b.type, b.tier).operatingCostPerTick;
    expect(upkeepOf(viewOf(stateWith(b)))).toContain(`$${formatMoney(upkeep)}/h`);
  });

  it('Research, Move and Demolish labels carry $ before the grouped amount', () => {
    const b = warehouse();
    const view = labelled(stateWith(b));
    const research = getResearchTaskDef('freight_warehouse', 2);
    expect(actionOf(view, 'research')!.label).toContain(`$${formatMoney(research.cost)}`);
    expect(actionOf(view, 'move')!.label).toBe(`${t('inspector.action.move')} · $${formatMoney(getMoveCost(b))}`);
    expect(actionOf(view, 'demolish')!.label).toBe(`${t('inspector.action.demolish')} · $${formatMoney(getDemolishCost(b))}`);
  });

  it('Upgrade label carries $', () => {
    const b = warehouse();
    const s = stateWith(b);
    s.buildings.unlockedTiers['freight_warehouse'] = 2;
    expect(actionOf(viewOf(s), 'upgrade')!.label).toBe(`${t('inspector.action.upgrade')} · $${formatMoney(getUpgradeCost(b.type, 2))}`);
  });

  it('a cash refusal title carries $ on both amounts', () => {
    const b = warehouse();
    const move = actionOf(viewOf(stateWith(b, 0)), 'move')!;
    expect(move.disabled).toBe(true);
    expect(move.title).toBe(`Not enough cash: needs $${formatMoney(getMoveCost(b))}, you have $0`);
  });

  it('the French locale places the sign after the amount', () => {
    setLocale('fr');
    const b = warehouse();
    const view = labelled(stateWith(b));
    const upkeep = getBuildingDef(b.type, b.tier).operatingCostPerTick;
    expect(upkeepOf(view)).toContain(`${formatMoney(upkeep)} $ par h`);
    expect(actionOf(view, 'move')!.label).toContain(`${formatMoney(getMoveCost(b))} $`);
    expect(actionOf(view, 'move')!.label).not.toContain(`$${formatMoney(getMoveCost(b))}`);
    expect(actionOf(view, 'research')!.label).toContain(`${formatMoney(getResearchTaskDef('freight_warehouse', 2).cost)} $`);
    const broke = actionOf(viewOf(stateWith(b, 0)), 'move')!;
    expect(broke.title).toContain(`${formatMoney(getMoveCost(b))} $`);
  });

  it('a queued research line and a course row carry the sign', () => {
    const s = stateWith(makeBuilding({ type: 'research_center' }));
    // The head of the queue renders as running (no cost); the money shows on the pending lines behind it.
    s.buildings.researchQueue.push({ targetType: 'freight_warehouse', targetTier: 2, ticksRemaining: 5, cost: 100, conditions: [] });
    s.buildings.researchQueue.push({ targetType: 'freight_warehouse', targetTier: 2, ticksRemaining: 5, cost: 5000, conditions: [] });
    expect(textOf(viewOf(s))).toContain('$5,000');
    const school = makeBuilding({ type: 'blasting_academy' });
    expect(textOf(viewOf(stateWith(school)))).toMatch(/fee \$[\d,]+/);
  });
});

describe('building inspector — research duration (#1820)', () => {
  it('instant tier-2 research shows no tick count', () => {
    const s = stateWith(makeBuilding({ type: 'freight_warehouse' }));
    addResearchCenter(s);
    expect(getResearchTaskDef('freight_warehouse', 2).ticks).toBe(0);
    const label = actionOf(viewOf(s), 'research')!.label!;
    expect(label).not.toMatch(/tick/i);
    expect(label).not.toMatch(/\b0\b/);
  });

  it('tier-3 research still shows its duration', () => {
    const s = stateWith(makeBuilding({ type: 'freight_warehouse', tier: 2 }));
    addResearchCenter(s);
    s.buildings.unlockedTiers['freight_warehouse'] = 2;
    const research = actionOf(viewOf(s), 'research')!;
    expect(research.disabled ?? false).toBe(false);
    expect(research.label).toContain('50 ticks');
  });
});

describe('building inspector — research prerequisite (#1820)', () => {
  it('without a Research Center the Research action is disabled and names it', () => {
    const research = actionOf(viewOf(stateWith(makeBuilding({ type: 'freight_warehouse' }))), 'research')!;
    expect(research.disabled).toBe(true);
    expect(research.title).toBe(t('inspector.reason.research_no_center'));
    expect(research.title).toContain('Research Center');
  });

  it('with an operating Research Center it is enabled and carries no reason', () => {
    const s = stateWith(makeBuilding({ type: 'freight_warehouse' }));
    addResearchCenter(s);
    const research = actionOf(viewOf(s), 'research')!;
    expect(research.disabled ?? false).toBe(false);
    expect(research.title).toBeUndefined();
  });

  it('tier 3 without the tier-2 research is disabled and names the missing tier', () => {
    const s = stateWith(makeBuilding({ type: 'freight_warehouse', tier: 2 }));
    addResearchCenter(s);
    const research = actionOf(viewOf(s), 'research')!;
    expect(research.disabled).toBe(true);
    expect(research.title).toBe(t('inspector.reason.research_needs_tier', { tier: 2 }));
  });

  it('queued research still shows progress and is disabled', () => {
    const s = stateWith(makeBuilding({ type: 'freight_warehouse', tier: 2 }));
    addResearchCenter(s);
    s.buildings.unlockedTiers['freight_warehouse'] = 2;
    s.buildings.researchQueue.push({ targetType: 'freight_warehouse', targetTier: 3, ticksRemaining: 20, cost: 12000, conditions: [] });
    const research = actionOf(viewOf(s), 'research')!;
    expect(research.disabled).toBe(true);
    expect(research.label).toBe(t('ui.build.research_progress', { percent: Math.round(((50 - 20) / 50) * 100), remaining: 20 }));
  });

  it('cash short with a Research Center keeps the cash reason', () => {
    const s = stateWith(makeBuilding({ type: 'freight_warehouse' }), 0);
    addResearchCenter(s);
    const research = actionOf(viewOf(s), 'research')!;
    expect(research.disabled).toBe(true);
    expect(research.title).toContain('Not enough cash');
  });
});

describe('building inspector — only Demolish waits for a Building Destroyer (#1820, #1875)', () => {
  const waitNoVehicle = () => t('inspector.wait.no_vehicle', { role: t('vehicle_type.building_destroyer') });

  function upgradable(): GameState {
    const s = stateWith(makeBuilding());
    s.buildings.unlockedTiers['management_office'] = 2;
    return s;
  }

  it('with no destroyer, Demolish carries the wait note and Upgrade has none', () => {
    const view = viewOf(upgradable());
    const up = actionOf(view, 'upgrade')!;
    expect(up.disabled ?? false).toBe(false);
    expect(up.note).toBeUndefined();
    const demolish = actionOf(view, 'demolish')!;
    expect(demolish.disabled ?? false).toBe(false);
    expect(demolish.note).toBe(waitNoVehicle());
    expect(actionOf(view, 'move')!.note).toBeUndefined();
  });

  it('with a destroyer but no licensed driver Demolish names the driver; Upgrade still has no note', () => {
    const s = upgradable();
    purchaseVehicle(s.vehicles, 'building_destroyer');
    const view = viewOf(s);
    expect(actionOf(view, 'upgrade')!.note).toBeUndefined();
    expect(actionOf(view, 'demolish')!.note).toBe(t('inspector.wait.no_driver', { role: t('vehicle_type.building_destroyer') }));
  });

  it('with a destroyer and a licensed driver there is no note', () => {
    const s = upgradable();
    purchaseVehicle(s.vehicles, 'building_destroyer');
    const { employee } = hireEmployee(s.employees, 'driver', new Random(5), 0, 0);
    assignSkill(s.employees, employee.id, ROLE_LICENCE_REQUIRED.building_destroyer, 1);
    const view = viewOf(s);
    for (const a of view.actions) expect(a.note, a.action).toBeUndefined();
  });

  it('a refused (disabled) action carries its reason, not a wait note', () => {
    const s = stateWith(makeBuilding({ tier: 3 }));
    const up = actionOf(viewOf(s), 'upgrade')!;
    expect(up.disabled).toBe(true);
    expect(up.note).toBeUndefined();
  });

  it('the Upgrade tooltip is inspector.tip.upgrade and no longer mentions demolishing', () => {
    const up = actionOf(viewOf(upgradable()), 'upgrade')!;
    expect(up.title).toBe(t('inspector.tip.upgrade'));
    expect(t('inspector.tip.upgrade').toLowerCase()).not.toContain('demolish');
  });
});

describe('building inspector — upgrade ordered (#1875)', () => {
  function upgradeOrdered(): GameState {
    const s = stateWith(makeBuilding());
    s.buildings.unlockedTiers['management_office'] = 2;
    addSite(s, 3, null, 100);
    s.plannedBuildings[0]!.tier = 2;
    s.plannedBuildings[0]!.upgrade = true;
    return s;
  }

  it('Upgrade, Move and Demolish are disabled with the upgrade_ordered reason', () => {
    const view = viewOf(upgradeOrdered());
    for (const name of ['upgrade', 'move', 'demolish'] as const) {
      const a = actionOf(view, name)!;
      expect(a.disabled, name).toBe(true);
      expect(a.title, name).toBe(t('inspector.reason.upgrade_ordered'));
    }
  });

  it('the standing building reads as upgrading, not as a construction site', () => {
    const s = upgradeOrdered();
    const operating = viewOf(stateWith(makeBuilding())).status;
    const status = viewOf(s).status;
    expect(status).not.toBe(operating);
    // No builder holds the site yet, so the line is the waiting variant.
    expect(status).toBe(t('inspector.status.upgrading_waiting', { tier: 2 }));
  });
});

describe('building inspector — builder phase (#1897)', () => {
  /** Hire a builder holding action 60; timer null = still walking. */
  function assignBuilder(s: GameState, remaining: number | null, total: number | undefined): number {
    const { employee } = hireEmployee(createEmployeeState(), 'driller', new Random(7), 0, 0);
    employee.name = 'Zed Builder';
    employee.activeActionId = 60;
    employee.taskTicksRemaining = remaining;
    if (total !== undefined) employee.activeTaskTotalTicks = total;
    s.employees.employees.push(employee);
    const a = s.pendingActions.find(p => p.id === 60)!;
    a.holderId = employee.id;
    a.status = 'in_progress';
    return employee.id;
  }

  function upgrading(): GameState {
    const s = stateWith(makeBuilding());
    s.buildings.unlockedTiers['management_office'] = 2;
    addSite(s, 3, null, 100);
    s.plannedBuildings[0]!.tier = 2;
    s.plannedBuildings[0]!.upgrade = true;
    return s;
  }

  function site(): { s: GameState; id: number } {
    const s = stateWith(null);
    addSite(s, 8, null, 100);
    return { s, id: 8 };
  }

  function builderLink(view: InspectorView, builderId: number): HTMLElement | null {
    const root = document.createElement('div');
    root.append(...view.sections);
    return root.querySelector<HTMLElement>(`[data-select-kind="employee"][data-select-id="${builderId}"]`);
  }

  function hasEmployeeLink(view: InspectorView): boolean {
    const root = document.createElement('div');
    root.append(...view.sections);
    return root.querySelector('[data-select-kind="employee"]') !== null;
  }

  describe('Builder row on an upgrading standing building', () => {
    it('shows a Builder row with an employee link when a builder is assigned', () => {
      const s = upgrading();
      const builderId = assignBuilder(s, 60, 100);
      const view = viewOf(s);
      const link = builderLink(view, builderId);
      expect(link).not.toBeNull();
      expect(link!.textContent).toBe('Zed Builder');
      expect(textOf(view)).toContain(t('inspector.builder'));
    });

    it('shows the Builder row while the builder is still on the way', () => {
      const s = upgrading();
      const builderId = assignBuilder(s, null, undefined);
      const view = viewOf(s);
      expect(builderLink(view, builderId)).not.toBeNull();
      expect(textOf(view)).toContain(t('inspector.builder'));
    });

    it('shows no Builder row and no employee link when unassigned', () => {
      const view = viewOf(upgrading());
      expect(hasEmployeeLink(view)).toBe(false);
      expect(textOf(view)).not.toContain(t('inspector.builder'));
    });

    it('shows no Builder row on a non-upgrading building', () => {
      const view = viewOf(stateWith(makeBuilding()));
      expect(hasEmployeeLink(view)).toBe(false);
      expect(textOf(view)).not.toContain(t('inspector.builder'));
    });

    it('shows no Builder row when the builder employee is missing', () => {
      const s = upgrading();
      s.pendingActions.find(p => p.id === 60)!.holderId = 9999;
      const view = viewOf(s);
      expect(hasEmployeeLink(view)).toBe(false);
      expect(textOf(view)).not.toContain(t('inspector.builder'));
    });
  });

  describe('status text per phase', () => {
    it('upgrade, unassigned: waiting for a builder', () => {
      expect(viewOf(upgrading()).status).toBe(t('inspector.status.upgrading_waiting', { tier: 2 }));
    });

    it('upgrade, on the way: names the builder', () => {
      const s = upgrading();
      assignBuilder(s, null, undefined);
      const status = viewOf(s).status;
      expect(status).toBe('Upgrading to tier 2 · Zed Builder is on the way');
      expect(status).toBe(t('inspector.status.upgrading_on_the_way', { tier: 2, builder: 'Zed Builder' }));
      expect(status).not.toMatch(/^inspector\./);
    });

    it('upgrade, working: shows the percentage', () => {
      const s = upgrading();
      assignBuilder(s, 60, 100);
      expect(viewOf(s).status).toBe(t('inspector.status.upgrading', { tier: 2, percent: 40 }));
    });

    it('construction site, unassigned: waiting for a builder', () => {
      const { s, id } = site();
      expect(viewOf(s, id).status).toBe(t('inspector.status.under_construction_waiting', { tier: 1 }));
    });

    it('construction site, on the way: names the builder', () => {
      const { s, id } = site();
      assignBuilder(s, null, undefined);
      const status = viewOf(s, id).status;
      expect(status).toBe('Under construction (tier 1) · Zed Builder is on the way');
      expect(status).toBe(t('inspector.status.under_construction_on_the_way', { tier: 1, builder: 'Zed Builder' }));
    });

    it('construction site, working: shows the percentage', () => {
      const { s, id } = site();
      assignBuilder(s, 60, 100);
      expect(viewOf(s, id).status).toBe(t('inspector.status.under_construction', { tier: 1, percent: 40 }));
    });

    it('on the way with a zero task total still reads on the way', () => {
      const s = upgrading();
      assignBuilder(s, 30, 0);
      expect(viewOf(s).status).toContain('is on the way');
    });

    it('a missing builder employee falls back to the waiting text without crashing', () => {
      const up = upgrading();
      up.pendingActions.find(p => p.id === 60)!.holderId = 9999;
      expect(viewOf(up).status).toBe(t('inspector.status.upgrading_waiting', { tier: 2 }));

      const { s, id } = site();
      s.pendingActions.find(p => p.id === 60)!.holderId = 9999;
      expect(viewOf(s, id).status).toBe(t('inspector.status.under_construction_waiting', { tier: 1 }));
    });
  });

  describe('view signature', () => {
    it('changes when a builder is assigned to an upgrade', () => {
      const s = upgrading();
      const before = viewOf(s).signature;
      assignBuilder(s, null, undefined);
      expect(viewOf(s).signature).not.toBe(before);
    });

    it('changes when the builder goes from on the way to working', () => {
      const s = upgrading();
      assignBuilder(s, null, undefined);
      const before = viewOf(s).signature;
      const e = s.employees.employees[s.employees.employees.length - 1]!;
      e.taskTicksRemaining = 50;
      e.activeTaskTotalTicks = 100;
      expect(viewOf(s).signature).not.toBe(before);
    });

    it('changes when the builder is renamed', () => {
      const s = upgrading();
      assignBuilder(s, 60, 100);
      const before = viewOf(s).signature;
      s.employees.employees[s.employees.employees.length - 1]!.name = 'Other Name';
      expect(viewOf(s).signature).not.toBe(before);
    });

    it('construction site signature changes when the builder arrives', () => {
      const { s, id } = site();
      const before = viewOf(s, id).signature;
      assignBuilder(s, null, undefined);
      expect(viewOf(s, id).signature).not.toBe(before);
      const onTheWay = viewOf(s, id).signature;
      const e = s.employees.employees[s.employees.employees.length - 1]!;
      e.taskTicksRemaining = 50;
      e.activeTaskTotalTicks = 100;
      expect(viewOf(s, id).signature).not.toBe(onTheWay);
    });
  });
});
