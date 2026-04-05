// BuildingMesh — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Building } from '../../../src/core/entities/Building.js';
import { BuildingMesh } from '../../../src/renderer/BuildingMesh.js';

function makeBuilding(id: number, type: Building['type'], x = 10, z = 10, hp = 100): Building {
  return { id, type, tier: 1, x, z, hp, active: true };
}

describe('BuildingMesh', () => {
  it('addBuilding places a group in the scene', () => {
    const scene = new THREE.Scene();
    const bm = new BuildingMesh(scene);
    bm.addBuilding(makeBuilding(1, 'management_office'));
    expect(scene.children.length).toBe(1);
    expect(bm.count).toBe(1);
    bm.dispose();
  });

  it('all building types can be added without error', () => {
    const scene = new THREE.Scene();
    const bm = new BuildingMesh(scene);
    const types: Building['type'][] = [
      'driving_center', 'blasting_academy', 'management_office', 'geology_lab',
      'research_center', 'living_quarters', 'explosive_warehouse', 'freight_warehouse',
      'vehicle_depot',
    ];
    types.forEach((type, i) => bm.addBuilding(makeBuilding(i, type)));
    expect(bm.count).toBe(types.length);
    bm.dispose();
  });

  it('building group is positioned at grid location', () => {
    const scene = new THREE.Scene();
    const bm = new BuildingMesh(scene);
    bm.addBuilding(makeBuilding(1, 'management_office', 20, 30));
    const group = scene.children[0] as THREE.Group;
    // management_office is 2x2; centre = (20+1, 0, 30+1) = (21, 0, 31)
    expect(group.position.x).toBeCloseTo(21);
    expect(group.position.z).toBeCloseTo(31);
    bm.dispose();
  });

  it('destroyed building has different visual (hp=0)', () => {
    const scene = new THREE.Scene();
    const bm = new BuildingMesh(scene);
    bm.addBuilding(makeBuilding(1, 'living_quarters', 0, 0, 0)); // hp=0
    const group = scene.children[0] as THREE.Group;
    const baseMesh = group.children[0] as THREE.Mesh;
    const mat = baseMesh.material as THREE.MeshPhongMaterial;
    // Destroyed color is dark grey (0x333333)
    expect(mat.color.r).toBeLessThan(0.3);
    expect(mat.color.g).toBeLessThan(0.3);
    expect(mat.color.b).toBeLessThan(0.3);
    bm.dispose();
  });

  it('removeBuilding removes mesh from scene', () => {
    const scene = new THREE.Scene();
    const bm = new BuildingMesh(scene);
    bm.addBuilding(makeBuilding(1, 'living_quarters'));
    bm.addBuilding(makeBuilding(2, 'management_office'));
    bm.removeBuilding(1);
    expect(scene.children.length).toBe(1);
    expect(bm.count).toBe(1);
    bm.dispose();
  });

  it('clearAll removes all buildings', () => {
    const scene = new THREE.Scene();
    const bm = new BuildingMesh(scene);
    bm.addBuilding(makeBuilding(1, 'management_office'));
    bm.addBuilding(makeBuilding(2, 'living_quarters'));
    bm.clearAll();
    expect(scene.children.length).toBe(0);
    expect(bm.count).toBe(0);
    bm.dispose();
  });

  it('updateBuilding replaces the mesh in place', () => {
    const scene = new THREE.Scene();
    const bm = new BuildingMesh(scene);
    const b = makeBuilding(1, 'management_office', 5, 5, 100);
    bm.addBuilding(b);
    // Simulate damage
    b.hp = 0;
    bm.updateBuilding(b);
    expect(scene.children.length).toBe(1);
    expect(bm.count).toBe(1);
    bm.dispose();
  });
});
