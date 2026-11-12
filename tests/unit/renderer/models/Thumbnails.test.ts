// Portrait thumbnails (#2241): every picture the UI asks for is committed, distinct and within budget.
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { thumbnailShots, thumbnailUrl } from '../../../../src/renderer/models/Thumbnails.js';
import { allModelIds, EMPLOYEE_ROLES, VEHICLE_TIERS, vehicleModelId, workerModelId } from '../../../../src/renderer/models/ModelIds.js';
import { getAllVehicleRoles } from '../../../../src/core/entities/Vehicle.js';

const THUMB_DIR = resolve(import.meta.dirname, '../../../../public/thumbs');
/** One thumbnail above this is a framing or export mistake (measured 5–20 KB). */
const MAX_THUMB_KB = 40;
/** The whole set, what a first visit downloads at most (measured ~0.6 MB). */
const MAX_TOTAL_KB = 1200;

describe('thumbnail catalogue', () => {
  const shots = thumbnailShots();

  it('covers every worker role and every vehicle role and tier', () => {
    const ids = new Set(shots.map(s => s.id));
    for (const role of EMPLOYEE_ROLES) expect(ids.has(workerModelId(role)), role).toBe(true);
    for (const role of getAllVehicleRoles()) {
      for (const tier of VEHICLE_TIERS) expect(ids.has(vehicleModelId(role, tier)), `${role} t${tier}`).toBe(true);
    }
  });

  it('names only models the game ships, each once', () => {
    const models = new Set(allModelIds());
    expect(new Set(shots.map(s => s.id)).size).toBe(shots.length);
    for (const s of shots) expect(models.has(s.id), s.id).toBe(true);
  });

  it('serves each thumbnail from /thumbs/ as WebP', () => {
    expect(thumbnailUrl('worker_driller')).toBe('/thumbs/worker_driller.webp');
  });
});

describe('public/thumbs', () => {
  it('holds a non-empty WebP for every shot, each within budget', () => {
    for (const s of thumbnailShots()) {
      const file = resolve(THUMB_DIR, `${s.id}.webp`);
      expect(existsSync(file), `${s.id}.webp missing — run npm run thumbs:build -- ${s.id}`).toBe(true);
      const kb = statSync(file).size / 1024;
      expect(kb, s.id).toBeGreaterThan(1);
      expect(kb, s.id).toBeLessThanOrEqual(MAX_THUMB_KB);
    }
  });

  it('holds nothing the catalogue does not ask for, and stays within the set budget', () => {
    const wanted = new Set(thumbnailShots().map(s => `${s.id}.webp`));
    const files = readdirSync(THUMB_DIR);
    expect(files.filter(f => !wanted.has(f))).toEqual([]);
    const totalKb = files.reduce((a, f) => a + statSync(resolve(THUMB_DIR, f)).size, 0) / 1024;
    expect(totalKb).toBeLessThanOrEqual(MAX_TOTAL_KB);
  });
});
