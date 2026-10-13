// BlastSimulator2026 — ClaimedInstances: hides ambient instances that sit on
// ground the playable mesh has claimed after load (#1664).
// Claims only grow, so a hidden instance never comes back.

import * as THREE from 'three';

/** The write surface of an instanced batch: set one instance's matrix, then publish. */
export interface InstanceSink {
  setMatrixAt(i: number, m: THREE.Matrix4): void;
  commit(): void;
}

interface Batch {
  sink: InstanceSink;
  xs: Float32Array;
  zs: Float32Array;
  live: Uint8Array;
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class ClaimedInstances {
  private batches: Batch[] = [];

  /** Register a batch; `points[i]` is the ground position of instance i. */
  track(sink: InstanceSink, points: ReadonlyArray<{ x: number; z: number }>): void {
    const n = points.length;
    const xs = new Float32Array(n);
    const zs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = points[i]!.x;
      zs[i] = points[i]!.z;
    }
    this.batches.push({ sink, xs, zs, live: new Uint8Array(n).fill(1) });
  }

  /** Hide tracked instances on claimed ground; returns how many were newly hidden. */
  dropClaimed(isClaimed: (x: number, z: number) => boolean): number {
    let hidden = 0;
    for (const b of this.batches) {
      let changed = false;
      for (let i = 0; i < b.live.length; i++) {
        if (b.live[i] === 0 || !isClaimed(b.xs[i]!, b.zs[i]!)) continue;
        b.sink.setMatrixAt(i, HIDDEN);
        b.live[i] = 0;
        changed = true;
        hidden++;
      }
      if (changed) b.sink.commit();
    }
    return hidden;
  }

  clear(): void {
    this.batches = [];
  }
}
