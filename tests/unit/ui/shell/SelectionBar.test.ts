// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { SelectionBar } from '../../../../src/ui/shell/SelectionBar.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { placeBuilding } from '../../../../src/core/entities/Building.js';
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

function makeBar(): { bar: SelectionBar; root: HTMLElement; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const bar = new SelectionBar(container);
  const root = container.firstElementChild as HTMLElement;
  return { bar, root, container };
}

function entity(kind: EntityPick['kind'], id: number): EntityPick {
  return { kind, id, point: new THREE.Vector3(), distance: 1 };
}

describe('SelectionBar', () => {
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

  it('shows the vehicle action set (Follow, Move Here) and no Haul/Unassign', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');

    bar.show(entity('vehicle', vehicle.id), state);
    const labels = Array.from(root.querySelectorAll('button')).map(b => b.textContent);
    expect(labels.some(l => l?.includes('Follow'))).toBe(true);
    expect(labels.some(l => l?.includes('Move Here'))).toBe(true);
    expect(labels.some(l => l?.includes('Haul'))).toBe(false);
    expect(labels.some(l => l?.includes('Unassign'))).toBe(false);
    expect(root.querySelector('[data-action="haul"]')).toBeNull();
    expect(root.querySelector('[data-action="unassign"]')).toBeNull();
    expect(root.querySelectorAll('button[data-action]').length).toBe(2);
  });

  it('shows the building action set (Upgrade, Move, Demolish)', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { building } = placeBuilding(state.buildings, 'management_office', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number } };

    bar.show(entity('building', building.id), state);
    const labels = Array.from(root.querySelectorAll('button')).map(b => b.textContent);
    expect(labels.some(l => l?.includes('Upgrade'))).toBe(true);
    expect(labels.some(l => l?.includes('Move'))).toBe(true);
    expect(labels.some(l => l?.includes('Demolish'))).toBe(true);
  });

  it('shows the fragment action set (Focus)', () => {
    const { bar, root } = makeBar();
    bar.show(entity('fragment', 42), makeState());
    const labels = Array.from(root.querySelectorAll('button')).map(b => b.textContent);
    expect(labels.some(l => l?.includes('Focus'))).toBe(true);
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
    expect(root.textContent).not.toContain('/');
    expect(root.textContent).not.toContain('Inside:');
  });

  it('hides when the shown entity no longer exists in state', () => {
    const { bar, root } = makeBar();
    bar.show(entity('employee', 9999), makeState());
    expect(root.style.display).toBe('none');
  });

  it('shows hole id, depth, and sequence delay, and the Focus action', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const hole = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    state.sequenceDelays[hole.id] = 25;

    bar.show(entity('hole', holeNumericId(hole.id)), state);
    expect(root.style.display).not.toBe('none');
    expect(root.textContent).toContain(hole.id);
    expect(root.textContent).toContain('8m');
    expect(root.textContent).toContain('+25ms');
    const labels = Array.from(root.querySelectorAll('button')).map(b => b.textContent);
    expect(labels.some(l => l?.includes('Focus'))).toBe(true);
  });

  it('shows hole depth with no delay suffix when the hole is not yet sequenced', () => {
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

    // Every action button carries a data-action; the close button is the one that doesn't.
    const closeBtn = root.querySelector('button:not([data-action])') as HTMLButtonElement;
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
    expect(labels.some(l => l?.includes('Follow'))).toBe(true);
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

// main.ts owns what each SelectionBar action *does*, and it can't be imported
// in a unit test (it wires a full SceneManager/Three.js canvas, audio and
// IndexedDB at import time), so the handler is checked statically — same
// approach as tests/unit/ui/TutorialBridge.test.ts. The template it dispatches
// is then substituted and run through the *real* console runner, so a wrong
// coordinate form (`x:… z:…` instead of `to:x,z`) fails here rather than
// silently doing nothing in the browser.
describe('SelectionBar move_here — the command src/main.ts dispatches', () => {
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
    const body = handler.slice(0, handler.indexOf('case \'follow\':'));
    // Must be `aim`, never `hover`. The live hover is cleared by the
    // canvas mouseleave that firing this very button necessarily causes, so
    // reading it made the action impossible with a real mouse. This assertion
    // originally required `hover` and so locked the bug in.
    expect(body).toContain('scenePicking.aim?.terrain');
    expect(body).not.toContain('scenePicking.hover?.terrain');
    expect(body).toContain("t('shell.selection.no_move_target')");
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

describe('SelectionBar — ramp (#1298)', () => {
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
    expect(bar.visible).toBe(true);
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
    expect(bar.visible).toBe(false);
  });
});
