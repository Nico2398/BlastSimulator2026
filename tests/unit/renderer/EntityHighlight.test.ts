// EntityHighlight — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EntityHighlight } from '../../../src/renderer/EntityHighlight.js';

describe('EntityHighlight', () => {
  it('show() adds a ring to the scene', () => {
    const scene = new THREE.Scene();
    const highlight = new EntityHighlight(scene);
    highlight.show(new THREE.Vector3(5, 0, 5), 'building');
    expect(scene.children.length).toBe(1);
    expect(highlight.visible).toBe(true);
    highlight.dispose();
  });

  it('ring is positioned at the given world point (with a small ground offset)', () => {
    const scene = new THREE.Scene();
    const highlight = new EntityHighlight(scene);
    highlight.show(new THREE.Vector3(12, 3, 8), 'vehicle');
    const ring = scene.children[0] as THREE.LineLoop;
    expect(ring.position.x).toBeCloseTo(12);
    expect(ring.position.z).toBeCloseTo(8);
    expect(ring.position.y).toBeGreaterThan(3); // lifted above the ground point
    highlight.dispose();
  });

  it('show() replaces a previously shown ring rather than stacking them', () => {
    const scene = new THREE.Scene();
    const highlight = new EntityHighlight(scene);
    highlight.show(new THREE.Vector3(0, 0, 0), 'building');
    highlight.show(new THREE.Vector3(5, 0, 5), 'vehicle');
    expect(scene.children.length).toBe(1);
    highlight.dispose();
  });

  it('hide() removes the ring from the scene', () => {
    const scene = new THREE.Scene();
    const highlight = new EntityHighlight(scene);
    highlight.show(new THREE.Vector3(0, 0, 0), 'employee');
    highlight.hide();
    expect(scene.children.length).toBe(0);
    expect(highlight.visible).toBe(false);
  });

  it('hide() on an already-hidden highlight is a no-op', () => {
    const scene = new THREE.Scene();
    const highlight = new EntityHighlight(scene);
    expect(() => highlight.hide()).not.toThrow();
    expect(scene.children.length).toBe(0);
  });

  it('setPosition() moves the ring for a live entity that keeps moving while selected', () => {
    const scene = new THREE.Scene();
    const highlight = new EntityHighlight(scene);
    highlight.show(new THREE.Vector3(0, 0, 0), 'vehicle');
    highlight.setPosition(new THREE.Vector3(20, 0, -4));
    const ring = scene.children[0] as THREE.LineLoop;
    expect(ring.position.x).toBeCloseTo(20);
    expect(ring.position.z).toBeCloseTo(-4);
    highlight.dispose();
  });

  it('setPosition() before show() is a safe no-op', () => {
    const scene = new THREE.Scene();
    const highlight = new EntityHighlight(scene);
    expect(() => highlight.setPosition(new THREE.Vector3(1, 1, 1))).not.toThrow();
  });

  it('different entity kinds render different ring radii', () => {
    const scene = new THREE.Scene();
    const highlight = new EntityHighlight(scene);
    highlight.show(new THREE.Vector3(0, 0, 0), 'building');
    const buildingGeom = (scene.children[0] as THREE.LineLoop).geometry;
    buildingGeom.computeBoundingBox();
    const buildingRadius = buildingGeom.boundingBox!.max.x;

    highlight.show(new THREE.Vector3(0, 0, 0), 'employee');
    const employeeGeom = (scene.children[0] as THREE.LineLoop).geometry;
    employeeGeom.computeBoundingBox();
    const employeeRadius = employeeGeom.boundingBox!.max.x;

    expect(buildingRadius).toBeGreaterThan(employeeRadius);
    highlight.dispose();
  });

  it('shows a ring for a hole selection without throwing', () => {
    const scene = new THREE.Scene();
    const highlight = new EntityHighlight(scene);
    expect(() => highlight.show(new THREE.Vector3(3, 0, 3), 'hole')).not.toThrow();
    expect(highlight.visible).toBe(true);
    highlight.dispose();
  });

  it('an explicit radius overrides the per-kind default', () => {
    const scene = new THREE.Scene();
    const highlight = new EntityHighlight(scene);
    highlight.show(new THREE.Vector3(0, 0, 0), 'employee', 9);
    const geom = (scene.children[0] as THREE.LineLoop).geometry;
    geom.computeBoundingBox();
    expect(geom.boundingBox!.max.x).toBeCloseTo(9, 1);
    highlight.dispose();
  });

  it('update() animates opacity without throwing when nothing is selected', () => {
    const scene = new THREE.Scene();
    const highlight = new EntityHighlight(scene);
    expect(() => highlight.update(0.1)).not.toThrow();
  });

  it('update() varies the ring material opacity over time', () => {
    const scene = new THREE.Scene();
    const highlight = new EntityHighlight(scene);
    highlight.show(new THREE.Vector3(0, 0, 0), 'building');
    const ring = scene.children[0] as THREE.LineLoop;
    const material = ring.material as THREE.LineDashedMaterial;
    const opacities = new Set<number>();
    for (let i = 0; i < 10; i++) {
      highlight.update(0.3);
      opacities.add(Math.round(material.opacity * 1000));
    }
    expect(opacities.size).toBeGreaterThan(1);
    highlight.dispose();
  });

  it('dispose() releases geometry and material and removes the ring', () => {
    const scene = new THREE.Scene();
    const highlight = new EntityHighlight(scene);
    highlight.show(new THREE.Vector3(0, 0, 0), 'building');
    const ring = scene.children[0] as THREE.LineLoop;
    const geomDisposeSpy = ring.geometry.dispose;
    let disposed = false;
    ring.geometry.dispose = () => { disposed = true; geomDisposeSpy.call(ring.geometry); };
    highlight.dispose();
    expect(disposed).toBe(true);
    expect(scene.children.length).toBe(0);
  });
});
