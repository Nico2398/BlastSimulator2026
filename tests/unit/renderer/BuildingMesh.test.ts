// BuildingMesh — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Building } from '../../../src/core/entities/Building.js';
import { BuildingMesh } from '../../../src/renderer/BuildingMesh.js';
import { BUILDING_RUIN_MODEL_ID } from '../../../src/renderer/models/ModelIds.js';
import { loadedModelLibrary } from '../../helpers/models.js';

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

  it('destroyed building (hp=0) draws the shared rubble model stretched over its footprint, an intact one its own model', () => {
    const scene = new THREE.Scene();
    const bm = new BuildingMesh(scene);
    bm.addBuilding(makeBuilding(1, 'living_quarters', 0, 0, 0)); // hp=0
    bm.addBuilding(makeBuilding(2, 'living_quarters', 10, 10, 100));
    const ruin = bm.getInstance(1)!;
    expect(ruin.root.name).toBe(BUILDING_RUIN_MODEL_ID);
    // living_quarters t1 is 3×3 on a 2×2 rubble model → 1.5× on both axes.
    expect(ruin.root.scale.x).toBeCloseTo(1.5);
    expect(ruin.root.scale.z).toBeCloseTo(1.5);
    expect(bm.getInstance(2)!.root.name).toBe('building_living_quarters_t1');
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

  describe('scene picking (P2)', () => {
    it('pickables() returns one tagged object per building', () => {
      const scene = new THREE.Scene();
      const bm = new BuildingMesh(scene);
      bm.addBuilding(makeBuilding(1, 'management_office'));
      bm.addBuilding(makeBuilding(2, 'living_quarters'));
      const pickables = bm.pickables();
      expect(pickables).toHaveLength(2);
      expect(pickables.map(o => o.userData['entityId']).sort()).toEqual([1, 2]);
      expect(pickables.every(o => o.userData['entityKind'] === 'building')).toBe(true);
      bm.dispose();
    });

    it('getPosition() returns the building group world position', () => {
      const scene = new THREE.Scene();
      const bm = new BuildingMesh(scene);
      bm.addBuilding(makeBuilding(1, 'management_office', 20, 30));
      const pos = bm.getPosition(1);
      expect(pos?.x).toBeCloseTo(21);
      expect(pos?.z).toBeCloseTo(31);
      bm.dispose();
    });

    it('getPosition() returns null for an id that was never added', () => {
      const scene = new THREE.Scene();
      const bm = new BuildingMesh(scene);
      expect(bm.getPosition(999)).toBeNull();
      bm.dispose();
    });

    it('removed buildings drop out of pickables()', () => {
      const scene = new THREE.Scene();
      const bm = new BuildingMesh(scene);
      bm.addBuilding(makeBuilding(1, 'management_office'));
      bm.removeBuilding(1);
      expect(bm.pickables()).toHaveLength(0);
      bm.dispose();
    });
  });
});

describe('BuildingMesh — model refresh (real assets)', () => {
  it('refreshModels swaps a stand-in for the real model and re-pins the doors above its roof', async () => {
    const library = await loadedModelLibrary([]);
    const scene = new THREE.Scene();
    const bm = new BuildingMesh(scene, library);
    bm.addBuilding(makeBuilding(1, 'research_center'));
    expect(bm.getInstance(1)!.isFallback).toBe(true);
    bm.refreshModels(); // asset still missing — no change
    expect(bm.getInstance(1)!.isFallback).toBe(true);
    const loaded = await loadedModelLibrary(['building_research_center_t1']);
    library.register('building_research_center_t1', (loaded as unknown as { prototypes: Map<string, never> })['prototypes'].get('building_research_center_t1')!);
    bm.refreshModels();
    const inst = bm.getInstance(1)!;
    expect(inst.isFallback).toBe(false);
    const group = scene.children[0] as THREE.Group;
    // Model root + entry pin + exit pin, pins above the antenna tip.
    expect(group.children).toHaveLength(3);
    const pins = group.children.slice(1) as THREE.Mesh[];
    for (const pin of pins) expect(pin.position.y).toBeGreaterThan(inst.bounds.max.y);
    bm.dispose();
  });
});
