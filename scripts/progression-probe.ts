// BlastSimulator2026 — Progression probe CLI (#1922)
//
//   npm run probe:progression -- [--seed 42,7] [--biome a,b] [--kit digger,full]
//        [--strategy opening,reinvest] [--horizon N] [--quick] [--json path]
//
// Plays the reference strategies headlessly through the console core and prints
// a markdown table (stdout, deterministic) of the economy curve; timing goes to
// stderr. `--quick` is one site (desert_badlands, digger, seed 42) to 3000 ticks;
// it still runs both strategies (2 rows) unless `--strategy` is given.
//
// The full default matrix (24 runs to 10000 ticks) outlives one foreground Bash
// call, so run it detached and wait inside the same turn, always with an
// explicit timeout of 600000 ms on every call:
//
//   npm run long -- start probe -- npm run probe:progression -- --json out/probe.json
//   npm run long -- wait probe        # repeat while it exits 75

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from './shared/probe-config.js';
import { runMatrix } from './shared/probe-strategies.js';
import { formatTable, toJson } from './shared/probe-report.js';

export function main(argv: readonly string[]): void {
  const opts = parseArgs(argv);
  const results = runMatrix(opts);
  console.log(formatTable(results));
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
