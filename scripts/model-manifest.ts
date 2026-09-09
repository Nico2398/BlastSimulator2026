/**
 * BlastSimulator2026 — Model manifest writer
 *
 * Regenerates assets/models/manifest.json from the exported assets, so an
 * agent or a human can look up a model's nodes, parts, materials, size and
 * triangle count without reading its generator or opening Blender.
 *
 *   npm run models:manifest
 *
 * Run it after `npm run models:build`; a unit test fails when the committed
 * manifest no longer matches public/models/.
 */

import { writeFileSync } from 'node:fs';
import { buildModelManifest, MANIFEST_PATH } from './shared/model-manifest.js';

const manifest = await buildModelManifest();
writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${MANIFEST_PATH} — ${Object.keys(manifest.models).length} models`);
