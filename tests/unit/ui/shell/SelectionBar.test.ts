// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { SelectionBar } from '../../../../src/ui/shell/SelectionBar.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { placeBuilding } from '../../../../src/core/entities/Building.js';
import { purchaseVehicle } from '../../../../src/core/entities/Vehicle.js';
import { hireEmployee } from '../../../../src/core/entities/Employee.js';
import { Random } from '../../../../src/core/math/Random.js';
import { addHole, holeNumericId } from '../../../../src/core/mining/DrillPlan.js';
import type { EntityPick } from '../../../../src/ui/scene/ScenePicking.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRunner } from '../../../../src/console-api.js';

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

  it('shows the vehicle action set (Follow, Move Here, Haul, Unassign)', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');

    bar.show(entity('vehicle', vehicle.id), state);
    const labels = Array.from(root.querySelectorAll('button')).map(b => b.textContent);
    expect(labels.some(l => l?.includes('Follow'))).toBe(true);
    expect(labels.some(l => l?.includes('Move Here'))).toBe(true);
    expect(labels.some(l => l?.includes('Haul'))).toBe(true);
    expect(labels.some(l => l?.includes('Unassign'))).toBe(true);
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

  it('hides when the shown entity no longer exists in state', () => {
    const { bar, root } = makeBar();
    bar.show(entity('employee', 9999), makeState());
    expect(root.style.display).toBe('none');
  });

  it('shows hole id, depth, and sequence delay, and the Focus action', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const hole = addHole(state.drillHoles, 10, 10, 8, 0.15);
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
    const hole = addHole(state.drillHoles, 10, 10, 8, 0.15);

    bar.show(entity('hole', holeNumericId(hole.id)), state);
    expect(root.textContent).toContain('8m');
    expect(root.textContent).not.toContain('ms');
  });

  it('hides when the shown hole no longer exists in state', () => {
    const { bar, root } = makeBar();
    bar.show(entity('hole', 9999), makeState());
    expect(root.style.display).toBe('none');
  });

  it('every action button carries a stable data-action selector for scenario/playtest harnesses', () => {
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
    expect(labels.some(l => l?.includes('Haul'))).toBe(true);
  });

  // ── vehicle "Move Here" (gap G4: `vehicle move <id> to:<x,z>` had no button) ──

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
    const hole = addHole(state.drillHoles, 10, 10, 8, 0.15);

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

// main.ts owns what each SelectionBar action *does*, and it can't be imported
// in a unit test (it wires a full SceneManager/Three.js canvas, audio and
// IndexedDB at import time), so the handler is checked statically — same
// approach as tests/unit/ui/TutorialBridge.test.ts. The template it dispatches
// is then substituted and run through the *real* console runner, so a wrong
// coordinate form (`x:… z:…` instead of `to:x,z`) fails here rather than
// silently doing nothing in the browser.
describe('SelectionBar move_here — the command src/main.ts dispatches', () => {
  const mainTs = readFileSync(join(process.cwd(), 'src/main.ts'), 'utf8');

  /** The `vehicle move …` template literal handed to window.__gameConsole. */
  function extractTemplate(): string {
    const match = /__gameConsole\(`(vehicle move [^`]*)`\)/.exec(mainTs);
    expect(match, 'src/main.ts dispatches no `vehicle move …` command').not.toBeNull();
    return match![1]!;
  }

  it('handles the move_here action at all', () => {
    expect(mainTs).toContain("case 'move_here':");
  });

  it('dispatches `vehicle move <id> to:<x>,<z>` built from the latched aim tile', () => {
    expect(extractTemplate()).toBe('vehicle move ${entity.id} to:${terrain.tileX},${terrain.tileZ}');
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

    const command = extractTemplate()
      .replace('${entity.id}', String(vehicle.id))
      .replace('${terrain.tileX}', '12')
      .replace('${terrain.tileZ}', '7');
    expect(command).toBe(`vehicle move ${vehicle.id} to:12,7`);

    const result = runner.run(command);
    expect(result.success, result.output).toBe(true);

    const moved = ctx.state!.vehicles.vehicles.find(v => v.id === vehicle.id)!;
    expect(moved.task).toBe('moving');
    expect(moved.targetX).toBe(12);
    expect(moved.targetZ).toBe(7);
  });
});
