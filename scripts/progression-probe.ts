// BlastSimulator2026 — Progression probe CLI (#1922)
//
//   npm run probe:progression -- [--seed 42,7] [--biome a,b] [--kit digger,full]
//        [--strategy opening,reinvest,ladder,stay_g1] [--horizon N] [--quick] [--json path]
//        [--event-policy first|cheapest] [--start-delay N]
//
// `--start-delay N` (default 0) idles the crew on payroll N ticks before the strategy's first order, events answered
// by the event policy: a slow-starting player (#2118).
//
// `--event-policy` picks how pending events are answered: `first` (default, option 0) or `cheapest` (the option with
// the highest cashDelta; #2117) in the main play loop only: the ladder strategies and the blast-zone clearing waits answer by their own rules. The table's `first sale` / `sales/costs` columns read the ledger: sales (contracts +
// sales + bonus income) over all expenses from the first sale on, and the group median row adds the 10th percentile.
//
// Plays the reference strategies headlessly through the console core and prints
// a markdown table (stdout, deterministic) of the economy curve; timing goes to
// stderr. `--quick` is one site (desert_badlands, digger, seed 42) to 3000 ticks;
// it still runs both strategies (2 rows) unless `--strategy` is given.
//
// `--strategy ladder` plays the whole permit ladder (limit-sized blasts, benching, tier-2/3 equipment,
// a gentle ramp, grade-ups as soon as eligible); `stay_g1` is the same without applying past grade 1.
// A ladder-only run plays the one reference site (`LADDER_REFERENCE_SITE`: desert_badlands, full kit,
// seed 42) unless `--seed`, `--biome` or `--kit` name others. The grade-3 bar is that site reaching
// grade 3 inside its window (8,000-14,000 ticks), about half an hour to `--horizon 14000`. Reaching
// grade 5 takes `--horizon 50000`, hours of run time: a measurement, never a CI check. Ladder runs also
// print a per-grade summary (median tick and cash at each grade against the target windows) after the table.
//
// The full default matrix (24 runs to 10000 ticks) outlives one foreground Bash
// call, so run it detached and wait inside the same turn, always with an
// explicit timeout of 600000 ms on every call:
//
//   npm run long -- start probe -- npm run probe:progression -- --json out/probe.json
//   npm run long -- wait probe        # repeat while it exits 75
//
// A 50000-tick ladder run is the same shape:
//
//   npm run long -- start ladder -- npm run probe:progression -- --strategy ladder,stay_g1 --horizon 50000 --json out/ladder.json
//   npm run long -- wait ladder       # repeat while it exits 75

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from './shared/probe-config.js';
import { runMatrix } from './shared/probe-strategies.js';
import { formatGradeSummary, formatTable, toJson } from './shared/probe-report.js';

export function main(argv: readonly string[]): void {
  const opts = parseArgs(argv);
  const results = runMatrix(opts);
  console.log(formatTable(results));
  if (opts.strategies.some(id => id === 'ladder' || id === 'stay_g1')) console.log(`\n${formatGradeSummary(results)}`);
  if (opts.jsonPath) {
    mkdirSync(dirname(resolve(opts.jsonPath)), { recursive: true });
    writeFileSync(opts.jsonPath, toJson(results, opts));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
