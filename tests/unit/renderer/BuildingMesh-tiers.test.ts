// BuildingMesh — extended unit tests (CH1.7)
// Covers tier-specific visuals and entry/exit point markers.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Building } from '../../../src/core/entities/Building.js';
import { BuildingMesh, BODY_TINT } from '../../../src/renderer/BuildingMesh.js';
import type { ModelLibrary } from '../../../src/renderer/models/ModelLibrary.js';
import { loadedModelLibrary } from '../../helpers/models.js';

function makeBuilding(
  id: number,
  type: Building['type'],
  tier: Building['tier'] = 1,
  x = 0,
  z = 0,
  hp = 100,
): Building {
  return { id, type, tier, x, z, hp, active: true };
}

/** Model height of a building of `type`/`tier`, in a scene of its own — with real assets when `library` is loaded, else the stand-in's. */
function modelHeight(type: Building['type'], tier: Building['tier'], library?: ModelLibrary): number {
  const scene = new THREE.Scene();
  const bm = library ? new BuildingMesh(scene, library) : new BuildingMesh(scene);
  bm.addBuilding(makeBuilding(1, type, tier));
  const h = bm.getInstance(1)!.bounds.getSize(new THREE.Vector3()).y;
  bm.dispose();
  return h;
}

describe('BuildingMesh — tier visuals', () => {
  it('T2 building is taller than T1 building of same type', () => {
    expect(modelHeight('management_office', 2)).toBeGreaterThan(modelHeight('management_office', 1));
  });

  it('T3 building is taller than T2 building of same type', () => {
    expect(modelHeight('living_quarters', 3)).toBeGreaterThan(modelHeight('living_quarters', 2));
  });

  it('holds with the real exported assets too', async () => {
    const library = await loadedModelLibrary([
      'building_geology_lab_t1', 'building_geology_lab_t2', 'building_geology_lab_t3',
    ]);
    const h1 = modelHeight('geology_lab', 1, library);
    const h2 = modelHeight('geology_lab', 2, library);
    const h3 = modelHeight('geology_lab', 3, library);
    expect(h2).toBeGreaterThan(h1);
    expect(h3).toBeGreaterThan(h2);
  });

  it('T2 building base has a brighter colour than T1', () => {
    const getBaseColor = (tier: Building['tier']) => {
      const scene = new THREE.Scene();
      const bm = new BuildingMesh(scene);
      bm.addBuilding(makeBuilding(1, 'blasting_academy', tier));
      const color = bm.getInstance(1)!.tints.get(BODY_TINT)!.color;
      const rgb = { r: color.r, g: color.g, b: color.b };
      bm.dispose();
      return rgb;
    };
    const c1 = getBaseColor(1);
    const c2 = getBaseColor(2);
    // At least one channel should be brighter for T2
    const brighter = c2.r > c1.r || c2.g > c1.g || c2.b > c1.b;
    expect(brighter).toBe(true);
  });
});

describe('BuildingMesh — entry/exit markers', () => {
  it('adds entry and exit marker meshes for an intact building', () => {
    const scene = new THREE.Scene();
    const bm = new BuildingMesh(scene);
    bm.addBuilding(makeBuilding(1, 'management_office', 1));
    const group = scene.children[0] as THREE.Group;
    // group should have at minimum: base box + entry marker + exit marker
    expect(group.children.length).toBeGreaterThanOrEqual(3);
    bm.dispose();
  });

  it('does NOT add entry/exit markers for a destroyed building', () => {
    const scene = new THREE.Scene();
    const bm = new BuildingMesh(scene);
    bm.addBuilding(makeBuilding(1, 'management_office', 1, 0, 0, 0)); // hp=0
    const group = scene.children[0] as THREE.Group;
    // destroyed: only the base box, no accent, no markers
    expect(group.children.length).toBe(1);
    bm.dispose();
  });

  it('entry marker is coloured green (r < g)', () => {
    const scene = new THREE.Scene();
    const bm = new BuildingMesh(scene);
    bm.addBuilding(makeBuilding(1, 'driving_center', 1));
    const group = scene.children[0] as THREE.Group;
    // markers are the last two children (entry = second-to-last, exit = last for buildings without accent)
    // For driving_center (no accent): children = [base, entry, exit]
    const entryMarker = group.children[1] as THREE.Mesh;
    const color = (entryMarker.material as THREE.MeshPhongMaterial).color;
    expect(color.g).toBeGreaterThan(color.r);
    bm.dispose();
  });

  it('exit marker is coloured orange (r > g)', () => {
    const scene = new THREE.Scene();
    const bm = new BuildingMesh(scene);
    bm.addBuilding(makeBuilding(1, 'driving_center', 1));
    const group = scene.children[0] as THREE.Group;
    // For driving_center (no accent): children = [base, entry, exit]
    const exitMarker = group.children[2] as THREE.Mesh;
    const color = (exitMarker.material as THREE.MeshPhongMaterial).color;
    expect(color.r).toBeGreaterThan(color.g);
    bm.dispose();
  });
});
