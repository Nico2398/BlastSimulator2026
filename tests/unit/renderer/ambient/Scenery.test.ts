// Scenery — rocks around the site and village houses, instanced from the prop models

import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { Scenery, ROCK_COLOR_BY_BIOME } from '../../../../src/renderer/ambient/Scenery.js';
import { ModelLibrary } from '../../../../src/renderer/models/ModelLibrary.js';
import { houseModelId, rockModelId, HOUSE_VARIANTS, ROCK_VARIANTS } from '../../../../src/renderer/models/ModelIds.js';
import type { House, Village } from '../../../../src/core/world/Structures.js';
import type { Rect } from '../../../../src/core/world/WorldGen.js';
import { loadedModelLibrary } from '../../../helpers/models.js';

const RECT: Rect = { minX: 0, minZ: 0, maxX: 40, maxZ: 40 };
const flat = () => 3;

function house(x: number, z: number, rotation = 0.7): House {
  return { x, z, rotation, w: 5, d: 6, h: 3.5, hasChimney: true };
}
const VILLAGE: Village = { x: 300, z: 20, radius: 30, houses: [house(295, 18), house(306, 25, 2.1), house(300, 10, 4.0)] };

let library: ModelLibrary;
beforeAll(async () => {
  const ids = [
    ...Array.from({ length: ROCK_VARIANTS }, (_, v) => rockModelId(v)),
    ...Array.from({ length: HOUSE_VARIANTS }, (_, v) => houseModelId(v)),
  ];
  library = await loadedModelLibrary(ids);
});

function meshesNamed(scene: THREE.Scene, name: string): THREE.InstancedMesh[] {
  return scene.children.filter((c): c is THREE.InstancedMesh => c.name === name);
}

describe('Scenery', () => {
  it('scatters rocks in a band outside the playable rect, never on the site or inside a village, deterministically', () => {
    const scene = new THREE.Scene();
    const s = new Scenery(scene, 42, library, [VILLAGE], RECT, 20, 20, flat, 'green_foothills');
    expect(s.rockInstanceCount).toBeGreaterThan(20);
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    for (const mesh of meshesNamed(scene, 'scenery-rocks')) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        pos.setFromMatrixPosition(m);
        const onSite = pos.x >= RECT.minX - 6 && pos.x <= RECT.maxX + 6 && pos.z >= RECT.minZ - 6 && pos.z <= RECT.maxZ + 6;
        expect(onSite).toBe(false);
        expect(Math.hypot(pos.x - VILLAGE.x, pos.z - VILLAGE.z)).toBeGreaterThanOrEqual(VILLAGE.radius);
        expect(pos.y).toBeLessThan(3); // sunk a little below the sampled ground
      }
    }
    const again = new Scenery(new THREE.Scene(), 42, library, [VILLAGE], RECT, 20, 20, flat, 'green_foothills');
    expect(again.rockInstanceCount).toBe(s.rockInstanceCount);
    s.dispose();
    again.dispose();
  });

  it('colours rocks per biome through the TintRock surface', () => {
    const scene = new THREE.Scene();
    const s = new Scenery(scene, 42, library, [], RECT, 20, 20, flat, 'volcanic_flats');
    const rock = meshesNamed(scene, 'scenery-rocks')[0]!;
    expect((rock.material as THREE.MeshToonMaterial).color.getHex()).toBe(ROCK_COLOR_BY_BIOME['volcanic_flats']);
    s.dispose();
  });

  it('draws every village house at its position, yaw and w×h×d, with the chimney where ChimneySmoke puffs', () => {
    const scene = new THREE.Scene();
    const s = new Scenery(scene, 42, library, [VILLAGE], RECT, 20, 20, flat, 'green_foothills');
    expect(s.houseInstanceCount).toBe(3);
    const m = new THREE.Matrix4();
    const found: Array<{ x: number; z: number }> = [];
    for (const mesh of meshesNamed(scene, 'scenery-houses')) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        const pos = new THREE.Vector3().setFromMatrixPosition(m);
        const h = VILLAGE.houses.find(hh => Math.abs(hh.x - pos.x) < 1e-6 && Math.abs(hh.z - pos.z) < 1e-6)!;
        expect(h).toBeDefined();
        found.push({ x: pos.x, z: pos.z });
        expect(pos.y).toBe(3);
        const scale = new THREE.Vector3().setFromMatrixScale(m);
        expect(scale.x).toBeCloseTo(h.w);
        expect(scale.y).toBeCloseTo(h.h);
        expect(scale.z).toBeCloseTo(h.d);
        // The model's chimney corner (+0.25, +0.25) in house space must land on
        // ChimneySmoke's puff origin: house + rot(+rotation) · (w/4, d/4).
        const chimney = new THREE.Vector3(0.25, 1.1, 0.25).applyMatrix4(m);
        const cos = Math.cos(h.rotation);
        const sin = Math.sin(h.rotation);
        expect(chimney.x).toBeCloseTo(h.x + (h.w * 0.25) * cos - (h.d * 0.25) * sin, 5);
        expect(chimney.z).toBeCloseTo(h.z + (h.w * 0.25) * sin + (h.d * 0.25) * cos, 5);
      }
    }
    expect(found).toHaveLength(3);
    s.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('draws nothing when the prop assets are not in the library', () => {
    const scene = new THREE.Scene();
    const s = new Scenery(scene, 42, new ModelLibrary(), [VILLAGE], RECT, 20, 20, flat, 'green_foothills');
    expect(s.rockInstanceCount).toBe(0);
    expect(s.houseInstanceCount).toBe(0);
    expect(scene.children).toHaveLength(0);
    // …and names what it lacked, so the renderer can rebuild the layer once those props load.
    // Only the variants this seed and village actually asked for are looked up.
    expect(s.missingModelIds.length).toBeGreaterThan(0);
    expect(s.missingModelIds.some(id => id.startsWith('prop_rock_'))).toBe(true);
    expect(s.missingModelIds.some(id => id.startsWith('prop_house_'))).toBe(true);
    expect(new Set(s.missingModelIds).size).toBe(s.missingModelIds.length);
    s.dispose();
  });

  it('records no missing ids when every prop it drew came from the library', () => {
    const scene = new THREE.Scene();
    const s = new Scenery(scene, 42, library, [VILLAGE], RECT, 20, 20, flat, 'green_foothills');
    expect(s.missingModelIds).toEqual([]);
    s.dispose();
  });
});
