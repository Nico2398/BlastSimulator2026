// BlastSimulator2026 — Camera Controller
// Orbit/pan/zoom controls for the mine overview camera.
// - Left-drag: orbit
// - Right-drag or Middle-drag: pan
// - Scroll: zoom
// - Touch: pinch-to-zoom, single-finger orbit

import * as THREE from 'three';
import type { Rect } from '../core/world/WorldGen.js';

// Zoom limits (distance from target), metres. Spans full-grid overview
// (1200 — enough to pull back on the largest campaign level, 160×160,
// #458 T6.1/D13) down to drill-hole close-up (5).
const ZOOM_MIN = 5;
const ZOOM_MAX = 1200;
const ZOOM_SPEED = 0.12; // fraction of current distance per scroll tick

const ORBIT_SPEED = 0.005; // radians per pixel

// Scales with distance so panning feels consistent at all zoom levels
const PAN_SPEED_FACTOR = 0.001;

// Vertical angle limits (phi from vertical) — keep the camera from dipping
// below the terrain or flipping over the top.
const POLAR_MIN = 0.08;  // ~5° from horizon (almost horizontal)
const POLAR_MAX = Math.PI / 2 - 0.05; // ~85° — nearly straight down

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

  // Pan offset
  private panOffset: THREE.Vector3 = new THREE.Vector3();

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

  // Touch state
  private prevTouchDist = 0;
  private prevTouchX = 0;
  private prevTouchY = 0;

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
    // Ensure camera position stays above y after apply()
    this._minHeight = y;
    this.apply();
  }
  private _minHeight = -Infinity;

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
    if (e.button === 0) {
      // Left button — orbit
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
      this.orbit(dx, dy);
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
    const factor = e.deltaY > 0 ? 1 + ZOOM_SPEED : 1 - ZOOM_SPEED;
    this.spherical.radius = THREE.MathUtils.clamp(
      this.spherical.radius * factor,
      ZOOM_MIN,
      ZOOM_MAX,
    );
    this.apply();
  };

  // ---- Touch handlers ----

  private onTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1) {
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
      const factor = this.prevTouchDist / dist;
      this.spherical.radius = THREE.MathUtils.clamp(
        this.spherical.radius * factor,
        ZOOM_MIN,
        ZOOM_MAX,
      );
      this.prevTouchDist = dist;
      this.apply();
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
    // Pan in the camera's local XY plane (perpendicular to view direction)
    const panScale = this.spherical.radius * PAN_SPEED_FACTOR;

    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    this.camera.getWorldDirection(new THREE.Vector3()); // ensure matrix updated
    right.setFromMatrixColumn(this.camera.matrix, 0);
    up.setFromMatrixColumn(this.camera.matrix, 1);

    this.panOffset.addScaledVector(right, -dx * panScale);
    this.panOffset.addScaledVector(up, dy * panScale);

    this.target.add(this.panOffset);
    if (this.panLeash) {
      this.target.x = THREE.MathUtils.clamp(this.target.x, this.panLeash.minX, this.panLeash.maxX);
      this.target.z = THREE.MathUtils.clamp(this.target.z, this.panLeash.minZ, this.panLeash.maxZ);
    }
    this.panOffset.set(0, 0, 0);
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
