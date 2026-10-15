// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { Inspector } from '../../../../src/ui/shell/Inspector.js';
import { PANEL_CLOSE_ATTR } from '../../../../src/ui/panels/PanelBase.js';
import { setLocale, t } from '../../../../src/core/i18n/I18n.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { placeBuilding, storeExplosives, getBuildingDef } from '../../../../src/core/entities/Building.js';
import { purchaseVehicle, resolveVehicleDriver } from '../../../../src/core/entities/Vehicle.js';
import { hireEmployee } from '../../../../src/core/entities/Employee.js';
import { Random } from '../../../../src/core/math/Random.js';
import { addHole, holeNumericId } from '../../../../src/core/mining/DrillPlan.js';
import type { EntityPick } from '../../../../src/ui/scene/ScenePicking.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRunner } from '../../../../src/console-api.js';

const holeCounter = { nextHoleId: 1 };

function makeState() {
  return createGame({ seed: 1, mineType: 'desert' });
}

function makeBar(): { bar: Inspector; root: HTMLElement; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const bar = new Inspector(container);
  const root = container.firstElementChild as HTMLElement;
  return { bar, root, container };
}

function entity(kind: EntityPick['kind'], id: number): EntityPick {
  return { kind, id, point: new THREE.Vector3(), distance: 1 };
}

describe('Inspector', () => {
  it('is hidden initially', () => {
    const { root } = makeBar();
    expect(root.style.display).toBe('none');
  });

  it('shows employee identity and the crew action set (Detail, Dispatch Here, Train)', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1));

    bar.show(entity('employee', employee.id), state);
    expect(root.style.display).not.toBe('none');
    expect(root.textContent).toContain(employee.name);
    const labels = Array.from(root.querySelectorAll('button')).map(b => b.textContent);
    expect(labels.some(l => l?.includes('Detail'))).toBe(true);
    expect(labels.some(l => l?.includes('Dispatch Here'))).toBe(true);
    expect(labels.some(l => l?.includes('Train'))).toBe(true);
  });

  it('shows the vehicle action set (Locate, Move Here, Upgrade) and no Haul/Unassign', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');

    bar.show(entity('vehicle', vehicle.id), state);
    const labels = Array.from(root.querySelectorAll('button')).map(b => b.textContent);
    expect(labels.some(l => l?.includes('Follow'))).toBe(false);
    expect(root.querySelector('[data-action="locate"]')).not.toBeNull();
    expect(labels.some(l => l?.includes('Move Here'))).toBe(true);
    expect(labels.some(l => l?.includes('Haul'))).toBe(false);
    expect(labels.some(l => l?.includes('Unassign'))).toBe(false);
    expect(root.querySelector('[data-action="haul"]')).toBeNull();
    expect(root.querySelector('[data-action="unassign"]')).toBeNull();
    expect(Array.from(root.querySelectorAll('button[data-action]')).map(b => b.getAttribute('data-action')).sort()).toEqual(['locate', 'move_here', 'upgrade_vehicle']);
  });

  it('shows the building action set (Upgrade, Move, Demolish)', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { building } = placeBuilding(state.buildings, 'management_office', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number } };
    state.buildings.unlockedTiers['management_office'] = 2; // a locked next tier shows Research instead (#1758)

    bar.show(entity('building', building.id), state);
    const labels = Array.from(root.querySelectorAll('button')).map(b => b.textContent);
    expect(labels.some(l => l?.includes('Upgrade'))).toBe(true);
    expect(labels.some(l => l?.includes('Move'))).toBe(true);
    expect(labels.some(l => l?.includes('Demolish'))).toBe(true);
  });

  it('shows the fragment action set (Locate, no Focus)', () => {
    const { bar, root } = makeBar();
    bar.show(entity('fragment', 42), makeState());
    expect(root.querySelector('[data-action="locate"]')).not.toBeNull();
    expect(root.querySelector('[data-action="focus"]')).toBeNull();
  });

  it('shows occupancy count and an occupant-name listing for a people-holding building with occupants (#1205)', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { building } = placeBuilding(state.buildings, 'driving_center', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number; occupantIds: number[] } };
    const { employee: a } = hireEmployee(state.employees, 'driller', new Random(1));
    const { employee: b } = hireEmployee(state.employees, 'driller', new Random(2));
    building.occupantIds = [a.id, b.id];

    bar.show(entity('building', building.id), state);

    // driving_center tier 1 has a 4-person capacity (getBuildingPeopleCapacity).
    expect(root.textContent).toContain('2/4');
    expect(root.textContent).toContain(a.name);
    expect(root.textContent).toContain(b.name);
    expect(root.textContent).toContain('Inside:');
  });

  it('shows the occupancy count with no occupant listing for a people-holding building with zero occupants (#1205)', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { building } = placeBuilding(state.buildings, 'driving_center', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number } };

    bar.show(entity('building', building.id), state);

    expect(root.textContent).toContain('0/4');
    expect(root.textContent).not.toContain('Inside:');
  });

  it('shows neither an occupancy count nor an occupant listing for a building with no people capacity (#1205)', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { building } = placeBuilding(state.buildings, 'freight_warehouse', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number; hp: number } };

    bar.show(entity('building', building.id), state);

    expect(root.textContent).toContain(String(Math.round(building.hp)));
    expect(root.textContent).not.toContain(t('inspector.occupancy'));
    expect(root.textContent).not.toContain('Inside:');
  });

  it('hides when the shown entity no longer exists in state', () => {
    const { bar, root } = makeBar();
    bar.show(entity('employee', 9999), makeState());
    expect(root.style.display).toBe('none');
  });

  it('shows hole id, depth, and the Locate action', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const hole = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);

    bar.show(entity('hole', holeNumericId(hole.id)), state);
    expect(root.style.display).not.toBe('none');
    expect(root.textContent).toContain(hole.id);
    expect(root.textContent).toContain('8m');
    expect(root.textContent).not.toContain('ms');
    expect(root.querySelector('[data-action="locate"]')).not.toBeNull();
    expect(root.querySelector('[data-action="focus"]')).toBeNull();
  });

  it('shows hole depth only (`${depth}m`), never a delay suffix', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const hole = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);

    bar.show(entity('hole', holeNumericId(hole.id)), state);
    expect(root.textContent).toContain('8m');
    expect(root.textContent).not.toContain('ms');
  });

  it('hides when the shown hole no longer exists in state', () => {
    const { bar, root } = makeBar();
    bar.show(entity('hole', 9999), makeState());
    expect(root.style.display).toBe('none');
  });

  it('every action button carries a stable data-action selector for scenario/interaction harnesses', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1));

    bar.show(entity('employee', employee.id), state);

    expect(root.querySelector('[data-action="detail"]')).not.toBeNull();
    expect(root.querySelector('[data-action="dispatch_here"]')).not.toBeNull();
    expect(root.querySelector('[data-action="train"]')).not.toBeNull();
  });

  it('clicking an action fires the handler with the action name and entity', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
    const onAction = vi.fn();
    bar.setActionHandler(onAction);

    bar.show(entity('employee', employee.id), state);
    // Scoped to this test's own root — earlier tests' containers are still in
    // document.body (jsdom doesn't reset it between tests), so a bare
    // document.querySelector() here would find a stale button instead.
    const detailBtn = root.querySelector<HTMLButtonElement>('[data-action="detail"]');
    detailBtn?.click();

    expect(onAction).toHaveBeenCalledWith('detail', expect.objectContaining({ kind: 'employee', id: employee.id }));
  });

  it('the close button hides the bar', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
    bar.show(entity('employee', employee.id), state);

    // The close button carries the shared panel-close attribute.
    const closeBtn = root.querySelector(`[${PANEL_CLOSE_ATTR}]`) as HTMLButtonElement;
    closeBtn.click();
    expect(root.style.display).toBe('none');
  });

  it('hide() clears the visible selection', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
    bar.show(entity('employee', employee.id), state);
    bar.hide();
    expect(root.style.display).toBe('none');
  });

  it('showing a new entity replaces the previous action set rather than appending to it', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');

    bar.show(entity('employee', employee.id), state);
    bar.show(entity('vehicle', vehicle.id), state);

    const labels = Array.from(root.querySelectorAll('button')).map(b => b.textContent);
    expect(labels.some(l => l?.includes('Train'))).toBe(false);
    expect(root.querySelector('[data-action="locate"]')).not.toBeNull();
  });

  // ── vehicle "Move Here" (gap G4: `vehicle reposition <id> <x> <z>` had no button) ──

  it('the vehicle set carries a move_here data-action selector', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');

    bar.show(entity('vehicle', vehicle.id), state);
    expect(root.querySelector('[data-action="move_here"]')).not.toBeNull();
  });

  it('move_here is offered for vehicles only — not for employees, buildings, fragments or holes', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
    const { building } = placeBuilding(state.buildings, 'management_office', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number } };
    const hole = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);

    for (const pick of [
      entity('employee', employee.id),
      entity('building', building.id),
      entity('fragment', 42),
      entity('hole', holeNumericId(hole.id)),
    ]) {
      bar.show(pick, state);
      expect(root.querySelector('[data-action="move_here"]'), `${pick.kind} must not offer move_here`).toBeNull();
    }
  });

  it('keeps move_here distinct from the building move action', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { building } = placeBuilding(state.buildings, 'management_office', 2, 2, 34, 34, 1, 0, 0) as { building: { id: number } };
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');

    bar.show(entity('building', building.id), state);
    expect(root.querySelector('[data-action="move"]')).not.toBeNull();
    expect(root.querySelector('[data-action="move_here"]')).toBeNull();

    bar.show(entity('vehicle', vehicle.id), state);
    expect(root.querySelector('[data-action="move_here"]')).not.toBeNull();
    expect(root.querySelector('[data-action="move"]')).toBeNull();
  });

  it('clicking Move Here fires the handler with move_here and the vehicle entity', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');
    const onAction = vi.fn();
    bar.setActionHandler(onAction);

    bar.show(entity('vehicle', vehicle.id), state);
    root.querySelector<HTMLButtonElement>('[data-action="move_here"]')?.click();

    expect(onAction).toHaveBeenCalledWith('move_here', expect.objectContaining({ kind: 'vehicle', id: vehicle.id }));
  });

  it('dispose() removes the bar from the DOM', () => {
    const { bar, root, container } = makeBar();
    bar.dispose();
    expect(container.contains(root)).toBe(false);
  });
});

describe('Inspector vehicle upgrade button (#1401)', () => {
  function upgradeBtn(root: HTMLElement): HTMLButtonElement {
    return root.querySelector('[data-action="upgrade_vehicle"]') as HTMLButtonElement;
  }

  it('is enabled when cash covers the upgrade', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');
    state.cash = 1e9;
    bar.show(entity('vehicle', vehicle.id), state);
    expect(upgradeBtn(root).disabled).toBe(false);
  });

  it('is disabled when cash is short', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');
    state.cash = 0;
    bar.show(entity('vehicle', vehicle.id), state);
    expect(upgradeBtn(root).disabled).toBe(true);
  });

  it('is disabled at max tier however much cash', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');
    vehicle.tier = 3;
    state.cash = 1e9;
    bar.show(entity('vehicle', vehicle.id), state);
    expect(upgradeBtn(root).disabled).toBe(true);
  });
});

describe('removed vehicle Haul/Unassign i18n keys (#1400)', () => {
  const locales = ['en', 'fr'].map(l => [l, JSON.parse(readFileSync(join(process.cwd(), `src/core/i18n/locales/${l}.json`), 'utf8')) as Record<string, unknown>] as const);
  for (const key of ['shell.selection.haul', 'shell.selection.unassign', 'shell.selection.no_haul_target']) {
    for (const [name, json] of locales) {
      it(`${name}.json has no ${key}`, () => {
        expect(Object.keys(json)).not.toContain(key);
        const nested = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], json);
        expect(nested).toBeUndefined();
      });
    }
  }
});

// main.ts owns what each Inspector action *does*, and it can't be imported
// in a unit test (it wires a full SceneManager/Three.js canvas, audio and
// IndexedDB at import time), so the handler is checked statically — same
// approach as tests/unit/ui/TutorialBridge.test.ts. The template it dispatches
// is then substituted and run through the *real* console runner, so a wrong
// coordinate form (`x:… z:…` instead of `to:x,z`) fails here rather than
// silently doing nothing in the browser.
describe('Inspector move_here — the command src/main.ts dispatches', () => {
  const mainTs = readFileSync(join(process.cwd(), 'src/main.ts'), 'utf8');

  /** The `vehicle reposition …` template literal handed to window.__gameConsole. */
  function extractTemplate(): string {
    const match = /__gameConsole\(`(vehicle reposition [^`]*)`\)/.exec(mainTs);
    expect(match, 'src/main.ts dispatches no `vehicle reposition …` command').not.toBeNull();
    return match![1]!;
  }

  it('handles the move_here action at all', () => {
    expect(mainTs).toContain("case 'move_here':");
  });

  it('dispatches `vehicle reposition <id> <x> <z>` built from the latched aim tile', () => {
    expect(extractTemplate()).toBe('vehicle reposition ${entity.id} ${terrain.tileX} ${terrain.tileZ}');
  });

  it('reads the LATCHED aim, not the live hover, and warns when there is no target', () => {
    const handler = mainTs.slice(mainTs.indexOf("case 'move_here':"));
    const body = handler.slice(0, handler.indexOf("case 'upgrade':"));
    // Must be `aim`, never `hover`. The live hover is cleared by the
    // canvas mouseleave that firing this very button necessarily causes, so
    // reading it made the action impossible with a real mouse. This assertion
    // originally required `hover` and so locked the bug in.
    expect(body).toContain('scenePicking.aim?.terrain');
    expect(body).not.toContain('scenePicking.hover?.terrain');
    expect(body).toContain("t('inspector.no_move_target')");
    expect(body).toContain("severity: 'warn'");
  });

  it('the dispatched string is accepted by the real vehicle command parser and moves the vehicle', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game mine_type:desert seed:1 size:32');
    const { vehicle } = purchaseVehicle(ctx.state!.vehicles, 'debris_hauler', 0, 0);
    // `reposition` would otherwise pick an idle licensed driver itself; this
    // test's own point is that the dispatched command string parses and
    // reaches the real command handler, so a genuinely mounted driver is put
    // aboard up front (#1089: moveTo needs a real Employee record and an
    // agreeing Locomotion/occupantIds pair to plan a drive leg through).
    const { employee } = hireEmployee(ctx.state!.employees, 'driver', new Random(1));
    employee.x = vehicle.x;
    employee.z = vehicle.z;
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    vehicle.occupantIds = [employee.id];

    const command = extractTemplate()
      .replace('${entity.id}', String(vehicle.id))
      .replace('${terrain.tileX}', '12')
      .replace('${terrain.tileZ}', '7');
    expect(command).toBe(`vehicle reposition ${vehicle.id} 12 7`);

    const result = runner.run(command);
    expect(result.success, result.output).toBe(true);

    // #1089/#1138: the drive leg is read off the driving employee's own
    // itinerary now (Vehicle carries no task/targetX/Z of its own) —
    // `reposition` installs an itinerary on the driver via moveTo, and the
    // itinerary only reflects the new target once Locomotion actually
    // advances it a tick, not the instant the command itself returns.
    runner.run('tick 1');
    const moved = ctx.state!.vehicles.vehicles.find(v => v.id === vehicle.id)!;
    const driver = resolveVehicleDriver(moved, ctx.state!.employees.employees);
    expect(driver?.itinerary).not.toBeNull();
    expect(driver?.itinerary?.legs[0]?.destX).toBe(12);
    expect(driver?.itinerary?.legs[0]?.destZ).toBe(7);
  });
});

describe('Inspector — ramp (#1298)', () => {
  function stateWithRamp(width: 3 | 5 | 7) {
    const state = makeState();
    const def = { originX: 10, originZ: 5, direction: 'south' as const, length: 12, targetDepth: 6, width };
    state.builtRamps.push({ id: 1, def, width, footprint: { minX: 10 - Math.floor(width / 2), maxX: 10 + Math.floor(width / 2), minZ: 5, maxZ: 16 } });
    state.nextBuiltRampId = 2;
    return state;
  }

  it('shows the ramp with its id and width', () => {
    const { bar, root } = makeBar();
    bar.show(entity('ramp', 1), stateWithRamp(5));
    expect(bar.open).toBe(true);
    expect(root.textContent).toContain('5');
  });

  it('offers a widen action and no demolish, upgrade or move', () => {
    const { bar, root } = makeBar();
    bar.show(entity('ramp', 1), stateWithRamp(3));
    expect(root.querySelector('[data-action="widen"]')).not.toBeNull();
    expect(root.querySelector('[data-action="demolish"]')).toBeNull();
    expect(root.querySelector('[data-action="upgrade"]')).toBeNull();
    expect(root.querySelector('[data-action="move"]')).toBeNull();
  });

  it('fires the widen action with the ramp entity when clicked', () => {
    const { bar, root } = makeBar();
    const handler = vi.fn();
    bar.setActionHandler(handler);
    bar.show(entity('ramp', 1), stateWithRamp(5));
    root.querySelector<HTMLButtonElement>('[data-action="widen"]')!.click();
    expect(handler).toHaveBeenCalledWith('widen', expect.objectContaining({ kind: 'ramp', id: 1 }));
  });

  it('offers no widen action at the maximum width', () => {
    const { bar, root } = makeBar();
    bar.show(entity('ramp', 1), stateWithRamp(7));
    expect(root.querySelector<HTMLButtonElement>('[data-action="widen"]')).toBeNull();
  });

  it('hides the bar for a ramp id that no longer exists', () => {
    const { bar } = makeBar();
    bar.show(entity('ramp', 99), makeState());
    expect(bar.open).toBe(false);
  });

  // ── Explosive Warehouse stock and free capacity (#1685) ───────────────────

  it('shows stock and free capacity for a selected Explosive Warehouse', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { building } = placeBuilding(state.buildings, 'explosive_warehouse', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number } };
    storeExplosives(state.buildings, 'boomite', 100);
    storeExplosives(state.buildings, 'krackle', 25);
    const cap = getBuildingDef('explosive_warehouse', 1).capacity;

    bar.show(entity('building', building.id), state);

    expect(root.textContent).toContain('125');
    expect(root.textContent).toContain(String(cap - 125));
    expect(root.textContent).toContain('kg');
  });

  it('shows zero stock and the full capacity for an empty Explosive Warehouse', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { building } = placeBuilding(state.buildings, 'explosive_warehouse', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number } };
    const cap = getBuildingDef('explosive_warehouse', 1).capacity;

    bar.show(entity('building', building.id), state);

    expect(root.textContent).toContain(String(cap));
    expect(root.textContent).toContain('kg');
  });

  it('shows no stock figures for other buildings', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { building } = placeBuilding(state.buildings, 'freight_warehouse', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number } };
    storeExplosives(state.buildings, 'boomite', 100);

    bar.show(entity('building', building.id), state);

    expect(root.textContent).not.toContain('kg');
  });
});

describe('Inspector — src/main.ts wiring (#1756)', () => {
  const mainTs = readFileSync(join(process.cwd(), 'src/main.ts'), 'utf8');

  it('handles the locate action and no longer handles follow or focus', () => {
    expect(mainTs).toContain("case 'locate':");
    expect(mainTs).not.toContain("case 'follow':");
    expect(mainTs).not.toContain("case 'focus':");
  });

  it('no longer references the selection bar', () => {
    expect(mainTs).not.toContain('SelectionBar');
    expect(mainTs).not.toContain('bs-selection-bar');
  });

  it('reports the inspector in __uiState', () => {
    expect(mainTs).toContain('inspector');
  });
});

describe('Inspector — window frame (#1756)', () => {
  afterEach(() => { setLocale('en'); });

  function employeeSetup() {
    const ctx = makeBar();
    const state = makeState();
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
    return { ...ctx, state, employee };
  }

  it('root is #bs-inspector', () => {
    const { root } = makeBar();
    expect(root.id).toBe('bs-inspector');
  });

  it('exposes data-kind and data-id of the target while open', () => {
    const { bar, root, state, employee } = employeeSetup();
    bar.show(entity('employee', employee.id), state);
    expect(root.dataset['kind']).toBe('employee');
    expect(root.dataset['id']).toBe(String(employee.id));
    expect(bar.open).toBe(true);
    expect(bar.target).toEqual({ kind: 'employee', id: employee.id });
  });

  it('target is null and open is false while hidden', () => {
    const { bar } = makeBar();
    expect(bar.open).toBe(false);
    expect(bar.target).toBeNull();
  });

  it('re-targets when another entity is shown, still a single root', () => {
    const { bar, root, container, state, employee } = employeeSetup();
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');
    bar.show(entity('employee', employee.id), state);
    bar.show(entity('vehicle', vehicle.id), state);
    expect(root.dataset['kind']).toBe('vehicle');
    expect(root.dataset['id']).toBe(String(vehicle.id));
    expect(bar.target).toEqual({ kind: 'vehicle', id: vehicle.id });
    expect(container.querySelectorAll('#bs-inspector').length).toBe(1);
  });

  it('every kind offers a locate action that fires the handler', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');
    const { building } = placeBuilding(state.buildings, 'management_office', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number } };
    const hole = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    state.builtRamps.push({ id: 1, def: { originX: 10, originZ: 5, direction: 'south', length: 12, targetDepth: 6, width: 3 }, width: 3, footprint: { minX: 9, maxX: 11, minZ: 5, maxZ: 16 } });
    state.nextBuiltRampId = 2;
    const onAction = vi.fn();
    bar.setActionHandler(onAction);

    for (const pick of [
      entity('employee', employee.id), entity('vehicle', vehicle.id), entity('building', building.id),
      entity('fragment', 42), entity('hole', holeNumericId(hole.id)), entity('ramp', 1),
    ]) {
      bar.show(pick, state);
      const btn = root.querySelector<HTMLButtonElement>('[data-action="locate"]');
      expect(btn, `${pick.kind} must offer locate`).not.toBeNull();
      btn!.click();
      expect(onAction).toHaveBeenLastCalledWith('locate', expect.objectContaining({ kind: pick.kind, id: pick.id }));
    }
  });

  it('sub-line carries the id and the kind', () => {
    const { bar, root, state, employee } = employeeSetup();
    bar.show(entity('employee', employee.id), state);
    expect(root.textContent).toContain(`#${employee.id}`);
  });

  it('refreshes live values on update() without a reselect, keeping action button nodes', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { building } = placeBuilding(state.buildings, 'management_office', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number; hp: number } };
    building.hp = 80;
    bar.show(entity('building', building.id), state);
    const before = Array.from(root.querySelectorAll('button[data-action]'));
    expect(root.textContent).toContain('80');

    building.hp = 37;
    bar.update(state);

    expect(root.textContent).toContain('37');
    const after = Array.from(root.querySelectorAll('button[data-action]'));
    expect(after.length).toBe(before.length);
    after.forEach((node, i) => expect(node).toBe(before[i]));
  });

  it('update() flips a button disabled state in place when cash changes', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');
    state.cash = 0;
    bar.show(entity('vehicle', vehicle.id), state);
    const btn = root.querySelector<HTMLButtonElement>('[data-action="upgrade_vehicle"]')!;
    expect(btn.disabled).toBe(true);

    state.cash = 1e9;
    bar.update(state);

    expect(root.querySelector('[data-action="upgrade_vehicle"]')).toBe(btn);
    expect(btn.disabled).toBe(false);
  });

  it('update() refreshes occupancy as occupants enter', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { building } = placeBuilding(state.buildings, 'driving_center', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number; occupantIds: number[] } };
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
    bar.show(entity('building', building.id), state);
    expect(root.textContent).toContain('0/4');

    building.occupantIds = [employee.id];
    bar.update(state);

    expect(root.textContent).toContain('1/4');
    expect(root.textContent).toContain(employee.name);
  });

  it('update() refreshes explosive warehouse stock', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { building } = placeBuilding(state.buildings, 'explosive_warehouse', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number } };
    bar.show(entity('building', building.id), state);
    const stock = root.querySelector('[data-info="warehouse-stock"]');
    expect(stock).not.toBeNull();

    storeExplosives(state.buildings, 'boomite', 60);
    bar.update(state);

    expect(root.querySelector('[data-info="warehouse-stock"]')!.textContent).toContain('60');
  });

  it('update() hides the window when the entity has left the state', () => {
    const { bar, root, state, employee } = employeeSetup();
    bar.show(entity('employee', employee.id), state);
    state.employees.employees = state.employees.employees.filter(e => e.id !== employee.id);
    bar.update(state);
    expect(root.style.display).toBe('none');
    expect(bar.open).toBe(false);
    expect(bar.target).toBeNull();
  });

  it('update() with nothing shown is a no-op', () => {
    const { bar, root } = makeBar();
    bar.update(makeState());
    expect(root.style.display).toBe('none');
  });

  it('an occupant name is a link that selects that employee', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { building } = placeBuilding(state.buildings, 'driving_center', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number; occupantIds: number[] } };
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
    building.occupantIds = [employee.id];
    const onSelect = vi.fn();
    bar.setSelectHandler(onSelect);
    bar.show(entity('building', building.id), state);

    const link = Array.from(root.querySelectorAll<HTMLElement>('a, button, [role="link"]')).find(e => e.textContent === employee.name);
    expect(link, 'occupant name must be a clickable link').toBeDefined();
    link!.click();

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: 'employee', id: employee.id }));
  });

  it('the close button carries the shared panel-close attribute, hides and fires the close handler', () => {
    const { bar, root, state, employee } = employeeSetup();
    const onClose = vi.fn();
    bar.setCloseHandler(onClose);
    bar.show(entity('employee', employee.id), state);

    const closeBtn = root.querySelector<HTMLButtonElement>(`[${PANEL_CLOSE_ATTR}]`);
    expect(closeBtn).not.toBeNull();
    closeBtn!.click();

    expect(root.style.display).toBe('none');
    expect(bar.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hide() empties target and open', () => {
    const { bar, state, employee } = employeeSetup();
    bar.show(entity('employee', employee.id), state);
    bar.hide();
    expect(bar.open).toBe(false);
    expect(bar.target).toBeNull();
  });

  it('refreshLocale() re-renders in the new language and stays open', () => {
    const { bar, root, state, employee } = employeeSetup();
    bar.show(entity('employee', employee.id), state);
    setLocale('fr');
    bar.refreshLocale();

    expect(bar.open).toBe(true);
    expect(root.style.display).not.toBe('none');
    expect(root.textContent).toContain(t('ui.crew.needs'));
    expect(root.textContent).toContain(t('role.driller'));
    expect(bar.target).toEqual({ kind: 'employee', id: employee.id });
  });

  it('refreshLocale() while closed stays closed', () => {
    const { bar, root } = makeBar();
    bar.refreshLocale();
    expect(root.style.display).toBe('none');
  });

  it('shows a rebuild site as Rebuilding with upgrade, move and demolish disabled', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    state.plannedBuildings.push({ buildingId: 77, type: 'management_office', tier: 2, rebuild: true } as never);
    bar.show(entity('building', 77), state);
    expect(root.textContent).toContain(t('inspector.status.rebuilding_waiting', { tier: 2 }));
    for (const a of ['upgrade', 'move', 'demolish']) {
      expect(root.querySelector<HTMLButtonElement>(`[data-action="${a}"]`)!.disabled, a).toBe(true);
    }
  });

  it('shows the vehicle status and the employee role', () => {
    const { bar, root, state, employee } = employeeSetup();
    bar.show(entity('employee', employee.id), state);
    expect(root.textContent).toContain(t('role.driller'));
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');
    bar.show(entity('vehicle', vehicle.id), state);
    expect(root.textContent).toContain(t('vehicle_type.debris_hauler'));
  });

  it('dispose() removes the root and its layout region', () => {
    const { bar, root, container } = makeBar();
    bar.dispose();
    expect(container.contains(root)).toBe(false);
  });
});

describe('Inspector building action strip (#1758)', () => {
  function placed(state: ReturnType<typeof makeState>): number {
    const { building } = placeBuilding(state.buildings, 'management_office', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number } };
    return building.id;
  }
  const actions = (root: HTMLElement): string[] =>
    Array.from(root.querySelectorAll('button[data-action]')).map(b => b.getAttribute('data-action')!).filter(a => a !== 'locate');
  const btn = (root: HTMLElement, a: string): HTMLButtonElement => root.querySelector(`button[data-action="${a}"]`) as HTMLButtonElement;

  it('a locked next tier swaps Upgrade for Research; unlocking swaps it back', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const id = placed(state);
    state.cash = 1e9;
    bar.show(entity('building', id), state);
    expect(actions(root)).toEqual(['research', 'move', 'demolish']);

    state.buildings.unlockedTiers['management_office'] = 2;
    bar.update(state);
    expect(actions(root)).toEqual(['upgrade', 'move', 'demolish']);
  });

  it('the research button shows its literal label, not a translation key', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    state.cash = 1e9;
    bar.show(entity('building', placed(state)), state);
    const text = btn(root, 'research').textContent ?? '';
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toMatch(/^(inspector|ui)\./);
  });

  it('a disabled action carries its reason as the tooltip', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const id = placed(state);
    state.cash = 0;
    state.buildings.unlockedTiers['management_office'] = 2;
    bar.show(entity('building', id), state);
    for (const a of ['upgrade', 'move', 'demolish']) {
      expect(btn(root, a).disabled, a).toBe(true);
      expect(btn(root, a).title, a).not.toBe('');
    }
  });

  it('cash arriving enables the buttons in place, keeping the same nodes', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const id = placed(state);
    state.cash = 0;
    state.buildings.unlockedTiers['management_office'] = 2;
    bar.show(entity('building', id), state);
    const upgrade = btn(root, 'upgrade');
    expect(upgrade.disabled).toBe(true);

    state.cash = 1e9;
    bar.update(state);
    expect(btn(root, 'upgrade')).toBe(upgrade);
    expect(upgrade.disabled).toBe(false);
    expect(upgrade.title).not.toBe('');
  });

  it('queued research updates the Research button text in place as it progresses', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    state.cash = 1e9;
    bar.show(entity('building', placed(state)), state);
    const research = btn(root, 'research');
    const before = research.textContent;
    state.buildings.researchQueue.push({ targetType: 'management_office', targetTier: 2, ticksRemaining: 5, cost: 1, conditions: [] });
    bar.update(state);
    expect(btn(root, 'research')).toBe(research);
    expect(research.textContent).not.toBe(before);
    expect(research.disabled).toBe(true);
  });

  it('a building with a demolition ordered shows every action disabled', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const id = placed(state);
    state.cash = 1e9;
    state.pendingActions.push({
      id: 50, type: 'demolish_building', requiredSkill: null, requiredVehicleRole: 'building_destroyer',
      targetX: 2, targetZ: 2, targetY: 0, payload: { buildingId: id }, targetEmployeeId: null,
      status: 'queued', holderId: null, queuedAtTick: 0,
    });
    bar.show(entity('building', id), state);
    for (const a of actions(root)) expect(btn(root, a).disabled, a).toBe(true);
  });
});

describe('Inspector building actions — what src/main.ts routes them to (#1758)', () => {
  const mainTs = readFileSync(join(process.cwd(), 'src/main.ts'), 'utf8');
  /** Source of one `case 'name':` arm, up to the next arm of the same switch. */
  function caseBody(name: string): string {
    const start = mainTs.indexOf(`case '${name}':`);
    expect(start, `src/main.ts has no case '${name}'`).toBeGreaterThan(-1);
    const next = mainTs.indexOf("\n    case '", start + 1);
    return mainTs.slice(start, next === -1 ? start + 1200 : next);
  }

  it('move arms the placement tool through the UI manager and no longer opens the Build panel', () => {
    const body = caseBody('move');
    expect(body).toContain('uiManager.moveBuilding(');
    expect(body).not.toContain("showPanel('build')");
  });

  it('upgrade goes through the shared upgrade flow, not a bare console command', () => {
    const body = caseBody('upgrade');
    expect(body).toContain('uiManager.upgradeBuilding(');
    expect(body).not.toContain('build upgrade');
  });

  it('research queues through the UI manager', () => {
    expect(caseBody('research')).toContain('uiManager.queueBuildingResearch(');
  });

  it('the demolish confirm is handed the freight ore stored in the warehouse', () => {
    expect(caseBody('demolish')).toContain('storedOreKg');
  });
});
