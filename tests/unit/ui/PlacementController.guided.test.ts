// @vitest-environment jsdom
// BlastSimulator2026 — Guided placement: snapping and refusal feedback (#489)
//
// The reported failure was a highlighted tile that "does not respond to
// clicks", followed by "some are accepted and some are blocked without clear
// visual indication". Both come from the same place: a click the region
// refused returned in silence, and a region that demanded exact corners could
// not be satisfied by a pick a player is able to make. These tests hold the
// two guarantees that replaced that — any live click lands on the answer, and
// a refused click says so.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { PlacementController } from '../../../src/ui/scene/PlacementController.js';
import {
  setPickerRegion, liveArea, regionCenter, regionSpan, EXACT_LIVE_MARGIN,
} from '../../../src/ui/tutorialPickerRegion.js';
import type { ClaimRefusalReason } from '../../../src/core/world/PlayableArea.js';

const EXACT = { x1: 20, z1: 20, x2: 30, z2: 30, exact: true };
const AREA = { x1: 20, z1: 20, x2: 30, z2: 30 };

/** Tile the fake raycast will report next. Null stands for "the pointer is off the terrain". */
let tileUnderCursor: { x: number; z: number } | null = null;

vi.mock('../../../src/ui/scene/ScenePicking.js', () => ({
  pickScene: () => (tileUnderCursor
    ? { terrain: { tileX: tileUnderCursor.x, tileZ: tileUnderCursor.z } }
    : { terrain: null }),
}));

let canvas: HTMLCanvasElement;
let controller: PlacementController;

/**
 * Minimal CameraController surface — arm/disarm only calls setArmedRemap.
 * `rightButtonDragged` backs the #544 right-drag-vs-right-click cancel guard;
 * tests flip it directly rather than simulating real mouse gestures, mirroring
 * how `setArmedRemap` is already a bare spy rather than a real remap.
 */
const cameraController = { setArmedRemap: vi.fn(), rightButtonDragged: false };

function press(x: number, z: number): void {
  tileUnderCursor = { x, z };
  canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 1, clientY: 1, bubbles: true }));
}

function release(x: number, z: number): void {
  tileUnderCursor = { x, z };
  canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 1, clientY: 1, bubbles: true }));
}

function hover(x: number, z: number): void {
  tileUnderCursor = { x, z };
  canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1, bubbles: true }));
}

beforeEach(() => {
  setPickerRegion(null);
  tileUnderCursor = null;
  cameraController.rightButtonDragged = false;
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

describe('an exact region is the answer, not a target to reproduce', () => {
  it('a drag that covers only part of the region still confirms the whole region', () => {
    setPickerRegion(EXACT);
    controller.arm({ shape: 'rect' });

    press(22, 22);
    release(26, 26);

    expect(controller.selection).toEqual({ x1: 20, z1: 20, x2: 30, z2: 30 });
    expect(controller.canConfirm).toBe(true);
  });

  it('a single click inside the region is enough', () => {
    setPickerRegion(EXACT);
    controller.arm({ shape: 'rect' });

    press(25, 25);

    expect(controller.selection).toEqual({ x1: 20, z1: 20, x2: 30, z2: 30 });
    expect(controller.canConfirm).toBe(true);
  });

  it('a one-tile region snaps a point pick onto that tile', () => {
    setPickerRegion({ x1: 23, z1: 23, x2: 23, z2: 23, exact: true });
    controller.arm({ shape: 'point' });

    press(21, 24); // near it, not on it — the pick a player can actually land

    expect(controller.selection).toEqual({ x1: 23, z1: 23, x2: 23, z2: 23 });
    expect(controller.canConfirm).toBe(true);
  });

  it('a line region snaps to its own endpoints, so only one ramp can be dug', () => {
    setPickerRegion({ x1: 16, z1: 19, x2: 16, z2: 31, exact: true });
    controller.arm({ shape: 'line' });

    press(18, 22);
    release(15, 28);

    expect(controller.selection).toEqual({ x1: 16, z1: 19, x2: 16, z2: 31 });
    expect(controller.canConfirm).toBe(true);
  });

  it('leaves an unconstrained placement free-form', () => {
    controller.arm({ shape: 'rect' });

    press(3, 3);
    release(7, 9);

    expect(controller.selection).toEqual({ x1: 3, z1: 3, x2: 7, z2: 9 });
    expect(controller.canConfirm).toBe(true);
  });

  it('still refuses a non-matching selection when the region is not exact', () => {
    setPickerRegion(AREA);
    controller.arm({ shape: 'rect' });

    press(22, 22);
    release(26, 26);

    expect(controller.selection).toEqual({ x1: 22, z1: 22, x2: 26, z2: 26 });
    expect(controller.canConfirm).toBe(true); // inside the area is enough here
  });
});

describe('a refused click says so', () => {
  it('marks the tile instead of returning in silence', () => {
    setPickerRegion(EXACT);
    controller.arm({ shape: 'rect' });

    press(2, 2);

    expect(controller.selection).toBeNull();
    expect(controller.canConfirm).toBe(false);
    expect(controller.refusedTile).toEqual({ x: 2, z: 2 });
  });

  it('notifies on the refusal, so the strip and overlay can redraw', () => {
    setPickerRegion(EXACT);
    const onChange = vi.fn();
    controller.arm({ shape: 'rect' });
    controller.setChangeHandler(onChange);

    press(2, 2);

    expect(onChange).toHaveBeenCalled();
  });

  it('marks a hovered tile outside the area too', () => {
    setPickerRegion(EXACT);
    controller.arm({ shape: 'rect' });

    hover(2, 2);
    expect(controller.refusedTile).toEqual({ x: 2, z: 2 });

    hover(25, 25);
    expect(controller.refusedTile).toBeNull();
  });

  it('clears the mark on disarm', () => {
    setPickerRegion(EXACT);
    controller.arm({ shape: 'rect' });
    press(2, 2);

    controller.disarm();

    expect(controller.refusedTile).toBeNull();
  });

  it('never refuses anything when no step is guiding the placement', () => {
    controller.arm({ shape: 'rect' });
    hover(0, 0);
    expect(controller.refusedTile).toBeNull();
  });

  it('fires the feedback handler independently of whichever panel armed the tool', () => {
    const feedback = vi.fn();
    controller.setFeedbackHandler(feedback);
    setPickerRegion(EXACT);
    controller.arm({ shape: 'rect' });
    // A panel replaces the change handler on every arm; the feedback slot must survive that.
    controller.setChangeHandler(() => {});

    press(2, 2);

    expect(feedback).toHaveBeenCalled();
  });
});

describe('the pre-filled selection a panel opens with', () => {
  it('is dropped while a step is guiding the placement', () => {
    // SurveyPanel pre-fills the middle of the map. Every guided region sits
    // away from it, so the strip used to open showing a tile the step would
    // never accept and a Confirm dead before the player touched anything.
    // Dropping it — rather than clamping it into the region — also leaves the
    // player the pick the step is actually teaching.
    setPickerRegion({ x1: 23, z1: 23, x2: 23, z2: 23, exact: true });
    controller.arm({ shape: 'point', initialSelection: { x: 16, z: 16 } });

    expect(controller.selection).toBeNull();
    expect(controller.canConfirm).toBe(false);

    press(22, 24);
    expect(controller.selection).toEqual({ x1: 23, z1: 23, x2: 23, z2: 23 });
    expect(controller.canConfirm).toBe(true);
  });

  it('is left alone when nothing is guiding the placement', () => {
    controller.arm({ shape: 'point', initialSelection: { x: 16, z: 16 } });
    expect(controller.selection).toEqual({ x1: 16, z1: 16, x2: 16, z2: 16 });
  });
});

describe('cancel via right-click vs right-drag (#544)', () => {
  function contextmenu(): MouseEvent {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    canvas.dispatchEvent(event);
    return event;
  }

  it('a right-drag that orbited the camera leaves an armed tool untouched', () => {
    setPickerRegion(EXACT);
    controller.arm({ shape: 'rect' });
    press(25, 25);
    const onCancel = vi.fn();
    controller.setCancelHandler(onCancel);
    const phaseBefore = controller.currentPhase;
    const selectionBefore = controller.selection;

    cameraController.rightButtonDragged = true;
    // Real (measured) gesture order: mousedown(2) -> contextmenu -> mousemove(s)
    // -> mouseup(2). contextmenu fires immediately after mousedown, before any
    // movement, so the tool is still armed when it arrives and preventDefault()
    // is called. mouseup arrives last, once rightButtonDragged is already true,
    // so onMouseUp's button-2 branch skips cancel (#544).
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, clientX: 1, clientY: 1, bubbles: true }));
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    canvas.dispatchEvent(event);
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 5, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('mouseup', { button: 2, clientX: 5, clientY: 5, bubbles: true }));

    expect(controller.isArmed).toBe(true);
    expect(controller.currentPhase).toBe(phaseBefore);
    expect(controller.selection).toEqual(selectionBefore);
    expect(onCancel).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalled();
  });

  it('a right-click with no camera movement still cancels the armed tool', () => {
    setPickerRegion(EXACT);
    controller.arm({ shape: 'rect' });
    const onCancel = vi.fn();
    controller.setCancelHandler(onCancel);

    cameraController.rightButtonDragged = false;
    // Real (measured) gesture order: mousedown(2) -> contextmenu -> mouseup(2).
    // contextmenu fires right after mousedown, before mouseup, so the tool is
    // still armed at that point — onContextMenu's idle/confirmed early-return
    // does NOT trigger, and preventDefault() IS called. The cancel decision
    // itself still lives in onMouseUp for button 2 (#544): mouseup arrives
    // last, rightButtonDragged is false, so onMouseUp's button-2 branch calls
    // cancel() and the tool ends up disarmed anyway — just via mouseup, not
    // via contextmenu.
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, clientX: 1, clientY: 1, bubbles: true }));
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    canvas.dispatchEvent(event);
    canvas.dispatchEvent(new MouseEvent('mouseup', { button: 2, clientX: 1, clientY: 1, bubbles: true }));

    expect(controller.isArmed).toBe(false);
    expect(onCancel).toHaveBeenCalledTimes(1);
    // The tool was still armed when contextmenu fired (mouseup hasn't run
    // yet), so onContextMenu's early-return did not trigger and it called
    // preventDefault() on its way through — the cancellation itself happens
    // afterward, at mouseup.
    expect(preventDefault).toHaveBeenCalled();
  });

  it('Escape still cancels an armed tool regardless of rightButtonDragged', () => {
    setPickerRegion(EXACT);
    controller.arm({ shape: 'rect' });
    const onCancel = vi.fn();
    controller.setCancelHandler(onCancel);

    // Set true to prove Escape's path never even consults it — a regression
    // lock on the unchanged path, not a new behavior.
    cameraController.rightButtonDragged = true;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(controller.isArmed).toBe(false);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('a contextmenu while idle is a no-op regardless of rightButtonDragged', () => {
    const onCancel = vi.fn();
    controller.setCancelHandler(onCancel);
    cameraController.rightButtonDragged = true;

    contextmenu();

    expect(controller.currentPhase).toBe('idle');
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('the claim check (#558) — refusal feedback separate from a tutorial region', () => {
  it('lets the callback see the tile and confirms when it reports no refusal', () => {
    // No tutorial region is pinned in this suite's beforeEach, so nothing but
    // the claim check itself is in a position to refuse this tile.
    const claimCheck = vi.fn((): ClaimRefusalReason | null => null);
    controller.setClaimCheck(claimCheck);
    controller.arm({ shape: 'point' });

    press(50, 50);

    expect(claimCheck).toHaveBeenCalledWith(50, 50);
    expect(controller.selection).toEqual({ x1: 50, z1: 50, x2: 50, z2: 50 });
    expect(controller.canConfirm).toBe(true);
    expect(controller.refusalReason).toBeNull();
  });

  it('refuses confirm and reports the reason when the claim check refuses the tile', () => {
    controller.setClaimCheck(() => 'protected_structure');
    controller.arm({ shape: 'point' });

    press(50, 50);

    expect(controller.refusalReason).toBe('protected_structure');
    expect(controller.canConfirm).toBe(false);
  });
});

describe('live area', () => {
  it('grows an exact region so a player does not have to thread a needle', () => {
    expect(liveArea(EXACT)).toEqual({
      x1: 20 - EXACT_LIVE_MARGIN, z1: 20 - EXACT_LIVE_MARGIN,
      x2: 30 + EXACT_LIVE_MARGIN, z2: 30 + EXACT_LIVE_MARGIN,
    });
  });

  it('leaves a suggestion area exactly as published', () => {
    expect(liveArea(AREA)).toEqual({ x1: 20, z1: 20, x2: 30, z2: 30 });
  });

  it('reports a centre and a span for framing the camera on the target', () => {
    expect(regionCenter(EXACT)).toEqual({ x: 25, z: 25 });
    expect(regionSpan(EXACT)).toBe(11);
    expect(regionSpan({ x1: 4, z1: 4, x2: 4, z2: 4 })).toBe(1);
  });
});
