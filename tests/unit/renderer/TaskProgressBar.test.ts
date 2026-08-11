// TaskProgressBar — unit tests (#546)
// Billboarded fill-bar floating above each currently-working employee.
// Fixture shape follows tests/unit/entities/EmployeeActivity.test.ts's
// makeEmployee/makeVehicle helpers (the same functions computeEmployeeActivity
// is exercised against), since TaskProgressBar's own state derives from that
// function's 'working' classification.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TaskProgressBar } from '../../../src/renderer/TaskProgressBar.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 1, name: 'Test Employee', role: 'driller', salary: 1000, morale: 60,
    unionized: false, injured: false, alive: true,
    x: 0, z: 0,
    qualifications: [],
    trainingState: null,
    activeActionId: null,
    hunger: 100, fatigue: 100, breakNeed: 100,
    collapsing: false,
    interruptedActionPayload: null,
    ticksWorked: 0,
    restTicksRemaining: null,
    restNeedKey: null,
    taskTicksRemaining: null,
    activeTaskSkill: null,
    destinationX: null,
    destinationZ: null,
    moveConsecutiveFailures: 0,
    isMoveStuck: false,
    pendingRestDuration: null,
    pendingRestNeedKey: null,
    pendingTaskDuration: null,
    pendingActionType: null,
    pendingActionPayload: null,
    pendingDriverVehicleId: null,
    ...overrides,
  };
}

/** Unused directly (sync's vehicles arg is only consulted by computeEmployeeActivity
 * for the 'driving' state, irrelevant here), kept for signature parity with sync(). */
const NO_VEHICLES: Vehicle[] = [];

function makeCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 4000);
}

/** Every THREE.Mesh anywhere under `object`, recursively. */
function collectMeshes(object: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  object.traverse(child => {
    if ((child as THREE.Mesh).isMesh) out.push(child as THREE.Mesh);
  });
  return out;
}

/**
 * The bar's fill mesh under `anchor` — distinguished from the track mesh by
 * FILL_Z_OFFSET (the only mesh TaskProgressBar ever offsets on Z, to sit in
 * front of the track and avoid z-fighting). The track mesh's scale.x is
 * never touched — it stays at THREE's default of 1 — so keying off Z instead
 * of "any mesh" ensures this actually checks the fill level, not a
 * coincidental default.
 */
function findFillMesh(anchor: THREE.Object3D): THREE.Mesh {
  const fill = collectMeshes(anchor).find(m => m.position.z !== 0);
  if (!fill) throw new Error('no fill mesh found under anchor');
  return fill;
}

describe('TaskProgressBar', () => {
  it('a working employee produces exactly one indicator', () => {
    const scene = new THREE.Scene();
    const bar = new TaskProgressBar(scene, makeCamera());
    const anchor = new THREE.Group();
    scene.add(anchor);
    const emp = makeEmployee({ id: 1, taskTicksRemaining: 10, activeTaskTotalTicks: 20 });

    bar.sync([emp], NO_VEHICLES, id => (id === 1 ? anchor : null));

    expect(bar.count).toBe(1);
    bar.dispose();
  });

  describe('fill ratio tracks task completion progress', () => {
    it('reads ~0 just after the task starts (ticksRemaining ≈ totalTicks)', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const anchor = new THREE.Group();
      scene.add(anchor);
      const emp = makeEmployee({ id: 1, taskTicksRemaining: 20, activeTaskTotalTicks: 20 });

      bar.sync([emp], NO_VEHICLES, id => (id === 1 ? anchor : null));

      expect(findFillMesh(anchor).scale.x).toBeCloseTo(0, 5);
      bar.dispose();
    });

    it('reads ~0.5 halfway through the task', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const anchor = new THREE.Group();
      scene.add(anchor);
      const emp = makeEmployee({ id: 1, taskTicksRemaining: 10, activeTaskTotalTicks: 20 });

      bar.sync([emp], NO_VEHICLES, id => (id === 1 ? anchor : null));

      expect(findFillMesh(anchor).scale.x).toBeCloseTo(0.5, 5);
      bar.dispose();
    });

    it('reads ~0.95 just before the task completes', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const anchor = new THREE.Group();
      scene.add(anchor);
      const emp = makeEmployee({ id: 1, taskTicksRemaining: 1, activeTaskTotalTicks: 20 });

      bar.sync([emp], NO_VEHICLES, id => (id === 1 ? anchor : null));

      expect(findFillMesh(anchor).scale.x).toBeCloseTo(0.95, 5);
      bar.dispose();
    });
  });

  it('an idle employee produces no indicator', () => {
    const scene = new THREE.Scene();
    const bar = new TaskProgressBar(scene, makeCamera());
    const anchor = new THREE.Group();
    scene.add(anchor);
    const emp = makeEmployee({ id: 1 }); // all activity fields default → idle

    bar.sync([emp], NO_VEHICLES, id => (id === 1 ? anchor : null));

    expect(bar.count).toBe(0);
    expect(anchor.children.length).toBe(0);
    bar.dispose();
  });

  it('a walking employee produces no indicator', () => {
    const scene = new THREE.Scene();
    const bar = new TaskProgressBar(scene, makeCamera());
    const anchor = new THREE.Group();
    scene.add(anchor);
    const emp = makeEmployee({ id: 1, destinationX: 12, destinationZ: 4, pendingActionType: 'drill_hole' });

    bar.sync([emp], NO_VEHICLES, id => (id === 1 ? anchor : null));

    expect(bar.count).toBe(0);
    expect(anchor.children.length).toBe(0);
    bar.dispose();
  });

  it('a resting employee produces no indicator (rest gets no progress bar, per plan)', () => {
    const scene = new THREE.Scene();
    const bar = new TaskProgressBar(scene, makeCamera());
    const anchor = new THREE.Group();
    scene.add(anchor);
    const emp = makeEmployee({ id: 1, restTicksRemaining: 7 });

    bar.sync([emp], NO_VEHICLES, id => (id === 1 ? anchor : null));

    expect(bar.count).toBe(0);
    expect(anchor.children.length).toBe(0);
    bar.dispose();
  });

  it('an old-save employee with taskTicksRemaining but no activeTaskTotalTicks gets no fabricated bar', () => {
    const scene = new THREE.Scene();
    const bar = new TaskProgressBar(scene, makeCamera());
    const anchor = new THREE.Group();
    scene.add(anchor);
    // activeTaskTotalTicks intentionally omitted — computeEmployeeActivity
    // reports totalTicks: null for this shape (old save, pre-#546 field).
    const emp = makeEmployee({ id: 1, taskTicksRemaining: 8 });

    bar.sync([emp], NO_VEHICLES, id => (id === 1 ? anchor : null));

    expect(bar.count).toBe(0);
    expect(anchor.children.length).toBe(0);
    bar.dispose();
  });

  it('completing the task removes the bar on the next sync', () => {
    const scene = new THREE.Scene();
    const bar = new TaskProgressBar(scene, makeCamera());
    const anchor = new THREE.Group();
    scene.add(anchor);
    const working = makeEmployee({ id: 1, taskTicksRemaining: 5, activeTaskTotalTicks: 20 });

    bar.sync([working], NO_VEHICLES, id => (id === 1 ? anchor : null));
    expect(bar.count).toBe(1);
    const childrenWhileWorking = anchor.children.length;
    expect(childrenWhileWorking).toBeGreaterThan(0);

    const idle = makeEmployee({ id: 1 }); // task cleared → idle
    bar.sync([idle], NO_VEHICLES, id => (id === 1 ? anchor : null));

    expect(bar.count).toBe(0);
    expect(anchor.children.length).toBe(0);
    bar.dispose();
  });

  it('dispose() leaves nothing behind', () => {
    const scene = new THREE.Scene();
    const bar = new TaskProgressBar(scene, makeCamera());
    const anchor = new THREE.Group();
    scene.add(anchor);
    const emp = makeEmployee({ id: 1, taskTicksRemaining: 5, activeTaskTotalTicks: 20 });

    bar.sync([emp], NO_VEHICLES, id => (id === 1 ? anchor : null));
    expect(bar.count).toBeGreaterThan(0);

    bar.dispose();

    expect(bar.count).toBe(0);
    expect(anchor.children.length).toBe(0);
  });

  it('update() billboards the bar group to face the camera', () => {
    const scene = new THREE.Scene();
    const camera = makeCamera();
    camera.quaternion.setFromEuler(new THREE.Euler(0.4, 1.1, 0.2));
    const bar = new TaskProgressBar(scene, camera);
    const anchor = new THREE.Group();
    scene.add(anchor);
    const emp = makeEmployee({ id: 1, taskTicksRemaining: 10, activeTaskTotalTicks: 20 });

    bar.sync([emp], NO_VEHICLES, id => (id === 1 ? anchor : null));
    const [group] = anchor.children;
    // Sanity: freshly-created bar starts at THREE's default identity rotation,
    // distinct from the camera's — otherwise the assertion below would pass
    // even if update() never ran.
    expect(group.quaternion.equals(camera.quaternion)).toBe(false);

    bar.update(0.016);

    expect(group.quaternion.equals(camera.quaternion)).toBe(true);
    bar.dispose();
  });

  it('clearAll() removes every bar without disposing the whole instance', () => {
    const scene = new THREE.Scene();
    const bar = new TaskProgressBar(scene, makeCamera());
    const anchorA = new THREE.Group();
    const anchorB = new THREE.Group();
    scene.add(anchorA, anchorB);
    const empA = makeEmployee({ id: 1, taskTicksRemaining: 5, activeTaskTotalTicks: 20 });
    const empB = makeEmployee({ id: 2, taskTicksRemaining: 5, activeTaskTotalTicks: 20 });
    const getAnchor = (id: number): THREE.Group | null => (id === 1 ? anchorA : id === 2 ? anchorB : null);

    bar.sync([empA, empB], NO_VEHICLES, getAnchor);
    expect(bar.count).toBe(2);

    bar.clearAll();

    expect(bar.count).toBe(0);
    expect(anchorA.children.length).toBe(0);
    expect(anchorB.children.length).toBe(0);
    bar.dispose();
  });
});
