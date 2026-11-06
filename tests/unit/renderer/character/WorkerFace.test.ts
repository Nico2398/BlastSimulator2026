// Worker faces — lids, lashes and brows stay clear of the eyes in every face state, on the real exported rigs

import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { poseFace } from '../../../../src/renderer/character/WorkerMotion.js';
import { workerRig, type WorkerRig } from '../../../../src/renderer/character/WorkerRig.js';
import type { ModelLibrary } from '../../../../src/renderer/models/ModelLibrary.js';
import { loadedModelLibrary } from '../../../helpers/models.js';

const ROLES = ['driller', 'blaster', 'driver', 'surveyor', 'manager'] as const;
const SIDES = ['L', 'R'] as const;

/** Every face the animator draws, at its extremes: `poseFace(rig, blink, droop, alarm, gasp, pain)`. */
const FACES: Record<string, [number, number, number, number, number]> = {
  rest: [0, 0, 0, 0, 0],
  halfBlink: [0.5, 0, 0, 0, 0],
  shut: [1, 0, 0, 0, 0],
  panic: [0, 0, 1, 1, 0],
  panicBlink: [0.5, 0, 1, 1, 0],
  tired: [0, 1, 0, 0, 0],
  hurt: [0, 0, 0, 0, 1],
  hurtPanic: [0, 0, 1, 1, 1],
};

let library: ModelLibrary;
beforeAll(async () => {
  library = await loadedModelLibrary(ROLES.map((r) => `worker_${r}`));
});

interface RigVertex { mesh: THREE.SkinnedMesh; index: number }

/** Vertices riding `bone` alone; with `colour`, only those of the vertex-coloured buckets that pass it. */
function riding(root: THREE.Object3D, bone: string, colour?: (c: THREE.Color) => boolean): RigVertex[] {
  const out: RigVertex[] = [];
  const c = new THREE.Color();
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.visible) return;
    const g = mesh.geometry;
    const col = g.getAttribute('color');
    if (colour && !col) return;
    const joint = g.getAttribute('skinIndex');
    const weight = g.getAttribute('skinWeight');
    const index = g.index!;
    const end = Math.min(index.count, g.drawRange.start + g.drawRange.count);
    const seen = new Set<number>();
    for (let k = g.drawRange.start; k < end; k++) {
      const i = index.getX(k);
      if (seen.has(i)) continue;
      seen.add(i);
      if (weight.getX(i) < 0.99 || mesh.skeleton.bones[joint.getX(i)]!.name !== bone) continue;
      if (colour && !colour(c.setRGB(col!.getX(i), col!.getY(i), col!.getZ(i)))) continue;
      out.push({ mesh, index: i });
    }
  });
  return out;
}

function positions(vs: RigVertex[]): THREE.Vector3[] {
  return vs.map(({ mesh, index }) => mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
}

function nearest(a: THREE.Vector3[], b: THREE.Vector3[]): number {
  let best = Infinity;
  for (const p of a) for (const q of b) best = Math.min(best, p.distanceToSquared(q));
  return Math.sqrt(best);
}

/** Pose `rig` in one face, from the bind pose, and write it onto the scene. */
function pose(root: THREE.Object3D, rig: WorkerRig, args: [number, number, number, number, number]): void {
  rig.poser.reset();
  poseFace(rig, ...args);
  rig.poser.apply(rig.poser.capture(rig.poser.createBuffer()));
  root.updateMatrixWorld(true);
}

/** The worker posed in each face, with `measure` taken on both sides and the smaller kept (m). */
function gaps(role: string, measure: (root: THREE.Object3D, s: 'L' | 'R') => number): Record<string, number> {
  const root = library.instantiate(`worker_${role}`, { size: [1, 1, 1] }).root;
  const rig = workerRig(root)!;
  const out: Record<string, number> = {};
  for (const [face, args] of Object.entries(FACES)) {
    pose(root, rig, args);
    out[face] = Math.min(...SIDES.map((s) => measure(root, s)));
  }
  return out;
}

/** Side `s`'s eye white and the highlight painted on it: white, riding the head, nearer this eye than the other. */
function whites(root: THREE.Object3D, s: 'L' | 'R'): THREE.Vector3[] {
  const centre = (side: string): THREE.Vector3 => root.getObjectByName(`Lid${side}`)!.getWorldPosition(new THREE.Vector3());
  const here = centre(s);
  const there = centre(s === 'L' ? 'R' : 'L');
  return positions(riding(root, 'Head', (c) => c.r > 0.85 && c.g > 0.85 && c.b > 0.8))
    .filter((p) => p.distanceTo(here) < Math.min(0.08, p.distanceTo(there)));
}

describe('worker faces', () => {
  it('finds each eye: a white on the head, a lid on its own bone and a brow on its own, per side', () => {
    const root = library.instantiate('worker_driller', { size: [1, 1, 1] }).root;
    root.updateMatrixWorld(true);
    for (const s of SIDES) {
      expect(whites(root, s).length, s).toBeGreaterThan(100);
      expect(riding(root, `Lid${s}`).length, s).toBeGreaterThan(100);
      expect(riding(root, `Brow${s}`).length, s).toBeGreaterThan(20);
    }
  });

  it('keeps the lid and its lashes off the eye in every face: open, blinking, shut, wide with panic, drooping, wincing', () => {
    for (const role of ROLES) {
      const gap = gaps(role, (root, s) => nearest(positions(riding(root, `Lid${s}`)), whites(root, s)));
      for (const [face, g] of Object.entries(gap)) expect(g, `${role} ${face}`).toBeGreaterThan(0.001);
    }
  });

  it('keeps the brows well clear of the eyes, raised in panic and tilted in pain included', () => {
    for (const role of ROLES) {
      const gap = gaps(role, (root, s) => nearest(positions(riding(root, `Brow${s}`)), whites(root, s)));
      for (const [face, g] of Object.entries(gap)) expect(g, `${role} ${face}`).toBeGreaterThan(0.004);
    }
  });

  it('turns each lid about its own axis, so a blink never changes how far the lid sits from the eye', () => {
    for (const role of ROLES) {
      const root = library.instantiate(`worker_${role}`, { size: [1, 1, 1] }).root;
      const rig = workerRig(root)!;
      for (const s of SIDES) {
        pose(root, rig, FACES.rest!);
        const lid = riding(root, `Lid${s}`);
        const open = positions(lid);
        const eye = root.getObjectByName(`Lid${s}`)!.getWorldPosition(new THREE.Vector3());
        pose(root, rig, FACES.shut!);
        const shut = positions(lid);
        // The shell is one of revolution about the hinge: each vertex keeps its place along that
        // axis and its distance from the eye's centre — only its angle round the axis changes.
        const axis = rig.rest[s].lidHinge;
        let moved = 0;
        for (let i = 0; i < lid.length; i++) {
          const a = open[i]!.clone().sub(eye);
          const b = shut[i]!.clone().sub(eye);
          expect(Math.abs(a.dot(axis) - b.dot(axis)), `${role} ${s}`).toBeLessThan(1e-4);
          expect(Math.abs(a.length() - b.length()), `${role} ${s}`).toBeLessThan(1e-4);
          moved = Math.max(moved, a.distanceTo(b));
        }
        expect(moved, `${role} ${s}`).toBeGreaterThan(0.03);
      }
    }
  });
});
