// BlastSimulator2026 — Player-facing text for the breakout warning (#2003)
import { t } from '../../core/i18n/I18n.js';
import { BURDEN_BREAKOUT_MAX } from '../../core/config/balance.js';
import { breakoutWarningKind, type BreakoutPrediction } from '../../core/mining/BreakoutPrediction.js';

/** "3 of 9 holes are too deep to break out (more than 4 m of rock stays above the charge)…". The caller picks the key. */
export function breakoutWarningText(prediction: BreakoutPrediction, key: string): string {
  return t(key, {
    count: prediction.tooDeepHoleIds.length,
    total: prediction.chargedHoleCount,
    max: BURDEN_BREAKOUT_MAX,
    percent: Math.round(prediction.sealedShare * 100),
  });
}

/** The warning for `prediction` using the i18n key of its kind, or null when none is due. */
export function breakoutWarningFor(
  prediction: BreakoutPrediction | null,
  keys: Record<'none' | 'partial', string>,
): string | null {
  const kind = prediction ? breakoutWarningKind(prediction) : null;
  return prediction && kind ? breakoutWarningText(prediction, keys[kind]) : null;
}
