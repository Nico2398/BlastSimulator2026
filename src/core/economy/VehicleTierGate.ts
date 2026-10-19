// Grade-gated vehicle tiers on progression sites (#1928).
import type { VehicleTier } from '../entities/Vehicle.js';
import { VEHICLE_TIER_UNLOCK_GRADE } from '../config/balance.js';
import { gradeDef, registerUnlockLine } from './MineGrade.js';
import { t } from '../i18n/I18n.js';

/** Null when allowed (or grade is undefined: non-progression site); else the grade needed. */
export function vehicleTierGate(grade: number | undefined, tier: VehicleTier): { needed: number } | null {
  if (grade === undefined) return null;
  const needed = VEHICLE_TIER_UNLOCK_GRADE[tier];
  return grade >= needed ? null : { needed };
}

function gradeName(grade: number): string {
  const def = gradeDef(grade);
  return t(def.nameKey, def.nameParams);
}

/** Dealer refusal text for a gated purchase or upgrade; null when allowed (or non-progression site). */
export function vehicleTierRefusal(grade: number | undefined, tier: VehicleTier): string | null {
  const gate = vehicleTierGate(grade, tier);
  if (grade === undefined || gate === null) return null;
  return t('vehicle.tier_locked', { current: gradeName(grade), needed: gradeName(gate.needed) });
}

/** Short lock label shown on gated UI controls. */
export function vehicleTierLockLabel(needed: number): string {
  return t('ui.fleet.tier_locked', { grade: gradeName(needed) });
}

for (const grade of new Set(Object.values(VEHICLE_TIER_UNLOCK_GRADE))) {
  if (grade > 0) registerUnlockLine({ grade, key: `progression.unlock.vehicle_tier.${grade}` });
}
