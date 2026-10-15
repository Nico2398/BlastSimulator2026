// BlastSimulator2026 — RallyFlagMesh: the flag planted on the site's rally point

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RallyFlagMesh, RALLY_FLAG_NAME } from '../../../src/renderer/RallyFlagMesh.js';

const ground = (y: number) => (): number => y;

describe('RallyFlagMesh', () => {
  it('plants nothing while the state has no rally point', () => {
    const scene = new THREE.Scene();
    new RallyFlagMesh(scene).sync(undefined, ground(4));
    expect(scene.children).toHaveLength(0);
  });

  it('plants one flag on the rally point, standing on the sampled ground', () => {
    const scene = new THREE.Scene();
    const flag = new RallyFlagMesh(scene);
    flag.sync({ x: 12, z: 20 }, ground(4));
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]!.name).toBe(RALLY_FLAG_NAME);
    expect(flag.position).toEqual(new THREE.Vector3(12, 4, 20));
    const box = new THREE.Box3().setFromObject(scene.children[0]!);
    // The cairn at its foot is bedded a little into the ground, never buried.
    expect(box.min.y).toBeGreaterThan(3.5);
    expect(box.max.y).toBeGreaterThan(6);
  });

  it('sinks with the ground when a dig or a blast lowers it, keeping the one flag', () => {
    const scene = new THREE.Scene();
    const flag = new RallyFlagMesh(scene);
    flag.sync({ x: 12, z: 20 }, ground(4));
    const planted = scene.children[0];
    flag.sync({ x: 12, z: 20 }, ground(-3));
    expect(scene.children).toEqual([planted]);
    expect(flag.position!.y).toBe(-3);
  });

  it('is removed when the rally point goes away and on dispose', () => {
    const scene = new THREE.Scene();
    const flag = new RallyFlagMesh(scene);
    flag.sync({ x: 1, z: 1 }, ground(0));
    flag.sync(undefined, ground(0));
    expect(scene.children).toHaveLength(0);
    expect(flag.position).toBeNull();
    flag.sync({ x: 1, z: 1 }, ground(0));
    flag.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
