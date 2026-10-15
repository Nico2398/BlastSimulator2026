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

const holeCounter = { nextHoleId: 1 };

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

function addSurvey(state: ReturnType<typeof makeState>): void {
  state.surveyResults.push({
    id: 1, method: 'seismic', centerX: 12, centerZ: 8, completedTick: state.tickCount,
    surveyorId: 1, confidence: 0.8,
    estimates: { '12,8': { grumpite: 0.65 } },
  });
}

describe('HoverTag', () => {
  it('is hidden initially', () => {
    const { root } = makeTag();
    expect(root.style.display).toBe('none');
  });

  it('update(null, ...) hides the tag', () => {
    const { tag, root } = makeTag();
    tag.update(null, makeState(), true);
    expect(root.style.display).toBe('none');
  });

  /** Entity hovers never show the tag (#1752) — even with the overlay on. */
  function expectNoTag(hover: PickResult, state = makeState()): void {
    const { tag, root } = makeTag();
    tag.update(hover, state, true);
    expect(root.style.display).toBe('none');
  }
  const pt = () => new THREE.Vector3();

  it('shows no tag for a building hover (was name and HP)', () => {
    const state = makeState();
    const { building } = placeBuilding(state.buildings, 'management_office', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number } };
    expectNoTag({ entity: { kind: 'building', id: building.id, point: pt(), distance: 1 }, terrain: null }, state);
  });

  it('shows no tag for a vehicle hover (was type and state)', () => {
    const state = makeState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');
    expectNoTag({ entity: { kind: 'vehicle', id: vehicle.id, point: pt(), distance: 1 }, terrain: null }, state);
  });

  it('shows no tag for an employee hover (was name and role)', () => {
    const state = makeState();
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1));
    expectNoTag({ entity: { kind: 'employee', id: employee.id, point: pt(), distance: 1 }, terrain: null }, state);
  });

  it('shows no tag for a building with occupants (was the occupancy count, #1205)', () => {
    const state = makeState();
    const { building } = placeBuilding(state.buildings, 'driving_center', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number; occupantIds: number[] } };
    building.occupantIds = [1, 2];
    expectNoTag({ entity: { kind: 'building', id: building.id, point: pt(), distance: 1 }, terrain: null }, state);
  });

  it('shows no tag for an empty people-holding building', () => {
    const state = makeState();
    const { building } = placeBuilding(state.buildings, 'driving_center', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number } };
    expectNoTag({ entity: { kind: 'building', id: building.id, point: pt(), distance: 1 }, terrain: null }, state);
  });

  it('shows no tag for a warehouse building', () => {
    const state = makeState();
    const { building } = placeBuilding(state.buildings, 'freight_warehouse', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number } };
    expectNoTag({ entity: { kind: 'building', id: building.id, point: pt(), distance: 1 }, terrain: null }, state);
  });

  it('shows no tag for an entity that no longer exists in state', () => {
    expectNoTag({ entity: { kind: 'employee', id: 9999, point: pt(), distance: 1 }, terrain: null });
  });

  it('shows no tag for a hole hover (was id and depth)', () => {
    const state = makeState();
    const hole = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    expectNoTag({ entity: { kind: 'hole', id: holeNumericId(hole.id), point: pt(), distance: 1 }, terrain: null }, state);
  });

  it('shows no tag for a missing hole', () => {
    expectNoTag({ entity: { kind: 'hole', id: 9999, point: pt(), distance: 1 }, terrain: null });
  });

  it('shows no tag for a fragment hover', () => {
    expectNoTag({ entity: { kind: 'fragment', id: 12, point: pt(), distance: 1 }, terrain: null });
  });

  it('shows no tag for a ramp hover, even though a ramp pick carries its ground tile', () => {
    expectNoTag({
      entity: { kind: 'ramp', id: 1, point: pt(), distance: 1 },
      terrain: { point: pt(), tileX: 12, tileZ: 8, distance: 1 },
    });
  });

  it('shows no tag for an entity standing on a surveyed tile', () => {
    const state = makeState();
    addSurvey(state);
    const { building } = placeBuilding(state.buildings, 'management_office', 2, 2, 32, 32, 1, 0, 0) as { building: { id: number } };
    expectNoTag({
      entity: { kind: 'building', id: building.id, point: pt(), distance: 1 },
      terrain: { point: pt(), tileX: 12, tileZ: 8, distance: 1 },
    }, state);
  });

  it('shows tile coordinates for a surveyed terrain hover', () => {
    const { tag, root } = makeTag();
    const state = makeState();
    addSurvey(state);
    const hover: PickResult = { entity: null, terrain: { point: new THREE.Vector3(), tileX: 12, tileZ: 8, distance: 1 } };
    tag.update(hover, state, true);
    expect(root.textContent).toContain('12');
    expect(root.textContent).toContain('8');
  });

  it('is hidden for an unsurveyed tile and never says "No survey data"', () => {
    const { tag, root } = makeTag();
    const hover: PickResult = { entity: null, terrain: { point: new THREE.Vector3(), tileX: 12, tileZ: 8, distance: 1 } };
    tag.update(hover, makeState(), true);
    expect(root.style.display).toBe('none');
    expect(root.textContent).not.toContain('No survey data');
  });

  it('is hidden for a tile whose survey has no estimate for that column', () => {
    const { tag, root } = makeTag();
    const state = makeState();
    addSurvey(state);
    const hover: PickResult = { entity: null, terrain: { point: new THREE.Vector3(), tileX: 13, tileZ: 8, distance: 1 } };
    tag.update(hover, state, true);
    expect(root.style.display).toBe('none');
  });

  it('is hidden for a surveyed tile whose column estimate is empty', () => {
    const { tag, root } = makeTag();
    const state = makeState();
    state.surveyResults.push({
      id: 1, method: 'seismic', centerX: 12, centerZ: 8, completedTick: state.tickCount,
      surveyorId: 1, confidence: 0.8, estimates: { '12,8': {} },
    });
    const hover: PickResult = { entity: null, terrain: { point: new THREE.Vector3(), tileX: 12, tileZ: 8, distance: 1 } };
    tag.update(hover, state, true);
    expect(root.style.display).toBe('none');
  });

  it('is hidden for a surveyed tile while the survey overlay is hidden', () => {
    const { tag, root } = makeTag();
    const state = makeState();
    addSurvey(state);
    const hover: PickResult = { entity: null, terrain: { point: new THREE.Vector3(), tileX: 12, tileZ: 8, distance: 1 } };
    tag.update(hover, state, false);
    expect(root.style.display).toBe('none');
  });

  it('hides a showing tag when the overlay is toggled off', () => {
    const { tag, root } = makeTag();
    const state = makeState();
    addSurvey(state);
    const hover: PickResult = { entity: null, terrain: { point: new THREE.Vector3(), tileX: 12, tileZ: 8, distance: 1 } };
    tag.update(hover, state, true);
    expect(root.style.display).not.toBe('none');
    tag.update(hover, state, false);
    expect(root.style.display).toBe('none');
  });

  it('root element has id bs-hover-tag', () => {
    const { root } = makeTag();
    expect(root.id).toBe('bs-hover-tag');
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

    tag.update(hover, state, true);
    expect(root.textContent).toContain('65%');
  });

  it('shows FRESH for a survey with no stale flag', () => {
    const { tag, root } = makeTag();
    const state = makeState();
    state.surveyResults.push({
      id: 1, method: 'seismic', centerX: 12, centerZ: 8, completedTick: state.tickCount,
      surveyorId: 1, confidence: 0.8,
      estimates: { '12,8': { grumpite: 0.65 } },
    });
    const hover: PickResult = { entity: null, terrain: { point: new THREE.Vector3(), tileX: 12, tileZ: 8, distance: 1 } };

    tag.update(hover, state, true);
    expect(root.textContent).toContain('FRESH');
  });

  it('shows FRESH for an old survey no blast has touched, at any tick (#1356)', () => {
    const { tag, root } = makeTag();
    const state = makeState();
    state.surveyResults.push({
      id: 1, method: 'seismic', centerX: 12, centerZ: 8, completedTick: 0,
      surveyorId: 1, confidence: 0.8,
      estimates: { '12,8': { grumpite: 0.65 } },
    });
    state.tickCount = 100000;
    const hover: PickResult = { entity: null, terrain: { point: new THREE.Vector3(), tileX: 12, tileZ: 8, distance: 1 } };

    tag.update(hover, state, true);
    expect(root.textContent).toContain('FRESH');
    expect(root.textContent).not.toContain('STALE');
  });

  it('shows STALE for a survey carrying the stale flag (#1356)', () => {
    const { tag, root } = makeTag();
    const state = makeState();
    state.surveyResults.push({
      id: 1, method: 'seismic', centerX: 12, centerZ: 8, completedTick: state.tickCount,
      surveyorId: 1, confidence: 0.8, stale: true,
      estimates: { '12,8': { grumpite: 0.65 } },
    });
    const hover: PickResult = { entity: null, terrain: { point: new THREE.Vector3(), tileX: 12, tileZ: 8, distance: 1 } };

    tag.update(hover, state, true);
    expect(root.textContent).toContain('STALE');
  });

  it('shows each depth band of a surveyed column with its ore (#1683)', () => {
    const { tag, root } = makeTag();
    const state = makeState();
    state.surveyResults.push({
      id: 1, method: 'seismic', centerX: 12, centerZ: 8, completedTick: state.tickCount,
      surveyorId: 1, confidence: 0.8,
      estimates: { '12,8': { grumpite: 0.65 } },
      depthProfile: { '12,8': [
        { fromM: 5, toM: 10, ores: { grumpite: 0.4 } },
        { fromM: 10, toM: 15, ores: { grumpite: 0.65 } },
      ] },
    });
    const hover: PickResult = { entity: null, terrain: { point: new THREE.Vector3(), tileX: 12, tileZ: 8, distance: 1 } };

    tag.update(hover, state, true);
    expect(root.textContent).toContain('5-10 m');
    expect(root.textContent).toContain('10-15 m');
    expect(root.textContent).toContain('65%');
  });

  it('shows 1 m core-sample bands as given (#1683)', () => {
    const { tag, root } = makeTag();
    const state = makeState();
    state.surveyResults.push({
      id: 1, method: 'core_sample', centerX: 12, centerZ: 8, completedTick: state.tickCount,
      surveyorId: 1, confidence: 0.95,
      estimates: { '12,8': { grumpite: 0.5 } },
      depthProfile: { '12,8': [{ fromM: 10, toM: 11, ores: { grumpite: 0.5 } }] },
    });
    const hover: PickResult = { entity: null, terrain: { point: new THREE.Vector3(), tileX: 12, tileZ: 8, distance: 1 } };

    tag.update(hover, state, true);
    expect(root.textContent).toContain('10-11 m');
  });

  it('shows no depth bands when the survey carries no depth profile (#1683)', () => {
    const { tag, root } = makeTag();
    const state = makeState();
    state.surveyResults.push({
      id: 1, method: 'seismic', centerX: 12, centerZ: 8, completedTick: state.tickCount,
      surveyorId: 1, confidence: 0.8,
      estimates: { '12,8': { grumpite: 0.65 } },
    });
    const hover: PickResult = { entity: null, terrain: { point: new THREE.Vector3(), tileX: 12, tileZ: 8, distance: 1 } };

    tag.update(hover, state, true);
    expect(root.textContent).toContain('65%');
    expect(root.textContent).toContain('FRESH');
    expect(root.textContent).not.toMatch(/\d+-\d+ m/);
  });

  it('hide() hides the tag', () => {
    const { tag, root } = makeTag();
    const hover: PickResult = { entity: null, terrain: { point: new THREE.Vector3(), tileX: 1, tileZ: 1, distance: 1 } };
    tag.update(hover, makeState(), true);
    tag.hide();
    expect(root.style.display).toBe('none');
  });

  it('dispose() removes the tag from the DOM', () => {
    const { tag, root, container } = makeTag();
    tag.dispose();
    expect(container.contains(root)).toBe(false);
  });
});
