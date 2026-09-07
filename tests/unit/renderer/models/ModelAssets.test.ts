// Exported model assets — every id the game asks for exists, parses, stays
// within budget, and carries the nodes and tint materials the renderer relies on.

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import * as THREE from 'three';
import { resolve } from 'node:path';
import type { ModelLibrary } from '../../../../src/renderer/models/ModelLibrary.js';
import {
  allModelIds, buildingModelId, vehicleModelId, workerModelId, BUILDING_RUIN_MODEL_ID, EMPLOYEE_ROLES,
} from '../../../../src/renderer/models/ModelIds.js';
import { getAllVehicleRoles } from '../../../../src/core/entities/Vehicle.js';
import { BUILDING_DEFS } from '../../../../src/core/entities/BuildingDefs.js';
import { getFootprintSize } from '../../../../src/core/entities/Building.js';
import type { BuildingTier, BuildingType } from '../../../../src/core/entities/Building.js';
import { loadedModelLibrary, MODEL_DIR } from '../../../helpers/models.js';

/** One .glb may not exceed this (KB); the whole set is what the loading screen's first phase downloads. */
const MAX_ASSET_KB = 400;
const MAX_TOTAL_MB = 8;

let library: ModelLibrary;

beforeAll(async () => {
  library = await loadedModelLibrary();
});

describe('public/models', () => {
  it('holds an asset for every catalogued id, within size budget', () => {
    let total = 0;
    for (const id of allModelIds()) {
      const file = resolve(MODEL_DIR, `${id}.glb`);
      expect(existsSync(file), `${id}.glb missing — run npm run models:build`).toBe(true);
      const kb = statSync(file).size / 1024;
      expect(kb, `${id}.glb is ${kb.toFixed(0)} KB`).toBeLessThanOrEqual(MAX_ASSET_KB);
      total += kb;
    }
    expect(total / 1024).toBeLessThanOrEqual(MAX_TOTAL_MB);
  });

  it('every asset parses into the library', () => {
    for (const id of allModelIds()) expect(library.has(id), id).toBe(true);
  });

  it('every worker has the six animatable nodes, a role tint and a minion silhouette', () => {
    for (const role of EMPLOYEE_ROLES) {
      const inst = library.instantiate(workerModelId(role), { size: [1, 1, 1] });
      for (const node of ['Head', 'Torso', 'ArmL', 'ArmR', 'LegL', 'LegR']) {
        expect(inst.node(node), `${role} ${node}`).not.toBeNull();
      }
      expect([...inst.tints.keys()]).toEqual(['TintRole']);
      const size = inst.bounds.getSize(new THREE.Vector3());
      expect(size.y, `${role} height`).toBeGreaterThan(1.1);
      expect(size.y, `${role} height`).toBeLessThan(1.6);
      expect(inst.bounds.min.y, `${role} stands on the ground`).toBeCloseTo(0, 1);
    }
  });

  it('every vehicle has a Body node and paint tint; the hauler rolls on four wheel nodes', () => {
    for (const role of getAllVehicleRoles()) {
      const inst = library.instantiate(vehicleModelId(role), { size: [1, 1, 1] });
      expect(inst.node('Body'), role).not.toBeNull();
      expect(inst.tints.has('TintBody'), role).toBe(true);
      expect(inst.bounds.min.y, `${role} on the ground`).toBeCloseTo(0, 1);
    }
    const hauler = library.instantiate(vehicleModelId('debris_hauler'), { size: [1, 1, 1] });
    for (const wheel of ['WheelFL', 'WheelFR', 'WheelRL', 'WheelRR']) expect(hauler.node(wheel)).not.toBeNull();
    expect(library.instantiate(vehicleModelId('rock_fragmenter'), { size: [1, 1, 1] }).node('Flywheel')).not.toBeNull();
  });

  it('every building fits its footprint, grows taller with tier and exposes the wall tint', () => {
    for (const type of Object.keys(BUILDING_DEFS) as BuildingType[]) {
      let previousHeight = 0;
      for (const tier of [1, 2, 3] as BuildingTier[]) {
        const inst = library.instantiate(buildingModelId(type, tier), { size: [1, 1, 1] });
        const { sizeX, sizeZ } = getFootprintSize(BUILDING_DEFS[type][tier].footprint);
        const size = inst.bounds.getSize(new THREE.Vector3());
        // Props may poke past the walls, but the model must not swallow neighbouring cells.
        expect(size.x, `${type} t${tier} width`).toBeLessThanOrEqual(sizeX + 2.2);
        expect(size.z, `${type} t${tier} depth`).toBeLessThanOrEqual(sizeZ + 2.2);
        expect(size.y, `${type} t${tier} taller than t${tier - 1}`).toBeGreaterThan(previousHeight);
        previousHeight = size.y;
        expect(inst.tints.has('TintBody'), `${type} t${tier}`).toBe(true);
      }
    }
    const ruin = library.instantiate(BUILDING_RUIN_MODEL_ID, { size: [1, 1, 1] });
    expect(ruin.bounds.getSize(new THREE.Vector3()).x).toBeLessThanOrEqual(2.6);
  });
});
