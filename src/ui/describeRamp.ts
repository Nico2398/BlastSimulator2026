// BlastSimulator2026 — Title and subline shared by the ramp inspector and hover tag (#1298)

import { t } from '../core/i18n/I18n.js';
import type { BuiltRamp } from '../core/state/GameState.js';
import type { RampClimb } from '../core/mining/RampGrade.js';
import { formatMoney } from '../core/economy/formatMoney.js';

/** Whether vehicles climb a ramp, as one line carrying the limit (#2045); literal keys so key scans find them. */
function climbableLine(shell: boolean, climb: RampClimb): string {
  const max = Math.round(climb.maxDeg);
  if (shell) return t(climb.climbable ? 'shell.selection.ramp_climbable' : 'shell.selection.ramp_not_climbable', { max });
  return t(climb.climbable ? 'ui.build.ramp_climbable' : 'ui.build.ramp_not_climbable', { max });
}

/** The one-line title and detail line naming a built ramp; `climb` adds its grade and whether vehicles can climb it. */
export function describeRamp(ramp: BuiltRamp, climb?: RampClimb): { title: string; sub: string } {
  const base = t('shell.selection.ramp_sub', { id: ramp.id, width: ramp.width, length: ramp.def.length });
  const legs = ramp.def.legs === undefined ? [] : [t('shell.selection.ramp_legs', { legs: ramp.def.legs.length })];
  const extra = climb === undefined ? [] : [
    t('shell.selection.ramp_grade', { grade: Math.round(climb.gradeDeg) }),
    climbableLine(true, climb),
  ];
  return {
    title: t('shell.selection.ramp_title', { width: ramp.width }),
    sub: [base, ...legs, ...extra].join(' · '),
  };
}

/** Readout lines for the ramp param strip while a plan is being drawn; the climbable line only when `climb` is given. */
export function describeRampPlan(p: { length: number; legs: number; cost: number; gradeDeg: number; climb: RampClimb | null }): string[] {
  const lines = [t('ui.build.ramp_readout', {
    length: p.length, legs: p.legs, cost: formatMoney(p.cost), grade: Math.round(p.gradeDeg * 10) / 10,
  })];
  if (p.climb !== null) lines.push(climbableLine(false, p.climb));
  return lines;
}
