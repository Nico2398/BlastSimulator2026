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
import { EmployeeBillboardRoster } from './EmployeeBillboardRoster.js';

/** One billboard label, keyed by building id via EmployeeBillboardRoster. */
interface OccupancyLabel {
  mesh: THREE.Object3D;
}

/**
 * Billboarded "<inside>/<capacity>" labels, one per people-holding building,
 * keyed by building id. Parented under the scene root (see file header),
 * never under a building's own model Group.
 */
export class BuildingOccupancyLabels {
  private readonly labels = new EmployeeBillboardRoster<OccupancyLabel>(label => label.mesh);

  // TODO: implement — store scene/camera once sync()/update() need them
  // (scene as the parent labels attach under, per file header; camera for
  // Billboard.faceCamera in update()).
  constructor(_scene: THREE.Scene, _camera: THREE.Camera) {}

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
    _buildings: readonly Building[],
    _getPosition: (id: number) => THREE.Vector3 | null,
    _getRoofY: (id: number) => number | null,
  ): void {
    // TODO: implement
  }

  /** Animate/refresh billboard orientation. Call every frame with elapsed seconds. */
  update(_dt: number): void {
    // TODO: implement
  }

  /** Remove all label meshes from the scene. */
  clearAll(): void {
    this.labels.clearAll();
  }

  dispose(): void {
    this.clearAll();
  }
}
