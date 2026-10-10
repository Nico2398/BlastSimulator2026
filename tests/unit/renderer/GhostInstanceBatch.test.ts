// GhostInstanceBatch — thousands of debris ghosts as slots of one draw (#1603)

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GhostInstanceBatch } from '../../../src/renderer/GhostInstanceBatch.js';

function makeBatch() {
  const scene = new THREE.Scene();
  const moves: Array<[number, number]> = [];
  const batch = new GhostInstanceBatch(scene, new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 10, (id, slot) => moves.push([id, slot]));
  const positionOf = (slot: number) => {
    const m = new THREE.Matrix4();
    batch.object.getMatrixAt(slot, m);
    return new THREE.Vector3().setFromMatrixPosition(m).toArray();
  };
  return { scene, batch, moves, positionOf };
}

describe('GhostInstanceBatch', () => {
  it('draws each added ghost at its own position, as one object in the scene', () => {
    const { scene, batch, positionOf } = makeBatch();
    expect(batch.add(7, 1, 2, 3)).toBe(0);
    expect(batch.add(8, 4, 5, 6)).toBe(1);
    expect(batch.count).toBe(2);
    expect(batch.object.count).toBe(2);
    expect(positionOf(1)).toEqual([4, 5, 6]);
    expect(scene.children).toEqual([batch.object]);
    expect(batch.object.renderOrder).toBe(10);
  });

  it('moves the last ghost into a removed slot and says so', () => {
    const { batch, moves, positionOf } = makeBatch();
    batch.add(1, 0, 0, 0);
    batch.add(2, 1, 0, 0);
    batch.add(3, 2, 0, 0);
    batch.remove(0);
    expect(moves).toEqual([[3, 0]]);
    expect(positionOf(0)).toEqual([2, 0, 0]);
    expect(batch.count).toBe(2);
    batch.remove(1); // the last slot: nothing moves
    expect(moves).toHaveLength(1);
    expect(batch.object.count).toBe(1);
  });

  it('grows past its first capacity without losing a ghost, still one object in the scene', () => {
    const { scene, batch, positionOf } = makeBatch();
    for (let i = 0; i < 200; i++) batch.add(i, i, 0, i * 2);
    expect(batch.count).toBe(200);
    expect(positionOf(0)).toEqual([0, 0, 0]);
    expect(positionOf(199)).toEqual([199, 0, 398]);
    expect(scene.children).toEqual([batch.object]);
  });

  it('dispose takes the batch out of the scene', () => {
    const { scene, batch } = makeBatch();
    batch.add(1, 0, 0, 0);
    batch.dispose();
    expect(scene.children).toEqual([]);
  });
});
