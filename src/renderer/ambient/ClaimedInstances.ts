// BlastSimulator2026 — ClaimedInstances: hides ambient instances that sit on
// ground the playable mesh has claimed after load (#1664).

import type * as THREE from 'three';

/** The write surface of an instanced batch: set one instance's matrix, then publish. */
export interface InstanceSink {
  setMatrixAt(i: number, m: THREE.Matrix4): void;
  commit(): void;
}

export class ClaimedInstances {
  /** Register a batch; `points[i]` is the ground position of instance i. */
  track(_sink: InstanceSink, _points: ReadonlyArray<{ x: number; z: number }>): void {
    throw new Error('not implemented');
  }

  /** Hide tracked instances on claimed ground; returns how many were newly hidden. */
  dropClaimed(_isClaimed: (x: number, z: number) => boolean): number {
    throw new Error('not implemented');
  }

  clear(): void {
    throw new Error('not implemented');
  }
}
