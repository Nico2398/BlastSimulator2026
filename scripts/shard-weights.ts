/**
 * BlastSimulator2026 — Refresh the test shard weight table
 *
 * Writes tests/shard-weights.json, the per-file durations CI's test shards are
 * balanced by (scripts/lib/test-shard-sequencer.ts), from test reports:
 *   - JUnit XML, as CI's `test` job uploads it (`test-results-<shard>`
 *     artifacts) — measured on CI's runners, under coverage, which is what the
 *     shards actually spend;
 *   - a vitest JSON report (`npx vitest run --reporter=json --outputFile=...`).
 *
 * A file several reports name keeps its longest duration. Only files a report
 * names are written: run it over every shard's report of one CI run, or the
 * table loses the files it was not given.
 *
 * Usage:
 *   npx tsx scripts/shard-weights.ts <report.xml|report.json>...
 *
 * @module shard-weights
 */

import { readFileSync, writeFileSync } from 'fs';
import { isAbsolute, relative, resolve, sep } from 'path';
import { SHARD_WEIGHTS_FILE, type ShardWeightsTable } from './lib/test-shard-sequencer.js';

const ROOT = resolve(import.meta.dirname, '..');

const TABLE_COMMENT =
  'Per-test-file durations CI balances its test shards by (scripts/lib/test-shard-sequencer.ts). '
  + 'Only balance depends on it, never which tests run. Refresh: npx tsx scripts/shard-weights.ts <JUnit or vitest JSON reports>.';

/** A test file as the table names it: root-relative, `/`-separated. */
function tableKey(file: string, root: string): string {
  const rel = isAbsolute(file) ? relative(root, file) : file;
  return rel.split(sep).join('/');
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Durations from a JUnit report: each `<testsuite name=... time=...>` is one test file. */
export function durationsFromJUnit(xml: string, root: string): Map<string, number> {
  const durations = new Map<string, number>();
  for (const [tag] of xml.matchAll(/<testsuite\s[^>]*>/g)) {
    const name = /\sname="([^"]*)"/.exec(tag)?.[1];
    const time = /\stime="([^"]*)"/.exec(tag)?.[1];
    if (name === undefined || time === undefined || !Number.isFinite(Number(time))) continue;
    durations.set(tableKey(decodeXmlAttribute(name), root), Math.round(Number(time) * 1000));
  }
  return durations;
}

interface VitestJsonReport {
  testResults?: { name?: unknown; startTime?: unknown; endTime?: unknown }[];
}

/** Durations from a vitest JSON report: `endTime - startTime` of each test file. */
export function durationsFromVitestJson(text: string, root: string): Map<string, number> {
  const report = JSON.parse(text) as VitestJsonReport;
  const durations = new Map<string, number>();
  for (const result of report.testResults ?? []) {
    const { name, startTime, endTime } = result;
    if (typeof name !== 'string' || typeof startTime !== 'number' || typeof endTime !== 'number') continue;
    durations.set(tableKey(name, root), Math.max(0, Math.round(endTime - startTime)));
  }
  return durations;
}

/** The table for `durations`, keys sorted so a refresh diffs line by line. */
export function weightTable(durations: ReadonlyMap<string, number>): ShardWeightsTable {
  const milliseconds: Record<string, number> = {};
  for (const file of [...durations.keys()].sort()) milliseconds[file] = durations.get(file) ?? 0;
  return { $comment: TABLE_COMMENT, milliseconds };
}

function main(reports: readonly string[]): number {
  if (reports.length === 0) {
    console.error('usage: shard-weights <report.xml|report.json>...');
    return 2;
  }
  const durations = new Map<string, number>();
  for (const report of reports) {
    const text = readFileSync(report, 'utf8');
    const found = report.endsWith('.json') ? durationsFromVitestJson(text, ROOT) : durationsFromJUnit(text, ROOT);
    for (const [file, ms] of found) durations.set(file, Math.max(ms, durations.get(file) ?? 0));
  }
  if (durations.size === 0) {
    console.error('no test file durations found in the reports given; the table was left unchanged');
    return 1;
  }
  writeFileSync(resolve(ROOT, SHARD_WEIGHTS_FILE), `${JSON.stringify(weightTable(durations), null, 2)}\n`);
  console.log(`${SHARD_WEIGHTS_FILE}: ${durations.size} test files`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exit(main(process.argv.slice(2)));
}
