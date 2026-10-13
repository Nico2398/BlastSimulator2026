// ClaimedInstances — hides ambient instances standing on ground claimed after load (#1664)

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ClaimedInstances, type InstanceSink } from '../../../../src/renderer/ambient/ClaimedInstances.js';

interface RecordingSink extends InstanceSink {
  writes: Map<number, THREE.Matrix4>;
  commits: number;
}

function makeSink(): RecordingSink {
  const writes = new Map<number, THREE.Matrix4>();
  const sink: RecordingSink = {
    writes,
    commits: 0,
    setMatrixAt(i, m) { writes.set(i, m.clone()); },
    commit() { sink.commits++; },
  };
  return sink;
}

const POINTS = [
  { x: 1, z: 1 },
  { x: 10, z: 10 },
  { x: 11, z: 10 },
  { x: 50, z: 50 },
];
const inRect = (x: number, z: number) => x >= 10 && x <= 12 && z >= 9 && z <= 11;

describe('ClaimedInstances', () => {
  it('hides every instance whose point is claimed by writing a zero-scale matrix', () => {
    const sink = makeSink();
    const claimed = new ClaimedInstances();
    claimed.track(sink, POINTS);

    expect(claimed.dropClaimed(inRect)).toBe(2);

    expect([...sink.writes.keys()].sort()).toEqual([1, 2]);
    for (const m of sink.writes.values()) {
      const s = new THREE.Vector3().setFromMatrixScale(m);
      expect(s.x).toBe(0);
      expect(s.y).toBe(0);
      expect(s.z).toBe(0);
    }
    expect(sink.commits).toBe(1);
  });

  it('never touches an instance outside the claimed ground', () => {
    const sink = makeSink();
    const claimed = new ClaimedInstances();
    claimed.track(sink, POINTS);
    claimed.dropClaimed(inRect);
    expect(sink.writes.has(0)).toBe(false);
    expect(sink.writes.has(3)).toBe(false);
  });

  it('is idempotent: a second call hides nothing new and commits nothing', () => {
    const sink = makeSink();
    const claimed = new ClaimedInstances();
    claimed.track(sink, POINTS);
    claimed.dropClaimed(inRect);
    const commitsBefore = sink.commits;

    expect(claimed.dropClaimed(inRect)).toBe(0);
    expect(sink.commits).toBe(commitsBefore);
  });

  it('hides only the newly claimed instances when the claim grows', () => {
    const sink = makeSink();
    const claimed = new ClaimedInstances();
    claimed.track(sink, POINTS);
    claimed.dropClaimed(inRect);
    expect(claimed.dropClaimed((x, z) => inRect(x, z) || (x === 50 && z === 50))).toBe(1);
    expect(sink.writes.has(3)).toBe(true);
  });

  it('returns 0 and commits nothing when no point is claimed', () => {
    const sink = makeSink();
    const claimed = new ClaimedInstances();
    claimed.track(sink, POINTS);
    expect(claimed.dropClaimed(() => false)).toBe(0);
    expect(sink.writes.size).toBe(0);
    expect(sink.commits).toBe(0);
  });

  it('copes with an empty point list', () => {
    const sink = makeSink();
    const claimed = new ClaimedInstances();
    claimed.track(sink, []);
    expect(claimed.dropClaimed(() => true)).toBe(0);
    expect(sink.commits).toBe(0);
  });

  it('with nothing tracked, dropClaimed returns 0', () => {
    expect(new ClaimedInstances().dropClaimed(() => true)).toBe(0);
  });

  it('tracks several batches independently', () => {
    const a = makeSink();
    const b = makeSink();
    const claimed = new ClaimedInstances();
    claimed.track(a, [{ x: 1, z: 1 }]);
    claimed.track(b, [{ x: 1, z: 1 }, { x: 99, z: 99 }]);
    expect(claimed.dropClaimed((x) => x < 5)).toBe(2);
    expect(a.commits).toBe(1);
    expect(b.commits).toBe(1);
    expect(b.writes.has(1)).toBe(false);
  });

  it('clear() forgets every batch so a later dropClaimed is a no-op', () => {
    const sink = makeSink();
    const claimed = new ClaimedInstances();
    claimed.track(sink, POINTS);
    claimed.clear();
    expect(claimed.dropClaimed(() => true)).toBe(0);
    expect(sink.writes.size).toBe(0);
    expect(sink.commits).toBe(0);
  });
});
