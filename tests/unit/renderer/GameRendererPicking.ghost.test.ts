// BlastSimulator2026 — ghost picking: a raycast hit on a pending order's ghost resolves to its action id (#2266)
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { GhostPreview } from '../../../src/core/state/GameState.js';
import { GhostMesh } from '../../../src/renderer/GhostMesh.js';
import { GhostInstanceBatch } from '../../../src/renderer/GhostInstanceBatch.js';
import { resolveTaggedAncestor } from '../../../src/renderer/Pickable.js';
import {
  entityWorldPosition, pickables, resolveGhostId, type PickingDeps,
} from '../../../src/renderer/GameRendererPicking.js';

function makePreview(id: number, overrides: Partial<GhostPreview> = {}): GhostPreview {
  return {
    id,
    type: 'drill_hole',
    targetX: id * 3,
    targetY: 2,
    targetZ: id * 3 + 1,
    claimed: false,
    ...overrides,
  };
}

function debris(id: number, overrides: Partial<GhostPreview> = {}): GhostPreview {
  return makePreview(id, { type: 'haul_debris', ...overrides });
}

function depsWith(ghosts: GhostMesh | null): PickingDeps {
  return { ghosts, getTerrainSurfaceY: () => 0 } as unknown as PickingDeps;
}

describe('GhostInstanceBatch.idAt (#2266)', () => {
  function makeBatch() {
    const scene = new THREE.Scene();
    return new GhostInstanceBatch(scene, new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 10, () => {});
  }

  it('names the ghost in each live slot', () => {
    const batch = makeBatch();
    batch.add(7, 0, 0, 0);
    batch.add(8, 1, 0, 0);
    expect(batch.idAt(0)).toBe(7);
    expect(batch.idAt(1)).toBe(8);
  });

  it('is null past the last live slot and for a negative slot', () => {
    const batch = makeBatch();
    batch.add(7, 0, 0, 0);
    expect(batch.idAt(1)).toBeNull();
    expect(batch.idAt(-1)).toBeNull();
    expect(makeBatch().idAt(0)).toBeNull();
  });

  it('follows the move of the last ghost into a removed slot', () => {
    const batch = makeBatch();
    batch.add(1, 0, 0, 0);
    batch.add(2, 1, 0, 0);
    batch.add(3, 2, 0, 0);
    batch.remove(0);
    expect(batch.idAt(0)).toBe(3);
    expect(batch.idAt(1)).toBe(2);
    expect(batch.idAt(2)).toBeNull();
  });

  it('still resolves every slot after the batch grew past its first capacity', () => {
    const batch = makeBatch();
    for (let i = 0; i < 200; i++) batch.add(1000 + i, i, 0, 0);
    expect(batch.idAt(0)).toBe(1000);
    expect(batch.idAt(199)).toBe(1199);
    expect(batch.idAt(200)).toBeNull();
  });
});

describe('GhostMesh picking (#2266)', () => {
  it('lists a plain ghost root among its pickables, tagged as an order with the action id', () => {
    const gm = new GhostMesh(new THREE.Scene());
    gm.sync([makePreview(5)]);
    const root = gm.getGroup(5)!;
    expect(gm.pickables()).toContain(root);
    expect(resolveTaggedAncestor(root)).toEqual({ kind: 'order', id: 5 });
    gm.dispose();
  });

  it('drops a ghost from its pickables once its order is gone', () => {
    const gm = new GhostMesh(new THREE.Scene());
    gm.sync([makePreview(5), makePreview(6)]);
    const root5 = gm.getGroup(5)!;
    const root6 = gm.getGroup(6)!;
    gm.sync([makePreview(6)]);
    expect(gm.pickables()).not.toContain(root5);
    expect(gm.pickables()).toContain(root6);
    gm.dispose();
  });

  it('has nothing to pick when no ghost exists', () => {
    const gm = new GhostMesh(new THREE.Scene());
    expect(gm.pickables().filter(o => o.userData['entityKind'] === 'order' && o.userData['entityId'] !== undefined)).toEqual([]);
    gm.dispose();
  });

  it('actionIdAt resolves a plain ghost root to its action id', () => {
    const gm = new GhostMesh(new THREE.Scene());
    gm.sync([makePreview(5), makePreview(6)]);
    expect(gm.actionIdAt(gm.getGroup(5)!)).toBe(5);
    expect(gm.actionIdAt(gm.getGroup(6)!)).toBe(6);
    gm.dispose();
  });

  it('actionIdAt is null for an object that is no ghost', () => {
    const gm = new GhostMesh(new THREE.Scene());
    gm.sync([makePreview(5)]);
    expect(gm.actionIdAt(new THREE.Mesh())).toBeNull();
    expect(gm.actionIdAt(new THREE.Mesh(), 0)).toBeNull();
    gm.dispose();
  });

  it('tags the instanced batch mesh of debris ghosts as an order pickable', () => {
    const gm = new GhostMesh(new THREE.Scene());
    const [blue] = gm.materials;
    gm.sync([debris(1), debris(2)]);
    const batch = gm.batchOf(blue!)!;
    expect(gm.pickables()).toContain(batch);
    expect(batch.userData['entityKind']).toBe('order');
    gm.dispose();
  });

  it('actionIdAt resolves an instanced slot to the debris order in it', () => {
    const gm = new GhostMesh(new THREE.Scene());
    const [blue] = gm.materials;
    gm.sync([debris(11), debris(12), debris(13)]);
    const batch = gm.batchOf(blue!)!;
    expect(gm.actionIdAt(batch, 0)).toBe(11);
    expect(gm.actionIdAt(batch, 1)).toBe(12);
    expect(gm.actionIdAt(batch, 2)).toBe(13);
    gm.dispose();
  });

  it('actionIdAt is null for an empty slot and for an instanced mesh hit without an instance', () => {
    const gm = new GhostMesh(new THREE.Scene());
    const [blue] = gm.materials;
    gm.sync([debris(11)]);
    const batch = gm.batchOf(blue!)!;
    expect(gm.actionIdAt(batch, 5)).toBeNull();
    expect(gm.actionIdAt(batch)).toBeNull();
    gm.dispose();
  });

  it('actionIdAt follows a debris ghost that moves slot when another is removed', () => {
    const gm = new GhostMesh(new THREE.Scene());
    const [blue] = gm.materials;
    gm.sync([debris(1), debris(2), debris(3)]);
    gm.sync([debris(2), debris(3)]);
    const batch = gm.batchOf(blue!)!;
    const ids = [gm.actionIdAt(batch, 0), gm.actionIdAt(batch, 1)];
    expect(ids.sort()).toEqual([2, 3]);
    expect(gm.actionIdAt(batch, 2)).toBeNull();
    gm.dispose();
  });

  it('actionIdAt follows a debris ghost restyled into another batch', () => {
    const gm = new GhostMesh(new THREE.Scene());
    const [blue, claimed] = gm.materials;
    gm.sync([debris(1), debris(2)]);
    gm.sync([debris(1, { claimed: true }), debris(2)]);
    expect(gm.actionIdAt(gm.batchOf(claimed!)!, 0)).toBe(1);
    expect(gm.actionIdAt(gm.batchOf(blue!)!, 0)).toBe(2);
    gm.dispose();
  });

  it('keeps the pickable batch mesh tagged and resolvable after the batch grew', () => {
    const gm = new GhostMesh(new THREE.Scene());
    const [blue] = gm.materials;
    const many = Array.from({ length: 150 }, (_, i) => debris(i + 1));
    gm.sync(many);
    const batch = gm.batchOf(blue!)!;
    expect(gm.pickables()).toContain(batch);
    expect(batch.userData['entityKind']).toBe('order');
    expect(gm.actionIdAt(batch, 149)).toBe(150);
    gm.dispose();
  });

  it('getPosition gives a plain ghost its place in the world', () => {
    const gm = new GhostMesh(new THREE.Scene());
    gm.sync([makePreview(5, { targetX: 12, targetZ: 34, targetY: 2 })]);
    const p = gm.getPosition(5)!;
    expect(p).toBeInstanceOf(THREE.Vector3);
    expect(p.x).toBeCloseTo(12);
    expect(p.z).toBeCloseTo(34);
    gm.dispose();
  });

  it('getPosition gives an instanced debris ghost its place in the world', () => {
    const gm = new GhostMesh(new THREE.Scene());
    gm.sync([debris(8, { targetX: 21, targetZ: 43, targetY: 1 })]);
    const p = gm.getPosition(8)!;
    expect(p.x).toBeCloseTo(21);
    expect(p.z).toBeCloseTo(43);
    gm.dispose();
  });

  it('getPosition is null for an unknown ghost and once its order is gone', () => {
    const gm = new GhostMesh(new THREE.Scene());
    gm.sync([makePreview(5), debris(8)]);
    expect(gm.getPosition(99)).toBeNull();
    gm.sync([]);
    expect(gm.getPosition(5)).toBeNull();
    expect(gm.getPosition(8)).toBeNull();
    gm.dispose();
  });
});

describe('GameRendererPicking ghost helpers (#2266)', () => {
  it('pickables includes the ghost pickables', () => {
    const gm = new GhostMesh(new THREE.Scene());
    gm.sync([makePreview(5)]);
    expect(pickables(depsWith(gm))).toContain(gm.getGroup(5)!);
    gm.dispose();
  });

  it('pickables of a renderer without ghosts holds none and does not throw', () => {
    expect(() => pickables(depsWith(null))).not.toThrow();
  });

  it('resolveGhostId resolves a plain ghost hit to its action id', () => {
    const gm = new GhostMesh(new THREE.Scene());
    gm.sync([makePreview(5)]);
    expect(resolveGhostId(depsWith(gm), gm.getGroup(5)!)).toBe(5);
    gm.dispose();
  });

  it('resolveGhostId resolves an instanced hit through its instance id', () => {
    const gm = new GhostMesh(new THREE.Scene());
    const [blue] = gm.materials;
    gm.sync([debris(11), debris(12)]);
    expect(resolveGhostId(depsWith(gm), gm.batchOf(blue!)!, 1)).toBe(12);
    gm.dispose();
  });

  it('resolveGhostId is null for a stray object and without ghosts', () => {
    const gm = new GhostMesh(new THREE.Scene());
    gm.sync([makePreview(5)]);
    expect(resolveGhostId(depsWith(gm), new THREE.Mesh())).toBeNull();
    expect(resolveGhostId(depsWith(null), new THREE.Mesh())).toBeNull();
    gm.dispose();
  });

  it("entityWorldPosition('order', id) is the ghost's position", () => {
    const gm = new GhostMesh(new THREE.Scene());
    gm.sync([makePreview(5, { targetX: 12, targetZ: 34 })]);
    const p = entityWorldPosition(depsWith(gm), 'order', 5)!;
    expect(p.x).toBeCloseTo(12);
    expect(p.z).toBeCloseTo(34);
    gm.dispose();
  });

  it("entityWorldPosition('order', id) is null when the ghost is gone or no ghosts exist", () => {
    const gm = new GhostMesh(new THREE.Scene());
    gm.sync([makePreview(5)]);
    gm.sync([]);
    expect(entityWorldPosition(depsWith(gm), 'order', 5)).toBeNull();
    expect(entityWorldPosition(depsWith(null), 'order', 5)).toBeNull();
    gm.dispose();
  });
});
