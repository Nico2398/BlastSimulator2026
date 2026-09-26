// BlastSimulator2026 — Building occupancy billboard labels (#1205)
//
// Camera-facing "<inside>/<capacity>" label floating above a building that
// holds people, kept in sync with Building.occupantIds. Unlike
// EmployeePictograms/TaskProgressBar, which parent their billboards under a
// per-entity anchor Group, a label here is parented directly under the
// scene: BuildingMesh.updateBuilding() removes and re-adds a building's own
// THREE.Group on every sync, so anything parented under it would be torn
// down and never reappear.

import * as THREE from 'three';
import type { Building } from '../core/entities/Building.js';
import { getBuildingPeopleCapacity } from '../core/entities/Building.js';
import { t } from '../core/i18n/I18n.js';
import { faceCamera } from './Billboard.js';
import { EmployeeBillboardRoster } from './EmployeeBillboardRoster.js';

const LABEL_WIDTH = 1.0;
const LABEL_HEIGHT = 0.36;
const CANVAS_WIDTH = 128;
const CANVAS_HEIGHT = 48;
/** World-unit gap above the model's local roof height, so the label floats clear of the roofline. */
const ROOF_CLEARANCE = 0.3;

const NORMAL_TEXT_COLOR = '#eceff1';
const NORMAL_BG_COLOR = 'rgba(20,20,20,0.55)';
const FULL_TEXT_COLOR = '#ffb300';
const FULL_BG_COLOR = 'rgba(90,40,0,0.7)';
/** Flat-color fallback swatches when no `document` exists to draw the canvas text (see buildLabelMaterial). */
const NORMAL_FALLBACK_COLOR = 0xeceff1;
const FULL_FALLBACK_COLOR = 0xffb300;

/** One billboard label, keyed by building id via EmployeeBillboardRoster. */
interface OccupancyLabel {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  /** Null in the no-DOM fallback (see buildLabelMaterial), where the material is a flat color instead. */
  canvas: HTMLCanvasElement | null;
  texture: THREE.CanvasTexture | null;
  /** Last drawn values, so sync() redraws the canvas only when they actually changed. */
  inside: number;
  capacity: number;
}

/**
 * Build the label's material. `document` is unavailable in this project's
 * Node-only Vitest suites (no jsdom) — mirrors EmployeePictograms'
 * buildIconMaterial fallback: a flat-color material stands in for the
 * canvas-text texture wherever `document` doesn't exist. Some test workers
 * do provide a `document` (and thus `HTMLCanvasElement`) without the
 * `canvas` npm package installed, in which case `getContext('2d')` itself
 * returns null rather than `document` being undefined — checked here too,
 * so the fallback still triggers on that path instead of drawLabel crashing.
 */
function buildLabelMaterial(): Pick<OccupancyLabel, 'material' | 'canvas' | 'texture'> {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    if (canvas.getContext('2d') !== null) {
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
      return { material, canvas, texture };
    }
  }

  return {
    material: new THREE.MeshBasicMaterial({ color: NORMAL_FALLBACK_COLOR, transparent: true, depthWrite: false }),
    canvas: null,
    texture: null,
  };
}

/** Redraw `canvas`'s background pill + "<inside>/<capacity>" text, styled distinctly when `full`. */
function drawLabel(canvas: HTMLCanvasElement, texture: THREE.CanvasTexture, text: string, full: boolean): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return; // Defensive: buildLabelMaterial() already ensured a real context before handing out this canvas.
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = full ? FULL_BG_COLOR : NORMAL_BG_COLOR;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = full ? FULL_TEXT_COLOR : NORMAL_TEXT_COLOR;
  ctx.font = `bold ${Math.round(h * 0.6)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 1);
  texture.needsUpdate = true;
}

/** Recolor the no-canvas flat-color fallback material to match full/normal state. */
function recolorFallback(material: THREE.MeshBasicMaterial, full: boolean): void {
  material.color.set(full ? FULL_FALLBACK_COLOR : NORMAL_FALLBACK_COLOR);
}

/**
 * Billboarded "<inside>/<capacity>" labels, one per people-holding building,
 * keyed by building id. Parented under the scene root (see file header),
 * never under a building's own model Group.
 */
export class BuildingOccupancyLabels {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly labels = new EmployeeBillboardRoster<OccupancyLabel>(
    label => label.mesh,
    label => {
      label.texture?.dispose();
      label.material.dispose();
    },
  );

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;
    this.geometry = new THREE.PlaneGeometry(LABEL_WIDTH, LABEL_HEIGHT);
  }

  /** Number of occupancy labels currently rendered. */
  get count(): number {
    return this.labels.count;
  }

  /**
   * Sync label meshes against the current building roster. Adds/updates
   * labels for buildings with a nonzero people capacity and removes labels
   * for buildings with none or no longer present. `getPosition` resolves a
   * building id to its world position (`BuildingMesh.getPosition`);
   * `getRoofY` resolves it to local roof height (`ModelInstance.bounds.max.y`
   * via `BuildingMesh.getInstance`) for label placement above the roof.
   */
  sync(
    buildings: readonly Building[],
    getPosition: (id: number) => THREE.Vector3 | null,
    getRoofY: (id: number) => number | null,
  ): void {
    const liveIds = new Set<number>();

    for (const b of buildings) {
      const capacity = getBuildingPeopleCapacity(b.type, b.tier);
      const inside = b.occupantIds.length;
      if (capacity <= 0 || inside <= 0) continue;

      const pos = getPosition(b.id);
      const roofY = getRoofY(b.id);
      if (pos === null || roofY === null) continue;

      liveIds.add(b.id);

      let label = this.labels.get(b.id);
      if (!label) {
        const built = buildLabelMaterial();
        const mesh = new THREE.Mesh(this.geometry, built.material);
        mesh.userData['entityKind'] = 'buildingOccupancyLabel';
        mesh.userData['entityId'] = b.id;
        this.scene.add(mesh);
        label = { mesh, ...built, inside: -1, capacity: -1 };
        this.labels.set(b.id, label);
      }

      label.mesh.position.set(pos.x, pos.y + roofY + ROOF_CLEARANCE, pos.z);

      if (label.inside !== inside || label.capacity !== capacity) {
        label.inside = inside;
        label.capacity = capacity;
        const full = inside === capacity;
        const text = t('building.occupancy', { inside, capacity });
        label.mesh.userData['occupancyText'] = text;
        label.mesh.userData['full'] = full;
        if (label.canvas && label.texture) {
          drawLabel(label.canvas, label.texture, text, full);
        } else {
          recolorFallback(label.material, full);
        }
      }
    }

    // Sweep any label whose building is no longer eligible (emptied, removed, or lost its capacity).
    this.labels.sweep(liveIds);
  }

  /** Animate/refresh billboard orientation. Call every frame with elapsed seconds. */
  update(_dt: number): void {
    for (const label of this.labels.values()) {
      faceCamera(label.mesh, this.camera);
    }
  }

  /** Remove all label meshes from the scene. */
  clearAll(): void {
    this.labels.clearAll();
  }

  dispose(): void {
    this.clearAll();
    this.geometry.dispose();
  }
}
