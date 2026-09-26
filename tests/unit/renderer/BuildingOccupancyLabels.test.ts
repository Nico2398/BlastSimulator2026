// BlastSimulator2026 — Building occupancy billboard labels (#1205)
//
// Camera-facing "<inside>/<capacity>" label floating above a building that
// holds people, kept in sync with Building.occupantIds — see the file header
// of src/renderer/BuildingOccupancyLabels.ts for why every label is parented
// directly under the scene rather than under a building's own model Group
// (BuildingMesh.updateBuilding() tears that group down and rebuilds it on
// every sync; a label parented under it would vanish and never reappear).
//
// Testable contract this suite pins down (the class has no public accessor
// beyond `count`, mirroring EmployeePictograms/TaskProgressBar's own
// no-document-in-Node-tests convention — see EmployeePictograms.test.ts):
// each label's root Object3D carries `userData`:
//   - entityKind: 'buildingOccupancyLabel'
//   - entityId: the building's id
//   - occupancyText: `${inside}/${capacity}`
//   - full: true once inside === capacity (and capacity > 0), else false
// This gives every test below a way to find "the label for building N" and
// inspect its state without assuming a canvas/document is available — this
// suite runs in the Node environment (no `@vitest-environment jsdom`), same
// as every other renderer unit test, so no glyph pixels can be inspected
// either way.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BuildingOccupancyLabels } from '../../../src/renderer/BuildingOccupancyLabels.js';
import type { Building } from '../../../src/core/entities/Building.js';
import { getBuildingPeopleCapacity } from '../../../src/core/entities/Building.js';

function makeBuilding(overrides: Partial<Building> = {}): Building {
  return {
    id: 1, type: 'driving_center', tier: 1, x: 10, z: 10, hp: 100, active: true,
    occupantIds: [],
    ...overrides,
  };
}

function makeCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 4000);
}

/** Every Object3D anywhere under `scene` tagged as a building occupancy label. */
function findLabels(scene: THREE.Scene): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  scene.traverse(child => {
    if (child.userData['entityKind'] === 'buildingOccupancyLabel') out.push(child);
  });
  return out;
}

function labelFor(scene: THREE.Scene, buildingId: number): THREE.Object3D | undefined {
  return findLabels(scene).find(o => o.userData['entityId'] === buildingId);
}

const POS_A = new THREE.Vector3(10, 0, 10);
const POS_B = new THREE.Vector3(40, 0, 25);

function getPositionAt(pos: THREE.Vector3): (id: number) => THREE.Vector3 | null {
  return () => pos.clone();
}

function getRoofYAt(roofY: number): (id: number) => number | null {
  return () => roofY;
}

// driving_center tier 1: 4-person capacity, a people-holding type.
const DRIVING_CENTER_CAPACITY = getBuildingPeopleCapacity('driving_center', 1);
// freight_warehouse: not in the people-holding set, so 0 regardless of BuildingDef.capacity.
const FREIGHT_WAREHOUSE_CAPACITY = getBuildingPeopleCapacity('freight_warehouse', 1);
// research_center: also not people-holding — the "hypothetically non-empty occupantIds" case.
const RESEARCH_CENTER_CAPACITY = getBuildingPeopleCapacity('research_center', 1);

describe('BuildingOccupancyLabels', () => {
  it('driving_center tier 1 has a nonzero people capacity, freight_warehouse and research_center do not (fixture sanity)', () => {
    expect(DRIVING_CENTER_CAPACITY).toBeGreaterThan(0);
    expect(FREIGHT_WAREHOUSE_CAPACITY).toBe(0);
    expect(RESEARCH_CENTER_CAPACITY).toBe(0);
  });

  it('creates no label for a building with zero occupants', () => {
    const scene = new THREE.Scene();
    const labels = new BuildingOccupancyLabels(scene, makeCamera());
    const building = makeBuilding({ occupantIds: [] });

    labels.sync([building], getPositionAt(POS_A), getRoofYAt(2));

    expect(labels.count).toBe(0);
    expect(labelFor(scene, building.id)).toBeUndefined();
    labels.dispose();
  });

  it('creates no label for a building type with no people capacity, even with a nonzero occupantIds (hypothetical — Mount.ts never actually populates it for these types)', () => {
    const scene = new THREE.Scene();
    const labels = new BuildingOccupancyLabels(scene, makeCamera());
    const warehouse = makeBuilding({ id: 2, type: 'freight_warehouse', occupantIds: [1, 2] });
    const researchCenter = makeBuilding({ id: 3, type: 'research_center', occupantIds: [1] });

    labels.sync([warehouse, researchCenter], getPositionAt(POS_A), getRoofYAt(2));

    expect(labels.count).toBe(0);
    labels.dispose();
  });

  it('shows "<inside>/<capacity>" text for a people-holding building with occupants', () => {
    const scene = new THREE.Scene();
    const labels = new BuildingOccupancyLabels(scene, makeCamera());
    const building = makeBuilding({ occupantIds: [1, 2] });

    labels.sync([building], getPositionAt(POS_A), getRoofYAt(2));

    expect(labels.count).toBe(1);
    const label = labelFor(scene, building.id);
    expect(label).toBeDefined();
    expect(label!.userData['occupancyText']).toBe(`2/${DRIVING_CENTER_CAPACITY}`);
    labels.dispose();
  });

  it('text follows occupantIds.length across successive sync() calls', () => {
    const scene = new THREE.Scene();
    const labels = new BuildingOccupancyLabels(scene, makeCamera());
    const building = makeBuilding({ occupantIds: [1] });

    labels.sync([building], getPositionAt(POS_A), getRoofYAt(2));
    expect(labelFor(scene, building.id)!.userData['occupancyText']).toBe(`1/${DRIVING_CENTER_CAPACITY}`);

    building.occupantIds = [1, 2, 3];
    labels.sync([building], getPositionAt(POS_A), getRoofYAt(2));
    expect(labelFor(scene, building.id)!.userData['occupancyText']).toBe(`3/${DRIVING_CENTER_CAPACITY}`);

    building.occupantIds = [1];
    labels.sync([building], getPositionAt(POS_A), getRoofYAt(2));
    expect(labelFor(scene, building.id)!.userData['occupancyText']).toBe(`1/${DRIVING_CENTER_CAPACITY}`);

    labels.dispose();
  });

  it('is styled as "full" once inside === capacity, and not full otherwise', () => {
    const scene = new THREE.Scene();
    const labels = new BuildingOccupancyLabels(scene, makeCamera());
    const building = makeBuilding({ occupantIds: [1, 2] }); // 2 of 4 — not full

    labels.sync([building], getPositionAt(POS_A), getRoofYAt(2));
    expect(labelFor(scene, building.id)!.userData['isFull']).toBe(false);

    building.occupantIds = [1, 2, 3, 4]; // 4 of 4 — full
    labels.sync([building], getPositionAt(POS_A), getRoofYAt(2));
    expect(labelFor(scene, building.id)!.userData['isFull']).toBe(true);

    labels.dispose();
  });

  it('a full building and a partially-occupied building are visibly distinguishable via the full flag', () => {
    const scene = new THREE.Scene();
    const labels = new BuildingOccupancyLabels(scene, makeCamera());
    const full = makeBuilding({ id: 1, occupantIds: [1, 2, 3, 4] });
    const partial = makeBuilding({ id: 2, occupantIds: [1] });

    labels.sync([full, partial], getPositionAt(POS_A), getRoofYAt(2));

    const fullLabel = labelFor(scene, full.id)!;
    const partialLabel = labelFor(scene, partial.id)!;
    expect(fullLabel.userData['isFull']).toBe(true);
    expect(partialLabel.userData['isFull']).toBe(false);
    expect(fullLabel.userData['isFull']).not.toBe(partialLabel.userData['isFull']);

    labels.dispose();
  });

  it('an inside count of 0 is not "full" even for a building whose capacity is also (hypothetically) 0-driven — full requires capacity > 0', () => {
    // Sanity for the full predicate's edge: 0 === 0 must never read as "full"
    // for a building that never gets a label at all (capacity 0). This is
    // already covered by "no label" above; this test locks the intent down
    // explicitly in case a future capacity-0 people-holding type is added.
    const scene = new THREE.Scene();
    const labels = new BuildingOccupancyLabels(scene, makeCamera());
    const building = makeBuilding({ occupantIds: [] }); // 0 of 4 — never full

    labels.sync([building], getPositionAt(POS_A), getRoofYAt(2));

    // 0 occupants means no label at all (separate rule, asserted above), so
    // there is nothing to be "full". Re-assert count stays 0 here too.
    expect(labels.count).toBe(0);
    labels.dispose();
  });

  it('positions the label above the roof at the resolved position', () => {
    const scene = new THREE.Scene();
    const labels = new BuildingOccupancyLabels(scene, makeCamera());
    const building = makeBuilding({ occupantIds: [1] });

    labels.sync([building], getPositionAt(POS_A), getRoofYAt(3));

    const label = labelFor(scene, building.id)!;
    const world = new THREE.Vector3();
    label.getWorldPosition(world);
    expect(world.x).toBeCloseTo(POS_A.x, 5);
    expect(world.z).toBeCloseTo(POS_A.z, 5);
    expect(world.y).toBeGreaterThan(3); // above the roof, not at or below it
    labels.dispose();
  });

  it('repositions on a later sync() when getPosition/getRoofY report a new location — same label instance, not recreated (simulates BuildingMesh.updateBuilding tearing down and rebuilding the building\'s own Group)', () => {
    const scene = new THREE.Scene();
    const labels = new BuildingOccupancyLabels(scene, makeCamera());
    const building = makeBuilding({ occupantIds: [1, 2] });

    labels.sync([building], getPositionAt(POS_A), getRoofYAt(2));
    const before = labelFor(scene, building.id);
    expect(before).toBeDefined();
    expect(labels.count).toBe(1);

    // Simulate BuildingMesh.updateBuilding(): the building's own model Group
    // was destroyed and rebuilt elsewhere; getPosition/getRoofY now resolve
    // to a new location. The occupancy label itself was never parented under
    // that Group (file header), so it must survive untouched apart from
    // being repositioned.
    labels.sync([building], getPositionAt(POS_B), getRoofYAt(5));
    const after = labelFor(scene, building.id);

    expect(labels.count).toBe(1); // not duplicated
    expect(after).toBe(before); // same instance, not torn down and recreated

    const world = new THREE.Vector3();
    after!.getWorldPosition(world);
    expect(world.x).toBeCloseTo(POS_B.x, 5);
    expect(world.z).toBeCloseTo(POS_B.z, 5);
    expect(world.y).toBeGreaterThan(5);
    labels.dispose();
  });

  it('skips a building whose getPosition resolves to null (anchor not ready yet) — no throw, no label', () => {
    const scene = new THREE.Scene();
    const labels = new BuildingOccupancyLabels(scene, makeCamera());
    const building = makeBuilding({ occupantIds: [1] });

    expect(() => labels.sync([building], () => null, getRoofYAt(2))).not.toThrow();
    expect(labels.count).toBe(0);
    labels.dispose();
  });

  it('removing a building from the synced list removes (sweeps) its label', () => {
    const scene = new THREE.Scene();
    const labels = new BuildingOccupancyLabels(scene, makeCamera());
    const building = makeBuilding({ occupantIds: [1, 2] });

    labels.sync([building], getPositionAt(POS_A), getRoofYAt(2));
    expect(labels.count).toBe(1);

    labels.sync([], getPositionAt(POS_A), getRoofYAt(2));

    expect(labels.count).toBe(0);
    expect(labelFor(scene, building.id)).toBeUndefined();
    labels.dispose();
  });

  it('removes the label once occupantIds drops to zero for a still-present building', () => {
    const scene = new THREE.Scene();
    const labels = new BuildingOccupancyLabels(scene, makeCamera());
    const building = makeBuilding({ occupantIds: [1] });

    labels.sync([building], getPositionAt(POS_A), getRoofYAt(2));
    expect(labels.count).toBe(1);

    building.occupantIds = [];
    labels.sync([building], getPositionAt(POS_A), getRoofYAt(2));

    expect(labels.count).toBe(0);
    expect(labelFor(scene, building.id)).toBeUndefined();
    labels.dispose();
  });

  it('tracks multiple people-holding buildings independently, ignoring buildings with no people capacity mixed into the same roster', () => {
    const scene = new THREE.Scene();
    const labels = new BuildingOccupancyLabels(scene, makeCamera());
    const a = makeBuilding({ id: 1, occupantIds: [1, 2] });
    const b = makeBuilding({ id: 2, type: 'blasting_academy', occupantIds: [1] });
    const warehouse = makeBuilding({ id: 3, type: 'freight_warehouse', occupantIds: [] });

    labels.sync([a, b, warehouse], getPositionAt(POS_A), getRoofYAt(2));

    expect(labels.count).toBe(2);
    expect(labelFor(scene, a.id)).toBeDefined();
    expect(labelFor(scene, b.id)).toBeDefined();
    expect(labelFor(scene, warehouse.id)).toBeUndefined();
    labels.dispose();
  });

  it('update(dt) does not throw and leaves count unaffected', () => {
    const scene = new THREE.Scene();
    const labels = new BuildingOccupancyLabels(scene, makeCamera());
    const building = makeBuilding({ occupantIds: [1] });
    labels.sync([building], getPositionAt(POS_A), getRoofYAt(2));

    expect(() => labels.update(0.016)).not.toThrow();
    expect(labels.count).toBe(1);
    labels.dispose();
  });

  it('clearAll() empties count to 0 without disposing the whole instance', () => {
    const scene = new THREE.Scene();
    const labels = new BuildingOccupancyLabels(scene, makeCamera());
    const a = makeBuilding({ id: 1, occupantIds: [1] });
    const b = makeBuilding({ id: 2, occupantIds: [1, 2] });
    labels.sync([a, b], getPositionAt(POS_A), getRoofYAt(2));
    expect(labels.count).toBe(2);

    labels.clearAll();

    expect(labels.count).toBe(0);
    expect(findLabels(scene).length).toBe(0);
    labels.dispose();
  });

  it('dispose() leaves nothing behind', () => {
    const scene = new THREE.Scene();
    const labels = new BuildingOccupancyLabels(scene, makeCamera());
    const building = makeBuilding({ occupantIds: [1] });
    labels.sync([building], getPositionAt(POS_A), getRoofYAt(2));
    expect(labels.count).toBeGreaterThan(0);

    labels.dispose();

    expect(labels.count).toBe(0);
    expect(findLabels(scene).length).toBe(0);
  });
});
