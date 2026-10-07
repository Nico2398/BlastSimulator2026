// BlastSimulator2026 — Integration: survey staleness is blast-driven (#1356)
//
// Drives the real console `blast` command. Staleness is a flag set by a blast
// that clears a column inside a survey's disc; time alone never sets it. The
// post-blast ore report is computed against the PRE-blast freshness, and only
// afterwards are overlapping surveys marked stale.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { ConsoleRunner } from '../../src/console/ConsoleRunner.js';
import type { MiningContext } from '../../src/console/commands/mining.js';
import type { SurveyResult } from '../../src/core/mining/SurveyCalc.js';
import { isSurveyStale } from '../../src/core/mining/SurveyCalc.js';
import { serialize, deserialize } from '../../src/core/state/SaveLoad.js';

/** Survey whose estimates cover every column in [0, 40]². */
function wideSurvey(id: number, over: Partial<SurveyResult> = {}): SurveyResult {
  const estimates: Record<string, Record<string, number>> = {};
  for (let x = 0; x <= 40; x++) for (let z = 0; z <= 40; z++) estimates[`${x},${z}`] = { blingite: 0.4 };
  return {
    id, method: 'seismic', centerX: 16, centerZ: 16, completedTick: 1, surveyorId: 1,
    estimates, confidence: 0.9, ...over,
  };
}

function drain(runner: ConsoleRunner, ctx: MiningContext, done: () => boolean): void {
  for (let i = 0; i < 800 && !done(); i++) {
    for (const emp of ctx.state!.employees.employees) emp.fatigue = 100;
    runner.run('tick 1');
  }
  expect(done()).toBe(true);
}

/** Everything up to (not including) `blast`. */
function prepareBlast(runner: ConsoleRunner, ctx: MiningContext): void {
  expect(runner.run('new_game seed:42 size:32 staffed:true').success).toBe(true);
  expect(runner.run('drill_plan grid rows:2 cols:2 spacing:5 depth:6 start:14,14').success).toBe(true);
  drain(runner, ctx, () => ctx.state!.plannedDrillHoles.length === 0);
  expect(runner.run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
  drain(runner, ctx, () => Object.keys(ctx.state!.plannedChargesByHole).length === 0);
  expect(runner.run('sequence auto delay_step:25').success).toBe(true);
}

describe('console blast marks overlapping surveys stale (#1356)', () => {
  it('a survey covering the blast turns stale; a distant core sample stays fresh', () => {
    const { runner, ctx } = createRunner();
    prepareBlast(runner, ctx);
    const covering = wideSurvey(1);
    const distant = wideSurvey(2, { method: 'core_sample', centerX: 1, centerZ: 1 });
    ctx.state!.surveyResults.push(covering, distant);

    expect(runner.run('blast').success).toBe(true);

    expect(isSurveyStale(covering)).toBe(true);
    expect(isSurveyStale(distant)).toBe(false);
  });

  it('ticking alone never stales a survey', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const survey = wideSurvey(1);
    ctx.state!.surveyResults.push(survey);
    for (let i = 0; i < 30; i++) {
      for (const emp of ctx.state!.employees.employees) emp.fatigue = 100;
      runner.run('tick 10');
    }
    expect(ctx.state!.tickCount).toBeGreaterThan(100);
    expect(isSurveyStale(survey)).toBe(false);
  });

  it('the ore report uses pre-blast freshness: a fresh survey still feeds this blast\'s estimate', () => {
    const { runner, ctx } = createRunner();
    prepareBlast(runner, ctx);
    ctx.state!.surveyResults.push(wideSurvey(1));

    expect(runner.run('blast').success).toBe(true);

    const report = ctx.state!.lastOreReport!;
    expect(report.totalYieldKg).toBeGreaterThan(0);
    expect(report.estimatedYieldKg).toBeGreaterThan(0);
    // ...and only afterwards did the survey go stale.
    expect(isSurveyStale(ctx.state!.surveyResults[0]!)).toBe(true);
  });

  it('a survey already stale before the blast contributes no estimate (ratio 1.0)', () => {
    const { runner, ctx } = createRunner();
    prepareBlast(runner, ctx);
    ctx.state!.surveyResults.push(wideSurvey(1, { stale: true }));

    expect(runner.run('blast').success).toBe(true);

    const report = ctx.state!.lastOreReport!;
    expect(report.estimatedYieldKg).toBe(0);
    expect(report.yieldRatio).toBe(1.0);
  });

  it('a blast over an already-stale survey leaves it stale and un-estimated', () => {
    const { runner, ctx } = createRunner();
    prepareBlast(runner, ctx);
    const survey = wideSurvey(1, { stale: true });
    ctx.state!.surveyResults.push(survey);

    expect(runner.run('blast').success).toBe(true);

    // Marking is idempotent: still stale, and it fed no estimate to this blast.
    expect(survey.stale).toBe(true);
    expect(ctx.state!.lastOreReport!.estimatedYieldKg).toBe(0);
  });
});

describe('survey stale flag persists through save/load (#1356)', () => {
  it('round-trips stale:true', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game seed:42 size:32').success).toBe(true);
    ctx.state!.surveyResults.push(wideSurvey(1, { stale: true }), wideSurvey(2));

    const loaded = deserialize(serialize(ctx.state!));

    expect(isSurveyStale(loaded.surveyResults.find(s => s.id === 1)!)).toBe(true);
    expect(isSurveyStale(loaded.surveyResults.find(s => s.id === 2)!)).toBe(false);
  });

  it('an old save whose surveys lack the field loads them fresh', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game seed:42 size:32').success).toBe(true);
    ctx.state!.surveyResults.push(wideSurvey(1, { completedTick: 0 }));
    const raw = JSON.parse(serialize(ctx.state!)) as { surveyResults: Array<Record<string, unknown>> };
    for (const s of raw.surveyResults) delete s['stale'];
    (raw as unknown as { tickCount: number }).tickCount = 5000;

    const loaded = deserialize(JSON.stringify(raw));

    expect(loaded.surveyResults).toHaveLength(1);
    expect(isSurveyStale(loaded.surveyResults[0]!)).toBe(false);
  });
});
