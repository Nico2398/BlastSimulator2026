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

  it('shows the vehicle action set (Follow, Haul, Unassign)', () => {
    const { bar, root } = makeBar();
    const state = makeState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');

    bar.show(entity('vehicle', vehicle.id), state);
    const labels = Array.from(root.querySelectorAll('button')).map(b => b.textContent);
    expect(labels.some(l => l?.includes('Follow'))).toBe(true);
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

  it('dispose() removes the bar from the DOM', () => {
    const { bar, root, container } = makeBar();
    bar.dispose();
    expect(container.contains(root)).toBe(false);
  });
});
