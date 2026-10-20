// BlastSimulator2026 — Title and subline shared by the ramp inspector and hover tag (#1298)

import { t } from '../core/i18n/I18n.js';
import type { BuiltRamp } from '../core/state/GameState.js';
import type { VehicleTier } from '../core/entities/Vehicle.js';
import { VEHICLE_TIER_LIST, slopeDegreesForTier } from '../core/nav/ClimbLimit.js';
import { formatMoney } from '../core/economy/formatMoney.js';

/** Climb facts for a ramp, from core's `describeRampClimb`, which already lists every tier off a progression site (#1938). */
interface RampClimbText {
  gradeDeg: number;
  tiers: VehicleTier[];
}

const TIER_COUNT = 3;

function tiersLine(tiers: readonly VehicleTier[]): string {
  if (tiers.length === TIER_COUNT) return t('shell.selection.ramp_tiers_all');
  if (tiers.length === 0) return t('shell.selection.ramp_tiers_none');
  return t('shell.selection.ramp_tiers', { tiers: tiers.join(', ') });
}

/** The one-line title and detail line naming a built ramp; `opts` adds its grade and the vehicle tiers that climb it. */
export function describeRamp(ramp: BuiltRamp, opts?: RampClimbText): { title: string; sub: string } {
  const base = t('shell.selection.ramp_sub', { id: ramp.id, width: ramp.width, length: ramp.def.length });
  const legs = ramp.def.legs === undefined ? [] : [t('shell.selection.ramp_legs', { legs: ramp.def.legs.length })];
  const climb = opts === undefined ? [] : [
    t('shell.selection.ramp_grade', { grade: Math.round(opts.gradeDeg) }),
    tiersLine(opts.tiers),
  ];
  return {
    title: t('shell.selection.ramp_title', { width: ramp.width }),
    sub: [base, ...legs, ...climb].join(' · '),
  };
}

/** One line naming which vehicle tiers climb the planned grade, e.g. "T1 ✓ T2 ✓ T3 ✗ (max 18°)"; no limit when every tier climbs. */
export function rampTierCheckLine(tiers: readonly VehicleTier[]): string {
  const checks = VEHICLE_TIER_LIST.map(tier => `T${tier} ${tiers.includes(tier) ? '✓' : '✗'}`).join(' ');
  const failing = VEHICLE_TIER_LIST.find(tier => !tiers.includes(tier));
  if (failing === undefined) return checks;
  return t('ui.build.ramp_tiers_check', { checks, max: t('ui.build.ramp_tiers_max', { deg: slopeDegreesForTier(failing) }) });
}

/** Readout lines for the ramp param strip while a plan is being drawn; the tier line only when `tiers` is given. */
export function describeRampPlan(p: { length: number; legs: number; cost: number; gradeDeg: number; tiers: VehicleTier[] | null }): string[] {
  const lines = [t('ui.build.ramp_readout', {
    length: p.length, legs: p.legs, cost: formatMoney(p.cost), grade: Math.round(p.gradeDeg * 10) / 10,
  })];
  if (p.tiers !== null) lines.push(rampTierCheckLine(p.tiers));
  return lines;
}
