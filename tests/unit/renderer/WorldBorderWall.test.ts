// WorldBorderWall — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WorldBorderWall } from '../../../src/renderer/WorldBorderWall.js';
import type { Rect } from '../../../src/core/world/WorldGen.js';

const RECT: Rect = { minX: 0, minZ: 0, maxX: 64, maxZ: 48 };

function makeWall(scene: THREE.Scene, minGroundY = 5, maxGroundY = 25): WorldBorderWall {
  return new WorldBorderWall(scene, { rect: RECT, minGroundY, maxGroundY });
}

function wallMesh(scene: THREE.Scene): THREE.Mesh {
  return scene.children.find((c) => c.name === 'world-border-wall') as THREE.Mesh;
}

describe('WorldBorderWall', () => {
  it('adds a single mesh standing on all four sides of the rect', () => {
    const scene = new THREE.Scene();
    const wall = makeWall(scene);
    const mesh = wallMesh(scene);
    expect(mesh).toBeDefined();

    const pos = mesh.geometry.getAttribute('position');
    expect(pos.count).toBe(16); // 4 sides x 4 corners
    expect(mesh.geometry.getIndex()!.count).toBe(24); // 4 sides x 2 triangles

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minX = Math.min(minX, pos.getX(i)); maxX = Math.max(maxX, pos.getX(i));
      minZ = Math.min(minZ, pos.getZ(i)); maxZ = Math.max(maxZ, pos.getZ(i));
    }
    expect(minX).toBe(RECT.minX);
    expect(maxX).toBe(RECT.maxX);
    expect(minZ).toBe(RECT.minZ);
    expect(maxZ).toBe(RECT.maxZ);
    wall.dispose();
  });

  it('buries its foot below the lowest ground and reaches above the highest', () => {
    // Terrain has to be able to occlude the bottom edge, or the wall looks
    // like a floating pane rather than something standing in the ground.
    const scene = new THREE.Scene();
    const wall = makeWall(scene, 5, 25);
    const pos = wallMesh(scene).geometry.getAttribute('position');

    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minY = Math.min(minY, pos.getY(i)); maxY = Math.max(maxY, pos.getY(i));
    }
    expect(minY).toBeLessThan(5);
    expect(maxY).toBeGreaterThan(25);
    wall.dispose();
  });

  it('does not write depth, so its four panels never fight each other', () => {
    const scene = new THREE.Scene();
    const wall = makeWall(scene);
    const mat = wallMesh(scene).material as THREE.ShaderMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.side).toBe(THREE.DoubleSide);
    wall.dispose();
  });

  it('tracks the view target, not the camera, so the glow follows where you look', () => {
    const scene = new THREE.Scene();
    const wall = makeWall(scene);
    const mat = wallMesh(scene).material as THREE.ShaderMaterial;

    wall.update(0.016, new THREE.Vector3(12, 3, 40));
    const t = mat.uniforms['uViewTarget']!.value as THREE.Vector3;
    expect(t.x).toBe(12);
    expect(t.z).toBe(40);
    wall.dispose();
  });

  it('advances its own clock so the field animates', () => {
    const scene = new THREE.Scene();
    const wall = makeWall(scene);
    const mat = wallMesh(scene).material as THREE.ShaderMaterial;
    expect(mat.uniforms['uTime']!.value).toBe(0);

    wall.update(0.5, new THREE.Vector3());
    wall.update(0.25, new THREE.Vector3());
    expect(mat.uniforms['uTime']!.value).toBeCloseTo(0.75, 6);
    wall.dispose();
  });

  it('discards entirely far from the view target rather than drawing a faint sheet', () => {
    const scene = new THREE.Scene();
    const wall = makeWall(scene);
    const mat = wallMesh(scene).material as THREE.ShaderMaterial;
    // The fragment shader must bail out, not just fade — an always-drawn
    // transparent pane over the whole perimeter is what this replaces.
    expect(mat.fragmentShader).toContain('discard');
    wall.dispose();
  });

  it('dispose removes it from the scene', () => {
    const scene = new THREE.Scene();
    const wall = makeWall(scene);
    expect(wallMesh(scene)).toBeDefined();
    wall.dispose();
    expect(wallMesh(scene)).toBeUndefined();
  });

  it('copes with a site whose ground is perfectly flat', () => {
    const scene = new THREE.Scene();
    const wall = makeWall(scene, 10, 10);
    const mat = wallMesh(scene).material as THREE.ShaderMaterial;
    expect(Number.isFinite(mat.uniforms['uSpan']!.value as number)).toBe(true);
    expect(mat.uniforms['uSpan']!.value as number).toBeGreaterThan(0);
    expect(Number.isFinite(mat.uniforms['uGroundFrac']!.value as number)).toBe(true);
    wall.dispose();
  });
});
