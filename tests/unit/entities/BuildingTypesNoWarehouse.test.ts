// BlastSimulator2026 — The explosive warehouse is not a building type any more (#2154)
//
// Explosives are bought as each hole is loaded (#2153), so nothing stores them. The type leaves the
// definitions, the research table, the model manifest, the generator defs and both locales.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  BUILDING_DEFS,
  getAllBuildingTypes,
} from '../../../src/core/entities/Building.js';
import { RESEARCH_TASK_DEFS } from '../../../src/core/config/balance.js';

const GONE = 'explosive_warehouse';
const ROOT = resolve(__dirname, '../../..');
const readJson = (rel: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8')) as Record<string, unknown>;

describe('explosive_warehouse is not a BuildingType (#2154)', () => {
  it('is absent from BUILDING_DEFS', () => {
    expect(Object.keys(BUILDING_DEFS)).not.toContain(GONE);
    expect((BUILDING_DEFS as Record<string, unknown>)[GONE]).toBeUndefined();
  });

  it('is absent from the list of building types the Build menu and console iterate', () => {
    expect(getAllBuildingTypes() as string[]).not.toContain(GONE);
  });

  it('keeps the other building types (the removal is not a wipe)', () => {
    const types = getAllBuildingTypes() as string[];
    for (const kept of ['freight_warehouse', 'living_quarters', 'management_office', 'spoil_heap']) {
      expect(types, kept).toContain(kept);
    }
  });

  it('every building type still has its three tiers or its one tier, none naming the warehouse', () => {
    for (const type of getAllBuildingTypes()) {
      for (const def of Object.values(BUILDING_DEFS[type])) {
        expect(def.nameKey, type).not.toContain(GONE);
      }
    }
  });

  it('has no research task row', () => {
    expect(Object.keys(RESEARCH_TASK_DEFS)).not.toContain(GONE);
  });

  it('research table keys match the building types exactly', () => {
    expect(Object.keys(RESEARCH_TASK_DEFS).sort()).toEqual([...getAllBuildingTypes()].sort());
  });
});

describe('explosive_warehouse is gone from the model assets (#2154)', () => {
  it('manifest.json lists no building_explosive_warehouse model', () => {
    const manifest = JSON.stringify(readJson('assets/models/manifest.json'));
    expect(manifest).not.toContain(GONE);
  });

  it('manifest.json still lists the freight warehouse model', () => {
    expect(JSON.stringify(readJson('assets/models/manifest.json'))).toContain('freight_warehouse');
  });

  it('the generator definitions (building-defs.json) have no explosive_warehouse entry', () => {
    const defs = readJson('assets/models/blender/building-defs.json');
    expect(Object.keys(defs)).not.toContain(GONE);
    expect(JSON.stringify(defs)).not.toContain(GONE);
  });
});

describe('explosive_warehouse is gone from both locales (#2154)', () => {
  const locales = {
    en: readJson('src/core/i18n/locales/en.json'),
    fr: readJson('src/core/i18n/locales/fr.json'),
  };

  it.each(['en', 'fr'] as const)('%s has no building.explosive_warehouse.* key', (loc) => {
    const keys = Object.keys(locales[loc]).filter((k) => k.startsWith('building.explosive_warehouse'));
    expect(keys).toEqual([]);
  });

  it.each(['en', 'fr'] as const)('%s has no tutorial.step_explosivewarehouse* key', (loc) => {
    const keys = Object.keys(locales[loc]).filter((k) => k.startsWith('tutorial.step_explosivewarehouse'));
    expect(keys).toEqual([]);
  });

  it.each(['en', 'fr'] as const)('%s has no tutorial.stage.build_explosive_warehouse key', (loc) => {
    expect(Object.keys(locales[loc])).not.toContain('tutorial.stage.build_explosive_warehouse');
  });

  it.each(['en', 'fr'] as const)('%s keeps the freight warehouse names', (loc) => {
    expect(Object.keys(locales[loc])).toContain('building.freight_warehouse.t1.name');
  });
});
