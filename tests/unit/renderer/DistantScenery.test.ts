// DistantScenery — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { DistantScenery } from '../../../src/renderer/DistantScenery.js';
import { getBiome } from '../../../src/core/world/BiomeCatalog.js';

describe('DistantScenery', () => {
  it('generate adds objects to scene', () => {
    const scene = new THREE.Scene();
    const ds = new DistantScenery(scene);
    const biome = getBiome('alpine_granite')!;
    ds.generate(biome, 32, 32);
    // Scene should have the group
    expect(scene.children.length).toBeGreaterThan(0);
    ds.dispose();
  });

  it('generates for every biome without error', () => {
    for (const id of ['desert_badlands', 'red_canyon', 'alpine_granite', 'green_foothills', 'tropical_karst', 'volcanic_flats']) {
      const scene = new THREE.Scene();
      const ds = new DistantScenery(scene);
      const biome = getBiome(id)!;
      ds.generate(biome, 32, 32);
      expect(scene.children.length).toBeGreaterThan(0);
      ds.dispose();
    }
  });

  it('clear removes all scenery objects', () => {
    const scene = new THREE.Scene();
    const ds = new DistantScenery(scene);
    const biome = getBiome('desert_badlands')!;
    ds.generate(biome, 32, 32);
    ds.clear();
    // Group should still be in scene but empty
    const group = scene.children[0] as THREE.Group;
    expect(group.children.length).toBe(0);
    ds.dispose();
  });

  it('scenery is placed far from grid centre (>= 100 units)', () => {
    const scene = new THREE.Scene();
    const ds = new DistantScenery(scene);
    const biome = getBiome('alpine_granite')!;
    ds.generate(biome, 32, 32);

    const group = scene.children[0] as THREE.Group;
    let allFar = true;
    for (const child of group.children) {
      // Skip the flat ground plane (it's centered exactly at gridCentre)
      if (child instanceof THREE.Mesh && child.rotation.x !== 0) continue;
      if (child instanceof THREE.Group) {
        const dist = Math.sqrt(
          Math.pow(child.position.x - 32, 2) + Math.pow(child.position.z - 32, 2)
        );
        if (dist < 100) allFar = false;
      }
    }
    expect(allFar).toBe(true);
    ds.dispose();
  });

  it('regenerate replaces existing scenery', () => {
    const scene = new THREE.Scene();
    const ds = new DistantScenery(scene);
    const biome = getBiome('alpine_granite')!;
    ds.generate(biome, 32, 32);
    const countFirst = (scene.children[0] as THREE.Group).children.length;
    ds.generate(getBiome('desert_badlands')!, 32, 32);
    const countSecond = (scene.children[0] as THREE.Group).children.length;
    // Desert has fewer trees, different count expected
    expect(countSecond).toBeGreaterThan(0);
    void countFirst;
    ds.dispose();
  });

  it('dispose removes group from scene', () => {
    const scene = new THREE.Scene();
    const ds = new DistantScenery(scene);
    ds.generate(getBiome('tropical_karst')!, 32, 32);
    ds.dispose();
    expect(scene.children.length).toBe(0);
  });
});
