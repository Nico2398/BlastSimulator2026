// BlastSimulator2026 — ClaimableProps: the scene-owned instanced props of an
// ambient layer, with the ones standing on ground the playable mesh later
// claims tracked for hiding (#1664).

import type * as THREE from 'three';
import type { InstancedProp } from '../models/InstancedProp.js';
import { ClaimedInstances, type InstanceSink } from './ClaimedInstances.js';

type Points = ReadonlyArray<{ x: number; z: number }>;

export class ClaimableProps {
  private readonly props: InstancedProp[] = [];
  private readonly claimed = new ClaimedInstances();

  constructor(private readonly scene: THREE.Scene) {}

  /** Publish a filled prop and add it to the scene; with `points`, hide its instances once their ground is claimed. */
  add(prop: InstancedProp, points?: Points): void {
    prop.commit();
    if (points) this.claimed.track(prop, points);
    prop.addTo(this.scene);
    this.props.push(prop);
  }

  /** Track instances of a batch the layer adds to the scene itself. */
  track(sink: InstanceSink, points: Points): void {
    this.claimed.track(sink, points);
  }

  /** Hide instances on claimed ground; returns how many were newly hidden. */
  dropClaimed(isClaimed: (x: number, z: number) => boolean): number {
    return this.claimed.dropClaimed(isClaimed);
  }

  dispose(): void {
    this.claimed.clear();
    for (const prop of this.props) prop.dispose(this.scene);
    this.props.length = 0;
  }
}
