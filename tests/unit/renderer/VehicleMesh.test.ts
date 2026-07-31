// VehicleMesh — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Vehicle, VehicleTier, VehicleOperationalState } from '../../../src/core/entities/Vehicle.js';
import { VehicleMesh, STATE_COLOR_MAP, applyStateIndicator } from '../../../src/renderer/VehicleMesh.js';

function makeVehicle(id: number, type: Vehicle['type'], x = 0, z = 0, tier = 1 as VehicleTier): Vehicle {
  return { id, type, x, z, hp: 100, task: 'idle', targetX: x, targetZ: z, tier } as Vehicle;
}

describe('VehicleMesh', () => {
  it('addVehicle adds group to scene', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    vm.addVehicle(makeVehicle(1, 'debris_hauler'));
    expect(scene.children.length).toBe(1);
    expect(vm.count).toBe(1);
    vm.dispose();
  });

  it('all vehicle roles can be added', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const types: Vehicle['type'][] = ['debris_hauler', 'rock_digger', 'drill_rig', 'building_destroyer', 'rock_fragmenter'];
    types.forEach((t, i) => vm.addVehicle(makeVehicle(i, t, i * 5, 0)));
    expect(vm.count).toBe(5);
    vm.dispose();
  });

  it('vehicles have multiple children (composed shapes)', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const types: Vehicle['type'][] = ['debris_hauler', 'rock_digger', 'drill_rig', 'building_destroyer', 'rock_fragmenter'];
    for (const type of types) {
      vm.addVehicle(makeVehicle(0, type));
      const group = scene.children[0] as THREE.Group;
      expect(group.children.length).toBeGreaterThan(1); // multi-part shapes
      vm.clearAll();
    }
    vm.dispose();
  });

  it('update lerps vehicle toward new position', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const v = makeVehicle(1, 'debris_hauler', 0, 0);
    vm.addVehicle(v);

    // Move vehicle target far away
    v.x = 100;
    v.z = 100;

    // After a few updates, position should move toward target
    vm.update([v]);
    vm.update([v]);
    vm.update([v]);
    const group = scene.children[0] as THREE.Group;
    expect(group.position.x).toBeGreaterThan(0);
    expect(group.position.z).toBeGreaterThan(0);
    vm.dispose();
  });

  it('snapPosition moves vehicle immediately', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    vm.addVehicle(makeVehicle(1, 'building_destroyer', 0, 0));
    vm.snapPosition(1, 50, 0, 75);
    const group = scene.children[0] as THREE.Group;
    expect(group.position.x).toBeCloseTo(50);
    expect(group.position.z).toBeCloseTo(75);
    vm.dispose();
  });

  it('removeVehicle removes specific mesh', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    vm.addVehicle(makeVehicle(1, 'debris_hauler'));
    vm.addVehicle(makeVehicle(2, 'rock_digger'));
    vm.removeVehicle(1);
    expect(scene.children.length).toBe(1);
    expect(vm.count).toBe(1);
    vm.dispose();
  });

  it('clearAll removes all vehicles', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    vm.addVehicle(makeVehicle(1, 'debris_hauler'));
    vm.addVehicle(makeVehicle(2, 'drill_rig'));
    vm.clearAll();
    expect(scene.children.length).toBe(0);
    vm.dispose();
  });
});

// ── Task 2.13: tier-specific scale and color variation ────────────────────────
// Role used throughout: debris_hauler.
//   • children[0] of its group is the yellow body mesh — the first part built,
//     and the one whose material color reflects the tier tint.
//   • group.scale.x reflects the uniform scale applied via group.scale.setScalar().

describe('VehicleMesh — tier scale variation', () => {
  /** Helper: add a debris_hauler at the given tier, return group.scale.x. */
  const getScale = (tier: VehicleTier): number => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    vm.addVehicle(makeVehicle(1, 'debris_hauler', 0, 0, tier));
    const group = scene.children[0] as THREE.Group;
    const sx = group.scale.x;
    vm.dispose();
    return sx;
  };

  it('T2 vehicle group scale is larger than T1', () => {
    // Higher tier → bigger vehicle → setScalar(value > 1) for T2 relative to T1.
    expect(getScale(2)).toBeGreaterThan(getScale(1));
  });

  it('T3 vehicle group scale is larger than T2', () => {
    // T3 must be strictly larger than T2.
    expect(getScale(3)).toBeGreaterThan(getScale(2));
  });
});

describe('VehicleMesh — tier color brightening', () => {
  /**
   * Helper: add a debris_hauler at the given tier and return the RGB components
   * of the first child mesh's MeshPhongMaterial color.
   * The first child of debris_hauler is the yellow body (children[0]).
   */
  const getBodyColor = (tier: VehicleTier): { r: number; g: number; b: number } => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    vm.addVehicle(makeVehicle(1, 'debris_hauler', 0, 0, tier));
    const group = scene.children[0] as THREE.Group;
    const bodyMesh = group.children[0] as THREE.Mesh;
    const color = (bodyMesh.material as THREE.MeshPhongMaterial).color;
    vm.dispose();
    return { r: color.r, g: color.g, b: color.b };
  };

  it('T2 debris_hauler body color is brighter than T1', () => {
    // Higher tier → brighter tint on the body material.
    const c1 = getBodyColor(1);
    const c2 = getBodyColor(2);
    const brighter = c2.r > c1.r || c2.g > c1.g || c2.b > c1.b;
    expect(brighter).toBe(true);
  });

  it('T3 debris_hauler body color is brighter than T2', () => {
    // T3 must be strictly brighter than T2 on at least one channel.
    const c2 = getBodyColor(2);
    const c3 = getBodyColor(3);
    const brighter = c3.r > c2.r || c3.g > c2.g || c3.b > c2.b;
    expect(brighter).toBe(true);
  });
});

// ── Issue #411: operational-state visual indicator ─────────────────────────
// Prior to this, VehicleOperationalState.working (and waiting/broken) all
// rendered identically to idle since only position lerped — no color/marker
// distinguished them. STATE_COLOR_MAP and applyStateIndicator close that gap,
// following the same material-manipulation pattern as applyTierVariation.

describe('STATE_COLOR_MAP (#411)', () => {
  const ALL_STATES: VehicleOperationalState[] = ['idle', 'moving', 'working', 'waiting', 'broken'];

  it('has a numeric color entry for every VehicleOperationalState', () => {
    for (const state of ALL_STATES) {
      expect(STATE_COLOR_MAP[state], `missing color for state "${state}"`).toBeTypeOf('number');
    }
  });

  it('assigns a distinct color to each of the 5 states', () => {
    const colors = ALL_STATES.map(s => STATE_COLOR_MAP[s]);
    const unique = new Set(colors);
    expect(unique.size).toBe(ALL_STATES.length);
  });
});

describe('applyStateIndicator (#411)', () => {
  /** Marker mesh contract: a single child tagged userData.isStateIndicator. */
  function getIndicatorMeshes(group: THREE.Group): THREE.Mesh[] {
    return group.children.filter(
      (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.userData?.['isStateIndicator'] === true,
    );
  }

  it('adds exactly one state-indicator marker mesh to the group', () => {
    const group = new THREE.Group();
    applyStateIndicator(group, 'working');

    expect(getIndicatorMeshes(group)).toHaveLength(1);
  });

  it("marker material color matches STATE_COLOR_MAP['broken']", () => {
    const group = new THREE.Group();
    applyStateIndicator(group, 'broken');

    const marker = getIndicatorMeshes(group)[0]!;
    const mat = marker.material as THREE.MeshBasicMaterial | THREE.MeshPhongMaterial;
    expect(mat.color.getHex()).toBe(STATE_COLOR_MAP['broken']);
  });

  it("marker material color matches STATE_COLOR_MAP['waiting']", () => {
    const group = new THREE.Group();
    applyStateIndicator(group, 'waiting');

    const marker = getIndicatorMeshes(group)[0]!;
    const mat = marker.material as THREE.MeshBasicMaterial | THREE.MeshPhongMaterial;
    expect(mat.color.getHex()).toBe(STATE_COLOR_MAP['waiting']);
  });

  it('updates the existing marker in place on repeated calls rather than stacking duplicates', () => {
    const group = new THREE.Group();
    applyStateIndicator(group, 'idle');
    applyStateIndicator(group, 'moving');
    applyStateIndicator(group, 'working');

    const markers = getIndicatorMeshes(group);
    expect(markers).toHaveLength(1);
    const mat = markers[0]!.material as THREE.MeshBasicMaterial | THREE.MeshPhongMaterial;
    expect(mat.color.getHex()).toBe(STATE_COLOR_MAP['working']);
  });

  it('does not remove or alter the group\'s existing body meshes', () => {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshPhongMaterial({ color: 0xf5c518 }));
    group.add(body);

    applyStateIndicator(group, 'working');

    expect(group.children).toContain(body);
  });
});
