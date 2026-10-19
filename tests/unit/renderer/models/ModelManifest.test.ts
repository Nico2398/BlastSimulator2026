// The model manifest describes the exported assets — nodes, parts, materials,
// size, triangles — so a model can be edited without reverse-engineering its
// generator. It is derived data, so the only thing worth asserting is that it
// still matches what public/models/ actually holds.

import { describe, it, expect } from 'vitest';
import { buildModelManifest, readModelManifest } from '../../../../scripts/shared/model-manifest.js';
import { allModelIds } from '../../../../src/renderer/models/ModelIds.js';

describe('assets/models/manifest.json', () => {
  it('matches the exported assets', async () => {
    const committed = readModelManifest();
    expect(committed, 'manifest missing — run npm run models:manifest').not.toBeNull();
    const fresh = await buildModelManifest();
    expect(committed, 'manifest is stale — run npm run models:manifest after rebuilding a model').toEqual(fresh);
  });

  it('describes every model the game asks for', () => {
    const manifest = readModelManifest()!;
    for (const id of allModelIds()) expect(manifest.models[id], id).toBeDefined();
  });

  it('describes the four single-tier vanity projects (#1948)', () => {
    const { models } = readModelManifest()!;
    for (const type of ['ceo_statue', 'golf_course', 'executive_helipad', 'gold_tower']) {
      expect(models[`building_${type}_t1`], type).toBeDefined();
      expect(models[`building_${type}_t2`], type).toBeUndefined();
      expect(models[`building_${type}_t3`], type).toBeUndefined();
    }
  });

  it('names the generator module each id is built by', () => {
    const { models } = readModelManifest()!;
    expect(models['worker_driller']!.builder).toBe('workers.py');
    expect(models['vehicle_drill_rig_t1']!.builder).toBe('vehicles_t1.py');
    expect(models['vehicle_drill_rig_t2']!.builder).toBe('vehicles.py');
    expect(models['vehicle_drill_rig_t3']!.builder).toBe('vehicles_t3.py');
    expect(models['building_living_quarters_t1']!.builder).toBe('buildings_t1.py');
    expect(models['building_living_quarters_t2']!.builder).toBe('buildings.py');
    expect(models['building_spoil_heap_t1']!.builder).toBe('buildings_t1.py');
    expect(models['building_spoil_heap_t2']).toBeUndefined();
    expect(models['building_spoil_heap_t3']).toBeUndefined();
    expect(models['building_ruin']!.builder).toBe('buildings.py');
    expect(models['prop_grass_0']!.builder).toBe('props.py');
    for (const id of ['ceo_statue', 'golf_course', 'executive_helipad', 'gold_tower']) {
      expect(models[`building_${id}_t1`]!.builder, id).toBe('buildings_vanity.py');
    }
  });
});
