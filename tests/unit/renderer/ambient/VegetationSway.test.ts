// VegetationSway — unit tests (#458 T7.2/D12/A26)

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  VegetationSway, treeFamilyForBiome, TREE_FAMILY_BY_BIOME, FLOWER_BIOMES, GRASS_COLOR_BY_BIOME, type VegetationModels,
} from '../../../../src/renderer/ambient/VegetationSway.js';
import {
  bushModelId, flowerModelId, grassModelId, treeFarModelId, treeModelId, FLOWER_VARIANTS, GRASS_VARIANTS,
} from '../../../../src/renderer/models/ModelIds.js';
import { loadedModelLibrary } from '../../../helpers/models.js';
import { ModelLibrary } from '../../../../src/renderer/models/ModelLibrary.js';
import { createAmbientUniforms } from '../../../../src/renderer/ambient/AmbientUniforms.js';
import type { TreePoint } from '../../../../src/core/world/Structures.js';
import type { Rect } from '../../../../src/core/world/WorldGen.js';

const RECT: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
const flatGround = () => 5;

function makeTree(overrides?: Partial<TreePoint>): TreePoint {
  return { x: 100, z: 100, h: 5, scale: 1, variant: 0, ...overrides };
}

function treeMeshes(scene: THREE.Scene): THREE.InstancedMesh[] {
  return scene.children.filter((c): c is THREE.InstancedMesh => c.name === 'vegetation-trees');
}
function grassMesh(scene: THREE.Scene): THREE.InstancedMesh | undefined {
  return scene.children.find((c): c is THREE.InstancedMesh => c.name === 'vegetation-grass');
}

describe('VegetationSway', () => {
  it('constructs without a browser/DOM, building one InstancedMesh per tree variant present', () => {
    const scene = new THREE.Scene();
    const trees = [makeTree({ variant: 0 }), makeTree({ variant: 1 }), makeTree({ variant: 0 })];
    const veg = new VegetationSway(scene, 42, createAmbientUniforms(), trees, 16, 16, RECT, flatGround);

    expect(treeMeshes(scene)).toHaveLength(2); // variants 0 and 1 present, 2 absent
    expect(veg.treeInstanceCount).toBe(3);
    veg.dispose();
  });

  it('excludes trees beyond TREE_DRAW_DISTANCE from the landscape centre', () => {
    const scene = new THREE.Scene();
    const trees = [
      makeTree({ x: 16, z: 16, variant: 0 }),   // near centre — included
      makeTree({ x: 5000, z: 5000, variant: 0 }), // far beyond 900m — excluded
    ];
    const veg = new VegetationSway(scene, 42, createAmbientUniforms(), trees, 16, 16, RECT, flatGround);
    expect(veg.treeInstanceCount).toBe(1);
    veg.dispose();
  });

  it('places no tree mesh at all when the tree list is empty', () => {
    const scene = new THREE.Scene();
    const veg = new VegetationSway(scene, 42, createAmbientUniforms(), [], 16, 16, RECT, flatGround);
    expect(treeMeshes(scene)).toHaveLength(0);
    expect(veg.treeInstanceCount).toBe(0);
    veg.dispose();
  });

  it('adds grass instances only in the rim band outside the playable rect, not inside it', () => {
    const scene = new THREE.Scene();
    const veg = new VegetationSway(scene, 42, createAmbientUniforms(), [], 16, 16, RECT, flatGround);
    const mesh = grassMesh(scene);
    expect(mesh).toBeDefined();
    expect(veg.grassInstanceCount).toBeGreaterThan(0);

    const mat = new THREE.Matrix4();
    for (let i = 0; i < mesh!.count; i++) {
      mesh!.getMatrixAt(i, mat);
      const p = new THREE.Vector3().setFromMatrixPosition(mat);
      const insidePlayable = p.x >= RECT.minX && p.x <= RECT.maxX && p.z >= RECT.minZ && p.z <= RECT.maxZ;
      expect(insidePlayable).toBe(false);
    }
    veg.dispose();
  });

  it('samples ground height for grass placement via the provided callback', () => {
    const scene = new THREE.Scene();
    const heights = new Map<string, number>();
    const sampler = (x: number, z: number) => {
      const h = 10 + x * 0.1;
      heights.set(`${Math.round(x)},${Math.round(z)}`, h);
      return h;
    };
    const veg = new VegetationSway(scene, 42, createAmbientUniforms(), [], 16, 16, RECT, sampler);
    expect(heights.size).toBeGreaterThan(0);
    veg.dispose();
  });

  it('tree materials share the ambient uniforms object by reference (one update reaches every material)', () => {
    const scene = new THREE.Scene();
    const ambient = createAmbientUniforms();
    const trees = [makeTree({ variant: 0 })];
    const veg = new VegetationSway(scene, 42, ambient, trees, 16, 16, RECT, flatGround);

    const mesh = treeMeshes(scene)[0]!;
    const material = mesh.material as THREE.MeshStandardMaterial;
    // Force a shader compile so onBeforeCompile actually wires the uniforms —
    // simulate what WebGLRenderer would do by invoking it directly with a
    // minimal fake shader object.
    const fakeShader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '' };
    material.onBeforeCompile(fakeShader as any, null as any);
    expect(fakeShader.uniforms['uTime']).toBe(ambient.uTime);
    expect(fakeShader.uniforms['uWind']).toBe(ambient.uWind);
    veg.dispose();
  });

  it('is deterministic for a given seed', () => {
    const sceneA = new THREE.Scene();
    const sceneB = new THREE.Scene();
    const vegA = new VegetationSway(sceneA, 7, createAmbientUniforms(), [], 16, 16, RECT, flatGround);
    const vegB = new VegetationSway(sceneB, 7, createAmbientUniforms(), [], 16, 16, RECT, flatGround);
    expect(vegA.grassInstanceCount).toBe(vegB.grassInstanceCount);

    const meshA = grassMesh(sceneA)!;
    const meshB = grassMesh(sceneB)!;
    const matA = new THREE.Matrix4();
    const matB = new THREE.Matrix4();
    for (let i = 0; i < meshA.count; i++) {
      meshA.getMatrixAt(i, matA);
      meshB.getMatrixAt(i, matB);
      expect(matA.equals(matB)).toBe(true);
    }
    vegA.dispose();
    vegB.dispose();
  });

  it('dispose removes all tree and grass meshes from the scene', () => {
    const scene = new THREE.Scene();
    const trees = [makeTree({ variant: 0 })];
    const veg = new VegetationSway(scene, 42, createAmbientUniforms(), trees, 16, 16, RECT, flatGround);
    expect(treeMeshes(scene).length).toBeGreaterThan(0);
    expect(grassMesh(scene)).toBeDefined();

    veg.dispose();
    expect(treeMeshes(scene)).toHaveLength(0);
    expect(grassMesh(scene)).toBeUndefined();
  });
});

// ── Prop models: biome trees and bushes from the library, cone tree as fallback ──

describe('VegetationSway — prop models', () => {
  it('draws the biome\'s tree family from the library, with an outline hull sharing each variant\'s instance matrix', async () => {
    const library = await loadedModelLibrary([
      treeModelId('conifer', 0), treeModelId('conifer', 1), treeModelId('conifer', 2), bushModelId(0), bushModelId(1),
    ]);
    const scene = new THREE.Scene();
    const trees = [makeTree({ variant: 0 }), makeTree({ variant: 1, x: 120 }), makeTree({ variant: 0, x: 140 })];
    const veg = new VegetationSway(scene, 42, createAmbientUniforms(), trees, 16, 16, RECT, flatGround, { library, biomeId: 'alpine_granite' } satisfies VegetationModels);
    expect(veg.treeInstanceCount).toBe(3);
    const surfaces = treeMeshes(scene);
    const outlines = scene.children.filter((c): c is THREE.InstancedMesh => c.name === 'vegetation-trees-outline');
    expect(outlines).toHaveLength(2); // one per variant present
    for (const outline of outlines) {
      expect(surfaces.some(s => s.instanceMatrix === outline.instanceMatrix)).toBe(true);
      expect((outline.material as THREE.ShaderMaterial).uniforms['uCanopyHeight']!.value).toBeGreaterThan(3);
    }
    // Bushes fill the rim band once their assets are present.
    expect(veg.bushInstanceCount).toBeGreaterThan(0);
    expect(scene.children.some(c => c.name === 'vegetation-bushes')).toBe(true);
    veg.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('draws trees beyond the detail distance from the decimated far copy, without an outline', async () => {
    const library = await loadedModelLibrary([treeModelId('deciduous', 0), treeFarModelId('deciduous', 0)]);
    const scene = new THREE.Scene();
    // One near the centre (16,16), one 500 m away — same variant.
    const trees = [makeTree({ x: 40, z: 40 }), makeTree({ x: 516, z: 16 })];
    const veg = new VegetationSway(scene, 42, createAmbientUniforms(), trees, 16, 16, RECT, flatGround, { library, biomeId: 'green_foothills' });
    expect(veg.treeInstanceCount).toBe(2);
    const surfaces = treeMeshes(scene);
    expect(surfaces).toHaveLength(2); // near prop + far prop
    const outlines = scene.children.filter(c => c.name === 'vegetation-trees-outline');
    expect(outlines).toHaveLength(1); // only the near prop carries a hull
    const farProto = library.prototype(treeFarModelId('deciduous', 0))!;
    const farGeo = (farProto.root.getObjectByName('Body.painted') as THREE.Mesh).geometry;
    expect(surfaces.some(m => m.geometry === farGeo)).toBe(true);
    veg.dispose();
  });

  it('names the tree and bush ids it stood in for, and none once the library holds them all', async () => {
    const scene = new THREE.Scene();
    const trees = [makeTree({ variant: 0 })];
    const bare = new VegetationSway(scene, 42, createAmbientUniforms(), trees, 16, 16, RECT, flatGround, { library: new ModelLibrary(), biomeId: 'alpine_granite' });
    // Only the tree variants actually planted are looked up; grass, flowers (an alpine biome grows them) and bushes always are.
    expect(bare.missingModelIds).toEqual([
      treeModelId('conifer', 0), grassModelId(0), grassModelId(1), grassModelId(2), flowerModelId(0), flowerModelId(1),
      bushModelId(0), bushModelId(1),
    ]);
    bare.dispose();
    const ids = [0, 1, 2].flatMap(v => [treeModelId('conifer', v), treeFarModelId('conifer', v)]).concat([
      bushModelId(0), bushModelId(1), grassModelId(0), grassModelId(1), grassModelId(2), flowerModelId(0), flowerModelId(1),
    ]);
    const full = new VegetationSway(scene, 42, createAmbientUniforms(), trees, 16, 16, RECT, flatGround, { library: await loadedModelLibrary(ids), biomeId: 'alpine_granite' });
    expect(full.missingModelIds).toEqual([]);
    full.dispose();
  });

  it('draws grass tufts from the library, tinted for the biome and outlined, with wildflowers where the biome is lush', async () => {
    const ids = [...Array.from({ length: GRASS_VARIANTS }, (_, v) => grassModelId(v)), ...Array.from({ length: FLOWER_VARIANTS }, (_, v) => flowerModelId(v))];
    const library = await loadedModelLibrary(ids);
    const scene = new THREE.Scene();
    const veg = new VegetationSway(scene, 42, createAmbientUniforms(), [], 16, 16, RECT, flatGround, { library, biomeId: 'green_foothills' });
    expect(veg.grassInstanceCount).toBeGreaterThan(0);
    expect(veg.flowerInstanceCount).toBeGreaterThan(0);
    expect(veg.missingModelIds).toEqual([bushModelId(0), bushModelId(1)]); // only the bushes were left out of this library
    const tufts = scene.children.filter((c): c is THREE.InstancedMesh => c.name === 'vegetation-grass');
    expect(tufts).toHaveLength(GRASS_VARIANTS);
    // Grass and flowers are the two props drawn without an outline hull: at a tuft's
    // on-screen size the line is noise, and skipping it halves their cost.
    expect(scene.children.filter(c => c.name === 'vegetation-grass-outline')).toHaveLength(0);
    expect(scene.children.filter(c => c.name === 'vegetation-flowers-outline')).toHaveLength(0);
    expect(scene.children.some(c => c.name === 'vegetation-flowers')).toBe(true);
    // The TintGrass surface carries the biome's colour.
    const tint = new THREE.Color(GRASS_COLOR_BY_BIOME['green_foothills']!);
    const painted = tufts.flatMap(t => (Array.isArray(t.material) ? t.material : [t.material]) as THREE.MeshToonMaterial[]);
    expect(painted.some(m => m.color.getHex() === tint.getHex())).toBe(true);
    veg.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('grows no flowers on a desert rim and tints its grass straw-coloured', async () => {
    const library = await loadedModelLibrary([grassModelId(0), grassModelId(1), grassModelId(2)]);
    const scene = new THREE.Scene();
    const veg = new VegetationSway(scene, 42, createAmbientUniforms(), [], 16, 16, RECT, flatGround, { library, biomeId: 'desert_badlands' });
    expect(FLOWER_BIOMES.has('desert_badlands')).toBe(false);
    expect(veg.flowerInstanceCount).toBe(0);
    expect(scene.children.some(c => c.name === 'vegetation-flowers')).toBe(false);
    expect(veg.grassInstanceCount).toBeGreaterThan(0);
    const tuft = scene.children.find((c): c is THREE.InstancedMesh => c.name === 'vegetation-grass')!;
    const mats = (Array.isArray(tuft.material) ? tuft.material : [tuft.material]) as THREE.MeshToonMaterial[];
    expect(mats.some(m => m.color.getHex() === GRASS_COLOR_BY_BIOME['desert_badlands'])).toBe(true);
    veg.dispose();
  });

  it('maps every biome to a tree family and unknown biomes to deciduous', () => {
    expect(treeFamilyForBiome('alpine_granite')).toBe('conifer');
    expect(treeFamilyForBiome('desert_badlands')).toBe('desert');
    expect(treeFamilyForBiome('red_canyon')).toBe('desert');
    expect(treeFamilyForBiome('tropical_karst')).toBe('tropical');
    expect(treeFamilyForBiome('volcanic_flats')).toBe('volcanic');
    expect(treeFamilyForBiome('green_foothills')).toBe('deciduous');
    expect(treeFamilyForBiome('nowhere')).toBe('deciduous');
    expect(treeFamilyForBiome(undefined)).toBe('deciduous');
    expect(Object.keys(TREE_FAMILY_BY_BIOME)).toHaveLength(6);
  });

  it('gives each tree a seeded yaw so a forest is not a row of identical silhouettes', () => {
    const scene = new THREE.Scene();
    const trees = [makeTree({ x: 100 }), makeTree({ x: 130 }), makeTree({ x: 160 })];
    const veg = new VegetationSway(scene, 42, createAmbientUniforms(), trees, 16, 16, RECT, flatGround);
    const mesh = treeMeshes(scene)[0]!;
    const m = new THREE.Matrix4();
    const yaws = new Set<number>();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      yaws.add(+new THREE.Euler().setFromRotationMatrix(m).y.toFixed(3));
    }
    expect(yaws.size).toBe(3);
    veg.dispose();
  });
});
