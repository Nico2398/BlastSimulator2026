// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { HoverTag } from '../../../../src/ui/scene/HoverTag.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { placeBuilding } from '../../../../src/core/entities/Building.js';
import { purchaseVehicle } from '../../../../src/core/entities/Vehicle.js';
import { hireEmployee } from '../../../../src/core/entities/Employee.js';
import { Random } from '../../../../src/core/math/Random.js';
import { addHole, holeNumericId } from '../../../../src/core/mining/DrillPlan.js';
import type { PickResult } from '../../../../src/ui/scene/ScenePicking.js';

function makeState() {
  return createGame({ seed: 1, mineType: 'desert' });
}

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 20, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}),
  });
  return canvas;
}

function makeTag(): { tag: HoverTag; root: HTMLElement; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const tag = new HoverTag(container, makeCanvas(), makeCamera());
  const root = container.firstElementChild as HTMLElement;
  return { tag, root, container };
}

describe('HoverTag', () => {
  it('is hidden initially', () => {
    const { root } = makeTag();
    expect(root.style.display).toBe('none');
  });

  it('update(null, ...) hides the tag', () => {
    const { tag, root } = makeTag();
    tag.update(null, makeState());
    expect(root.style.display).toBe('none');
  });

  it('shows a building name and HP for an entity hover', () => {
    const { tag, root } = makeTag();
    const state = makeState();
    // state.world stays null until a grid binds it (createGame() alone never does) —
    // bounds are passed directly rather than read from it.
    const { building } = placeBuilding(state.buildings, 'management_office', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number; hp: number } };
    const hover: PickResult = { entity: { kind: 'building', id: building.id, point: new THREE.Vector3(), distance: 1 }, terrain: null };

    tag.update(hover, state);
    expect(root.style.display).not.toBe('none');
    expect(root.textContent).toContain(String(Math.round(building.hp)));
  });

  it('shows a vehicle type and state for an entity hover', () => {
    const { tag, root } = makeTag();
    const state = makeState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');
    const hover: PickResult = { entity: { kind: 'vehicle', id: vehicle.id, point: new THREE.Vector3(), distance: 1 }, terrain: null };

    tag.update(hover, state);
    expect(root.textContent).toContain('Debris Hauler');
  });

  it('shows an employee name and role for an entity hover', () => {
    const { tag, root } = makeTag();
    const state = makeState();
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
    const hover: PickResult = { entity: { kind: 'employee', id: employee.id, point: new THREE.Vector3(), distance: 1 }, terrain: null };

    tag.update(hover, state);
    expect(root.textContent).toContain(employee.name);
    expect(root.textContent).toContain('Driller');
  });

  it('hides when the hovered entity no longer exists in state', () => {
    const { tag, root } = makeTag();
    const state = makeState();
    const hover: PickResult = { entity: { kind: 'employee', id: 9999, point: new THREE.Vector3(), distance: 1 }, terrain: null };
    tag.update(hover, state);
    expect(root.style.display).toBe('none');
  });

  it('shows a hole id and depth for an entity hover', () => {
    const { tag, root } = makeTag();
    const state = makeState();
    const hole = addHole(state.drillHoles, 10, 10, 8, 0.15);
    const hover: PickResult = { entity: { kind: 'hole', id: holeNumericId(hole.id), point: new THREE.Vector3(), distance: 1 }, terrain: null };

    tag.update(hover, state);
    expect(root.textContent).toContain(hole.id);
    expect(root.textContent).toContain('8m');
  });

  it('shows the sequence delay for a hovered hole once it has one', () => {
    const { tag, root } = makeTag();
    const state = makeState();
    const hole = addHole(state.drillHoles, 10, 10, 8, 0.15);
    state.sequenceDelays[hole.id] = 50;
    const hover: PickResult = { entity: { kind: 'hole', id: holeNumericId(hole.id), point: new THREE.Vector3(), distance: 1 }, terrain: null };

    tag.update(hover, state);
    expect(root.textContent).toContain('+50ms');
  });

  it('hides when the hovered hole no longer exists in state', () => {
    const { tag, root } = makeTag();
    const state = makeState();
    const hover: PickResult = { entity: { kind: 'hole', id: 9999, point: new THREE.Vector3(), distance: 1 }, terrain: null };
    tag.update(hover, state);
    expect(root.style.display).toBe('none');
  });

  it('shows tile coordinates for a terrain hover', () => {
    const { tag, root } = makeTag();
    const hover: PickResult = { entity: null, terrain: { point: new THREE.Vector3(), tileX: 12, tileZ: 8, distance: 1 } };
    tag.update(hover, makeState());
    expect(root.textContent).toContain('12');
    expect(root.textContent).toContain('8');
  });

  it('shows "no survey data" when nothing has surveyed that column', () => {
    const { tag, root } = makeTag();
    const hover: PickResult = { entity: null, terrain: { point: new THREE.Vector3(), tileX: 12, tileZ: 8, distance: 1 } };
    tag.update(hover, makeState());
    expect(root.textContent).toContain('No survey data');
  });

  it('shows the ranked ore estimate for a surveyed column', () => {
    const { tag, root } = makeTag();
    const state = makeState();
    state.surveyResults.push({
      id: 1, method: 'seismic', centerX: 12, centerZ: 8, completedTick: state.tickCount,
      surveyorId: 1, confidence: 0.8,
      estimates: { '12,8': { grumpite: 0.65 } },
    });
    const hover: PickResult = { entity: null, terrain: { point: new THREE.Vector3(), tileX: 12, tileZ: 8, distance: 1 } };

    tag.update(hover, state);
    expect(root.textContent).toContain('65%');
  });

  it('shows FRESH for a survey within the staleness window', () => {
    const { tag, root } = makeTag();
    const state = makeState();
    state.surveyResults.push({
      id: 1, method: 'seismic', centerX: 12, centerZ: 8, completedTick: state.tickCount,
      surveyorId: 1, confidence: 0.8,
      estimates: { '12,8': { grumpite: 0.65 } },
    });
    const hover: PickResult = { entity: null, terrain: { point: new THREE.Vector3(), tileX: 12, tileZ: 8, distance: 1 } };

    tag.update(hover, state);
    expect(root.textContent).toContain('FRESH');
  });

  it('shows STALE for a survey past the staleness window', () => {
    const { tag, root } = makeTag();
    const state = makeState();
    state.surveyResults.push({
      id: 1, method: 'seismic', centerX: 12, centerZ: 8, completedTick: 0,
      surveyorId: 1, confidence: 0.8,
      estimates: { '12,8': { grumpite: 0.65 } },
    });
    state.tickCount = 100000; // far past SURVEY_STALE_TICKS
    const hover: PickResult = { entity: null, terrain: { point: new THREE.Vector3(), tileX: 12, tileZ: 8, distance: 1 } };

    tag.update(hover, state);
    expect(root.textContent).toContain('STALE');
  });

  it('hide() hides the tag', () => {
    const { tag, root } = makeTag();
    const hover: PickResult = { entity: null, terrain: { point: new THREE.Vector3(), tileX: 1, tileZ: 1, distance: 1 } };
    tag.update(hover, makeState());
    tag.hide();
    expect(root.style.display).toBe('none');
  });

  it('dispose() removes the tag from the DOM', () => {
    const { tag, root, container } = makeTag();
    tag.dispose();
    expect(container.contains(root)).toBe(false);
  });
});
