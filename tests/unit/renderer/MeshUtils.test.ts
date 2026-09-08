// MeshUtils — shared disposal and colour helpers

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { brightenColor, disposeGroup } from '../../../src/renderer/MeshUtils.js';

describe('disposeGroup', () => {
  it('disposes the geometry and material of every mesh and line child, array materials included', () => {
    const group = new THREE.Group();
    const single = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    const multi = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]);
    const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    group.add(single, multi, line, new THREE.Object3D());
    const spies = [
      vi.spyOn(single.geometry, 'dispose'), vi.spyOn(single.material as THREE.Material, 'dispose'),
      vi.spyOn(multi.geometry, 'dispose'),
      ...(multi.material as THREE.Material[]).map(m => vi.spyOn(m, 'dispose')),
      vi.spyOn(line.geometry, 'dispose'), vi.spyOn(line.material as THREE.Material, 'dispose'),
    ];
    disposeGroup(group);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it('is a no-op on an empty group', () => {
    expect(() => disposeGroup(new THREE.Group())).not.toThrow();
  });
});

describe('brightenColor', () => {
  it('returns the colour unchanged for a zero or negative shift', () => {
    expect(brightenColor(0xff6600, 0)).toBe(0xff6600);
    expect(brightenColor(0xff6600, -0.5)).toBe(0xff6600);
  });

  it('moves every channel toward white by the shift fraction', () => {
    expect(brightenColor(0x000000, 0.5)).toBe(0x808080);
    expect(brightenColor(0xff6600, 1)).toBe(0xffffff);
    const half = brightenColor(0x2266ff, 0.5);
    expect((half >> 16) & 0xff).toBe(Math.round(0x22 + (0xff - 0x22) * 0.5));
    expect((half >> 8) & 0xff).toBe(Math.round(0x66 + (0xff - 0x66) * 0.5));
    expect(half & 0xff).toBe(0xff);
  });
});
