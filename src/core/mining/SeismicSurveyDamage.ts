// BlastSimulator2026 — Seismic survey shockwave damage to nearby buildings

import { SEISMIC_SURVEY_DAMAGE_RADIUS, SEISMIC_SURVEY_DAMAGE_HP } from '../config/balance.js';
import type { BuildingState } from '../entities/Building.js';
import { getBuildingDef, getDefSize, destroyBuilding } from '../entities/Building.js';
import type { AccidentRecord } from '../entities/Damage.js';

/**
 * Sentinel `fragmentId` for accidents with no originating fragment (e.g. a
 * seismic survey shockwave, which has no projectile). `kineticEnergy` is
 * reported as 0 for the same reason.
 */
const NO_FRAGMENT_ID = -1;

/**
 * Apply seismic survey shockwave damage to buildings near the survey centre.
 *
 * Every building whose footprint centre lies within `SEISMIC_SURVEY_DAMAGE_RADIUS`
 * grid cells (Euclidean) of `(centerX, centerZ)` loses `SEISMIC_SURVEY_DAMAGE_HP`
 * HP, independently — proximity to multiple buildings does not split the damage.
 * A building destroyed by the shockwave (HP <= 0) is removed via `destroyBuilding`.
 * No-op for any method other than `'seismic'` — callers should gate on method
 * before invoking this.
 *
 * Mirrors `processBuildingHit` in `src/core/entities/Damage.ts`: mutates
 * `buildings` in place and returns the `AccidentRecord`s produced, using the
 * `'seismic_damage'` / `'seismic_destroyed'` types (not `'building_damage'` /
 * `'building_destroyed'`, which readers would otherwise assume came from a
 * blast fragment) so the accident log doesn't misattribute the cause. The
 * caller is responsible for pushing the returned records into
 * `state.damage.accidents`, matching how `processProjections` divides the
 * work with its per-hit processors.
 */
export function applySeismicSurveyDamage(
  buildings: BuildingState,
  centerX: number,
  centerZ: number,
  tick: number,
): AccidentRecord[] {
  const accidents: AccidentRecord[] = [];

  for (const b of [...buildings.buildings]) {
    const def = getBuildingDef(b.type, b.tier);
    const { sizeX, sizeZ } = getDefSize(def);
    const cx = b.x + sizeX / 2;
    const cz = b.z + sizeZ / 2;
    const dx = cx - centerX;
    const dz = cz - centerZ;
    if (Math.sqrt(dx * dx + dz * dz) > SEISMIC_SURVEY_DAMAGE_RADIUS) continue;

    const entityLabel = b.type;
    b.hp -= SEISMIC_SURVEY_DAMAGE_HP;
    if (b.hp <= 0) {
      destroyBuilding(buildings, b.id);
      accidents.push({ tick, type: 'seismic_destroyed', entityId: b.id, fragmentId: NO_FRAGMENT_ID, kineticEnergy: 0, entityLabel });
    } else {
      accidents.push({ tick, type: 'seismic_damage', entityId: b.id, fragmentId: NO_FRAGMENT_ID, kineticEnergy: 0, entityLabel });
    }
  }

  return accidents;
}
