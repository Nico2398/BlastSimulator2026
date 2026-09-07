// ModelIds — asset naming derived from the core catalogs

import { describe, it, expect } from 'vitest';
import {
  allModelIds, buildingModelId, modelUrl, vehicleModelId, workerModelId, BUILDING_RUIN_MODEL_ID, EMPLOYEE_ROLES,
} from '../../../../src/renderer/models/ModelIds.js';

describe('ModelIds', () => {
  it('names workers, vehicles and buildings by role/type and tier', () => {
    expect(workerModelId('driller')).toBe('worker_driller');
    expect(vehicleModelId('drill_rig')).toBe('vehicle_drill_rig');
    expect(buildingModelId('living_quarters', 3)).toBe('building_living_quarters_t3');
  });

  it('enumerates every asset once: 5 workers, 5 vehicles, 9 × 3 buildings, the ruin', () => {
    const ids = allModelIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter(id => id.startsWith('worker_'))).toHaveLength(EMPLOYEE_ROLES.length);
    expect(ids.filter(id => id.startsWith('vehicle_'))).toHaveLength(5);
    expect(ids.filter(id => /^building_.*_t[123]$/.test(id))).toHaveLength(27);
    expect(ids).toContain(BUILDING_RUIN_MODEL_ID);
    expect(ids).toHaveLength(5 + 5 + 27 + 1);
  });

  it('serves assets from /models/ by default and from a custom base when given', () => {
    expect(modelUrl('worker_driller')).toBe('/models/worker_driller.glb');
    expect(modelUrl('worker_driller', 'https://cdn.example/m/')).toBe('https://cdn.example/m/worker_driller.glb');
  });
});
