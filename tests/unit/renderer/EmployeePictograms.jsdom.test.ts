// @vitest-environment jsdom
//
// EmployeePictograms — jsdom-no-`canvas`-package regression coverage (#1258)
//
// The sibling suite (EmployeePictograms.test.ts) deliberately runs in the
// plain Node environment, where `document` is `undefined` and
// buildIconMaterial's `typeof document === 'undefined'` branch is what's
// exercised. This file runs under `@vitest-environment jsdom` instead: here
// `document` IS defined, but this repo's node_modules has no `canvas` npm
// package installed, so jsdom's `HTMLCanvasElement.getContext('2d')` returns
// `null` rather than a real 2D context. buildIconMaterial's non-null
// assertion (`canvas.getContext('2d')!`) silences the type system on exactly
// this path and then calls drawGlyph with a null ctx, which crashes the
// EmployeePictograms constructor for every real player session (browsers
// have `document`, same as jsdom, and the crash is about the *missing
// context*, not the missing `document`).
//
// Fixed reference sibling: BuildingOccupancyLabels' buildLabelMaterial
// (#1205) checks `canvas.getContext('2d') !== null` explicitly and falls
// back to a flat-color MeshBasicMaterial otherwise — see its file header and
// BuildingOccupancyLabels.test.ts for the same fallback-path shape being
// asserted there.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EmployeePictograms, type PictogramKind } from '../../../src/renderer/EmployeePictograms.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import type { Vehicle, VehicleState } from '../../../src/core/entities/Vehicle.js';

// Sanity for the whole file's premise: confirm this repo's actual jsdom
// environment really does return a null 2D context (no `canvas` npm package
// installed) rather than throwing or returning undefined. If this ever
// stops being true (e.g. `canvas` gets added as a dependency), every
// assertion below about the fallback path would need re-examining.
it('sanity: jsdom canvas.getContext(\'2d\') is null in this repo\'s test environment (no `canvas` npm package)', () => {
  const canvas = document.createElement('canvas');
  expect(canvas.getContext('2d')).toBeNull();
});

/** Mirrors EmployeePictograms.test.ts's own makeEmployee fixture. */
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
    locomotion: { kind: 'on_foot' },
    itinerary: null,
    vehicleWaitingTicks: 0,
    ...overrides,
  };
}

function makeVehicleState(vehicles: Vehicle[] = []): VehicleState {
  return { vehicles, nextId: vehicles.length + 1, driverBoardingCount: 0, reservations: [] };
}
const NO_VEHICLES: VehicleState = makeVehicleState();

function makeCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 4000);
}

function collectMeshes(object: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  object.traverse(child => {
    if ((child as THREE.Mesh).isMesh) out.push(child as THREE.Mesh);
  });
  return out;
}

// Same table EmployeePictograms.ts keeps privately as FALLBACK_COLOR —
// duplicated here (rather than imported, since the source never exports it)
// so this suite pins the *contract* independently of the source's internal
// naming. If the real palette changes, this table must be updated
// deliberately, same as any other fixture-vs-source drift.
const EXPECTED_FALLBACK_COLOR: Record<PictogramKind, number> = {
  collapsed: 0xe53935,
  resting: 0x4fc3f7,
  walking_to_rest: 0x4fc3f7,
  walking: 0xeceff1,
  driving: 0xffb300,
  idle: 0xb0bec5,
};

const PICTOGRAM_KINDS: readonly PictogramKind[] = ['collapsed', 'resting', 'walking_to_rest', 'walking', 'driving', 'idle'];

/** One employee fixture shaped to produce each PictogramKind, mirroring the
 * exhaustive table in EmployeePictograms.test.ts's own
 * "every non-working PictogramKind produces a mesh" test. */
const OVERRIDES_FOR: Record<PictogramKind, Partial<Employee>> = {
  collapsed: { collapsing: true },
  resting: { restTicksRemaining: 5 },
  walking_to_rest: { destinationX: 5, destinationZ: 5, pendingActionType: 'rest' },
  walking: { destinationX: 5, destinationZ: 5, pendingActionType: null },
  driving: {}, // exercised via a Vehicle fixture in its own test below
  idle: {},
};

describe('EmployeePictograms under jsdom with no `canvas` npm package (#1258)', () => {
  it('constructing EmployeePictograms does not throw even though document exists but getContext(\'2d\') returns null', () => {
    const scene = new THREE.Scene();
    expect(() => new EmployeePictograms(scene, makeCamera())).not.toThrow();
  });

  it('every PictogramKind falls back to a flat-color material (map falsy, color matches FALLBACK_COLOR) when synced', () => {
    for (const kind of PICTOGRAM_KINDS) {
      if (kind === 'driving') continue; // needs a Vehicle fixture; covered in its own test below
      const scene = new THREE.Scene();
      const pictograms = new EmployeePictograms(scene, makeCamera());
      const anchor = new THREE.Group();
      scene.add(anchor);
      const emp = makeEmployee({ id: 1, ...OVERRIDES_FOR[kind] });

      pictograms.sync([emp], NO_VEHICLES, id => (id === 1 ? anchor : null));

      const [mesh] = collectMeshes(anchor);
      if (!mesh) throw new Error(`no pictogram mesh found under anchor for kind "${kind}"`);
      const material = mesh.material as THREE.MeshBasicMaterial;

      expect(material.map, `kind "${kind}" should have no texture map in the fallback path`).toBeFalsy();
      expect(material.color.getHex(), `kind "${kind}" fallback color should match FALLBACK_COLOR`).toBe(EXPECTED_FALLBACK_COLOR[kind]);

      pictograms.dispose();
    }
  });

  it('a driving employee also falls back to a flat-color material matching FALLBACK_COLOR.driving', () => {
    const scene = new THREE.Scene();
    const pictograms = new EmployeePictograms(scene, makeCamera());
    const anchor = new THREE.Group();
    scene.add(anchor);
    const emp = makeEmployee({ id: 1 });
    const vehicle: Vehicle = {
      id: 1, type: 'debris_hauler', tier: 1, x: 0, z: 0, hp: 100,
      cargo: [],
      occupantIds: [1],
    };

    pictograms.sync([emp], makeVehicleState([vehicle]), id => (id === 1 ? anchor : null));

    const [mesh] = collectMeshes(anchor);
    if (!mesh) throw new Error('no pictogram mesh found under anchor for kind "driving"');
    const material = mesh.material as THREE.MeshBasicMaterial;
    expect(material.map).toBeFalsy();
    expect(material.color.getHex()).toBe(EXPECTED_FALLBACK_COLOR.driving);

    pictograms.dispose();
  });

  it('two employees of the same kind still share the exact same fallback material instance (shared-material budget holds under the fallback path too)', () => {
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
    expect((meshA.material as THREE.MeshBasicMaterial).color.getHex()).toBe(EXPECTED_FALLBACK_COLOR.resting);

    pictograms.dispose();
  });

  it('dispose() does not throw when every material in the instance is a fallback (no .map to dispose)', () => {
    const scene = new THREE.Scene();
    const pictograms = new EmployeePictograms(scene, makeCamera());
    const anchor = new THREE.Group();
    scene.add(anchor);
    const resting = makeEmployee({ id: 1, restTicksRemaining: 5 });

    pictograms.sync([resting], NO_VEHICLES, id => (id === 1 ? anchor : null));

    expect(() => pictograms.dispose()).not.toThrow();
    expect(pictograms.count).toBe(0);
  });
});
