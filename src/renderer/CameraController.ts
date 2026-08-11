// BlastSimulator2026 — Camera Controller
// Orbit camera for the mine overview.
// - Left-drag: orbit — yaw and pitch, freely, around the view target
// - Right-drag or Middle-drag: pan, always in a horizontal plane
// - Scroll: move closer to or further from the target
// - Touch: pinch to zoom, single-finger orbit

import * as THREE from 'three';
import type { Rect } from '../core/world/WorldGen.js';

// ---------------------------------------------------------------------------
// Orientation and zoom are independent.
//
// Dragging sets where you are looking from; scrolling sets how far away you
// are. Neither touches the other, so an angle you picked survives zooming in
// to work up close and back out again.
//
// The one constraint is on the target: it only ever moves in a horizontal
// plane. An earlier version panned it along the camera's local up vector,
// which has a Y component whenever the camera is tilted — that walked the
// look-at point up into the sky a little on every drag, and nothing clamped it
// back down (the pan leash bounds X and Z only). The view ended up stranded
// above the world with the ground out of reach.
// ---------------------------------------------------------------------------

// Zoom limits (distance from target), metres. Spans full-grid overview
// (1200 — enough to pull back on the largest campaign level, 160×160,
// #458 T6.1/D13) down to drill-hole close-up (5).
const ZOOM_MIN = 5;
const ZOOM_MAX = 1200;
// Fraction of current distance gained per scroll tick. Zooming in uses the
// reciprocal rather than (1 - ZOOM_SPEED), so a tick out and a tick back in
// cancel exactly and you land where you started.
const ZOOM_SPEED = 0.12;
const ZOOM_OUT_FACTOR = 1 + ZOOM_SPEED;
const ZOOM_IN_FACTOR = 1 / ZOOM_OUT_FACTOR;

const ORBIT_SPEED = 0.005; // radians per pixel

// Scales with distance so panning feels consistent at all zoom levels
const PAN_SPEED_FACTOR = 0.001;

/**
 * Pixel movement below this between right-button mousedown and release still
 * reads as a click, not a drag — mirrors ScenePicking's
 * CLICK_MOVE_THRESHOLD_PX for the analogous left-button distinction. Below
 * this, PlacementController's contextmenu handler still cancels the armed
 * tool; at or above it, a right-drag used purely to orbit the camera leaves
 * the tool untouched (#544).
 */
const RIGHT_DRAG_THRESHOLD_PX = 5;

// Vertical angle limits. `phi` is measured from straight up, so a small value
// puts the camera overhead looking down and a value near π/2 puts it level
// with the target. Stopping short of both ends keeps the camera from flipping
// over the top or dropping under the terrain.
const POLAR_MIN = 0.08;               // ~5° off vertical — nearly top-down
const POLAR_MAX = Math.PI / 2 - 0.05; // ~87° — nearly horizontal

// Default framing: orbit distance as a multiple of the site's horizontal
// span. At FOV 55° this keeps the whole pit on screen with a comfortable
// margin — too small and the benches run off the edges, too large and the
// mine shrinks to a distant patch.
const FRAME_DISTANCE_FACTOR = 1.15;
/** Default vertical angle — ~45° above the horizon, reads as an overview. */
const DEFAULT_POLAR = Math.PI / 4;

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

  // Spherical coords relative to target
  private spherical: THREE.Spherical;
  private defaultTarget: THREE.Vector3;
  private defaultSpherical: THREE.Spherical;

  /**
   * Soft leash on manual panning — the landscape beyond the playable rect is
   * viewable but not the play focus, so dragging the view shouldn't wander
   * off into it indefinitely (#458 T6.1/D13). Null until a grid loads.
   * Does not affect `focus`/`frameSite`, which are deliberate programmatic
   * moves (e.g. multi-angle screenshot shots into the landscape zone).
   */
  private panLeash: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;

  // Interaction state
  private isOrbiting = false;
  private isPanning = false;
  private prevMouseX = 0;
  private prevMouseY = 0;

  private rightButtonDown = false;
  private rightDownX = 0;
  private rightDownY = 0;
  /**
   * True once the current (or just-finished) right-button gesture has moved
   * past RIGHT_DRAG_THRESHOLD_PX from its mousedown position. Single source
   * of truth for "was this a drag, not a click" — PlacementController reads
   * it instead of re-deriving pixel distance itself (#544). Reset on the
   * next right-button mousedown; persists across mouseup so a `contextmenu`
   * handler firing afterward can still read it.
   */
  private rightGestureMoved = false;

  /**
   * True while a placement tool (P3 grid select) has taken the left button.
   * Right swaps to orbit for the duration and left is ignored here entirely —
   * PlacementController reads it directly. Middle stays pan. Design doc §01
   * "camera remap while armed": silently swapping a camera control without
   * this is how a player loses their bearings mid-drag.
   */
  private armedRemap = false;

  // Touch state
  private prevTouchDist = 0;
  private prevTouchX = 0;
  private prevTouchY = 0;

  private _minHeight = -Infinity;

  private readonly listeners: [string, EventListener][] = [];

  constructor(camera: THREE.PerspectiveCamera, target: THREE.Vector3, canvas: HTMLElement) {
    this.camera = camera;
    this.target = target.clone();
    this.canvas = canvas;

    // Initialise spherical from current camera position
    const offset = camera.position.clone().sub(this.target);
    this.spherical = new THREE.Spherical().setFromVector3(offset);
    this.spherical.phi = THREE.MathUtils.clamp(this.spherical.phi, POLAR_MIN, POLAR_MAX);
    this.spherical.radius = THREE.MathUtils.clamp(this.spherical.radius, ZOOM_MIN, ZOOM_MAX);

    this.defaultTarget = this.target.clone();
    this.defaultSpherical = this.spherical.clone();

    this.attach();
    this.apply();
  }

  // ---- Public API ----

  /** Current orbit distance (metres) — the zoom level, for effects that need to scale with it (#458 T6.1/D13). */
  get distance(): number {
    return this.spherical.radius;
  }

  /**
   * The point the camera is looking at. Read by effects that key off where the
   * player's attention is rather than where the camera happens to sit — the
   * border wall lights up around this, not around the camera.
   */
  get viewTarget(): THREE.Vector3 {
    return this.target;
  }

  /** True if the right-button gesture just released (or still held) moved past RIGHT_DRAG_THRESHOLD_PX — a drag, not a click (#544). */
  get rightButtonDragged(): boolean {
    return this.rightGestureMoved;
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
   * resulting orbit becomes the camera's new default, so `reset()` and the
   * multi-angle screenshot shots frame the same site.
   */
  frameSite(centerX: number, centerY: number, centerZ: number, span: number): void {
    this.setTargetAndDistance(centerX, centerY, centerZ, span * FRAME_DISTANCE_FACTOR, false);
    this.spherical.phi = DEFAULT_POLAR;
    this.defaultTarget = this.target.clone();
    this.defaultSpherical = this.spherical.clone();
    this.apply();
  }

  /** Minimum terrain height below target — camera won't go underground. */
  setMinHeight(y: number): void {
    this._minHeight = y;
    this.apply();
  }

  /**
   * Move the orbit target and distance directly, without touching yaw/pitch.
   * Used together with `setOrbit` by scenario multi-angle shots that need to
   * centre and zoom on a specific point (e.g. a ramp excavation) rather than
   * the whole-site default framing (#410). Unlike `frameSite`, this is a
   * one-off move — it does not become the new default for `reset()`.
   */
  focus(x: number, y: number, z: number, distance: number): void {
    this.setTargetAndDistance(x, y, z, distance);
  }

  /**
   * Project a world point to normalized device coordinates ([-1, 1] on each
   * axis; z > 1 means behind the camera). The DOM-side conversion to screen
   * pixels needs the canvas's live CSS rect, so that half stays with the
   * caller — same screen↔world split ScenePicking uses in the other
   * direction. Used by interaction mode to click a world tile for real
   * rather than reaching for a console-equivalent shortcut
   * (`.claude/rules/scenario-defs.md`'s click-only `role: 'player'` invariant).
   */
  projectToNDC(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).project(this.camera);
  }

  /** Enable/disable the placement-tool button remap (design doc §01). */
  setArmedRemap(enabled: boolean): void {
    this.armedRemap = enabled;
    this.isOrbiting = false;
    this.isPanning = false;
  }

  /** Set (or clear, passing null) the playable-rect ± margin bound on manual panning (#458 T6.1/D13). */
  setPanLeash(rect: Rect | null, margin: number): void {
    this.panLeash = rect && {
      minX: rect.minX - margin,
      maxX: rect.maxX + margin,
      minZ: rect.minZ - margin,
      maxZ: rect.maxZ + margin,
    };
  }

  /** Set absolute yaw (degrees) and pitch (degrees above horizon). */
  setOrbit(yawDeg: number, pitchDeg: number): void {
    this.spherical.theta = THREE.MathUtils.degToRad(yawDeg);
    const phi = THREE.MathUtils.degToRad(90 - pitchDeg);
    this.spherical.phi = THREE.MathUtils.clamp(phi, POLAR_MIN, POLAR_MAX);
    this.apply();
  }

  /** Reset camera to default position. */
  reset(): void {
    this.spherical.copy(this.defaultSpherical);
    this.target.copy(this.defaultTarget);
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
    if (this.armedRemap) {
      // Left is taken by the placement tool — PlacementController handles it,
      // this controller stays out of the way. Right orbits instead of pans
      // (temporary swap); middle is unchanged.
      if (e.button === 2) this.isOrbiting = true;
      else if (e.button === 1) this.isPanning = true;
    } else if (e.button === 0) {
      // Left button — orbit
      this.isOrbiting = true;
    } else if (e.button === 1 || e.button === 2) {
      // Middle or Right button — pan
      this.isPanning = true;
    }
    if (e.button === 2) {
      // New right-button gesture starts clean — PlacementController's
      // onMouseUp handler reads rightButtonDragged (backed by
      // rightGestureMoved) via the button-2 branch, since mouseup is
      // guaranteed to fire after any movement regardless of where
      // contextmenu lands (#544).
      this.rightButtonDown = true;
      this.rightDownX = e.clientX;
      this.rightDownY = e.clientY;
      this.rightGestureMoved = false;
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
      this.orbit(dx, dy);
    } else if (this.isPanning) {
      this.pan(dx, dy);
    }

    if (this.rightButtonDown && !this.rightGestureMoved) {
      // Peak displacement from the press point, not net displacement — a
      // drag that returns to the press point before release still counts.
      const rdx = e.clientX - this.rightDownX;
      const rdy = e.clientY - this.rightDownY;
      if (Math.sqrt(rdx * rdx + rdy * rdy) > RIGHT_DRAG_THRESHOLD_PX) {
        this.rightGestureMoved = true;
      }
    }
  };

  private onMouseUp = () => {
    this.isOrbiting = false;
    this.isPanning = false;
    this.rightButtonDown = false;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoomBy(e.deltaY > 0 ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR);
  };

  // ---- Touch handlers ----

  private onTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      // Single-finger orbit is suspended while armed — same swap as the
      // mouse's left button, so a placement tool's own touch handling (not
      // yet implemented) will have the paint gesture to itself.
      if (this.armedRemap) return;
      this.isOrbiting = true;
      this.prevTouchX = e.touches[0]!.clientX;
      this.prevTouchY = e.touches[0]!.clientY;
    } else if (e.touches.length === 2) {
      this.isOrbiting = false;
      this.prevTouchDist = touchDistance(e.touches[0]!, e.touches[1]!);
    }
  };

  private onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1 && this.isOrbiting) {
      const dx = e.touches[0]!.clientX - this.prevTouchX;
      const dy = e.touches[0]!.clientY - this.prevTouchY;
      this.prevTouchX = e.touches[0]!.clientX;
      this.prevTouchY = e.touches[0]!.clientY;
      this.orbit(dx, dy);
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

  /**
   * Set orbit target + clamp radius to `distance`. Shared by `focus` and
   * `frameSite` (see their docs for how the two differ). Pass `applyNow:
   * false` to defer `apply()` when the caller still has more fields to set.
   */
  private setTargetAndDistance(x: number, y: number, z: number, distance: number, applyNow = true): void {
    this.target.set(x, y, z);
    this.spherical.radius = THREE.MathUtils.clamp(distance, ZOOM_MIN, ZOOM_MAX);
    if (applyNow) this.apply();
  }

  /** Ground-plane unit vector pointing from the camera toward the target. */
  private groundForward(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.spherical.theta), 0, -Math.cos(this.spherical.theta));
  }

  /** Ground-plane unit vector pointing to the camera's right. */
  private groundRight(): THREE.Vector3 {
    return new THREE.Vector3(Math.cos(this.spherical.theta), 0, -Math.sin(this.spherical.theta));
  }

  /** Move closer to or further from the target. Orientation is untouched. */
  private zoomBy(factor: number): void {
    this.spherical.radius = THREE.MathUtils.clamp(
      this.spherical.radius * factor,
      ZOOM_MIN,
      ZOOM_MAX,
    );
    this.apply();
  }

  /** Swing around the target: yaw from horizontal drag, pitch from vertical. */
  private orbit(dx: number, dy: number): void {
    this.spherical.theta -= dx * ORBIT_SPEED;
    this.spherical.phi = THREE.MathUtils.clamp(
      this.spherical.phi - dy * ORBIT_SPEED,
      POLAR_MIN,
      POLAR_MAX,
    );
    this.apply();
  }

  private pan(dx: number, dy: number): void {
    // Strictly horizontal: both basis vectors lie in the ground plane, so no
    // amount of dragging can lift the target off it.
    const scale = this.spherical.radius * PAN_SPEED_FACTOR;
    this.target.addScaledVector(this.groundRight(), -dx * scale);
    this.target.addScaledVector(this.groundForward(), dy * scale);
    if (this.panLeash) {
      this.target.x = THREE.MathUtils.clamp(this.target.x, this.panLeash.minX, this.panLeash.maxX);
      this.target.z = THREE.MathUtils.clamp(this.target.z, this.panLeash.minZ, this.panLeash.maxZ);
    }
    this.apply();
  }

  private apply(): void {
    // Convert spherical back to Cartesian and position camera
    const offset = new THREE.Vector3().setFromSpherical(this.spherical);
    const newPos = this.target.clone().add(offset);

    // Clamp camera above minimum height
    if (newPos.y < this._minHeight + 1) {
      newPos.y = this._minHeight + 1;
    }

    this.camera.position.copy(newPos);
    this.camera.lookAt(this.target);
  }
}
