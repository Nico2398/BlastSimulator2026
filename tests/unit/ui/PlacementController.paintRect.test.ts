// @vitest-environment jsdom
// BlastSimulator2026 — paintRect must run the same tile checks the real
// pointer path does (#1045).
//
// paintRect is the window.__placement bridge the scenario harness drives
// through pickTile/dragTiles (scripts/shared/interaction-executor.ts). It
// sets anchor/current/phase directly and — before this fix — ran NEITHER of
// the two refusal predicates onMouseMove/onMouseDown run: claimCheck
// (site-claim ownership) and footprintCheck (ground levelness). So a
// harness-driven tile pick never got refused, even on a tile the pointer
// path would block: canConfirm stayed true and the strip showed no refusal.
//
// These tests hold that paintRect(x1, z1, x2, z2) must evaluate both
// predicates against the anchor tile (x1, z1) only — never (x2, z2), never
// per-tile across the rect — before setting phase/selection, and must be a
// true no-op while idle/confirmed.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { PlacementController } from '../../../src/ui/scene/PlacementController.js';
import { setPickerRegion } from '../../../src/ui/tutorialPickerRegion.js';
import type { ClaimRefusalReason } from '../../../src/core/world/PlayableArea.js';

/** Tile the fake raycast will report next. Null stands for "off the terrain". */
let tileUnderCursor: { x: number; z: number } | null = null;

vi.mock('../../../src/ui/scene/ScenePicking.js', () => ({
  pickScene: () => (tileUnderCursor
    ? { terrain: { tileX: tileUnderCursor.x, tileZ: tileUnderCursor.z } }
    : { terrain: null }),
}));

let canvas: HTMLCanvasElement;
let controller: PlacementController;

/** Minimal CameraController surface, mirroring PlacementController.guided.test.ts. */
const cameraController = { setArmedRemap: vi.fn(), rightButtonDragged: false };

function press(x: number, z: number): void {
  tileUnderCursor = { x, z };
  canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 1, clientY: 1, bubbles: true }));
}

beforeEach(() => {
  setPickerRegion(null);
  tileUnderCursor = null;
  cameraController.rightButtonDragged = false;
  cameraController.setArmedRemap.mockClear();
  canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  controller = new PlacementController(
    canvas,
    new THREE.PerspectiveCamera(),
    {} as never,
    cameraController as never,
  );
});

afterEach(() => {
  controller.dispose();
  canvas.remove();
  setPickerRegion(null);
});

describe('paintRect runs the claim check against the anchor tile (#1045)', () => {
  it('refuses when claimCheck refuses (x1, z1): reason set, cannot confirm, phase unchanged, footprint untouched', () => {
    controller.arm({ shape: 'rect' });
    const phaseBefore = controller.currentPhase;
    const claimCheck = vi.fn((): ClaimRefusalReason | null => 'protected_structure');
    controller.setClaimCheck(claimCheck);

    controller.paintRect(10, 10, 14, 16);

    expect(controller.refusalReason).toBe('protected_structure');
    expect(controller.canConfirm).toBe(false);
    expect(controller.currentPhase).toBe(phaseBefore);
    expect(controller.currentPhase).not.toBe('selected');
    expect(controller.footprintInvalid).toBe(false);
  });
});

describe('paintRect runs the footprint check against the anchor tile (#1045)', () => {
  it('refuses when footprintCheck refuses (x1, z1): footprint invalid, selected but not confirmable, no claim reason', () => {
    controller.arm({ shape: 'rect' });
    controller.setFootprintCheck(() => false);

    controller.paintRect(5, 5, 7, 9);

    expect(controller.currentPhase).toBe('selected');
    expect(controller.selection).toEqual({ x1: 5, z1: 5, x2: 7, z2: 9 });
    expect(controller.footprintInvalid).toBe(true);
    expect(controller.refusalReason).toBeNull();
    expect(controller.canConfirm).toBe(false);
  });
});

describe('paintRect accepts when both checks accept the anchor tile (#1045)', () => {
  it('enters selected, confirmable, with no refusal and no footprint failure — predicates unset', () => {
    controller.arm({ shape: 'rect' });

    controller.paintRect(2, 3, 6, 8);

    expect(controller.currentPhase).toBe('selected');
    expect(controller.footprintInvalid).toBe(false);
    expect(controller.refusalReason).toBeNull();
    expect(controller.canConfirm).toBe(true);
  });

  it('enters selected, confirmable, with no refusal and no footprint failure — predicates set and accepting', () => {
    controller.arm({ shape: 'rect' });
    controller.setClaimCheck(() => null);
    controller.setFootprintCheck(() => true);

    controller.paintRect(2, 3, 6, 8);

    expect(controller.currentPhase).toBe('selected');
    expect(controller.footprintInvalid).toBe(false);
    expect(controller.refusalReason).toBeNull();
    expect(controller.canConfirm).toBe(true);
  });
});

describe('paintRect is a no-op outside armed/dragging/hovering/selected (#1045)', () => {
  it('does nothing while idle: neither predicate fires, state stays untouched', () => {
    const claimCheck = vi.fn((): ClaimRefusalReason | null => null);
    const footprintCheck = vi.fn((): boolean => true);
    controller.setClaimCheck(claimCheck);
    controller.setFootprintCheck(footprintCheck);
    expect(controller.currentPhase).toBe('idle');

    controller.paintRect(1, 1, 3, 3);

    expect(claimCheck).not.toHaveBeenCalled();
    expect(footprintCheck).not.toHaveBeenCalled();
    expect(controller.currentPhase).toBe('idle');
    expect(controller.selection).toBeNull();
  });

  it('does nothing while confirmed: neither predicate fires, phase stays confirmed', () => {
    controller.arm({ shape: 'point' });
    press(4, 4); // real pointer path -> 'selected', no claim/footprint check installed yet
    expect(controller.currentPhase).toBe('selected');
    controller.confirm();
    expect(controller.currentPhase).toBe('confirmed');

    const claimCheck = vi.fn((): ClaimRefusalReason | null => null);
    const footprintCheck = vi.fn((): boolean => true);
    controller.setClaimCheck(claimCheck);
    controller.setFootprintCheck(footprintCheck);

    controller.paintRect(9, 9, 11, 11);

    expect(claimCheck).not.toHaveBeenCalled();
    expect(footprintCheck).not.toHaveBeenCalled();
    expect(controller.currentPhase).toBe('confirmed');
  });
});

describe('paintRect evaluates each predicate exactly once, against (x1, z1) only (#1045)', () => {
  it('never checks (x2, z2) or any tile in between on a rect-shaped drag', () => {
    controller.arm({ shape: 'rect' });
    const claimCheck = vi.fn((): ClaimRefusalReason | null => null);
    const footprintCheck = vi.fn((): boolean => true);
    controller.setClaimCheck(claimCheck);
    controller.setFootprintCheck(footprintCheck);

    controller.paintRect(3, 4, 9, 12);

    expect(claimCheck).toHaveBeenCalledTimes(1);
    expect(claimCheck).toHaveBeenCalledWith(3, 4);
    expect(claimCheck).not.toHaveBeenCalledWith(9, 12);
    expect(footprintCheck).toHaveBeenCalledTimes(1);
    expect(footprintCheck).toHaveBeenCalledWith(3, 4);
    expect(footprintCheck).not.toHaveBeenCalledWith(9, 12);
  });
});
