// BlastSimulator2026 — Console command for surveying rock composition

import type { CommandResult } from '../../ConsoleRunner.js';
import { t } from '../../../core/i18n/I18n.js';
import type { MiningContext } from './types.js';
import { requireGameWithSub } from './shared.js';
import { runSurvey, SURVEY_METHODS, type SurveyMethod } from '../../../core/mining/SurveyCalc.js';
import { SURVEY_COSTS, SURVEY_COVERAGE_RADIUS } from '../../../core/config/balance.js';
import { claimForAction, cellsInDisc } from '../siteExpansion.js';

export function surveyCommand(
  ctx: MiningContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const preamble = requireGameWithSub(ctx, args);
  if (preamble.error) return preamble.error;
  const sub = preamble.sub;

  if (sub === 'show') {
    const pending = ctx.state!.pendingActions.filter(a => a.type === 'survey');
    if (pending.length === 0) return { success: true, output: t('mining.survey.none_pending') };
    // payload['method'] is Record<string, unknown> — String() narrows to a printable value
    const lines = pending.map(
      a => `  [${a.id}] ${String(a.payload['method'])} at (${a.targetX}, ${a.targetZ})`,
    );
    return { success: true, output: `Pending surveys:\n${lines.join('\n')}` };
  }

  if (sub === 'mode') {
    const pendingCount = ctx.state!.pendingActions.filter(a => a.type === 'survey').length;
    const completedCount = ctx.state!.surveyResults.length;
    return {
      success: true,
      output: `Survey status: ${completedCount} completed, ${pendingCount} pending.`,
    };
  }

  if (sub === 'ore_report') {
    const report = ctx.state!.lastOreReport;
    if (!report) {
      return {
        success: false,
        output: t('mining.survey.ore_report_unavailable'),
      };
    }

    const oreLines = Object.entries(report.oreYields).map(
      ([oreId, kg]) => `  ${oreId}: ${kg.toFixed(1)}kg`,
    );

    const lines = [
      t('mining.survey.ore_report_header'),
      ...(oreLines.length > 0 ? oreLines : ['  (no ore recovered)']),
      `Total yield: ${report.totalYieldKg.toFixed(1)}kg`,
      `Estimated yield: ${report.estimatedYieldKg.toFixed(1)}kg`,
      report.estimatedYieldKg === 0
        ? 'Yield ratio: n/a (no surveyed ore in blast zone)'
        : `Yield ratio: ${(report.yieldRatio * 100).toFixed(0)}% of estimate`,
    ];

    return { success: true, output: lines.join('\n') };
  }

  if (!sub) {
    return { success: false, output: t('mining.survey.usage') };
  }
  if (!(SURVEY_METHODS as string[]).includes(sub)) {
    return {
      success: false,
      output: t('mining.survey.unknown_method', { method: sub }),
    };
  }

  // sub is a validated SurveyMethod from this point
  const method = sub as SurveyMethod;

  if (named['x'] === undefined || named['z'] === undefined) {
    return {
      success: false,
      output: t('mining.survey.usage'),
    };
  }

  const x = parseInt(named['x'], 10);
  const z = parseInt(named['z'], 10);
  if (isNaN(x) || isNaN(z)) {
    return { success: false, output: t('mining.survey.invalid_coordinates') };
  }

  const claim = claimForAction(ctx, cellsInDisc(x, z, SURVEY_COVERAGE_RADIUS[method]), 'survey');
  if (!claim.ok) return { success: false, output: claim.output! };

  const result = runSurvey(ctx.state!, { method, centerX: x, centerZ: z });

  if (!result.success) {
    if (result.error === 'insufficient_funds') {
      return { success: false, output: `Insufficient funds. ${method} survey costs $${SURVEY_COSTS[method]}.` };
    }
    if (result.error === 'no_surveyor') {
      return { success: false, output: t('mining.survey.no_surveyor') };
    }
    return { success: false, output: t('mining.survey.failed') };
  }

  return {
    success: true,
    output: `${method} survey queued at (${x}, ${z}). Action ID: ${result.actionId}.`,
  };
}
