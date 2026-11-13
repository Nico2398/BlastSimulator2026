// BlastSimulator2026 — broken/stuck vehicle alert pictograms (#2226)
//
// A camera-facing icon above a vehicle that needs the player: broken down (hp <= 0) or stuck on its
// route. Every other status shows nothing — a working vehicle shows the task progress bar instead
// (TaskProgressBar.ts), and an idle, moving or waiting one is routine.

import * as THREE from 'three';
import type { Vehicle, VehicleState } from '../core/entities/Vehicle.js';
import { resolveVehicleDriver } from '../core/entities/Vehicle.js';
import type { Employee } from '../core/entities/Employee.js';
import { computeVehicleStatus, type VehicleStatusKind } from '../core/entities/VehicleStatus.js';
import { overlayHeight } from './TaskProgressBar.js';
import { faceCamera } from './Billboard.js';
import { EmployeeBillboardRoster } from './EmployeeBillboardRoster.js';
import { createCanvas2d } from './createCanvas2d.js';

type VehicleAlertKind = 'broken' | 'stuck';

/** The alert a status shows above its vehicle, or null. */
export function vehicleAlertKindFor(kind: VehicleStatusKind): VehicleAlertKind | null {
  return kind === 'broken' || kind === 'stuck' ? kind : null;
}

const ICON_SIZE = 0.9; // world units — a vehicle is bigger than a worker
const CANVAS_SIZE = 128;
const ALERT_KINDS: readonly VehicleAlertKind[] = ['broken', 'stuck'];
const ALERT_COLOR: Record<VehicleAlertKind, string> = { broken: '#e53935', stuck: '#ff9800' };

/** Glyph per kind: a warning triangle with a bang for broken, a stop disc with a bar for stuck. */
function drawGlyph(ctx: CanvasRenderingContext2D, kind: VehicleAlertKind): void {
  const c = CANVAS_SIZE;
  ctx.clearRect(0, 0, c, c);
  ctx.fillStyle = ALERT_COLOR[kind];
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = c * 0.05;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (kind === 'broken') {
    ctx.moveTo(c * 0.5, c * 0.08);
    ctx.lineTo(c * 0.94, c * 0.88);
    ctx.lineTo(c * 0.06, c * 0.88);
    ctx.closePath();
  } else {
    ctx.arc(c / 2, c / 2, c * 0.42, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  if (kind === 'broken') {
    ctx.fillRect(c * 0.46, c * 0.35, c * 0.08, c * 0.28);
    ctx.fillRect(c * 0.46, c * 0.69, c * 0.08, c * 0.08);
  } else {
    ctx.fillRect(c * 0.25, c * 0.44, c * 0.5, c * 0.12);
  }
}

/** Canvas glyph material, or a flat colour of the same hue where no 2D canvas exists (Node tests). */
function buildMaterial(kind: VehicleAlertKind): THREE.MeshBasicMaterial {
  const surface = createCanvas2d(CANVAS_SIZE, CANVAS_SIZE);
  if (surface !== null) {
    drawGlyph(surface.ctx, kind);
    const texture = new THREE.CanvasTexture(surface.canvas);
    texture.needsUpdate = true;
    return new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  }
  return new THREE.MeshBasicMaterial({ color: ALERT_COLOR[kind], transparent: true, depthWrite: false });
}

interface Alert {
  mesh: THREE.Mesh;
  kind: VehicleAlertKind;
}

/** Billboarded alert pictograms, one per broken or stuck vehicle, keyed by vehicle id. */
export class VehicleAlertPictograms {
  private readonly camera: THREE.Camera;
  private readonly alerts = new EmployeeBillboardRoster<Alert>(alert => alert.mesh);
  private readonly geometry = new THREE.PlaneGeometry(ICON_SIZE, ICON_SIZE);
  private readonly materials: Record<VehicleAlertKind, THREE.MeshBasicMaterial>;

  // scene is unused: each icon is parented under its vehicle's anchor group in sync().
  constructor(_scene: THREE.Scene, camera: THREE.Camera) {
    this.camera = camera;
    this.materials = { broken: buildMaterial('broken'), stuck: buildMaterial('stuck') };
  }

  /** Number of pictograms currently rendered. */
  get count(): number {
    return this.alerts.count;
  }

  /** Add, retarget or remove each vehicle's alert from its derived status; sweep vehicles that are gone. */
  sync(
    vehicles: readonly Vehicle[],
    vehicleState: VehicleState,
    employees: readonly Employee[],
    getAnchor: (id: number) => THREE.Object3D | null,
  ): void {
    const liveIds = new Set<number>();
    for (const vehicle of vehicles) {
      liveIds.add(vehicle.id);
      const status = computeVehicleStatus(vehicle, vehicleState, resolveVehicleDriver(vehicle, employees));
      const kind = vehicleAlertKindFor(status.kind);
      const anchor = kind !== null ? getAnchor(vehicle.id) : null;
      if (kind === null || anchor === null) {
        this.alerts.remove(vehicle.id);
        continue;
      }
      let alert = this.alerts.get(vehicle.id);
      if (!alert) {
        alert = { mesh: new THREE.Mesh(this.geometry, this.materials[kind]), kind };
        this.alerts.set(vehicle.id, alert);
      } else if (alert.kind !== kind) {
        alert.mesh.material = this.materials[kind];
        alert.kind = kind;
      }
      if (alert.mesh.parent !== anchor) anchor.add(alert.mesh);
      alert.mesh.position.set(0, overlayHeight(anchor) + ICON_SIZE / 2, 0);
    }
    this.alerts.sweep(liveIds);
  }

  /** Refresh billboard orientation. Call every frame. */
  update(_dt: number): void {
    for (const alert of this.alerts.values()) faceCamera(alert.mesh, this.camera);
  }

  clearAll(): void {
    this.alerts.clearAll();
  }

  dispose(): void {
    this.clearAll();
    this.geometry.dispose();
    for (const kind of ALERT_KINDS) {
      this.materials[kind].map?.dispose();
      this.materials[kind].dispose();
    }
  }
}
