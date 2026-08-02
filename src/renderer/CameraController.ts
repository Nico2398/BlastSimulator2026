// BlastSimulator2026 — Camera Controller
// Ground-anchored management-game camera for the mine overview.
// - Left-drag: rotate the view around the point being looked at
// - Right-drag or Middle-drag: pan, always in a horizontal plane
// - Scroll: change camera height — see "The height model" below
// - Touch: pinch to change height, single-finger rotate

import * as THREE from 'three';
import type { Rect } from '../core/world/WorldGen.js';

// ---------------------------------------------------------------------------
// The height model
//
// The camera is described by the ground point it looks at, a yaw, and a
// HEIGHT above that point — not by an orbit radius. Scrolling changes the
// height, and two things follow from it:
//
//   - Pitch is derived from height, not controlled separately. High up the
//     view tips toward top-down; down low it flattens toward the horizon, so
//     close-up work is seen from a natural near-ground angle. This is the
//     usual management-game feel.
//   - Descending also moves the camera FORWARD along its own view axis, so
//     zooming reads as flying in toward what you were looking at rather than
//     riding an elevator straight down.
//
// The target's Y never moves on its own: panning slides it across a
// horizontal plane and zooming slides it along that same plane. An earlier
// version panned along the camera's local up vector, which has a Y component
// whenever the camera is tilted — that walked the look-at point up into the
// sky a little on every drag, and nothing clamped it back down (the pan leash
// bounds X and Z only). The view ended up stranded above the world with the
// ground out of reach.
// ---------------------------------------------------------------------------

/** Camera height above its ground target, metres. Spans a whole 160x160 level down to drill-hole close-up. */
const HEIGHT_MIN = 6;
const HEIGHT_MAX = 900;
/** Fraction of current height gained or lost per scroll tick. */
const ZOOM_SPEED = 0.12;

/** Pitch above the horizon at HEIGHT_MIN and at HEIGHT_MAX (degrees). */
const PITCH_LOW_DEG = 16;
const PITCH_HIGH_DEG = 78;

const ORBIT_SPEED = 0.005; // radians per pixel

// Scales with height so panning feels consistent at every zoom level
const PAN_SPEED_FACTOR = 0.001;

// Default framing: view distance as a multiple of the site's horizontal span.
// At FOV 55° this keeps the whole pit on screen with a comfortable margin.
const FRAME_DISTANCE_FACTOR = 1.15;

/** Below this the view direction is too flat to solve a forward dolly against. */
const MIN_FORWARD_DIP = 1e-3;

/**
 * Pitch (radians above the horizon) for a given camera height.
 *
 * Interpolated in LOG height, because zooming is multiplicative — a constant
 * fraction per scroll tick. Log space makes each tick advance the tilt by the
 * same amount, so the tilt sweep feels even across the whole range instead of
 * spending almost all of it near the top.
 */
export function pitchForHeight(height: number): number {
  const t = THREE.MathUtils.clamp(
    Math.log(height / HEIGHT_MIN) / Math.log(HEIGHT_MAX / HEIGHT_MIN),
    0,
    1,
  );
  return THREE.MathUtils.degToRad(PITCH_LOW_DEG + (PITCH_HIGH_DEG - PITCH_LOW_DEG) * t);
}

/**
 * Height whose derived pitch puts the target `distance` metres away.
 *
 * radius = height / sin(pitch(height)) has height on both sides, so it is
 * solved by fixed-point iteration. The map contracts across the whole pitch
 * range, so a couple of dozen passes land well inside float precision.
 */
export function heightForViewDistance(distance: number): number {
  const wanted = Math.max(distance, HEIGHT_MIN);
  let h = THREE.MathUtils.clamp(wanted * 0.7, HEIGHT_MIN, HEIGHT_MAX);
  for (let i = 0; i < 24; i++) {
    h = THREE.MathUtils.clamp(wanted * Math.sin(pitchForHeight(h)), HEIGHT_MIN, HEIGHT_MAX);
  }
  return h;
}

// ---------- Touch helpers ----------
function touchDistance(a: Touch, b: Touch): number {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private target: THREE.Vector3;
  private canvas: HTMLElement;

  /** Camera height above `target`, metres — the single zoom parameter. */
  private height: number;
  /** Rotation about the vertical axis, radians. */
  private yaw: number;

  /**
   * Explicit pitch for scripted shots (screenshots, scenario multi-angle
   * captures), which need to name an angle the height model would never pick.
   * Null in normal play; any player input clears it and hands control back to
   * the height model. While set, `shotRadius` is the orbit distance.
   */
  private pitchOverride: number | null = null;
  private shotRadius: number;

  private defaultTarget: THREE.Vector3;
  private defaultHeight: number;
  private defaultYaw: number;

  /**
   * Soft leash on manual camera movement — the landscape beyond the playable
   * rect is viewable but not the play focus, so dragging or zooming shouldn't
   * wander off into it indefinitely (#458 T6.1/D13). Null until a grid loads.
   * Does not affect `focus`/`frameSite`, which are deliberate programmatic
   * moves (e.g. multi-angle screenshot shots into the landscape zone).
   */
  private panLeash: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;

  // Interaction state
  private isOrbiting = false;
  private isPanning = false;
  private prevMouseX = 0;
  private prevMouseY = 0;

  // Touch state
  private prevTouchDist = 0;
  private prevTouchX = 0;

  private _minHeight = -Infinity;

  private readonly listeners: [string, EventListener][] = [];

  constructor(camera: THREE.PerspectiveCamera, target: THREE.Vector3, canvas: HTMLElement) {
    this.camera = camera;
    this.target = target.clone();
    this.canvas = canvas;

    // Derive the height model from wherever the camera already is.
    const offset = camera.position.clone().sub(this.target);
    this.yaw = Math.atan2(offset.x, offset.z);
    this.height = THREE.MathUtils.clamp(offset.y, HEIGHT_MIN, HEIGHT_MAX);
    this.shotRadius = Math.max(offset.length(), HEIGHT_MIN);

    this.defaultTarget = this.target.clone();
    this.defaultHeight = this.height;
    this.defaultYaw = this.yaw;

    this.attach();
    this.apply();
  }

  // ---- Public API ----

  /** Straight-line distance from camera to target, for effects that scale with zoom (#458 T6.1/D13). */
  get distance(): number {
    return this.camera.position.distanceTo(this.target);
  }

  /** Current camera height above its ground target, metres. */
  get cameraHeight(): number {
    return this.height;
  }

  /** Point the camera looks at (can be updated externally for tracking). */
  setTarget(x: number, y: number, z: number): void {
    this.target.set(x, y, z);
    this.apply();
  }

  /**
   * Centre the view on a site and pull back far enough to see all of it.
   *
   * `span` is the largest horizontal extent of the site in world units. The
   * resulting framing becomes the camera's new default, so `reset()` and the
   * multi-angle screenshot shots frame the same site.
   */
  frameSite(centerX: number, centerY: number, centerZ: number, span: number): void {
    this.pitchOverride = null;
    this.target.set(centerX, centerY, centerZ);
    const viewDistance = Math.max(span * FRAME_DISTANCE_FACTOR, HEIGHT_MIN);
    this.height = heightForViewDistance(viewDistance);
    this.shotRadius = viewDistance;
    this.defaultTarget = this.target.clone();
    this.defaultHeight = this.height;
    this.defaultYaw = this.yaw;
    this.apply();
  }

  /** Minimum terrain height below target — camera won't go underground. */
  setMinHeight(y: number): void {
    this._minHeight = y;
    this.apply();
  }

  /**
   * Move the view target and distance directly, without touching yaw.
   * Used together with `setOrbit` by scenario multi-angle shots that need to
   * centre on a specific point (e.g. a ramp excavation) rather than the
   * whole-site default framing (#410). Unlike `frameSite`, this is a one-off
   * move — it does not become the new default for `reset()`.
   */
  focus(x: number, y: number, z: number, distance: number): void {
    this.target.set(x, y, z);
    this.shotRadius = Math.max(distance, HEIGHT_MIN);
    this.height = heightForViewDistance(this.shotRadius);
    this.apply();
  }

  /** Set (or clear, passing null) the playable-rect ± margin bound on manual camera movement (#458 T6.1/D13). */
  setPanLeash(rect: Rect | null, margin: number): void {
    this.panLeash = rect && {
      minX: rect.minX - margin,
      maxX: rect.maxX + margin,
      minZ: rect.minZ - margin,
      maxZ: rect.maxZ + margin,
    };
  }

  /**
   * Set absolute yaw and pitch (degrees) for a scripted shot.
   *
   * Pitch is normally a function of height; naming one here overrides that
   * until the next player input, so a capture can hold an angle the height
   * model would never choose (a near-horizontal pass over a tall level, say).
   */
  setOrbit(yawDeg: number, pitchDeg: number): void {
    this.yaw = THREE.MathUtils.degToRad(yawDeg);
    this.pitchOverride = THREE.MathUtils.clamp(
      THREE.MathUtils.degToRad(pitchDeg),
      THREE.MathUtils.degToRad(1),
      THREE.MathUtils.degToRad(89),
    );
    this.apply();
  }

  /** Reset camera to default position. */
  reset(): void {
    this.pitchOverride = null;
    this.target.copy(this.defaultTarget);
    this.height = this.defaultHeight;
    this.yaw = this.defaultYaw;
    this.apply();
  }

  /** Detach all DOM listeners and release resources. */
  dispose(): void {
    for (const [type, handler] of this.listeners) {
      this.canvas.removeEventListener(type, handler);
    }
    this.listeners.length = 0;
  }

  // ---- Event wiring ----

  private attach(): void {
    const on = (type: string, fn: EventListener) => {
      this.canvas.addEventListener(type, fn, { passive: false });
      this.listeners.push([type, fn]);
    };

    on('mousedown', this.onMouseDown as EventListener);
    on('mousemove', this.onMouseMove as EventListener);
    on('mouseup', this.onMouseUp as EventListener);
    on('mouseleave', this.onMouseUp as EventListener);
    on('wheel', this.onWheel as EventListener);
    on('touchstart', this.onTouchStart as EventListener);
    on('touchmove', this.onTouchMove as EventListener);
    on('touchend', this.onTouchEnd as EventListener);

    // Prevent context menu on right-click so right-drag works
    on('contextmenu', ((e: Event) => e.preventDefault()) as EventListener);
  }

  // ---- Mouse handlers ----

  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) {
      // Left button — rotate
      this.isOrbiting = true;
    } else if (e.button === 1 || e.button === 2) {
      // Middle or Right button — pan
      this.isPanning = true;
    }
    this.prevMouseX = e.clientX;
    this.prevMouseY = e.clientY;
  };

  private onMouseMove = (e: MouseEvent) => {
    const dx = e.clientX - this.prevMouseX;
    const dy = e.clientY - this.prevMouseY;
    this.prevMouseX = e.clientX;
    this.prevMouseY = e.clientY;

    if (this.isOrbiting) {
      this.orbit(dx);
    } else if (this.isPanning) {
      this.pan(dx, dy);
    }
  };

  private onMouseUp = () => {
    this.isOrbiting = false;
    this.isPanning = false;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoomBy(e.deltaY > 0 ? 1 + ZOOM_SPEED : 1 - ZOOM_SPEED);
  };

  // ---- Touch handlers ----

  private onTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      this.isOrbiting = true;
      this.prevTouchX = e.touches[0]!.clientX;
    } else if (e.touches.length === 2) {
      this.isOrbiting = false;
      this.prevTouchDist = touchDistance(e.touches[0]!, e.touches[1]!);
    }
  };

  private onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1 && this.isOrbiting) {
      const dx = e.touches[0]!.clientX - this.prevTouchX;
      this.prevTouchX = e.touches[0]!.clientX;
      this.orbit(dx);
    } else if (e.touches.length === 2) {
      const dist = touchDistance(e.touches[0]!, e.touches[1]!);
      if (dist > 0 && this.prevTouchDist > 0) this.zoomBy(this.prevTouchDist / dist);
      this.prevTouchDist = dist;
    }
  };

  private onTouchEnd = () => {
    this.isOrbiting = false;
  };

  // ---- Math helpers ----

  /** Ground-plane unit vector pointing away from the camera, toward the target. */
  private groundForward(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Ground-plane unit vector pointing to the camera's right. */
  private groundRight(): THREE.Vector3 {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  private clampTargetToLeash(): void {
    if (!this.panLeash) return;
    this.target.x = THREE.MathUtils.clamp(this.target.x, this.panLeash.minX, this.panLeash.maxX);
    this.target.z = THREE.MathUtils.clamp(this.target.z, this.panLeash.minZ, this.panLeash.maxZ);
  }

  /**
   * Change camera height by `factor`, carrying the view forward as it drops.
   *
   * The camera slides along its own view axis far enough to reach the new
   * height, and the target takes the horizontal part of that slide — so
   * zooming in advances on whatever was being looked at instead of sinking
   * vertically. The target's Y is untouched: movement stays in its plane.
   */
  private zoomBy(factor: number): void {
    this.pitchOverride = null; // player input — back to the height model
    const previous = this.height;
    const next = THREE.MathUtils.clamp(previous * factor, HEIGHT_MIN, HEIGHT_MAX);
    if (next === previous) return;

    const forward = this.target.clone().sub(this.camera.position).normalize();
    if (forward.y < -MIN_FORWARD_DIP) {
      // forward.y is negative (the camera looks down), so descending gives a
      // positive step — forward — and rising gives a negative one — back.
      const step = (next - previous) / forward.y;
      this.target.x += forward.x * step;
      this.target.z += forward.z * step;
      this.clampTargetToLeash();
    }

    this.height = next;
    this.apply();
  }

  private orbit(dx: number): void {
    this.pitchOverride = null; // player input — back to the height model
    // Yaw only. Pitch follows height, so there is no vertical orbit to drag.
    this.yaw -= dx * ORBIT_SPEED;
    this.apply();
  }

  private pan(dx: number, dy: number): void {
    this.pitchOverride = null; // player input — back to the height model
    // Strictly horizontal: both basis vectors lie in the ground plane, so no
    // amount of dragging can lift the target off it.
    const scale = this.height * PAN_SPEED_FACTOR;
    this.target.addScaledVector(this.groundRight(), -dx * scale);
    this.target.addScaledVector(this.groundForward(), dy * scale);
    this.clampTargetToLeash();
    this.apply();
  }

  private apply(): void {
    const pitch = this.pitchOverride ?? pitchForHeight(this.height);
    const radius = this.pitchOverride !== null ? this.shotRadius : this.height / Math.sin(pitch);
    const horizontal = radius * Math.cos(pitch);

    const newPos = new THREE.Vector3(
      this.target.x + horizontal * Math.sin(this.yaw),
      this.target.y + radius * Math.sin(pitch),
      this.target.z + horizontal * Math.cos(this.yaw),
    );

    // Clamp camera above minimum height
    if (newPos.y < this._minHeight + 1) {
      newPos.y = this._minHeight + 1;
    }

    this.camera.position.copy(newPos);
    this.camera.lookAt(this.target);
  }
}
