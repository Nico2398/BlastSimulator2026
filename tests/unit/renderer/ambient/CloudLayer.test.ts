// CloudLayer — unit tests (#458 T7.1/D12/A25, cartoon puffs #1602)

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CloudLayer } from '../../../../src/renderer/ambient/CloudLayer.js';

function makeSetup(seed = 42) {
  const scene = new THREE.Scene();
  const clouds = new CloudLayer(scene, seed, 80, 80);
  return { scene, clouds };
}

function instancedMeshes(scene: THREE.Scene): THREE.InstancedMesh[] {
  return scene.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);
}

function outlineOf(mesh: THREE.InstancedMesh): THREE.InstancedMesh {
  const hull = mesh.children.find((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);
  expect(hull).toBeDefined();
  return hull!;
}

function surfaceColor(mesh: THREE.InstancedMesh, uniform: string): THREE.Color {
  return (mesh.material as THREE.ShaderMaterial).uniforms[uniform]!.value as THREE.Color;
}

function luminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

describe('CloudLayer', () => {
  it('constructs without a browser/DOM and adds 5 cluster-variant InstancedMeshes to the scene', () => {
    const { scene, clouds } = makeSetup();
    const meshes = instancedMeshes(scene);
    expect(meshes).toHaveLength(5);
    clouds.dispose();
  });

  it('starts with a non-empty cloud coverage matching the sunny default', () => {
    const { clouds } = makeSetup();
    expect(clouds.cloudCoverage).toBeGreaterThan(0);
    expect(clouds.cloudCoverage).toBeLessThan(1);
    clouds.dispose();
  });

  it('cloudOffset accumulates with a non-zero wind vector and stays put with none', () => {
    const { clouds } = makeSetup();
    const before = clouds.cloudOffset.clone();
    clouds.update(1, { x: 0, z: 0 });
    expect(clouds.cloudOffset.x).toBeCloseTo(before.x, 10);
    expect(clouds.cloudOffset.y).toBeCloseTo(before.y, 10);

    clouds.update(1, { x: 1, z: 0 });
    expect(clouds.cloudOffset.x).toBeGreaterThan(before.x);
    clouds.dispose();
  });

  it('setWeather(storm) raises coverage toward 1.0 over successive updates', () => {
    const { clouds } = makeSetup();
    clouds.setWeather('storm');
    const before = clouds.cloudCoverage;
    for (let i = 0; i < 200; i++) clouds.update(0.05, { x: 0, z: 0 });
    expect(clouds.cloudCoverage).toBeGreaterThan(before);
    expect(clouds.cloudCoverage).toBeGreaterThan(0.95);
    clouds.dispose();
  });

  it('setWeather(heat_wave) lowers coverage toward its sparse target', () => {
    const { clouds } = makeSetup();
    clouds.setWeather('storm');
    for (let i = 0; i < 200; i++) clouds.update(0.05, { x: 0, z: 0 });
    clouds.setWeather('heat_wave');
    for (let i = 0; i < 200; i++) clouds.update(0.05, { x: 0, z: 0 });
    expect(clouds.cloudCoverage).toBeLessThan(0.15);
    clouds.dispose();
  });

  it('higher coverage draws at least as many total instances as lower coverage', () => {
    const { scene, clouds } = makeSetup();
    clouds.setWeather('heat_wave');
    for (let i = 0; i < 200; i++) clouds.update(0.05, { x: 0, z: 0 });
    const sparseTotal = instancedMeshes(scene).reduce((s, m) => s + m.count, 0);

    clouds.setWeather('storm');
    for (let i = 0; i < 200; i++) clouds.update(0.05, { x: 0, z: 0 });
    const denseTotal = instancedMeshes(scene).reduce((s, m) => s + m.count, 0);

    expect(denseTotal).toBeGreaterThan(sparseTotal);
    clouds.dispose();
  });

  it('is deterministic for a given seed — same seed places instances identically', () => {
    const a = makeSetup(99);
    const b = makeSetup(99);
    const meshesA = instancedMeshes(a.scene);
    const meshesB = instancedMeshes(b.scene);
    const matA = new THREE.Matrix4();
    const matB = new THREE.Matrix4();
    for (let v = 0; v < meshesA.length; v++) {
      meshesA[v]!.getMatrixAt(0, matA);
      meshesB[v]!.getMatrixAt(0, matB);
      expect(matA.equals(matB)).toBe(true);
    }
    a.clouds.dispose();
    b.clouds.dispose();
  });

  it('builds every cluster smooth-shaded: indexed, with vertex normals that vary across each triangle', () => {
    // The low-poly look #1602 removed came from flat shading — every
    // triangle's three normals identical, so each facet read as a plane.
    const { scene, clouds } = makeSetup();
    const n0 = new THREE.Vector3();
    const n1 = new THREE.Vector3();
    const n2 = new THREE.Vector3();
    for (const mesh of instancedMeshes(scene)) {
      const geo = mesh.geometry;
      const index = geo.getIndex();
      expect(index).not.toBeNull();
      const normal = geo.getAttribute('normal') as THREE.BufferAttribute;
      let flat = 0;
      for (let t = 0; t < index!.count; t += 3) {
        n0.fromBufferAttribute(normal, index!.getX(t));
        n1.fromBufferAttribute(normal, index!.getX(t + 1));
        n2.fromBufferAttribute(normal, index!.getX(t + 2));
        if (n0.distanceTo(n1) < 1e-6 && n1.distanceTo(n2) < 1e-6) flat++;
      }
      expect(flat / (index!.count / 3)).toBeLessThan(0.01);
    }
    clouds.dispose();
  });

  it('keeps each cluster inside its triangle budget (drawn up to 8 times per variant, twice with the outline)', () => {
    const { scene, clouds } = makeSetup();
    for (const mesh of instancedMeshes(scene)) {
      const triangles = mesh.geometry.getIndex()!.count / 3;
      expect(triangles).toBeGreaterThan(1000);
      expect(triangles).toBeLessThan(6000);
    }
    clouds.dispose();
  });

  it('gives every cluster a flat underside: its lowest vertices share one base height', () => {
    const { scene, clouds } = makeSetup();
    for (const mesh of instancedMeshes(scene)) {
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const ys = Array.from({ length: pos.count }, (_, i) => pos.getY(i)).sort((a, b) => a - b);
      const height = ys[ys.length - 1]! - ys[0]!;
      // The bottom tenth of the vertices sits within 5% of the cloud's height of the lowest one.
      expect(ys[Math.floor(ys.length / 10)]! - ys[0]!).toBeLessThan(height * 0.05);
    }
    clouds.dispose();
  });

  it('outlines every cluster with an inverted hull that shares its instances and visible count', () => {
    const { scene, clouds } = makeSetup();
    clouds.setWeather('cloudy');
    for (let i = 0; i < 50; i++) clouds.update(0.05, { x: 1, z: 0 });
    for (const mesh of instancedMeshes(scene)) {
      const hull = outlineOf(mesh);
      expect(hull.geometry).toBe(mesh.geometry);
      expect(hull.instanceMatrix).toBe(mesh.instanceMatrix);
      expect(hull.count).toBe(mesh.count);
      const material = hull.material as THREE.ShaderMaterial;
      expect(material.side).toBe(THREE.BackSide);
      expect(material.uniforms['depthPush']!.value).toBeGreaterThan(0);
    }
    clouds.dispose();
  });

  it('opts out of frustum culling — instances drift far from where a first-frame bounding sphere would put them', () => {
    const { scene, clouds } = makeSetup();
    for (const mesh of instancedMeshes(scene)) {
      expect(mesh.frustumCulled).toBe(false);
      expect(outlineOf(mesh).frustumCulled).toBe(false);
    }
    clouds.dispose();
  });

  it('darkens the clouds and their outline toward the storm palette, then clears again', () => {
    const { scene, clouds } = makeSetup();
    const mesh = instancedMeshes(scene)[0]!;
    const fairLit = luminance(surfaceColor(mesh, 'uLit'));
    const fairOutline = luminance((outlineOf(mesh).material as THREE.ShaderMaterial).uniforms['color']!.value as THREE.Color);

    clouds.setWeather('storm');
    // setWeather alone retargets; the paint moves only as update() runs.
    expect(luminance(surfaceColor(mesh, 'uLit'))).toBeCloseTo(fairLit, 10);
    for (let i = 0; i < 200; i++) clouds.update(0.05, { x: 0, z: 0 });
    expect(luminance(surfaceColor(mesh, 'uLit'))).toBeLessThan(fairLit * 0.5);
    expect(luminance((outlineOf(mesh).material as THREE.ShaderMaterial).uniforms['color']!.value as THREE.Color))
      .toBeLessThan(fairOutline);

    clouds.setWeather('sunny');
    // Exponential approach: ten time constants of TRANSITION_SPEED land within 1e-4.
    for (let i = 0; i < 400; i++) clouds.update(0.05, { x: 0, z: 0 });
    expect(luminance(surfaceColor(mesh, 'uLit'))).toBeCloseTo(fairLit, 3);
    clouds.dispose();
  });

  it('dispose removes all cluster meshes from the scene', () => {
    const { scene, clouds } = makeSetup();
    expect(instancedMeshes(scene)).toHaveLength(5);
    clouds.dispose();
    expect(instancedMeshes(scene)).toHaveLength(0);
  });
});
