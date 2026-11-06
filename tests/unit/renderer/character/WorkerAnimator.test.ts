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
  library = await loadedModelLibrary(['worker_driller', 'worker_blaster', 'worker_driver', 'worker_surveyor', 'worker_manager']);
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
        // Stance of the left foot once the heel-strike roll has laid it flat (by 0.15 of the
        // cycle at any duty), through heel-off: the toe joint is the pivot the heel peels
        // about, so it stays put until the foot lifts.
        const ph = a.gaitPhase;
        const toe = world(root, 'ToeL');
        if (ph > 0.15 && ph < 0.38 && toe.y < 0.04) {
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

  it('panicking, he holds his hat on with one hand and flings the other up and out past the shoulder', () => {
    const { root, rig } = worker('driller');
    const a = new WorkerAnimator(rig, 'driller', 5);
    // The driller's tool is in his right hand, so the left one holds the hat.
    for (let i = 0; i < 240; i++) {
      a.update(DT, { ...STILL, evacuating: true });
      if (i < 90 || i % 15) continue;
      const hat = world(root, 'Hat');
      const onHat = world(root, 'HandL');
      expect(onHat.distanceTo(hat), `hat hand frame ${i}`).toBeLessThan(0.22);
      expect(onHat.y, `hat hand frame ${i}`).toBeGreaterThan(world(root, 'UpperArmL').y);
      const shoulder = world(root, 'UpperArmR');
      const flung = world(root, 'HandR');
      expect(flung.y, `flung hand frame ${i}`).toBeGreaterThan(shoulder.y);
      expect(Math.abs(flung.z), `flung hand frame ${i}`).toBeGreaterThan(Math.abs(shoulder.z) + 0.05);
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

  it('an errand is a walk, one foot always down; fleeing is a run with both feet off the ground between steps', () => {
    for (const role of ['driller', 'surveyor', 'manager']) {
      const lowestFoot = (root: THREE.Group): number =>
        Math.min(world(root, 'ToeL').y, world(root, 'ToeR').y, world(root, 'FootL').y - 0.06, world(root, 'FootR').y - 0.06);
      for (const [evacuating, flight] of [[false, false], [true, true]] as const) {
        const { root, rig } = worker(role);
        const a = new WorkerAnimator(rig, role, 7);
        for (let i = 0; i < 180; i++) a.update(DT, { ...STILL, speed: 2, evacuating });
        let airborne = 0;
        for (let i = 0; i < 120; i++) {
          a.update(DT, { ...STILL, speed: 2, evacuating });
          if (lowestFoot(root) > 0.05) airborne++;
        }
        if (flight) expect(airborne, `${role} fleeing`).toBeGreaterThan(5);
        else expect(airborne, `${role} on an errand`).toBe(0);
      }
    }
  });

  it("carries the driller's drill hanging plumb from his fist while he walks", () => {
    const bind = worker('driller').root;
    bind.updateMatrixWorld(true);
    const handBind = bind.getObjectByName('HandR')!.getWorldQuaternion(new THREE.Quaternion()).invert();
    const fingers = world(bind, 'HandR').sub(world(bind, 'ForearmR')).normalize();
    const { root, rig } = worker('driller');
    const a = new WorkerAnimator(rig, 'driller', 3);
    for (let i = 0; i < 240; i++) {
      a.update(DT, { ...STILL, speed: 2 });
      if (i < 60 || i % 10) continue;
      root.updateMatrixWorld(true);
      const turned = root.getObjectByName('HandR')!.getWorldQuaternion(new THREE.Quaternion()).multiply(handBind);
      expect(fingers.clone().applyQuaternion(turned).y, `frame ${i}`).toBeLessThan(-0.9);
    }
  });

  it("keeps the blaster's detonator box on the ground while the plunger strokes", () => {
    const { root, rig } = worker('blaster');
    const a = new WorkerAnimator(rig, 'blaster', 3);
    const boxY: number[] = [];
    const handY: number[] = [];
    for (let i = 0; i < 300; i++) {
      a.update(DT, { ...STILL, working: true });
      if (i < 60) continue;
      boxY.push(world(root, 'Tool').y);
      handY.push(world(root, 'HandL').y);
    }
    expect(Math.max(...boxY) - Math.min(...boxY)).toBeLessThan(0.005);
    expect(Math.max(...handY) - Math.min(...handY)).toBeGreaterThan(0.07);
  });

  it('spent, he props both hands on his knees; injured, he presses his free hand to the leg he favours', () => {
    const { root, rig } = worker('driller');
    const tired = new WorkerAnimator(rig, 'driller', 3);
    for (let i = 0; i < 240; i++) tired.update(DT, { ...STILL, fatigue: 2 });
    for (const side of ['L', 'R']) {
      expect(world(root, `Hand${side}`).distanceTo(world(root, `Shin${side}`)), `${side} hand on knee`).toBeLessThan(0.14);
    }
    const hurt = worker('driller');
    const limp = new WorkerAnimator(hurt.rig, 'driller', 3);
    for (let i = 0; i < 240; i++) limp.update(DT, { ...STILL, injured: true });
    const s = hurt.rig.freeSide;
    const thigh = world(hurt.root, `Thigh${s}`).lerp(world(hurt.root, `Shin${s}`), 0.45);
    expect(world(hurt.root, `Hand${s}`).distanceTo(thigh)).toBeLessThan(0.14);
  });

  it("opens a hand that holds nothing: a collapsed worker's fingers uncurl from the fist they are bound in", () => {
    const { root, rig } = worker('driller');
    expect(rig.rest.L.fingerHinge, 'finger bones').not.toBeNull();
    // The fingertip: the far end of the tip segment, along its bone.
    const reach = (): number => {
      root.updateMatrixWorld(true);
      const tip = new THREE.Vector3(0, 0.03, 0).applyMatrix4(root.getObjectByName('FingerTipsL')!.matrixWorld);
      return tip.distanceTo(world(root, 'HandL'));
    };
    const P = rig.poser;
    P.reset();
    P.apply(P.capture(P.createBuffer()));
    const fist = reach();
    const a = new WorkerAnimator(rig, 'driller', 7);
    for (let i = 0; i < 200; i++) a.update(DT, { ...STILL, collapsing: true, fatigue: 0 });
    expect(reach()).toBeGreaterThan(fist * 1.25);
  });

  it("every role's work loop works the tool hand through a real stroke, and nothing sinks into the ground", () => {
    for (const role of ['driller', 'blaster', 'driver', 'surveyor', 'manager']) {
      const { root, rig } = worker(role);
      const a = new WorkerAnimator(rig, role, 5);
      const hand = `Hand${rig.toolSide ?? 'R'}`;
      let lo = new THREE.Vector3(Infinity, Infinity, Infinity);
      let hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      let lowest = Infinity;
      for (let i = 0; i < 300; i++) {
        a.update(DT, { ...STILL, working: true });
        if (i < 30) continue;
        const h = world(root, hand);
        lo = lo.min(h);
        hi = hi.max(h);
        root.traverse(o => { if (o instanceof THREE.Bone) lowest = Math.min(lowest, o.getWorldPosition(new THREE.Vector3()).y); });
      }
      expect(hi.sub(lo).length(), `${role} stroke`).toBeGreaterThan(0.04);
      expect(lowest, `${role} lowest bone`).toBeGreaterThan(-0.03);
    }
  });

  it('every role keeps its tool up off the ground standing about and walking', () => {
    for (const role of ['driller', 'blaster', 'driver', 'surveyor', 'manager']) {
      for (const speed of [0, 2]) {
        const { root, rig } = worker(role);
        const a = new WorkerAnimator(rig, role, 5);
        for (let i = 0; i < 240; i++) {
          a.update(DT, { ...STILL, speed });
          if (i > 60 && i % 20 === 0) expect(world(root, 'Tool').y, `${role} at ${speed} m/s`).toBeGreaterThan(0.1);
        }
      }
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
