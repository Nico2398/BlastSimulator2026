// BlastSimulator2026 — Crew pins
// A hired worker is a ~10 x 24 px speck at the default framing (the camera sits at
// the site's span x 1.15) and under a pixel on a big level, so a player who hires
// his first surveyor looks for him and finds nobody. Each worker carries a
// role-coloured pin whose on-screen size is a fixed fraction of the viewport's
// height, whatever the zoom; once the worker himself fills enough of the screen to
// be seen, the pin fades out of the close-up.
//
// Same shape as EmployeePictograms: one billboard per employee, parented under the
// character mesh's anchor group (so a worker without a mesh — riding a vehicle,
// inside a building — has none), synced from the roster and resized every frame.

import * as THREE from 'three';
import type { Employee, EmployeeRole } from '../core/entities/Employee.js';
import { ROLE_COLORS } from './CharacterMesh.js';
import { overlayHeight } from './TaskProgressBar.js';
import { EmployeeBillboardRoster } from './EmployeeBillboardRoster.js';
import { createCanvas2d } from './createCanvas2d.js';

/** Pin height as a fraction of the viewport's height: ~24 px at 720p, ~37 px at 1080p. */
export const MARKER_VIEWPORT_FRACTION = 0.034;
/** A worker's own height, as a fraction of the viewport's, up to which the pin stays opaque. */
const FADE_START = 0.12;
/** ...and from which it is gone: the worker needs no pin once he fills this much of the screen. */
const FADE_END = 0.24;
/** Metres between the top of the worker's overlay slot and the pin's tip: clears a task bar or pictogram. */
const TIP_LIFT = 0.35;
/** Drawn after every other overlay (task bars sit at 999). */
const MARKER_RENDER_ORDER = 1000;
const TEXTURE_SIZE = 128;

/** An employee's pin and the material it owns (one per pin, so each fades on its own). */
interface Marker {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
}

/** What the camera says right now, for sizing and fading a pin. */
interface CameraView {
  /** The projection matrix's vertical scale, 1 / tan(fov / 2). */
  p11: number;
  /** The sprite scale whose projected height is MARKER_VIEWPORT_FRACTION of the viewport. */
  size: number;
}

function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/**
 * A map pin: a role-coloured teardrop with a white rim, a dark outer line so it
 * reads on sand and on shadow alike, and a white dot in its head. The tip is the
 * bottom-centre of the canvas, which is where the sprite is anchored.
 */
export function drawPin(ctx: CanvasRenderingContext2D, color: string): void {
  const c = TEXTURE_SIZE;
  const cx = c / 2;
  const cy = c * 0.38;
  const r = c * 0.3;
  const tipY = c * 0.96;
  // Tangent points of the lines from the tip to the head circle.
  const theta = Math.acos(r / (tipY - cy));
  ctx.clearRect(0, 0, c, c);
  ctx.beginPath();
  ctx.moveTo(cx, tipY);
  ctx.lineTo(cx + r * Math.sin(theta), cy + r * Math.cos(theta));
  ctx.arc(cx, cy, r, Math.PI / 2 - theta, Math.PI / 2 + theta, true);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1c1420';
  ctx.lineWidth = c * 0.16;
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = c * 0.09;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, c * 0.1, 0, Math.PI * 2);
  ctx.fill();
}

/** Billboarded crew pins, one per rendered employee, keyed by employee id. */
export class EmployeeMarkers {
  private readonly markers = new EmployeeBillboardRoster<Marker>(
    marker => marker.sprite,
    marker => marker.material.dispose(),
  );
  /** One texture per role, drawn on first use; null where no canvas exists (Node tests). */
  private readonly textures = new Map<EmployeeRole, THREE.CanvasTexture | null>();
  private readonly world = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** Number of pins currently rendered. */
  get count(): number {
    return this.markers.count;
  }

  /** The pin on an employee's mesh, or null when he has none — for diagnostics and tests. */
  pinOf(id: number): THREE.Sprite | null {
    return this.markers.get(id)?.sprite ?? null;
  }

  /**
   * Sync pins against the roster: one for every employee `getAnchor` resolves to a
   * character mesh group, none for the rest. A pin follows its employee onto a new
   * group, and is dropped with an employee who left the roster.
   *
   * A pin is fitted to the camera as it is placed. The game loop runs update() before the
   * tick whose sync adds a worker's mesh (stepping out of a vehicle or a building) and draws
   * right after, so a pin left for the next update() would be drawn once at the default
   * sprite scale: a teardrop covering the viewport.
   */
  sync(
    employees: readonly Pick<Employee, 'id' | 'role'>[],
    getAnchor: (id: number) => THREE.Group | null,
  ): void {
    const liveIds = new Set<number>();
    for (const { id, role } of employees) {
      liveIds.add(id);
      const anchor = getAnchor(id);
      if (anchor === null) {
        this.markers.remove(id);
        continue;
      }
      let marker = this.markers.get(id);
      if (!marker) {
        marker = this.createMarker(role);
        this.markers.set(id, marker);
      }
      const placed = marker.sprite.parent !== anchor;
      if (placed) anchor.add(marker.sprite);
      marker.sprite.position.set(0, overlayHeight(anchor) + TIP_LIFT, 0);
      if (!placed) continue;
      const view = this.view();
      if (view) this.fit(marker, view);
    }
    this.markers.sweep(liveIds);
  }

  /** Resize every pin for the camera and fade it out of close-ups. Call every frame. */
  update(): void {
    if (this.markers.count === 0) return;
    const view = this.view();
    if (!view) return;
    for (const marker of this.markers.values()) this.fit(marker, view);
  }

  /** Remove every pin from the scene. */
  clearAll(): void {
    this.markers.clearAll();
  }

  dispose(): void {
    this.clearAll();
    for (const texture of this.textures.values()) texture?.dispose();
    this.textures.clear();
  }

  private createMarker(role: EmployeeRole): Marker {
    const map = this.textureFor(role);
    const material = new THREE.SpriteMaterial({
      // A flat role colour stands in wherever no canvas exists (Node-only Vitest workers).
      ...(map ? { map } : { color: ROLE_COLORS[role] }),
      sizeAttenuation: false,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.name = 'crew-pin';
    sprite.center.set(0.5, 0);
    sprite.renderOrder = MARKER_RENDER_ORDER;
    // Hidden until fit() has sized it: a Sprite starts at scale 1, which under sizeAttenuation false
    // covers the viewport.
    sprite.visible = false;
    // Sized by fit(); culling against the unit quad's world sphere would drop a pin whose
    // centre has just left the screen while its (view-scaled) quad is still on it.
    sprite.frustumCulled = false;
    // A marker, not a target: picking stays with the worker, and a Sprite raycast needs a raycaster camera.
    sprite.raycast = () => {};
    return { sprite, material };
  }

  /** The camera's facts for this call, or null when its projection cannot size anything. */
  private view(): CameraView | null {
    const p11 = this.camera.projectionMatrix.elements[5]!;
    if (!(p11 > 0)) return null;
    this.camera.getWorldPosition(this.eye);
    // A sprite with sizeAttenuation off is scaled by its view depth in the shader, so its projected
    // height is scale.y * p11 in NDC; the viewport spans 2 NDC units.
    return { p11, size: (2 * MARKER_VIEWPORT_FRACTION) / p11 };
  }

  /** Size a pin for the camera and fade it by how large its worker is on screen. */
  private fit({ sprite, material }: Marker, { p11, size }: CameraView): void {
    sprite.scale.set(size, size, 1);
    const anchor = sprite.parent;
    if (!anchor) return;
    const distance = Math.max(this.eye.distanceTo(sprite.getWorldPosition(this.world)), 1e-3);
    const workerFraction = (overlayHeight(anchor) * p11) / (2 * distance);
    const fade = (FADE_END - workerFraction) / (FADE_END - FADE_START);
    material.opacity = Math.min(1, Math.max(0, fade));
    sprite.visible = material.opacity > 0;
  }

  private textureFor(role: EmployeeRole): THREE.CanvasTexture | null {
    if (this.textures.has(role)) return this.textures.get(role) ?? null;
    const surface = createCanvas2d(TEXTURE_SIZE, TEXTURE_SIZE);
    let texture: THREE.CanvasTexture | null = null;
    if (surface) {
      drawPin(surface.ctx, cssColor(ROLE_COLORS[role]));
      texture = new THREE.CanvasTexture(surface.canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
    }
    this.textures.set(role, texture);
    return texture;
  }
}
