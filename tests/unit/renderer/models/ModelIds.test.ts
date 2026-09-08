// ModelIds — asset naming derived from the core catalogs

import { describe, it, expect } from 'vitest';
import {
  allModelIds, buildingModelId, modelUrl, vehicleModelId, workerModelId, BUILDING_RUIN_MODEL_ID, EMPLOYEE_ROLES,
  propModelIds, treeModelId, bushModelId, rockModelId, houseModelId, TREE_FAMILIES, TREE_VARIANTS, BUSH_VARIANTS,
  ROCK_VARIANTS, HOUSE_VARIANTS, GRASS_VARIANTS, FLOWER_VARIANTS,
} from '../../../../src/renderer/models/ModelIds.js';

describe('ModelIds', () => {
  it('names workers, vehicles and buildings by role/type and tier', () => {
    expect(workerModelId('driller')).toBe('worker_driller');
    expect(vehicleModelId('drill_rig', 3)).toBe('vehicle_drill_rig_t3');
    expect(buildingModelId('living_quarters', 3)).toBe('building_living_quarters_t3');
  });

  it('enumerates every asset once: 5 workers, 5 × 3 vehicles, 9 × 3 buildings, the ruin, and the props', () => {
    const ids = allModelIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter(id => id.startsWith('worker_'))).toHaveLength(EMPLOYEE_ROLES.length);
    expect(ids.filter(id => id.startsWith('vehicle_'))).toHaveLength(15);
    expect(ids.filter(id => /^building_.*_t[123]$/.test(id))).toHaveLength(27);
    expect(ids).toContain(BUILDING_RUIN_MODEL_ID);
    const props = propModelIds();
    // Each tree ships with its decimated far copy.
    expect(props).toHaveLength(TREE_FAMILIES.length * TREE_VARIANTS * 2 + BUSH_VARIANTS + ROCK_VARIANTS + HOUSE_VARIANTS + GRASS_VARIANTS + FLOWER_VARIANTS + 1);
    expect(ids).toHaveLength(5 + 15 + 27 + 1 + props.length);
  });

  it('names props by family and variant', () => {
    expect(treeModelId('conifer', 2)).toBe('prop_tree_conifer_2');
    expect(bushModelId(0)).toBe('prop_bush_0');
    expect(rockModelId(1)).toBe('prop_rock_1');
    expect(houseModelId(2)).toBe('prop_house_2');
    expect(propModelIds().every(id => id.startsWith('prop_'))).toBe(true);
  });

  it('serves assets from /models/ by default and from a custom base when given', () => {
    expect(modelUrl('worker_driller')).toBe('/models/worker_driller.glb');
    expect(modelUrl('worker_driller', 'https://cdn.example/m/')).toBe('https://cdn.example/m/worker_driller.glb');
  });
});
