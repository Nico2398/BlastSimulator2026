// WorkerAnimator — behaviour on the real exported worker rigs

import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { WorkerAnimator, type WorkerSignals } from '../../../../src/renderer/character/WorkerAnimator.js';
import { workerRig, type WorkerRig } from '../../../../src/renderer/character/WorkerRig.js';
import type { ModelLibrary } from '../../../../src/renderer/models/ModelLibrary.js';
import { loadedModelLibrary } from '../../../helpers/models.js';

const STILL: WorkerSignals = { speed: 0, turn: 0, working: false, collapsing: false, evacuating: false, injured: false, fatigue: 90 };
const DT = 1 / 60;

let library: ModelLibrary;
beforeAll(async () => {
  library = await loadedModelLibrary(['worker_driller', 'worker_blaster', 'worker_surveyor', 'worker_manager']);
});

function worker(role = 'driller'): { root: THREE.Group; rig: WorkerRig } {
  const inst = library.instantiate(`worker_${role}`, { size: [1, 1, 1] });
  return { root: inst.root, rig: workerRig(inst.root)! };
}

function world(root: THREE.Object3D, bone: string): THREE.Vector3 {
  root.updateMatrixWorld(true);
  return root.getObjectByName(bone)!.getWorldPosition(new THREE.Vector3());
}

describe('WorkerAnimator', () => {
  it('names the crew rig and measures it', () => {
    const { rig } = worker();
    expect(rig.toolSide).toBe('R');
    expect(rig.tool).toBeGreaterThanOrEqual(0);
    expect(rig.rest.L.sign).toBe(-1);
    expect(rig.rest.R.sign).toBe(1);
    expect(rig.rest.L.legLength).toBeGreaterThan(0.25);
    expect(rig.rest.L.legLength).toBeLessThan(0.5);
    expect(workerRig(new THREE.Group())).toBeNull();
  });

  it('keeps a planted foot still on the ground through mid-stance at walking pace, short legs included', () => {
    for (const [role, speed] of [['driller', 1.6], ['surveyor', 1.6], ['manager', 2]] as const) {
      const { root, rig } = worker(role);
      const a = new WorkerAnimator(rig, role, 7);
      const s = { ...STILL, speed };
      for (let i = 0; i < 180; i++) a.update(DT, s);
      // The body walks a treadmill: ground under it moves back at `speed`.
      let ground = 0;
      let worst = 0;
      let samples = 0;
      let prev: number | null = null;
      for (let i = 0; i < 240; i++) {
        a.update(DT, s);
        ground += speed * DT;
        // Stance of the left foot after the heel-strike roll, through heel-off: the toe joint
        // is the pivot the heel peels about, so it stays put until the foot lifts.
        const ph = a.gaitPhase;
        const toe = world(root, 'ToeL');
        if (ph > 0.1 && ph < 0.38 && toe.y < 0.04) {
          const x = toe.x + ground;
          if (prev !== null) { worst = Math.max(worst, Math.abs(x - prev)); samples++; }
          prev = x;
        } else {
          prev = null;
        }
      }
      expect(samples, role).toBeGreaterThan(10);
      // Per-frame slip of a planted foot: under a millimetre per 1/60 s frame.
      expect(worst, role).toBeLessThan(0.001);
    }
  });

  it('crossfades from idle into the walk and back, holding the walk through a brief stall', () => {
    const { rig } = worker();
    const a = new WorkerAnimator(rig, 'driller', 3);
    expect(a.weightOf('idle')).toBe(1);
    for (let i = 0; i < 60; i++) a.update(DT, { ...STILL, speed: 2 });
    expect(a.weightOf('move')).toBeCloseTo(1, 5);
    // Tween speed pulses between ticks: a few still frames do not stop the gait.
    for (let i = 0; i < 6; i++) a.update(DT, STILL);
    expect(a.weightOf('move')).toBeCloseTo(1, 5);
    for (let i = 0; i < 90; i++) a.update(DT, STILL);
    expect(a.weightOf('idle')).toBeCloseTo(1, 5);
    expect(a.weightOf('move')).toBeCloseTo(0, 5);
  });

  it('a task in progress plays the work loop; collapsing wins over everything', () => {
    const { rig } = worker();
    const a = new WorkerAnimator(rig, 'driller', 3);
    for (let i = 0; i < 60; i++) a.update(DT, { ...STILL, working: true });
    expect(a.weightOf('work')).toBeCloseTo(1, 5);
    for (let i = 0; i < 60; i++) a.update(DT, { ...STILL, working: true, speed: 2, collapsing: true });
    expect(a.weightOf('collapse')).toBeCloseTo(1, 5);
  });

  it('blinks now and then: the lids close briefly and open again', () => {
    const { root, rig } = worker();
    const a = new WorkerAnimator(rig, 'driller', 5);
    const lid = root.getObjectByName('LidL')!;
    const open = lid.quaternion.clone();
    let closedFrames = 0;
    for (let i = 0; i < 60 * 8; i++) {
      a.update(DT, STILL);
      if (lid.quaternion.angleTo(open) > 0.8) closedFrames++;
    }
    expect(closedFrames).toBeGreaterThan(0);
    expect(closedFrames).toBeLessThan(60); // a blink is a flicker, not a nap
  });

  it('is deterministic per seed and differs between seeds', () => {
    const pose = (seed: number): THREE.Quaternion => {
      const { root, rig } = worker();
      const a = new WorkerAnimator(rig, 'driller', seed);
      for (let i = 0; i < 100; i++) a.update(DT, STILL);
      return root.getObjectByName('Head')!.quaternion.clone();
    };
    expect(pose(4).angleTo(pose(4))).toBeLessThan(1e-9);
    expect(pose(4).angleTo(pose(9))).toBeGreaterThan(1e-3);
  });

  it("dangles the blaster's detonator from his fist as one piece, hanging plumb, while he walks", () => {
    const bind = worker('blaster').root;
    bind.updateMatrixWorld(true);
    const toolBind = bind.getObjectByName('Tool')!;
    const bindLocal = toolBind.quaternion.clone();
    const bindWorld = toolBind.getWorldQuaternion(new THREE.Quaternion()).invert();
    const fingers = world(bind, 'HandL').sub(world(bind, 'ForearmL')).normalize();
    const { root, rig } = worker('blaster');
    const a = new WorkerAnimator(rig, 'blaster', 3);
    let checked = 0;
    for (let i = 0; i < 240; i++) {
      a.update(DT, { ...STILL, speed: 1.4 });
      if (i < 60 || i % 10) continue;
      root.updateMatrixWorld(true);
      const tool = root.getObjectByName('Tool')!;
      // The rod rides in the fist: the box keeps its bind offset from the hand.
      expect(tool.quaternion.angleTo(bindLocal), `frame ${i}`).toBeLessThan(0.01);
      // And hangs: what pointed along the fingers at bind now points (nearly) straight down.
      const turned = tool.getWorldQuaternion(new THREE.Quaternion()).multiply(bindWorld);
      expect(fingers.clone().applyQuaternion(turned).y, `frame ${i}`).toBeLessThan(-0.9);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('panicking, both arms fling up and out past the shoulders', () => {
    const { root, rig } = worker('driller');
    const a = new WorkerAnimator(rig, 'driller', 5);
    for (let i = 0; i < 240; i++) {
      a.update(DT, { ...STILL, evacuating: true });
      if (i < 90 || i % 15) continue;
      for (const side of ['L', 'R']) {
        const shoulder = world(root, `UpperArm${side}`);
        const hand = world(root, `Hand${side}`);
        expect(hand.y, `${side} frame ${i}`).toBeGreaterThan(shoulder.y);
        expect(Math.abs(hand.z), `${side} frame ${i}`).toBeGreaterThan(Math.abs(shoulder.z) + 0.05);
      }
    }
  });

  it('a collapsed worker lies with one hand on the ground by his head and the other on his belly, nothing through the floor', () => {
    for (const role of ['driller', 'surveyor', 'manager']) {
      const { root, rig } = worker(role);
      const a = new WorkerAnimator(rig, role, 7);
      for (let i = 0; i < 200; i++) a.update(DT, { ...STILL, collapsing: true, fatigue: 0 });
      const hips = world(root, 'Hips');
      const [flung, belly] = [world(root, 'HandL'), world(root, 'HandR')].sort((p, q) => p.y - q.y);
      expect(flung!.y, `${role} flung hand`).toBeLessThan(0.07);
      expect(belly!.y, `${role} belly hand`).toBeGreaterThan(hips.y);
      expect(Math.abs(belly!.z), `${role} belly hand`).toBeLessThan(0.1);
      for (const bone of ['ForearmL', 'ForearmR', 'HandL', 'HandR']) expect(world(root, bone).y, `${role} ${bone}`).toBeGreaterThan(0);
    }
  });

  it('ignores a zero or negative time step', () => {
    const { root, rig } = worker();
    const a = new WorkerAnimator(rig, 'driller', 1);
    const before = root.getObjectByName('ThighL')!.quaternion.clone();
    a.update(0, { ...STILL, speed: 3 });
    a.update(-1, { ...STILL, speed: 3 });
    expect(root.getObjectByName('ThighL')!.quaternion.equals(before)).toBe(true);
    expect(a.weightOf('move')).toBe(0);
  });
});
