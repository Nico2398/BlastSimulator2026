// BlastSimulator2026 — Camera Controller
// Orbit/pan/zoom controls for the mine overview camera.
// - Left-drag: orbit
// - Right-drag or Middle-drag: pan
// - Scroll: zoom
// - Touch: pinch-to-zoom, single-finger orbit

import * as THREE from 'three';

// ---------- Zoom limits (distance from target) ----------
// Real mine overviews need to span ~200m (full grid) down to <5m (drill hole close-up)
const ZOOM_MIN = 5;    // metres — close-up detail
const ZOOM_MAX = 600;  // metres — full mine overview
const ZOOM_SPEED = 0.12; // fraction of current distance per scroll tick

// ---------- Orbit speed ----------
const ORBIT_SPEED = 0.005; // radians per pixel

// ---------- Pan speed ----------
// Scales with distance so panning feels consistent at all zoom levels
const PAN_SPEED_FACTOR = 0.001;

// ---------- Vertical angle limits (theta from horizontal) ----------
// Prevent camera from going below terrain surface or flipping over the top
const POLAR_MIN = 0.08;  // ~5° from horizon (almost horizontal)
const POLAR_MAX = Math.PI / 2 - 0.05; // ~85° — nearly straight down

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

  // Pan offset
  private panOffset: THREE.Vector3 = new THREE.Vector3();

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

    this.attach();
    this.apply();
  }

  // ---- Public API ----

  /** Point the camera looks at (can be updated externally for tracking). */
  setTarget(x: number, y: number, z: number): void {
    this.target.set(x, y, z);
    this.apply();
  }

  /** Minimum terrain height below target — camera won't go underground. */
  setMinHeight(y: number): void {
    // Ensure camera position stays above y after apply()
    this._minHeight = y;
    this.apply();
  }
  private _minHeight = -Infinity;

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
