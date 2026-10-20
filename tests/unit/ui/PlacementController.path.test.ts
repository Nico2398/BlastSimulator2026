// @vitest-environment jsdom
// BlastSimulator2026 — PlacementController 'path' shape (#1942): clicks add cardinal-snapped waypoints.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { PlacementController } from '../../../src/ui/scene/PlacementController.js';
import { setPickerRegion } from '../../../src/ui/tutorialPickerRegion.js';

let tileUnderCursor: { x: number; z: number } | null = null;

vi.mock('../../../src/ui/scene/ScenePicking.js', () => ({
  pickScene: () => (tileUnderCursor
    ? { terrain: { tileX: tileUnderCursor.x, tileZ: tileUnderCursor.z } }
    : { terrain: null }),
}));

let canvas: HTMLCanvasElement;
let controller: PlacementController;
const cameraController = { setArmedRemap: vi.fn(), rightButtonDragged: false };

function down(x: number, z: number): void {
  tileUnderCursor = { x, z };
  canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 1, clientY: 1, bubbles: true }));
}
function up(x: number, z: number): void {
  tileUnderCursor = { x, z };
  window.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 1, clientY: 1, bubbles: true }));
}
/** A plain click: press and release on one tile. */
function click(x: number, z: number): void { down(x, z); up(x, z); }

beforeEach(() => {
  setPickerRegion(null);
  tileUnderCursor = null;
  canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  controller = new PlacementController(canvas, new THREE.PerspectiveCamera(), {} as never, cameraController as never);
  controller.arm({ shape: 'path' });
});

afterEach(() => {
  controller.dispose();
  canvas.remove();
  setPickerRegion(null);
});

describe("PlacementController 'path' shape (#1942)", () => {
  it('reports the path shape and starts with no waypoints', () => {
    expect(controller.currentShape).toBe('path');
    expect(controller.waypoints).toEqual([]);
  });

  it('mousedown pushes the first waypoint', () => {
    down(5, 5);
    expect(controller.waypoints).toEqual([{ x: 5, z: 5 }]);
  });

  it('a same-tile click (down and up on one tile) leaves exactly one waypoint', () => {
    click(5, 5);
    expect(controller.waypoints).toEqual([{ x: 5, z: 5 }]);
  });

  it('a plain drag A to B ends with waypoints [A, B] and the selection first/last unchanged', () => {
    down(5, 5);
    up(5, 25);
    expect(controller.waypoints).toEqual([{ x: 5, z: 5 }, { x: 5, z: 25 }]);
    expect(controller.selection).toEqual({ x1: 5, z1: 5, x2: 5, z2: 25 });
    expect(controller.currentPhase).toBe('selected');
  });

  it('a drag ending off-axis pushes the cardinal-snapped end tile', () => {
    down(5, 5);
    up(8, 25);
    expect(controller.waypoints).toEqual([{ x: 5, z: 5 }, { x: 5, z: 25 }]);
  });

  it('later clicks add waypoints, each snapped to the previous one', () => {
    click(5, 5);
    click(5, 20);
    click(14, 22); // dominant axis x from (5,20) -> (14,20)
    expect(controller.waypoints).toEqual([{ x: 5, z: 5 }, { x: 5, z: 20 }, { x: 14, z: 20 }]);
  });

  it('selection spans the first and last waypoint', () => {
    click(5, 5);
    click(5, 20);
    click(14, 20);
    expect(controller.selection).toEqual({ x1: 5, z1: 5, x2: 14, z2: 20 });
  });

  it('clicking the last waypoint tile again is ignored', () => {
    click(5, 5);
    click(5, 20);
    click(5, 20);
    expect(controller.waypoints).toEqual([{ x: 5, z: 5 }, { x: 5, z: 20 }]);
  });

  it('popWaypoint drops the last corner', () => {
    click(5, 5);
    click(5, 20);
    click(14, 20);
    controller.popWaypoint();
    expect(controller.waypoints).toEqual([{ x: 5, z: 5 }, { x: 5, z: 20 }]);
    expect(controller.selection).toEqual({ x1: 5, z1: 5, x2: 5, z2: 20 });
  });

  it('popWaypoint on an empty path is a no-op', () => {
    expect(() => controller.popWaypoint()).not.toThrow();
    expect(controller.waypoints).toEqual([]);
  });

  it('Backspace undoes a corner', () => {
    click(5, 5);
    click(5, 20);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(controller.waypoints).toEqual([{ x: 5, z: 5 }]);
  });

  it('Backspace typed in a text field leaves the path alone', () => {
    click(5, 5);
    click(5, 20);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    input.remove();
    expect(controller.waypoints).toEqual([{ x: 5, z: 5 }, { x: 5, z: 20 }]);
  });

  it('notifies the change handler when a corner is added and when one is undone', () => {
    const onChange = vi.fn();
    controller.setChangeHandler(onChange);
    click(5, 5);
    onChange.mockClear();
    click(5, 20);
    expect(onChange).toHaveBeenCalled();
    onChange.mockClear();
    controller.popWaypoint();
    expect(onChange).toHaveBeenCalled();
  });

  it('cancel clears the waypoints', () => {
    click(5, 5);
    click(5, 20);
    controller.cancel();
    expect(controller.waypoints).toEqual([]);
  });

  it('re-arming starts a fresh path', () => {
    click(5, 5);
    controller.cancel();
    controller.arm({ shape: 'path' });
    expect(controller.waypoints).toEqual([]);
  });

  it('a rect shape never records waypoints', () => {
    controller.cancel();
    controller.arm({ shape: 'rect' });
    down(5, 5);
    up(9, 9);
    expect(controller.waypoints).toEqual([]);
  });
});
