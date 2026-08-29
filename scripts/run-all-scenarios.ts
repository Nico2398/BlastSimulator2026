/**
 * BlastSimulator2026 — Batch Scenario Runner
 *
 * Runs ALL scenario JSON files in a single process (cold start once)
 * for maximum CI throughput. Reports per-scenario pass/fail with detailed
 * error information and exits with code 1 if any scenario fails.
 *
 * Usage:
 *   npx tsx scripts/run-all-scenarios.ts [--mode command|interaction]
 *
 * Default mode: command (pure Node.js, no browser, ~24s for all 99).
 * Interaction mode: shared Puppeteer browser, ~2-3min for all 99.
 *
 * --report-drift (command mode only, issue #679): a step whose only
 * failures are equals/changedBy mismatches no longer marks the step (or its
 * scenario) as failed — it runs to completion instead, and every such
 * mismatch is collected into a drift report (stdout + drift-report.json)
 * rather than aborting the run. Directional goals (increased/decreased)
 * still fail the run as before. This means a run under --report-drift can
 * exit 0 while its drift report is non-empty — that's the point: it's a
 * run-to-completion report, not a pass/fail gate.
 *
 * This file is the thin CLI entrypoint; the actual work lives in its sibling
 * modules (issue #824): `run-all-scenarios-cli.ts` (arg parsing, sharding),
 * `run-all-scenarios-result.ts` (shared result/progress helpers),
 * `run-all-scenarios-command-batch.ts` (command-mode batch loop), and
 * `run-all-scenarios-interaction-batch.ts` (interaction-mode batch loop).
 */

import { readdirSync } from 'fs';
import { resolve } from 'path';
import { emitDriftReport, type ScenarioResult, type DriftRecord } from './shared/command-runner.js';
import { SCENARIO_DIR } from './shared/scenario-utils.js';
import { SCREENSHOT_DIR } from './shared/puppeteer-utils.js';
import { parseArgs, selectShard } from './run-all-scenarios-cli.js';
import { runBatchCommand } from './run-all-scenarios-command-batch.js';
import { runBatchInteraction } from './run-all-scenarios-interaction-batch.js';

export { buildScenarioLoadFailure } from './run-all-scenarios-result.js';

async function main(): Promise<void> {
  const { mode, scenarios: filterScenarios, port, shard, reportDrift } = parseArgs();

  const scenarioFiles = readdirSync(SCENARIO_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
    .sort();

  const selected = filterScenarios.length > 0 ? filterScenarios : scenarioFiles;
  const names = shard ? selectShard(selected, shard) : selected;

  console.log(`\nBlastSimulator2026 — Batch Scenario Runner`);
  console.log(`Mode: ${mode}`);
  if (shard) console.log(`Shard: ${shard.index}/${shard.total} — ${names.length}/${selected.length} scenarios`);
  console.log(`Scenarios: ${names.length} files`);

  const startTime = Date.now();
  let results: ScenarioResult[];

  if (mode === 'interaction') {
    results = await runBatchInteraction(names, port);
  } else {
    results = runBatchCommand(names, reportDrift, startTime);
  }

  if (reportDrift && mode === 'command') {
    const driftRecords: DriftRecord[] = results.flatMap(r => r.driftRecords ?? []);
    emitDriftReport(driftRecords, resolve(SCREENSHOT_DIR, 'drift-report.json'));
  }

  // Summary
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const failures = results.filter(r => r.failed);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`BATCH COMPLETE — ${totalTime}s`);
  console.log(`Total: ${results.length}, Passed: ${results.length - failures.length}, Failed: ${failures.length}`);

  if (failures.length > 0) {
    console.log(`\nFailed scenarios:`);
    for (const f of failures) {
      console.log(`  ❌ ${f.name} (${f.totalSteps} steps)`);
      if (f.error) console.log(`     ${f.error}`);
    }
    process.exit(1);
  }

  console.log(`\nAll scenarios passed.`);
  process.exit(0);
}

main().catch(err => {
  console.error('Batch runner failed:', err);
  process.exit(1);
});
