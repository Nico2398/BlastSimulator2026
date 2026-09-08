// DustDevils — unit tests (#458 T7.3): cartoon twisters from the prop library

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { DustDevils } from '../../../../src/renderer/ambient/DustDevils.js';
import { TWISTER_MODEL_ID } from '../../../../src/renderer/models/ModelIds.js';
import { ModelLibrary } from '../../../../src/renderer/models/ModelLibrary.js';
import { loadedModelLibrary } from '../../../helpers/models.js';

const flatGround = () => 5;

function funnels(scene: THREE.Scene): THREE.Group[] {
  return scene.children.filter((c): c is THREE.Group => c.name === 'dust-devil');
}

function debris(scene: THREE.Scene): THREE.InstancedMesh | undefined {
  return scene.children.find((c): c is THREE.InstancedMesh => c.name === 'dust-devil-debris');
}

describe('DustDevils', () => {
  it('constructs without a browser/DOM: one group per devil plus one batch of orbiting grit', () => {
    const scene = new THREE.Scene();
    const devils = new DustDevils(scene, 42, 50, 50, flatGround, new ModelLibrary());
    expect(devils.devilCount).toBeGreaterThan(0);
    expect(funnels(scene)).toHaveLength(devils.devilCount);
    expect(debris(scene)!.count).toBe(devils.devilCount * 5);
    // The asset is not in this library: stand-ins for now, and the id recorded for the catch-up rebuild.
    expect(devils.missingModelIds).toEqual([TWISTER_MODEL_ID]);
    devils.dispose();
  });

  it('draws the twister model when the library has it', async () => {
    const library = await loadedModelLibrary([TWISTER_MODEL_ID]);
    const scene = new THREE.Scene();
    const devils = new DustDevils(scene, 42, 50, 50, flatGround, library);
    expect(devils.missingModelIds).toEqual([]);
    expect(funnels(scene)[0]!.getObjectByName('Body')).toBeDefined();
    devils.dispose();
    expect(funnels(scene)).toHaveLength(0);
  });

  it('is deterministic for a given seed', () => {
    const sceneA = new THREE.Scene();
    const sceneB = new THREE.Scene();
    const a = new DustDevils(sceneA, 7, 50, 50, flatGround, new ModelLibrary());
    const b = new DustDevils(sceneB, 7, 50, 50, flatGround, new ModelLibrary());
    a.update(1.5);
    b.update(1.5);
    const groupsA = funnels(sceneA);
    const groupsB = funnels(sceneB);
    for (let i = 0; i < a.devilCount; i++) {
      expect(groupsA[i]!.matrix.equals(groupsB[i]!.matrix)).toBe(true);
    }
    a.dispose();
    b.dispose();
  });

  it('produces different seeds a different layout', () => {
    const sceneA = new THREE.Scene();
    const sceneB = new THREE.Scene();
    const a = new DustDevils(sceneA, 1, 50, 50, flatGround, new ModelLibrary());
    const b = new DustDevils(sceneB, 2, 50, 50, flatGround, new ModelLibrary());
    const groupsA = funnels(sceneA);
    const groupsB = funnels(sceneB);
    let anyDifferent = false;
    for (let i = 0; i < a.devilCount; i++) {
      if (!groupsA[i]!.matrix.equals(groupsB[i]!.matrix)) anyDifferent = true;
    }
    expect(anyDifferent).toBe(true);
    a.dispose();
    b.dispose();
  });

  it('spins, wobbles and wanders over time, and its grit orbits — matrices change between updates', () => {
    const scene = new THREE.Scene();
    const devils = new DustDevils(scene, 42, 50, 50, flatGround, new ModelLibrary());
    const funnel = funnels(scene)[0]!;
    const before = funnel.matrix.clone();
    const gritBefore = new THREE.Matrix4();
    debris(scene)!.getMatrixAt(0, gritBefore);
    const yawBefore = funnel.rotation.y;

    devils.update(2);
    expect(funnel.matrix.equals(before)).toBe(false);
    expect(funnel.rotation.y).toBeGreaterThan(yawBefore);
    expect(Math.abs(funnel.rotation.x)).toBeLessThan(0.2); // a stagger, not a fall
    const gritAfter = new THREE.Matrix4();
    debris(scene)!.getMatrixAt(0, gritAfter);
    expect(gritAfter.equals(gritBefore)).toBe(false);
    devils.dispose();
  });

  it('samples ground height for vertical placement', () => {
    const scene = new THREE.Scene();
    const heights = new Map<string, number>();
    const sampler = (x: number, z: number) => {
      const h = 20 + x * 0.1;
      heights.set(`${Math.round(x)},${Math.round(z)}`, h);
      return h;
    };
    const devils = new DustDevils(scene, 42, 50, 50, sampler, new ModelLibrary());
    expect(heights.size).toBeGreaterThan(0);
    expect(funnels(scene)[0]!.position.y).toBeGreaterThan(19);
    devils.dispose();
  });

  it('dispose removes every funnel and the grit batch from the scene', () => {
    const scene = new THREE.Scene();
    const devils = new DustDevils(scene, 42, 50, 50, flatGround, new ModelLibrary());
    expect(funnels(scene).length).toBeGreaterThan(0);
    devils.dispose();
    expect(funnels(scene)).toHaveLength(0);
    expect(debris(scene)).toBeUndefined();
  });
});
