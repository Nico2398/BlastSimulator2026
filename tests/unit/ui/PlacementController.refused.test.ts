// @vitest-environment jsdom
// BlastSimulator2026 — the refused-click hook: the audio layer buzzes for a placement click that is turned down,
// never for a hover over a refused tile (the feedback handler fires for both).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { PlacementController } from '../../../src/ui/scene/PlacementController.js';
import { setPickerRegion } from '../../../src/ui/tutorialPickerRegion.js';
import type { ClaimRefusalReason } from '../../../src/core/world/PlayableArea.js';

let tileUnderCursor: { x: number; z: number } | null = null;

vi.mock('../../../src/ui/scene/ScenePicking.js', () => ({
  pickScene: () => (tileUnderCursor
    ? { terrain: { tileX: tileUnderCursor.x, tileZ: tileUnderCursor.z } }
    : { terrain: null }),
}));

let canvas: HTMLCanvasElement;
let controller: PlacementController;
const cameraController = { setArmedRemap: vi.fn(), rightButtonDragged: false };

function pointerAt(type: 'mousedown' | 'mousemove', x: number, z: number): void {
  tileUnderCursor = { x, z };
  canvas.dispatchEvent(new MouseEvent(type, { button: 0, clientX: 1, clientY: 1, bubbles: true }));
}

beforeEach(() => {
  setPickerRegion(null);
  tileUnderCursor = null;
  canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  controller = new PlacementController(canvas, new THREE.PerspectiveCamera(), {} as never, cameraController as never);
  controller.arm({ shape: 'rect' });
});

afterEach(() => {
  controller.dispose();
  canvas.remove();
  setPickerRegion(null);
});

describe('PlacementController refused handler', () => {
  it('fires once for a click on a tile whose claim is refused', () => {
    const refused = vi.fn();
    controller.setRefusedHandler(refused);
    controller.setClaimCheck((): ClaimRefusalReason | null => 'protected_structure');

    pointerAt('mousedown', 4, 4);

    expect(refused).toHaveBeenCalledTimes(1);
    expect(controller.refusedTile).toEqual({ x: 4, z: 4 });
  });

  it('does not fire for a hover over a refused tile, although the feedback handler does', () => {
    const refused = vi.fn();
    const feedback = vi.fn();
    controller.setRefusedHandler(refused);
    controller.setFeedbackHandler(feedback);
    controller.setClaimCheck((): ClaimRefusalReason | null => 'protected_structure');

    pointerAt('mousemove', 4, 4);

    expect(controller.refusedTile).toEqual({ x: 4, z: 4 });
    expect(feedback).toHaveBeenCalled();
    expect(refused).not.toHaveBeenCalled();
  });

  it('does not fire for an accepted click', () => {
    const refused = vi.fn();
    controller.setRefusedHandler(refused);

    pointerAt('mousedown', 4, 4);

    expect(controller.currentPhase).toBe('dragging');
    expect(refused).not.toHaveBeenCalled();
  });

  it('fires for a click off the terrain', () => {
    const refused = vi.fn();
    controller.setRefusedHandler(refused);
    tileUnderCursor = null;
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 1, clientY: 1, bubbles: true }));

    expect(refused).toHaveBeenCalledTimes(1);
  });

  it('fires for a refused harness pick (paintRect), like the pointer path', () => {
    const refused = vi.fn();
    controller.setRefusedHandler(refused);
    controller.setClaimCheck((): ClaimRefusalReason | null => 'protected_structure');

    controller.paintRect(2, 2, 5, 5);

    expect(refused).toHaveBeenCalledTimes(1);
  });

  it('stays quiet once the handler is removed', () => {
    const refused = vi.fn();
    controller.setRefusedHandler(refused);
    controller.setRefusedHandler(null);
    controller.setClaimCheck((): ClaimRefusalReason | null => 'protected_structure');

    pointerAt('mousedown', 4, 4);

    expect(refused).not.toHaveBeenCalled();
  });
});
