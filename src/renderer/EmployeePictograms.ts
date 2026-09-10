// BlastSimulator2026 — Employee non-working activity pictograms (#1013)
//
// Billboarded icon (Zzz for resting, etc.) floating above an employee who is
// not currently working, naming why — reuses the billboard/per-employee
// anchor precedent TaskProgressBar.ts established for the progress bar shown
// while an employee IS working (#546). The two are mutually exclusive per
// employee: 'working' keeps the progress bar and shows no pictogram here.

import * as THREE from 'three';
import type { Employee } from '../core/entities/Employee.js';
import type { Vehicle } from '../core/entities/Vehicle.js';
import type { EmployeeActivity } from '../core/entities/EmployeeActivity.js';
import { BAR_Y_OFFSET } from './TaskProgressBar.js';
import { faceCamera } from './Billboard.js';
import { EmployeeBillboardRoster, forEachEmployeeActivity } from './EmployeeBillboardRoster.js';

/**
 * Which non-working pictogram an employee shows. Mirrors
 * EmployeeActivityKind's non-'working' kinds ('collapsed', 'resting',
 * 'driving', 'idle', 'walking'), plus 'walking_to_rest' — a walk toward a
 * rest destination reads as ordinary 'walking' in EmployeeActivityKind, but
 * gets its own pictogram here so the player can tell it apart from a walk to
 * a task.
 */
export type PictogramKind = 'collapsed' | 'resting' | 'walking_to_rest' | 'walking' | 'driving' | 'idle';

/**
 * Which pictogram (if any) `activity` should show. Null for 'working' —
 * that state keeps the progress bar, never an icon.
 */
export function pictogramKindFor(activity: EmployeeActivity): PictogramKind | null {
  switch (activity.kind) {
    case 'working':
      return null;
    case 'collapsed':
      return 'collapsed';
    case 'resting':
      return 'resting';
    case 'idle':
      return 'idle';
    case 'driving':
    case 'driving_to_task':
      return 'driving';
    case 'walking':
      return activity.actionType === 'rest' ? 'walking_to_rest' : 'walking';
  }
}

const ICON_SIZE = 0.5; // world units — matches TaskProgressBar's proportion to the ~0.4-wide capsule
const CANVAS_SIZE = 128;

/**
 * Fallback flat color per kind, matching each glyph's dominant stroke/fill
 * color above — used only when no `document` is available to draw the real
 * glyph onto a canvas texture (see buildIconMaterial below).
 */
const FALLBACK_COLOR: Record<PictogramKind, number> = {
  collapsed: 0xe53935,
  resting: 0x4fc3f7,
  walking_to_rest: 0x4fc3f7,
  walking: 0xeceff1,
  driving: 0xffb300,
  idle: 0xb0bec5,
};

/**
 * Draw a glyph for `kind` onto a fresh canvas and wrap it as a shared
 * material. `document` is unavailable in this project's Node-only Vitest
 * suites (no jsdom) — TaskProgressBar's own precedent never touches the DOM
 * at all, using flat-color materials instead of a texture. Pictograms need a
 * distinct glyph per kind, which a flat color alone can't carry, so canvas
 * drawing stays the browser-context behaviour and a flat-color material
 * (still one shared instance per kind, matching the real glyph's color)
 * stands in wherever `document` doesn't exist.
 */
function buildIconMaterial(kind: PictogramKind): THREE.MeshBasicMaterial {
  if (typeof document === 'undefined') {
    return new THREE.MeshBasicMaterial({ color: FALLBACK_COLOR[kind], transparent: true, depthWrite: false });
  }

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d')!;
  drawGlyph(ctx, kind);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  return new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
}

/** One shrinking "Z" glyph to place, in canvas-fraction coordinates (0-1 of CANVAS_SIZE). */
interface ZGlyph {
  x: number;
  y: number;
  size: number;
}

/**
 * Draw each of `zs` as a bold 'Z' character at its own position/size —
 * shared by the 'resting' and 'walking_to_rest' glyphs below, which differ
 * only in how many Zs they draw, at what sizes, and (for walking_to_rest)
 * an alpha/arrow wrapped around the call.
 */
function drawZs(ctx: CanvasRenderingContext2D, zs: readonly ZGlyph[], color: string): void {
  const c = CANVAS_SIZE;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const z of zs) {
    ctx.font = `bold ${c * z.size}px sans-serif`;
    ctx.fillText('Z', c * z.x, c * z.y);
  }
}

function drawGlyph(ctx: CanvasRenderingContext2D, kind: PictogramKind): void {
  const c = CANVAS_SIZE;
  ctx.clearRect(0, 0, c, c);

  switch (kind) {
    case 'collapsed': {
      // Stark warning mark — a red X, visually opposite the calm 'resting' Zzz.
      ctx.strokeStyle = '#e53935';
      ctx.lineWidth = c * 0.14;
      ctx.lineCap = 'round';
      const pad = c * 0.22;
      ctx.beginPath();
      ctx.moveTo(pad, pad);
      ctx.lineTo(c - pad, c - pad);
      ctx.moveTo(c - pad, pad);
      ctx.lineTo(pad, c - pad);
      ctx.stroke();
      break;
    }
    case 'resting': {
      // Calm "Z Z Z" sleep pictogram, full size/opacity — "there".
      drawZs(ctx, [
        { x: 0.28, y: 0.72, size: 0.34 },
        { x: 0.55, y: 0.48, size: 0.26 },
        { x: 0.75, y: 0.28, size: 0.18 },
      ], '#4fc3f7');
      break;
    }
    case 'walking_to_rest': {
      // Same colour family as 'resting', but fainter and smaller — "en route",
      // not "there yet" — plus a small arrow to read as travel.
      ctx.globalAlpha = 0.55;
      drawZs(ctx, [
        { x: 0.42, y: 0.55, size: 0.24 },
        { x: 0.66, y: 0.32, size: 0.16 },
      ], '#4fc3f7');
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#4fc3f7';
      ctx.lineWidth = c * 0.05;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(c * 0.18, c * 0.82);
      ctx.lineTo(c * 0.4, c * 0.82);
      ctx.moveTo(c * 0.32, c * 0.74);
      ctx.lineTo(c * 0.4, c * 0.82);
      ctx.lineTo(c * 0.32, c * 0.9);
      ctx.stroke();
      break;
    }
    case 'walking': {
      // Simple footsteps glyph — two offset ovals.
      ctx.fillStyle = '#eceff1';
      ctx.beginPath();
      ctx.ellipse(c * 0.36, c * 0.62, c * 0.1, c * 0.18, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(c * 0.64, c * 0.38, c * 0.1, c * 0.18, 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'driving': {
      // Steering-wheel glyph — ring + spokes + hub.
      ctx.strokeStyle = '#ffb300';
      ctx.lineWidth = c * 0.08;
      const r = c * 0.32;
      ctx.beginPath();
      ctx.arc(c / 2, c / 2, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(c / 2 - r, c / 2);
      ctx.lineTo(c / 2 + r, c / 2);
      ctx.moveTo(c / 2, c / 2 - r);
      ctx.lineTo(c / 2 - r * 0.4, c / 2 + r * 0.7);
      ctx.moveTo(c / 2, c / 2 - r);
      ctx.lineTo(c / 2 + r * 0.4, c / 2 + r * 0.7);
      ctx.stroke();
      ctx.fillStyle = '#ffb300';
      ctx.beginPath();
      ctx.arc(c / 2, c / 2, c * 0.06, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'idle': {
      // Three neutral static dots ("...").
      ctx.fillStyle = '#b0bec5';
      const y = c * 0.5;
      const r = c * 0.08;
      for (const x of [c * 0.28, c * 0.5, c * 0.72]) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
}

const PICTOGRAM_KINDS: readonly PictogramKind[] = ['collapsed', 'resting', 'walking_to_rest', 'walking', 'driving', 'idle'];

interface Pictogram {
  mesh: THREE.Mesh;
  kind: PictogramKind;
}

/** Billboarded non-working-activity pictograms, one per employee, keyed by employee id. */
export class EmployeePictograms {
  private readonly camera: THREE.Camera;
  private readonly pictograms = new EmployeeBillboardRoster<Pictogram>(pictogram => pictogram.mesh);

  // ---------- Shared resources (built once per instance, reused across every icon) ----------
  private readonly geometry: THREE.PlaneGeometry;
  private readonly materials: Record<PictogramKind, THREE.MeshBasicMaterial>;

  // scene is unused: each icon mesh is parented directly under its resolved
  // anchor group (sync() below), never the scene root — unlike
  // TaskProgressBar, which needs a transient scene-root home for a freshly
  // created bar group before its first sync() reparents it.
  constructor(_scene: THREE.Scene, camera: THREE.Camera) {
    this.camera = camera;

    this.geometry = new THREE.PlaneGeometry(ICON_SIZE, ICON_SIZE);

    const materials = {} as Record<PictogramKind, THREE.MeshBasicMaterial>;
    for (const kind of PICTOGRAM_KINDS) {
      materials[kind] = buildIconMaterial(kind);
    }
    this.materials = materials;
  }

  /** Number of pictograms currently rendered. */
  get count(): number {
    return this.pictograms.count;
  }

  /**
   * Sync pictogram meshes against the current employee/vehicle roster. Adds
   * pictograms for newly-non-working employees and removes them for
   * employees now working or no longer present. `getAnchor` resolves an
   * employee id to the CharacterMesh Group to billboard above.
   */
  sync(
    employees: readonly Employee[],
    vehicles: readonly Vehicle[],
    getAnchor: (id: number) => THREE.Group | null,
  ): void {
    const liveIds = new Set<number>();

    forEachEmployeeActivity(employees, vehicles, liveIds, (employee, activity) => {
      const kind = pictogramKindFor(activity);
      const anchor = kind !== null ? getAnchor(employee.id) : null;

      if (kind === null || anchor === null) {
        this.pictograms.remove(employee.id);
        return;
      }

      let pictogram = this.pictograms.get(employee.id);
      if (!pictogram) {
        const mesh = new THREE.Mesh(this.geometry, this.materials[kind]);
        mesh.position.set(0, BAR_Y_OFFSET, 0);
        anchor.add(mesh);
        pictogram = { mesh, kind };
        this.pictograms.set(employee.id, pictogram);
      } else {
        if (pictogram.kind !== kind) {
          pictogram.mesh.material = this.materials[kind];
          pictogram.kind = kind;
        }
        if (pictogram.mesh.parent !== anchor) {
          anchor.add(pictogram.mesh);
        }
      }
    });

    // Sweep any pictogram whose employee is no longer in the roster at all (death/removal).
    this.pictograms.sweep(liveIds);
  }

  /** Animate/refresh billboard orientation. Call every frame with elapsed seconds. */
  update(_dt: number): void {
    for (const pictogram of this.pictograms.values()) {
      faceCamera(pictogram.mesh, this.camera);
    }
  }

  /** Remove all pictogram meshes from the scene. */
  clearAll(): void {
    this.pictograms.clearAll();
  }

  dispose(): void {
    this.clearAll();
    this.geometry.dispose();
    for (const kind of PICTOGRAM_KINDS) {
      this.materials[kind].map?.dispose();
      this.materials[kind].dispose();
    }
  }
}
