/**
 * BlastSimulator2026 — Model definitions dump
 *
 * Writes assets/models/blender/building-defs.json from the game's own
 * building catalog so the Blender generators size every building to the
 * footprint the game places it on. Run by `npm run models:build` before
 * Blender starts; check the JSON in so a Blender-only edit still sees it.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUILDING_DEFS } from '../src/core/entities/BuildingDefs.js';
import { getFootprintSize } from '../src/core/entities/Building.js';

const OUT = resolve(import.meta.dirname ?? process.cwd(), '..', 'assets', 'models', 'blender', 'building-defs.json');

interface BuildingModelDef {
  sizeX: number;
  sizeZ: number;
  entry: readonly [number, number];
  exit: readonly [number, number];
}

const out: Record<string, Record<string, BuildingModelDef>> = {};
for (const [type, tiers] of Object.entries(BUILDING_DEFS)) {
  out[type] = {};
  for (const [tier, def] of Object.entries(tiers)) {
    const { sizeX, sizeZ } = getFootprintSize(def.footprint);
    out[type][tier] = { sizeX, sizeZ, entry: def.entryPoint, exit: def.exitPoint };
  }
}
writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${OUT}`);
