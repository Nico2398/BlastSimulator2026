// VegetationSway — unit tests (#458 T7.2/D12/A26)

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VegetationSway } from '../../../../src/renderer/ambient/VegetationSway.js';
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
