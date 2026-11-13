// BlastSimulator2026 — broken/stuck vehicle alert pictograms (#2226)

import * as THREE from 'three';
import type { Vehicle, VehicleState } from '../core/entities/Vehicle.js';
import type { Employee } from '../core/entities/Employee.js';
import type { VehicleStatusKind } from '../core/entities/VehicleStatus.js';

export type VehicleAlertKind = 'broken' | 'stuck';

/** The alert a status shows above its vehicle, or null. */
export function vehicleAlertKindFor(_kind: VehicleStatusKind): VehicleAlertKind | null {
  throw new Error('not implemented');
}

export class VehicleAlertPictograms {
  constructor(_scene: THREE.Scene, _camera: THREE.Camera) {}

  get count(): number {
    throw new Error('not implemented');
  }

  sync(
    _vehicles: readonly Vehicle[],
    _vehicleState: VehicleState,
    _employees: readonly Employee[],
    _getAnchor: (id: number) => THREE.Object3D | null,
  ): void {
    throw new Error('not implemented');
  }

  update(_dt: number): void {
    throw new Error('not implemented');
  }

  clearAll(): void {
    throw new Error('not implemented');
  }

  dispose(): void {
    throw new Error('not implemented');
  }
}
