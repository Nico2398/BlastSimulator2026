// EmployeePictograms — unit tests (#1013)
// Billboarded pictogram floating above each currently-non-working employee,
// naming why they aren't working (Zzz for resting, a walking icon for a walk
// toward a rest destination vs. an ordinary task walk, etc). Fixture shape
// mirrors TaskProgressBar.test.ts's makeEmployee/makeVehicle/makeCamera
// helpers (same functions computeEmployeeActivity/pictogramKindFor are
// exercised against), for consistency across the two renderer modules that
// share the same billboard-above-anchor precedent (#546 established it,
// #1013 reuses it).

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EmployeePictograms, pictogramKindFor, type PictogramKind } from '../../../src/renderer/EmployeePictograms.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';
import type { EmployeeActivity, EmployeeActivityKind } from '../../../src/core/entities/EmployeeActivity.js';
import type { ActionType } from '../../../src/core/state/GameState.js';

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

/** Unused directly by any test here (sync's vehicles arg only feeds
 * computeEmployeeActivity's 'driving' classification), kept for signature
 * parity with sync() — mirrors TaskProgressBar.test.ts's own NO_VEHICLES. */
const NO_VEHICLES: Vehicle[] = [];

function makeCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 4000);
}

/** Builds a minimal EmployeeActivity for pictogramKindFor's own unit tests —
 * only kind/actionType vary across these cases, so the rest are filled with
 * harmless defaults. */
function makeActivity(kind: EmployeeActivityKind, actionType: ActionType | null = null): EmployeeActivity {
  return { kind, ticksRemaining: null, totalTicks: null, actionType, vehicleId: null };
}

/** Every THREE.Mesh anywhere under `object`, recursively — mirrors
 * TaskProgressBar.test.ts's own collectMeshes helper. */
function collectMeshes(object: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  object.traverse(child => {
    if ((child as THREE.Mesh).isMesh) out.push(child as THREE.Mesh);
  });
  return out;
}

describe('pictogramKindFor', () => {
  it('returns null for kind "working", regardless of actionType', () => {
    expect(pictogramKindFor(makeActivity('working', 'drill_hole'))).toBeNull();
    expect(pictogramKindFor(makeActivity('working', 'survey'))).toBeNull();
    expect(pictogramKindFor(makeActivity('working', null))).toBeNull();
  });

  it('returns "collapsed" for kind "collapsed"', () => {
    expect(pictogramKindFor(makeActivity('collapsed'))).toBe('collapsed');
  });

  it('returns "resting" for kind "resting"', () => {
    expect(pictogramKindFor(makeActivity('resting'))).toBe('resting');
  });

  it('returns "idle" for kind "idle"', () => {
    expect(pictogramKindFor(makeActivity('idle'))).toBe('idle');
  });

  it('returns "driving" for kind "driving"', () => {
    expect(pictogramKindFor(makeActivity('driving'))).toBe('driving');
  });

  it('returns "driving" for kind "driving_to_task" too — both map to the single "driving" pictogram', () => {
    expect(pictogramKindFor(makeActivity('driving_to_task'))).toBe('driving');
  });

  it('returns "walking_to_rest" for kind "walking" with actionType "rest"', () => {
    expect(pictogramKindFor(makeActivity('walking', 'rest'))).toBe('walking_to_rest');
  });

  it('returns "walking" for kind "walking" with actionType null (an ordinary walk with no claimed action yet)', () => {
    expect(pictogramKindFor(makeActivity('walking', null))).toBe('walking');
  });

  it('returns "walking" for kind "walking" with any other actionType (a walk toward a claimed task, not a rest)', () => {
    expect(pictogramKindFor(makeActivity('walking', 'drill_hole'))).toBe('walking');
    expect(pictogramKindFor(makeActivity('walking', 'survey'))).toBe('walking');
    expect(pictogramKindFor(makeActivity('walking', 'general_work'))).toBe('walking');
  });

  it('never returns null for any non-"working" kind (every non-working state gets a pictogram)', () => {
    const nonWorkingKinds: EmployeeActivityKind[] = ['collapsed', 'resting', 'driving', 'driving_to_task', 'walking', 'idle'];
    for (const kind of nonWorkingKinds) {
      expect(pictogramKindFor(makeActivity(kind))).not.toBeNull();
    }
  });

  describe('walking-to-rest distinguishability (#1013 core ask)', () => {
    it('"walking_to_rest" and "walking" are distinct kinds — a walk to rest reads differently from an ordinary task walk', () => {
      const toRest = pictogramKindFor(makeActivity('walking', 'rest'));
      const ordinary = pictogramKindFor(makeActivity('walking', null));
      expect(toRest).toBe('walking_to_rest');
      expect(ordinary).toBe('walking');
      expect(toRest).not.toBe(ordinary);
    });
  });
});

describe('EmployeePictograms', () => {
  it('a working employee produces no pictogram; a resting employee produces exactly one', () => {
    const scene = new THREE.Scene();
    const pictograms = new EmployeePictograms(scene, makeCamera());
    const anchor = new THREE.Group();
    scene.add(anchor);
    const working = makeEmployee({ id: 1, taskTicksRemaining: 10 });
    const resting = makeEmployee({ id: 2, restTicksRemaining: 5 });

    pictograms.sync([working, resting], NO_VEHICLES, id => (id === 1 || id === 2 ? anchor : null));

    expect(pictograms.count).toBe(1);
    pictograms.dispose();
  });

  it('parents the pictogram mesh group under the anchor getAnchor resolves', () => {
    const scene = new THREE.Scene();
    const pictograms = new EmployeePictograms(scene, makeCamera());
    const anchor = new THREE.Group();
    scene.add(anchor);
    const resting = makeEmployee({ id: 1, restTicksRemaining: 5 });

    pictograms.sync([resting], NO_VEHICLES, id => (id === 1 ? anchor : null));

    expect(anchor.children.length).toBeGreaterThan(0);
    expect(collectMeshes(anchor).length).toBeGreaterThan(0);
    pictograms.dispose();
  });

  it('removes the pictogram once the employee starts working', () => {
    const scene = new THREE.Scene();
    const pictograms = new EmployeePictograms(scene, makeCamera());
    const anchor = new THREE.Group();
    scene.add(anchor);
    const resting = makeEmployee({ id: 1, restTicksRemaining: 5 });

    pictograms.sync([resting], NO_VEHICLES, id => (id === 1 ? anchor : null));
    expect(pictograms.count).toBe(1);

    const working = makeEmployee({ id: 1, taskTicksRemaining: 10 });
    pictograms.sync([working], NO_VEHICLES, id => (id === 1 ? anchor : null));

    expect(pictograms.count).toBe(0);
    expect(anchor.children.length).toBe(0);
    pictograms.dispose();
  });

  it('reuses the same mesh instance across a plain-walking -> walking-to-rest transition, swapping only the material', () => {
    const scene = new THREE.Scene();
    const pictograms = new EmployeePictograms(scene, makeCamera());
    const anchor = new THREE.Group();
    scene.add(anchor);
    const walking = makeEmployee({ id: 1, destinationX: 10, destinationZ: 10, pendingActionType: null });

    pictograms.sync([walking], NO_VEHICLES, id => (id === 1 ? anchor : null));
    const meshBefore = collectMeshes(anchor).find(m => m.isMesh);
    if (!meshBefore) throw new Error('no pictogram mesh found under anchor');
    const materialBefore = meshBefore.material;

    const walkingToRest = makeEmployee({ id: 1, destinationX: 10, destinationZ: 10, pendingActionType: 'rest' });
    pictograms.sync([walkingToRest], NO_VEHICLES, id => (id === 1 ? anchor : null));
    const meshAfter = collectMeshes(anchor).find(m => m.isMesh);
    if (!meshAfter) throw new Error('no pictogram mesh found under anchor after retarget');

    expect(meshAfter).toBe(meshBefore);
    expect(meshAfter.material).not.toBe(materialBefore);
    pictograms.dispose();
  });

  it('removes the pictogram once the employee is no longer in the roster at all (death/removal)', () => {
    const scene = new THREE.Scene();
    const pictograms = new EmployeePictograms(scene, makeCamera());
    const anchor = new THREE.Group();
    scene.add(anchor);
    const resting = makeEmployee({ id: 1, restTicksRemaining: 5 });

    pictograms.sync([resting], NO_VEHICLES, id => (id === 1 ? anchor : null));
    expect(pictograms.count).toBe(1);

    pictograms.sync([], NO_VEHICLES, () => null);

    expect(pictograms.count).toBe(0);
    expect(anchor.children.length).toBe(0);
    pictograms.dispose();
  });

  it('two employees both resting share the exact same material instance (shared-material budget)', () => {
    const scene = new THREE.Scene();
    const pictograms = new EmployeePictograms(scene, makeCamera());
    const anchorA = new THREE.Group();
    const anchorB = new THREE.Group();
    scene.add(anchorA, anchorB);
    const restingA = makeEmployee({ id: 1, restTicksRemaining: 5 });
    const restingB = makeEmployee({ id: 2, restTicksRemaining: 8 });
    const getAnchor = (id: number): THREE.Group | null => (id === 1 ? anchorA : id === 2 ? anchorB : null);

    pictograms.sync([restingA, restingB], NO_VEHICLES, getAnchor);

    const meshA = collectMeshes(anchorA)[0];
    const meshB = collectMeshes(anchorB)[0];
    if (!meshA || !meshB) throw new Error('expected one pictogram mesh under each anchor');
    expect(meshA.material).toBe(meshB.material);
    pictograms.dispose();
  });

  it('skips an employee whose getAnchor resolves to null (anchor not ready yet) — no throw, no mesh', () => {
    const scene = new THREE.Scene();
    const pictograms = new EmployeePictograms(scene, makeCamera());
    const resting = makeEmployee({ id: 1, restTicksRemaining: 5 });

    expect(() => pictograms.sync([resting], NO_VEHICLES, () => null)).not.toThrow();
    expect(pictograms.count).toBe(0);
    pictograms.dispose();
  });

  it('update(dt) billboards every active pictogram group to face the camera', () => {
    const scene = new THREE.Scene();
    const camera = makeCamera();
    camera.quaternion.setFromEuler(new THREE.Euler(0.4, 1.1, 0.2));
    const pictograms = new EmployeePictograms(scene, camera);
    const anchor = new THREE.Group();
    scene.add(anchor);
    const resting = makeEmployee({ id: 1, restTicksRemaining: 5 });

    pictograms.sync([resting], NO_VEHICLES, id => (id === 1 ? anchor : null));
    const [group] = anchor.children;
    if (!group) throw new Error('no pictogram group found under anchor');
    // Sanity: freshly-created group starts at THREE's default identity
    // rotation, distinct from the camera's — otherwise the assertion below
    // would pass even if update() never ran (mirrors TaskProgressBar's own
    // billboard test).
    expect(group.quaternion.equals(camera.quaternion)).toBe(false);

    pictograms.update(0.016);

    expect(group.quaternion.equals(camera.quaternion)).toBe(true);
    pictograms.dispose();
  });

  it('clearAll() empties count to 0 and detaches every mesh from the scene, without disposing the whole instance', () => {
    const scene = new THREE.Scene();
    const pictograms = new EmployeePictograms(scene, makeCamera());
    const anchorA = new THREE.Group();
    const anchorB = new THREE.Group();
    scene.add(anchorA, anchorB);
    const restingA = makeEmployee({ id: 1, restTicksRemaining: 5 });
    const restingB = makeEmployee({ id: 2, restTicksRemaining: 8 });
    const getAnchor = (id: number): THREE.Group | null => (id === 1 ? anchorA : id === 2 ? anchorB : null);

    pictograms.sync([restingA, restingB], NO_VEHICLES, getAnchor);
    expect(pictograms.count).toBe(2);

    pictograms.clearAll();

    expect(pictograms.count).toBe(0);
    expect(anchorA.children.length).toBe(0);
    expect(anchorB.children.length).toBe(0);
    pictograms.dispose();
  });

  it('dispose() leaves nothing behind', () => {
    const scene = new THREE.Scene();
    const pictograms = new EmployeePictograms(scene, makeCamera());
    const anchor = new THREE.Group();
    scene.add(anchor);
    const resting = makeEmployee({ id: 1, restTicksRemaining: 5 });

    pictograms.sync([resting], NO_VEHICLES, id => (id === 1 ? anchor : null));
    expect(pictograms.count).toBeGreaterThan(0);

    pictograms.dispose();

    expect(pictograms.count).toBe(0);
    expect(anchor.children.length).toBe(0);
  });

  it('every non-working PictogramKind produces a mesh when synced (exhaustive over the type)', () => {
    const kinds: PictogramKind[] = ['collapsed', 'resting', 'walking_to_rest', 'walking', 'driving', 'idle'];
    // One activity-shaped employee per kind, constructed the same way
    // pictogramKindFor's own tests build one — proves sync() itself
    // (not just pictogramKindFor) reaches every kind's shared resources.
    const overridesFor: Record<PictogramKind, Partial<Employee>> = {
      collapsed: { collapsing: true },
      resting: { restTicksRemaining: 5 },
      walking_to_rest: { destinationX: 5, destinationZ: 5, pendingActionType: 'rest' },
      walking: { destinationX: 5, destinationZ: 5, pendingActionType: null },
      driving: {}, // covered indirectly — driving requires a Vehicle fixture, exercised separately below
      idle: {},
    };

    for (const kind of kinds) {
      if (kind === 'driving') continue; // needs a Vehicle; see the dedicated 'driving' test below
      const scene = new THREE.Scene();
      const pictograms = new EmployeePictograms(scene, makeCamera());
      const anchor = new THREE.Group();
      scene.add(anchor);
      const emp = makeEmployee({ id: 1, ...overridesFor[kind] });

      pictograms.sync([emp], NO_VEHICLES, id => (id === 1 ? anchor : null));

      expect(pictograms.count, `kind "${kind}" should produce a pictogram`).toBe(1);
      pictograms.dispose();
    }
  });

  it('a driving employee (driverId set on a Vehicle) produces a "driving" pictogram', () => {
    const scene = new THREE.Scene();
    const pictograms = new EmployeePictograms(scene, makeCamera());
    const anchor = new THREE.Group();
    scene.add(anchor);
    const emp = makeEmployee({ id: 1 });
    const vehicle: Vehicle = {
      id: 1, type: 'debris_hauler', tier: 1, x: 0, z: 0, hp: 100, task: 'idle',
      targetX: 0, targetZ: 0, driverId: 1, state: 'idle', payloadKg: 0,
      waitingTicks: 0, moveConsecutiveFailures: 0, isMoveStuck: false,
      haulingFragmentId: null, haulingPhase: null, haulingDepotBuildingId: null,
      breakFragmentId: null, breakPhase: null, reservedForActionId: null,
      pendingEvacuationDestination: null,
    };

    pictograms.sync([emp], [vehicle], id => (id === 1 ? anchor : null));

    expect(pictograms.count).toBe(1);
    pictograms.dispose();
  });
});
