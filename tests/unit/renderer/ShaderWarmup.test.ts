// ShaderWarmup — unit tests (#1603)

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { warmupShaders } from '../../../src/renderer/ShaderWarmup.js';
import { GhostMesh } from '../../../src/renderer/GhostMesh.js';

type WarmupRenderer = Parameters<typeof warmupShaders>[0];

function fakeRenderer(initialTarget: THREE.WebGLRenderTarget | null = null) {
  let bound = initialTarget;
  const calls: Array<{ holder: THREE.Object3D; camera: THREE.Camera; target: THREE.Scene | null | undefined; boundTarget: THREE.WebGLRenderTarget | null }> = [];
  const compile = vi.fn((holder: THREE.Object3D, camera: THREE.Camera, target?: THREE.Scene | null) => {
    calls.push({ holder, camera, target, boundTarget: bound });
    return new Set<THREE.Material>();
  });
  const renderer = {
    compile,
    getRenderTarget: () => bound,
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { bound = t; },
  } as unknown as WarmupRenderer;
  return { renderer, compile, calls, bound: () => bound };
}

describe('warmupShaders', () => {
  it('compiles one mesh per material against the live scene, without adding anything to it', () => {
    const scene = new THREE.Scene();
    scene.add(new THREE.PointLight());
    const before = [...scene.children];
    const camera = new THREE.PerspectiveCamera();
    const materials = [new THREE.MeshPhongMaterial(), new THREE.MeshBasicMaterial({ transparent: true })];
    const { renderer, calls } = fakeRenderer();

    warmupShaders(renderer, camera, scene, materials, null);

    expect(calls).toHaveLength(1);
    const { holder, camera: usedCamera, target } = calls[0]!;
    // Lights come from the target scene: that is what makes the programs match.
    expect(target).toBe(scene);
    expect(usedCamera).toBe(camera);
    expect(holder).not.toBe(scene);
    expect(holder.children.map(c => (c as THREE.Mesh).material)).toEqual(materials);
    expect(scene.children).toEqual(before);
  });

  it('skips the compile when there is nothing to warm', () => {
    const { renderer, compile } = fakeRenderer();
    warmupShaders(renderer, new THREE.PerspectiveCamera(), new THREE.Scene(), [], null);
    expect(compile).not.toHaveBeenCalled();
  });

  it('warms every material a ghost can wear', () => {
    const ghosts = new GhostMesh(new THREE.Scene());
    const { renderer, calls } = fakeRenderer();
    warmupShaders(renderer, new THREE.PerspectiveCamera(), new THREE.Scene(), ghosts.materials, null);
    const warmed = calls[0]!.holder.children.map(c => (c as THREE.Mesh).material);
    expect(warmed).toHaveLength(3);
    expect(new Set(warmed).size).toBe(3);
    ghosts.dispose();
  });

  it('compiles into the target the scene is drawn into, then restores the previous one', () => {
    const previous = new THREE.WebGLRenderTarget(1, 1);
    const sceneTarget = new THREE.WebGLRenderTarget(1, 1);
    const { renderer, calls, bound } = fakeRenderer(previous);
    warmupShaders(renderer, new THREE.PerspectiveCamera(), new THREE.Scene(), [new THREE.MeshPhongMaterial()], sceneTarget);
    expect(calls[0]!.boundTarget).toBe(sceneTarget);
    expect(bound()).toBe(previous);
  });
});
