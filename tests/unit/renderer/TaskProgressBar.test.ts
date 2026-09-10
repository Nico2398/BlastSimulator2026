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
import type { PendingAction } from '../../../src/core/state/GameState.js';
import { MOVE_TWEEN_DURATION_S } from '../../../src/renderer/MovementInterpolation.js';

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 1, name: 'Test Employee', role: 'driller', salary: 1000, morale: 60,
    unionized: false, injured: false, alive: true,
    x: 0, z: 0,
    qualifications: [],
    trainingState: null,
    activeActionId: null,
    fatigue: 100,
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
    taskQueue: [],
    ...overrides,
  };
}

/** Unused directly (sync's vehicles arg is only consulted by computeEmployeeActivity
 * for the 'driving' state, irrelevant here), kept for signature parity with sync(). */
const NO_VEHICLES: Vehicle[] = [];

/** No construction sites in play — most pre-#1012 tests don't exercise them. */
const NO_PENDING_ACTIONS: PendingAction[] = [];

/** No site anchors resolvable — most pre-#1012 tests don't exercise them. */
const NO_SITE_ANCHOR = (_id: number): THREE.Object3D | null => null;

/**
 * A `place_building` PendingAction under construction (#1012). Mirrors the
 * real shape produced by buildOrder.ts closely enough for TaskProgressBar's
 * own sync() to key off `type`/`holderId`/`id` — the only fields it reads.
 */
function makePendingAction(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    id: 100,
    type: 'place_building',
    requiredSkill: null,
    requiredVehicleRole: null,
    targetX: 5,
    targetZ: 5,
    targetY: 0,
    payload: {},
    targetEmployeeId: null,
    status: 'in_progress',
    holderId: null,
    ...overrides,
  };
}

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

    bar.sync([emp], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);

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

      bar.sync([emp], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);

      expect(findFillMesh(anchor).scale.x).toBeCloseTo(0, 5);
      bar.dispose();
    });

    it('reads ~0.5 halfway through the task', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const anchor = new THREE.Group();
      scene.add(anchor);
      const emp = makeEmployee({ id: 1, taskTicksRemaining: 10, activeTaskTotalTicks: 20 });

      bar.sync([emp], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);

      expect(findFillMesh(anchor).scale.x).toBeCloseTo(0.5, 5);
      bar.dispose();
    });

    it('reads ~0.95 just before the task completes', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const anchor = new THREE.Group();
      scene.add(anchor);
      const emp = makeEmployee({ id: 1, taskTicksRemaining: 1, activeTaskTotalTicks: 20 });

      bar.sync([emp], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);

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

    bar.sync([emp], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);

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

    bar.sync([emp], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);

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

    bar.sync([emp], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);

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

    bar.sync([emp], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);

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

    bar.sync([working], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);
    expect(bar.count).toBe(1);
    const childrenWhileWorking = anchor.children.length;
    expect(childrenWhileWorking).toBeGreaterThan(0);

    const idle = makeEmployee({ id: 1 }); // task cleared → idle
    bar.sync([idle], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);

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

    bar.sync([emp], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);
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

    bar.sync([emp], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);
    const [group] = anchor.children;
    if (!group) throw new Error('no bar group found under anchor');
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

    bar.sync([empA, empB], NO_VEHICLES, NO_PENDING_ACTIONS, getAnchor, NO_SITE_ANCHOR);
    expect(bar.count).toBe(2);

    bar.clearAll();

    expect(bar.count).toBe(0);
    expect(anchorA.children.length).toBe(0);
    expect(anchorB.children.length).toBe(0);
    bar.dispose();
  });

  describe('fill easing between ticks (#906)', () => {
    // activeTaskTotalTicks: 100 throughout — makes taskProgressFraction
    // (1 - ticksRemaining / totalTicks) land on round fractions.
    function empAtFraction(id: number, fraction: number): Employee {
      const ticksRemaining = Math.round((1 - fraction) * 100);
      return makeEmployee({ id, taskTicksRemaining: ticksRemaining, activeTaskTotalTicks: 100 });
    }

    it('two forward sync() retargets followed by a small update(dt) ease strictly between the old and new fraction', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const anchor = new THREE.Group();
      scene.add(anchor);

      bar.sync([empAtFraction(1, 0.2)], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);
      bar.sync([empAtFraction(1, 0.6)], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);

      bar.update(MOVE_TWEEN_DURATION_S / 2);

      const fillX = findFillMesh(anchor).scale.x;
      expect(fillX).toBeGreaterThan(0.2);
      expect(fillX).toBeLessThan(0.6);
      bar.dispose();
    });

    it('at update(MOVE_TWEEN_DURATION_S / 2), fill scale.x is exactly the arithmetic midpoint of the retarget (linear, not smoothstep-curved)', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const anchor = new THREE.Group();
      scene.add(anchor);

      bar.sync([empAtFraction(1, 0.2)], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);
      bar.sync([empAtFraction(1, 0.6)], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);

      bar.update(MOVE_TWEEN_DURATION_S / 2);

      expect(findFillMesh(anchor).scale.x).toBeCloseTo(0.4, 5);
      bar.dispose();
    });

    it('at update(MOVE_TWEEN_DURATION_S / 4), fill scale.x is exactly the linear quarter-point value, not smoothstep', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const anchor = new THREE.Group();
      scene.add(anchor);

      bar.sync([empAtFraction(1, 0.2)], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);
      bar.sync([empAtFraction(1, 0.6)], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);

      bar.update(MOVE_TWEEN_DURATION_S / 4);

      // Smoothstep at t=0.25 would give ≈0.242 (0.2 + 0.4*0.104), not 0.3.
      expect(findFillMesh(anchor).scale.x).toBeCloseTo(0.3, 5);
      bar.dispose();
    });

    it('at update(MOVE_TWEEN_DURATION_S * 3/4), fill scale.x is exactly the linear three-quarter-point value, not smoothstep', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const anchor = new THREE.Group();
      scene.add(anchor);

      bar.sync([empAtFraction(1, 0.2)], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);
      bar.sync([empAtFraction(1, 0.6)], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);

      bar.update((MOVE_TWEEN_DURATION_S * 3) / 4);

      // Smoothstep at t=0.75 would give ≈0.558 (0.2 + 0.4*0.896), not 0.5.
      expect(findFillMesh(anchor).scale.x).toBeCloseTo(0.5, 5);
      bar.dispose();
    });

    it('repeated update() calls with no intervening sync() leave the fill unchanged once converged', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const anchor = new THREE.Group();
      scene.add(anchor);

      bar.sync([empAtFraction(1, 0.2)], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);
      bar.sync([empAtFraction(1, 0.6)], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);
      bar.update(MOVE_TWEEN_DURATION_S); // fully converge to 0.6

      const convergedX = findFillMesh(anchor).scale.x;
      expect(convergedX).toBeCloseTo(0.6, 5);

      bar.update(0.016);
      bar.update(0.016);
      bar.update(0.016);

      expect(findFillMesh(anchor).scale.x).toBe(convergedX);
      bar.dispose();
    });

    it('a sync() retarget lower than the current eased fraction (task changed/re-dispatched) snaps immediately, with no update() call needed', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const anchor = new THREE.Group();
      scene.add(anchor);

      // First appearance snaps straight to 0.9 (bar creation — unaffected by #906).
      bar.sync([empAtFraction(1, 0.9)], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);
      expect(findFillMesh(anchor).scale.x).toBeCloseTo(0.9, 5);

      // Task changed underneath the employee — new target is lower.
      bar.sync([empAtFraction(1, 0.05)], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);

      expect(findFillMesh(anchor).scale.x).toBeCloseTo(0.05, 5);
      bar.dispose();
    });

    it('update(0) produces no change in the fill', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const anchor = new THREE.Group();
      scene.add(anchor);

      bar.sync([empAtFraction(1, 0.2)], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);
      const beforeX = findFillMesh(anchor).scale.x;

      bar.update(0);

      expect(findFillMesh(anchor).scale.x).toBe(beforeX);
      bar.dispose();
    });

    it('a very large dt passed to update() converges the fill to exactly the target fraction, with no overshoot', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const anchor = new THREE.Group();
      scene.add(anchor);

      bar.sync([empAtFraction(1, 0.2)], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);
      bar.sync([empAtFraction(1, 0.6)], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);

      bar.update(10);

      const fillX = findFillMesh(anchor).scale.x;
      expect(fillX).toBeCloseTo(0.6, 5);
      expect(fillX).toBeLessThanOrEqual(0.6 + 1e-9);
      bar.dispose();
    });
  });

  // ── #1012: construction progress bars anchor to the site, not the worker ──
  // A `place_building` PendingAction's progress bar must be parented to the
  // ghost mesh's own transform (via getSiteAnchor/GhostMesh.getGroup) and
  // keyed by the action's id, not the holding employee's id — so it survives
  // the holder leaving/being reassigned and never doubles up with a
  // worker-anchored bar for the same task.

  describe('site-anchored construction progress bar (#1012)', () => {
    /** A holder employee whose taskProgressFraction (of a place_building task) is `fraction`. */
    function holderAtFraction(id: number, fraction: number, totalTicks = 100): Employee {
      const ticksRemaining = Math.round((1 - fraction) * totalTicks);
      return makeEmployee({
        id,
        taskTicksRemaining: ticksRemaining,
        activeTaskTotalTicks: totalTicks,
        pendingActionType: 'place_building',
      });
    }

    it('a place_building action with a holder mid-in_progress produces exactly one bar, anchored to the site', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const siteAnchor = new THREE.Group();
      const workerAnchor = new THREE.Group();
      scene.add(siteAnchor, workerAnchor);
      const holder = holderAtFraction(1, 0.5);
      const action = makePendingAction({ id: 50, holderId: 1 });

      bar.sync(
        [holder], NO_VEHICLES, [action],
        id => (id === 1 ? workerAnchor : null),
        id => (id === 50 ? siteAnchor : null),
      );

      expect(bar.count).toBe(1);
      expect(siteAnchor.children.length).toBeGreaterThan(0);
      bar.dispose();
    });

    it('the holder building the site does not also get a worker-anchored bar for the same action (no double bar)', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const siteAnchor = new THREE.Group();
      const workerAnchor = new THREE.Group();
      scene.add(siteAnchor, workerAnchor);
      const holder = holderAtFraction(1, 0.5);
      const action = makePendingAction({ id: 50, holderId: 1 });

      bar.sync(
        [holder], NO_VEHICLES, [action],
        id => (id === 1 ? workerAnchor : null),
        id => (id === 50 ? siteAnchor : null),
      );

      expect(workerAnchor.children.length).toBe(0);
      bar.dispose();
    });

    it("the site bar's fill fraction equals taskProgressFraction of the holder's current activity", () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const siteAnchor = new THREE.Group();
      scene.add(siteAnchor);
      const holder = holderAtFraction(1, 0.75);
      const action = makePendingAction({ id: 50, holderId: 1 });

      bar.sync(
        [holder], NO_VEHICLES, [action],
        () => null,
        id => (id === 50 ? siteAnchor : null),
      );

      expect(findFillMesh(siteAnchor).scale.x).toBeCloseTo(0.75, 5);
      bar.dispose();
    });

    it('a place_building action with no holder and no prior progress shows no bar', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const siteAnchor = new THREE.Group();
      scene.add(siteAnchor);
      const action = makePendingAction({ id: 50, holderId: null, status: 'queued' });

      bar.sync([], NO_VEHICLES, [action], () => null, id => (id === 50 ? siteAnchor : null));

      expect(bar.count).toBe(0);
      expect(siteAnchor.children.length).toBe(0);
      bar.dispose();
    });

    it('releasing the holder mid-build freezes the bar at its last fraction (no reset, no removal)', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const siteAnchor = new THREE.Group();
      scene.add(siteAnchor);
      const holder = holderAtFraction(1, 0.25);
      const action = makePendingAction({ id: 50, holderId: 1 });

      bar.sync([holder], NO_VEHICLES, [action], () => null, id => (id === 50 ? siteAnchor : null));
      expect(findFillMesh(siteAnchor).scale.x).toBeCloseTo(0.25, 5);

      // Holder released — reassigned/interrupted, no longer in the roster at
      // all — and no one else has claimed the action yet.
      const released = makePendingAction({ id: 50, holderId: null, status: 'queued' });
      bar.sync([], NO_VEHICLES, [released], () => null, id => (id === 50 ? siteAnchor : null));

      expect(bar.count).toBe(1);
      expect(siteAnchor.children.length).toBeGreaterThan(0);
      expect(findFillMesh(siteAnchor).scale.x).toBeCloseTo(0.25, 5);
      bar.dispose();
    });

    it('a new holder claiming the released action resumes advancing with no visible jump, retargeting to the new fraction', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const siteAnchor = new THREE.Group();
      scene.add(siteAnchor);
      const firstHolder = holderAtFraction(1, 0.25);
      const action = makePendingAction({ id: 50, holderId: 1 });
      bar.sync([firstHolder], NO_VEHICLES, [action], () => null, id => (id === 50 ? siteAnchor : null));

      const released = makePendingAction({ id: 50, holderId: null, status: 'queued' });
      bar.sync([], NO_VEHICLES, [released], () => null, id => (id === 50 ? siteAnchor : null));

      // A different employee claims and arrives — new holder, higher fraction.
      const secondHolder = holderAtFraction(2, 0.75);
      const reclaimed = makePendingAction({ id: 50, holderId: 2 });
      bar.sync([secondHolder], NO_VEHICLES, [reclaimed], () => null, id => (id === 50 ? siteAnchor : null));

      // No jump immediately after the retargeting sync() — still at the frozen value.
      expect(findFillMesh(siteAnchor).scale.x).toBeCloseTo(0.25, 5);

      bar.update(MOVE_TWEEN_DURATION_S * 2); // fully converge

      expect(findFillMesh(siteAnchor).scale.x).toBeCloseTo(0.75, 5);
      bar.dispose();
    });

    it('two simultaneous construction sites each track their own bar independently', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const siteAnchorA = new THREE.Group();
      const siteAnchorB = new THREE.Group();
      scene.add(siteAnchorA, siteAnchorB);
      const holderA = holderAtFraction(1, 0.2);
      const holderB = holderAtFraction(2, 0.8);
      const actionA = makePendingAction({ id: 50, holderId: 1 });
      const actionB = makePendingAction({ id: 51, holderId: 2 });
      const getSiteAnchor = (id: number): THREE.Object3D | null =>
        id === 50 ? siteAnchorA : id === 51 ? siteAnchorB : null;

      bar.sync([holderA, holderB], NO_VEHICLES, [actionA, actionB], () => null, getSiteAnchor);

      expect(bar.count).toBe(2);
      expect(findFillMesh(siteAnchorA).scale.x).toBeCloseTo(0.2, 5);
      expect(findFillMesh(siteAnchorB).scale.x).toBeCloseTo(0.8, 5);

      // Interrupt site A's holder — site B must be entirely unaffected.
      const releasedA = makePendingAction({ id: 50, holderId: null, status: 'queued' });
      bar.sync([holderB], NO_VEHICLES, [releasedA, actionB], () => null, getSiteAnchor);

      expect(bar.count).toBe(2);
      expect(findFillMesh(siteAnchorA).scale.x).toBeCloseTo(0.2, 5);
      expect(findFillMesh(siteAnchorB).scale.x).toBeCloseTo(0.8, 5);
      bar.dispose();
    });

    it('the site bar is removed on the next sync() once the building completes (action removed from pendingActions)', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const siteAnchor = new THREE.Group();
      scene.add(siteAnchor);
      const holder = holderAtFraction(1, 0.5);
      const action = makePendingAction({ id: 50, holderId: 1 });

      bar.sync([holder], NO_VEHICLES, [action], () => null, id => (id === 50 ? siteAnchor : null));
      expect(bar.count).toBe(1);

      // Building completed — action removed from the pool entirely.
      bar.sync([], NO_VEHICLES, [], () => null, () => null);

      expect(bar.count).toBe(0);
      expect(siteAnchor.children.length).toBe(0);
      bar.dispose();
    });

    it('the site bar is removed on the next sync() once the order is cancelled (action removed from pendingActions)', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const siteAnchor = new THREE.Group();
      scene.add(siteAnchor);
      const holder = holderAtFraction(1, 0.5);
      const action = makePendingAction({ id: 50, holderId: 1 });

      bar.sync([holder], NO_VEHICLES, [action], () => null, id => (id === 50 ? siteAnchor : null));
      expect(bar.count).toBe(1);

      // Order cancelled — same removal path as completion: the action just
      // drops out of pendingActions.
      bar.sync([], NO_VEHICLES, [], () => null, () => null);

      expect(bar.count).toBe(0);
      expect(siteAnchor.children.length).toBe(0);
      bar.dispose();
    });

    it('a non-place_building working employee still gets a worker-anchored bar via getWorkerAnchor, not a site bar (regression)', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const workerAnchor = new THREE.Group();
      scene.add(workerAnchor);
      const surveyor = makeEmployee({
        id: 1, taskTicksRemaining: 10, activeTaskTotalTicks: 20, pendingActionType: 'survey',
      });

      bar.sync([surveyor], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? workerAnchor : null), NO_SITE_ANCHOR);

      expect(bar.count).toBe(1);
      expect(workerAnchor.children.length).toBeGreaterThan(0);
      expect(findFillMesh(workerAnchor).scale.x).toBeCloseTo(0.5, 5);
      bar.dispose();
    });

    it('drill_hole and demolish_building working employees also keep their worker-anchored bar unchanged (regression)', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const anchorDriller = new THREE.Group();
      const anchorDemolisher = new THREE.Group();
      scene.add(anchorDriller, anchorDemolisher);
      const driller = makeEmployee({
        id: 1, taskTicksRemaining: 5, activeTaskTotalTicks: 20, pendingActionType: 'drill_hole',
      });
      const demolisher = makeEmployee({
        id: 2, taskTicksRemaining: 15, activeTaskTotalTicks: 20, pendingActionType: 'demolish_building',
      });
      const getWorkerAnchor = (id: number): THREE.Group | null =>
        id === 1 ? anchorDriller : id === 2 ? anchorDemolisher : null;

      bar.sync([driller, demolisher], NO_VEHICLES, NO_PENDING_ACTIONS, getWorkerAnchor, NO_SITE_ANCHOR);

      expect(bar.count).toBe(2);
      expect(anchorDriller.children.length).toBeGreaterThan(0);
      expect(anchorDemolisher.children.length).toBeGreaterThan(0);
      bar.dispose();
    });

    describe('bar count: workers + sites, no double-count (#1012)', () => {
      it('one employee building one site counts as exactly 1, not 2', () => {
        const scene = new THREE.Scene();
        const bar = new TaskProgressBar(scene, makeCamera());
        const siteAnchor = new THREE.Group();
        const workerAnchor = new THREE.Group();
        scene.add(siteAnchor, workerAnchor);
        const holder = holderAtFraction(1, 0.5);
        const action = makePendingAction({ id: 50, holderId: 1 });

        bar.sync(
          [holder], NO_VEHICLES, [action],
          id => (id === 1 ? workerAnchor : null),
          id => (id === 50 ? siteAnchor : null),
        );

        expect(bar.count).toBe(1);
        bar.dispose();
      });

      it('a worker building one site plus a different worker on an unrelated task counts as 2, not 3', () => {
        const scene = new THREE.Scene();
        const bar = new TaskProgressBar(scene, makeCamera());
        const siteAnchor = new THREE.Group();
        const workerAnchorBuilder = new THREE.Group();
        const workerAnchorSurveyor = new THREE.Group();
        scene.add(siteAnchor, workerAnchorBuilder, workerAnchorSurveyor);
        const builder = holderAtFraction(1, 0.5);
        const surveyor = makeEmployee({
          id: 2, taskTicksRemaining: 10, activeTaskTotalTicks: 20, pendingActionType: 'survey',
        });
        const action = makePendingAction({ id: 50, holderId: 1 });
        const getWorkerAnchor = (id: number): THREE.Group | null =>
          id === 1 ? workerAnchorBuilder : id === 2 ? workerAnchorSurveyor : null;

        bar.sync(
          [builder, surveyor], NO_VEHICLES, [action],
          getWorkerAnchor,
          id => (id === 50 ? siteAnchor : null),
        );

        expect(bar.count).toBe(2);
        bar.dispose();
      });
    });
  });

  // ── #1012: bars render regardless of ghost/building occlusion ─────────────
  // depthTest:false (in addition to the existing depthWrite:false) plus an
  // explicit renderOrder keep the bar visible through the ghost/building mesh
  // that would otherwise occlude it. Plain property assertions — no WebGL
  // context needed.

  describe('bars render through occlusion (#1012)', () => {
    it('worker bar track/fill materials have depthTest:false and depthWrite:false, and meshes have a renderOrder set', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const anchor = new THREE.Group();
      scene.add(anchor);
      const emp = makeEmployee({ id: 1, taskTicksRemaining: 10, activeTaskTotalTicks: 20 });

      bar.sync([emp], NO_VEHICLES, NO_PENDING_ACTIONS, id => (id === 1 ? anchor : null), NO_SITE_ANCHOR);

      const meshes = collectMeshes(anchor);
      expect(meshes.length).toBeGreaterThan(0);
      for (const mesh of meshes) {
        const material = mesh.material as THREE.MeshBasicMaterial;
        expect(material.depthWrite).toBe(false);
        expect(material.depthTest).toBe(false);
        expect(mesh.renderOrder).toBeGreaterThan(0);
      }
      bar.dispose();
    });

    it('site bar track/fill materials have depthTest:false and depthWrite:false, and meshes have a renderOrder set', () => {
      const scene = new THREE.Scene();
      const bar = new TaskProgressBar(scene, makeCamera());
      const siteAnchor = new THREE.Group();
      scene.add(siteAnchor);
      const holder = makeEmployee({
        id: 1, taskTicksRemaining: 10, activeTaskTotalTicks: 20, pendingActionType: 'place_building',
      });
      const action = makePendingAction({ id: 50, holderId: 1 });

      bar.sync([holder], NO_VEHICLES, [action], () => null, id => (id === 50 ? siteAnchor : null));

      const meshes = collectMeshes(siteAnchor);
      expect(meshes.length).toBeGreaterThan(0);
      for (const mesh of meshes) {
        const material = mesh.material as THREE.MeshBasicMaterial;
        expect(material.depthWrite).toBe(false);
        expect(material.depthTest).toBe(false);
        expect(mesh.renderOrder).toBeGreaterThan(0);
      }
      bar.dispose();
    });
  });
});
