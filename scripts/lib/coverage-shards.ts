/**
 * BlastSimulator2026 — Coverage shard dumps: what one CI shard hands the merge
 *
 * CI measures coverage in N shards (vitest.coverage-shard.config.ts) and judges
 * the thresholds once, over all of them (scripts/coverage-merge.ts). This module
 * is the contract between the two halves.
 *
 * A shard does not hand over an istanbul `coverage-final.json`, because merging
 * those is not the measurement a single run makes. V8 reports a block range only
 * where its count differs from the enclosing range's, so each shard's istanbul
 * conversion builds a different branch map for the same file, and
 * istanbul-lib-coverage's merge reconciles them by borrowing hit counts from the
 * nearest containing range. Measured on tests/unit/{economy,entities,mining}
 * (127 test files): one run against 3 shards merged that way disagreed on 19
 * file/metric pairs, all branches, by up to 39 points
 * (src/core/world/PlayableArea.ts 60.97% against 100%) — enough to flip any of
 * the thresholds vitest.config.ts pins "just under where each file sits".
 *
 * So a shard hands over what vitest's v8 provider holds just before it converts
 * anything: each test file's raw V8 coverage, cut down to the measured scripts,
 * and the transformed source of each script — the code V8's offsets index into.
 * The merge job feeds all of it to an unmodified provider, which merges,
 * converts, adds the untested files and checks the thresholds the way
 * `npm run test:coverage` does in one process.
 *
 * One thing is deliberately not the way a single run does it: the order. The
 * provider folds the raw files together pairwise, and that fold
 * (`mergeProcessCovs`) is not associative — the same files in another order
 * split or join a block range here and there. A single run folds in whatever
 * order its test files finish, so its own branch figures move between runs:
 * the same 127 files folded in a shuffled order moved 5 files by one or two
 * branches (at most 2.5 points). The merge folds in one canonical order instead
 * — by test file path, one file at a time — so its verdict depends on the code,
 * never on how the shards or the workers were scheduled.
 *
 * Absence of evidence is never a pass: the reader refuses a directory that
 * holds anything but exactly the expected shards, each parseable and naming
 * itself the shard its file name says.
 *
 * @module coverage-shards
 */

import { readdirSync, readFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import type { ScriptCov } from '@bcoe/v8-coverage';

/** Format tag every dump carries; a reader refuses any other. */
export const SHARD_DUMP_FORMAT = 'blastsim-v8-coverage-shard/1';

/** vite-node's two transform modes; the v8 provider keeps their coverage apart. */
const TRANSFORM_MODES = ['ssr', 'web'] as const;
export type TransformMode = (typeof TRANSFORM_MODES)[number];

/** Which of the N shards produced a dump. */
interface ShardIdentity {
  /** 1-based, as `--shard=i/N` spells it. */
  index: number;
  count: number;
}

/** A module as vite-node transformed it for the test run. */
interface TransformedSource {
  code?: string | undefined;
  /** A source map (`sources`, `mappings`, `sourcesContent`, ...), kept as vite produced it. */
  map?: unknown;
}

/** One test file's raw V8 coverage, cut down to the measured scripts. */
interface TestFileCoverage {
  /** The test file, relative to the root, or null when the coverage names none. */
  test: string | null;
  result: ScriptCov[];
}

/** One transform mode's share of a shard's measurement. */
interface ModeCoverage {
  processes: TestFileCoverage[];
  /** The transformed source of each script in `processes`, keyed by absolute file path. */
  transforms: Record<string, TransformedSource>;
}

export interface ShardDump {
  format: typeof SHARD_DUMP_FORMAT;
  shard: ShardIdentity;
  /** The root the shard ran in: every absolute path in the dump lies under it. */
  root: string;
  modes: Partial<Record<TransformMode, ModeCoverage>>;
}

/** Same shape as the rest of the codebase's results: no throwing across the seam. */
type Result<T> = { success: true; data: T } | { success: false; error: string };

/** The file a shard writes its dump to, and the merge expects to find. */
export function shardDumpFileName(shard: ShardIdentity): string {
  return `coverage-shard-${shard.index}-of-${shard.count}.json`;
}

// ── Writing a dump (one shard) ────────────────────────────────────────────────

/** A vite-node fetch-cache entry, as far as this module reads or writes one. */
export interface FetchCacheEntry {
  timestamp: number;
  result: TransformedSource;
}

/** What `buildShardDump` reads off the v8 provider at the end of a shard's run. */
interface ShardMeasurement {
  shard: ShardIdentity;
  root: string;
  /** The provider's `coverageFiles`: per project, per mode, the raw V8 files its workers wrote. */
  coverageFiles: ReadonlyMap<string | symbol, Readonly<Record<TransformMode, readonly string[]>>>;
  /** Absolute paths of the test files this run executed. */
  testFiles: ReadonlySet<string>;
  /** The provider's own include/exclude test (`testExclude.shouldInstrument`). */
  shouldInstrument: (filePath: string) => boolean;
  /** vite-node's per-mode fetch caches, holding the code each test file executed. */
  fetchCaches: Readonly<Record<TransformMode, ReadonlyMap<string, FetchCacheEntry>>>;
}

/** The key the v8 provider files a run without workspace projects under. */
const DEFAULT_PROJECT = Symbol.for('default-project');

/** `cleanUrl` of the v8 provider: fetch-cache keys can carry a query or a hash. */
function cleanPath(id: string): string {
  return id.replace(/#.*$/s, '').replace(/\?.*$/s, '');
}

/** Raw V8 coverage as one worker run writes it. */
interface RawProcessCoverage {
  result: ScriptCov[];
}

const INLINE_SOURCE_MAP = /\n\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)\s*$/;

/**
 * A transform as two shards must agree on it: the executed code exactly, and
 * its inline source map minus `file`. vite-node writes the module id it was
 * first requested by into `file` — `/src/ui/x.ts` from one import, the absolute
 * path from another — so which test file a shard ran first changes it. Nothing
 * reads `file` to place an offset; the code and every mapping still must match,
 * and the later shard's ranges are moved onto the first's code
 * (`onFirstShardsCode`) so the two merge as one script.
 */
export function comparableTransform(code: string | undefined): string | undefined {
  if (code === undefined) return undefined;
  const inline = INLINE_SOURCE_MAP.exec(code);
  if (!inline) return code;
  try {
    const { file: _sharedIdOnly, ...map } = JSON.parse(Buffer.from(inline[1]!, 'base64').toString('utf8')) as Record<string, unknown>;
    return `${code.slice(0, inline.index)}\n${JSON.stringify(map)}`;
  } catch {
    return code;
  }
}

/**
 * `script` moved onto the code the first shard executed for its module, when
 * the two differ only in the source map's `file` (`comparableTransform`). That
 * comment closes the script, so only the ranges that end where the script ends
 * — the module function and vite-node's wrapper — see the length change. Left
 * unshifted, they would not key-match the first shard's (V8 merges functions by
 * their range), and every top-level block under them would be counted twice.
 */
export function onFirstShardsCode(script: ScriptCov, lengthDelta: ReadonlyMap<string, number>): ScriptCov {
  if (!script.url.startsWith('file://')) return script;
  const delta = lengthDelta.get(fileURLToPath(script.url));
  if (delta === undefined || delta === 0) return script;
  const end = Math.max(...script.functions.flatMap((fn) => fn.ranges.map((range) => range.endOffset)));
  return {
    ...script,
    functions: script.functions.map((fn) => ({
      ...fn,
      ranges: fn.ranges.map((range) => (range.endOffset === end ? { ...range, endOffset: end + delta } : range)),
    })),
  };
}

/**
 * Whether the shards' dumps split exactly the `expected` test files: each in
 * one shard, none missing, none the measured run would not hold. Shards that
 * read different splits — two checkouts, two weight tables — would otherwise
 * merge into a measurement of some files twice and others never, and a file
 * whose coverage went missing would read 0% rather than refuse.
 */
export function checkShardPartition(
  testsByShard: ReadonlyMap<number, ReadonlySet<string>>,
  expected: readonly string[],
): Result<void> {
  const shardOf = new Map<string, number>();
  const problems: string[] = [];
  for (const [index, tests] of [...testsByShard].sort(([a], [b]) => a - b)) {
    for (const test of tests) {
      const earlier = shardOf.get(test);
      if (earlier !== undefined) problems.push(`${test} ran in shard ${earlier} and shard ${index}`);
      else shardOf.set(test, index);
    }
  }
  const wanted = new Set(expected);
  for (const test of [...wanted].sort()) if (!shardOf.has(test)) problems.push(`${test} is in no shard's coverage`);
  for (const test of [...shardOf.keys()].sort()) if (!wanted.has(test)) problems.push(`${test} is not a test file the measurement runs`);
  if (problems.length === 0) return { success: true, data: undefined };
  const shown = problems.slice(0, 10).join('\n');
  return { success: false, error: `the shards do not split one suite:\n${shown}${problems.length > 10 ? `\n… and ${problems.length - 10} more` : ''}` };
}

/**
 * Reads the raw V8 files of one shard into a dump: each test file's coverage cut
 * down to the scripts the measurement instruments (`coverage.include`/`exclude`,
 * as the provider itself filters before converting), tagged with the test file
 * it came from, plus the transformed source of every script that appears.
 */
export async function buildShardDump(measurement: ShardMeasurement): Promise<Result<ShardDump>> {
  const modes: Partial<Record<TransformMode, ModeCoverage>> = {};
  for (const [project, perMode] of measurement.coverageFiles) {
    if (project !== DEFAULT_PROJECT) {
      return { success: false, error: `coverage shards support the default project only, found project ${String(project)}` };
    }
    for (const mode of TRANSFORM_MODES) {
      const files = perMode[mode];
      if (files.length === 0) continue;
      const processes: TestFileCoverage[] = [];
      const urls = new Set<string>();
      for (const file of files) {
        const raw = JSON.parse(await readFile(file, 'utf8')) as RawProcessCoverage;
        const tests = raw.result
          .filter((script) => script.url.startsWith('file://') && measurement.testFiles.has(fileURLToPath(script.url)))
          .map((script) => relative(measurement.root, fileURLToPath(script.url)).split(sep).join('/'))
          .sort();
        const result = raw.result.filter((script) => isMeasured(script.url, measurement.shouldInstrument));
        for (const script of result) urls.add(script.url);
        processes.push({ test: tests.length > 0 ? tests.join(' ') : null, result });
      }
      const byPath = new Map<string, TransformedSource>();
      for (const [key, entry] of measurement.fetchCaches[mode]) {
        const path = cleanPath(key);
        if (!byPath.has(path)) byPath.set(path, entry.result);
      }
      const transforms: Record<string, TransformedSource> = {};
      for (const url of urls) {
        const path = fileURLToPath(url);
        const source = byPath.get(path);
        if (source) transforms[path] = { code: source.code, map: source.map };
      }
      modes[mode] = { processes, transforms };
    }
  }
  return {
    success: true,
    data: { format: SHARD_DUMP_FORMAT, shard: measurement.shard, root: measurement.root, modes },
  };
}

function isMeasured(url: string, shouldInstrument: (filePath: string) => boolean): boolean {
  if (!url.startsWith('file://')) return false;
  return shouldInstrument(fileURLToPath(url));
}

// ── Reading the dumps (the merge job) ─────────────────────────────────────────

const DUMP_NAME = /^coverage-shard-(\d+)-of-(\d+)\.json$/;

/**
 * Lists the dumps in `dir`, failing closed unless the directory holds exactly
 * shards 1..expectedCount of expectedCount: a missing shard, a shard of another
 * count or a stray file refuses the whole set. A threshold judged on part of the
 * suite would read every file the missing shard measured as untested, and say
 * nothing true. Returns the paths in shard order; `readShardDump` checks each
 * one's content, a dump at a time, so the merge never holds them all at once.
 */
export function listShardDumps(dir: string, expectedCount: number): Result<string[]> {
  if (!Number.isInteger(expectedCount) || expectedCount < 1) {
    return { success: false, error: `expected shard count must be a positive integer, got ${expectedCount}` };
  }
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (error) {
    return { success: false, error: `cannot read the shard directory ${dir}: ${(error as Error).message}` };
  }
  const expected = `${shardDumpFileName({ index: 1, count: expectedCount })} .. ${shardDumpFileName({ index: expectedCount, count: expectedCount })}`;
  const problems: string[] = [];
  const found = new Map<number, string>();
  for (const entry of [...entries].sort()) {
    const match = DUMP_NAME.exec(entry);
    const index = Number(match?.[1]);
    if (!match || Number(match[2]) !== expectedCount || index < 1 || index > expectedCount) {
      problems.push(`unexpected file ${entry} (expected exactly ${expected})`);
      continue;
    }
    found.set(index, entry);
  }
  const missing = Array.from({ length: expectedCount }, (_, i) => i + 1).filter((index) => !found.has(index));
  if (missing.length > 0) {
    problems.push(
      `missing ${missing.map((index) => shardDumpFileName({ index, count: expectedCount })).join(', ')}`
      + ' — a shard that crashed or was cancelled uploads no coverage; its own log says why',
    );
  }
  if (problems.length > 0) return { success: false, error: problems.join('\n') };
  return { success: true, data: [...found].sort((a, b) => a[0] - b[0]).map(([, entry]) => join(dir, entry)) };
}

/** Reads one listed dump and checks that it is the shard its file name says. */
export function readShardDump(path: string, expected: ShardIdentity): Result<ShardDump> {
  const name = basename(path);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { success: false, error: `${name}: unreadable (${(error as Error).message})` };
  }
  const parsed = parseShardDump(text);
  if (!parsed.success) return { success: false, error: `${name}: ${parsed.error}` };
  const { index, count } = parsed.data.shard;
  if (index !== expected.index || count !== expected.count) {
    return { success: false, error: `${name}: the dump names itself shard ${index}/${count}` };
  }
  return parsed;
}

/** Parses one dump, checking every field the merge relies on. */
export function parseShardDump(text: string): Result<ShardDump> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { success: false, error: `not JSON (${(error as Error).message})` };
  }
  if (!isRecord(value) || value.format !== SHARD_DUMP_FORMAT) {
    return { success: false, error: `not a ${SHARD_DUMP_FORMAT} dump` };
  }
  const { shard, root, modes } = value;
  if (!isRecord(shard) || !Number.isInteger(shard.index) || !Number.isInteger(shard.count)) {
    return { success: false, error: 'no shard identity' };
  }
  if (typeof root !== 'string' || !isAbsolute(root)) {
    return { success: false, error: 'no absolute root' };
  }
  if (!isRecord(modes) || Object.keys(modes).some((mode) => !(TRANSFORM_MODES as readonly string[]).includes(mode))) {
    return { success: false, error: 'modes must be ssr and/or web' };
  }
  for (const coverage of Object.values(modes)) {
    if (!isRecord(coverage) || !Array.isArray(coverage.processes) || !isRecord(coverage.transforms)) {
      return { success: false, error: 'a mode lacks its processes or transforms' };
    }
    for (const testCoverage of coverage.processes as unknown[]) {
      if (!isRecord(testCoverage) || !(testCoverage.test === null || typeof testCoverage.test === 'string') || !Array.isArray(testCoverage.result)) {
        return { success: false, error: 'a test file coverage lacks its test or result' };
      }
      if (!(testCoverage.result as unknown[]).every((script) => isRecord(script) && typeof script.url === 'string' && Array.isArray(script.functions))) {
        return { success: false, error: 'a script coverage lacks its url or functions' };
      }
    }
  }
  return { success: true, data: value as unknown as ShardDump };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Re-roots a dump taken under `dump.root` onto `root`: script URLs, transform
 * keys and absolute source-map `sources`. The code itself is left as the shard
 * ran it — V8's offsets index into exactly that text. A measured path outside
 * the shard's root cannot be placed and refuses the dump.
 */
export function rebaseShardDump(dump: ShardDump, root: string): Result<ShardDump> {
  const from = resolve(dump.root);
  const to = resolve(root);
  const move = (path: string): string | null => {
    const rel = relative(from, path);
    if (rel.startsWith('..') || isAbsolute(rel)) return null;
    return join(to, rel);
  };
  const modes: Partial<Record<TransformMode, ModeCoverage>> = {};
  for (const mode of TRANSFORM_MODES) {
    const coverage = dump.modes[mode];
    if (!coverage) continue;
    const processes: TestFileCoverage[] = [];
    for (const testCoverage of coverage.processes) {
      const result: ScriptCov[] = [];
      for (const script of testCoverage.result) {
        const moved = move(fileURLToPath(script.url));
        if (moved === null) return { success: false, error: `${script.url} lies outside the shard root ${dump.root}` };
        result.push({ ...script, url: pathToFileURL(moved).href });
      }
      processes.push({ test: testCoverage.test, result });
    }
    const transforms: Record<string, TransformedSource> = {};
    for (const [path, source] of Object.entries(coverage.transforms)) {
      const moved = move(path);
      if (moved === null) return { success: false, error: `${path} lies outside the shard root ${dump.root}` };
      transforms[moved] = { code: source.code, map: rebaseSources(source.map, move) };
    }
    modes[mode] = { processes, transforms };
  }
  return { success: true, data: { ...dump, root: to, modes } };
}

function rebaseSources(map: unknown, move: (path: string) => string | null): unknown {
  if (!isRecord(map) || !Array.isArray(map.sources)) return map;
  const sources = (map.sources as unknown[]).map((source) =>
    typeof source === 'string' && isAbsolute(source) ? (move(source) ?? source) : source);
  return { ...map, sources };
}

// ── Handing the dumps to the provider (the merge job) ────────────────────────

/** The v8 provider's raw-coverage bookkeeping, as `ShardCoverageInjector` fills it. */
interface RawCoverageSink {
  coverageFiles: Map<string | symbol, Record<TransformMode, string[]>>;
  coverageFilesDirectory: string;
}

/** vite-node's fetch caches, which the provider reads the executed code from. */
interface TransformCacheSink {
  fetchCaches: Record<TransformMode, Map<string, FetchCacheEntry>>;
  fetchCache: Map<string, FetchCacheEntry>;
}


/** One test file's raw coverage, written out and waiting for its place in the fold. */
interface QueuedCoverage {
  test: string | null;
  /** Arrival order: shard order, then the shard's own order. Breaks ties only. */
  at: number;
  file: string;
}

/** Test files sort by path; coverage that names none sorts last, in arrival order. */
function byTestFile(a: QueuedCoverage, b: QueuedCoverage): number {
  if (a.test !== b.test) {
    if (a.test === null) return 1;
    if (b.test === null) return -1;
    return a.test < b.test ? -1 : 1;
  }
  return a.at - b.at;
}

/**
 * Registers shard dumps with a freshly cleaned v8 provider as though its own
 * workers had written them, one dump at a time so the merge never holds every
 * shard in memory: each test file's raw coverage becomes a file in the
 * provider's temp directory, and each transformed module goes into vite-node's
 * fetch cache, so the provider maps the offsets against the code that actually
 * ran and subtracts vite-node's wrapper, as it does for any executed module.
 * Two shards that transformed one module differently cannot share one set of
 * offsets, so that refuses the merge rather than mapping one shard's counts onto
 * another's code.
 *
 * `finish` hands the provider the files in canonical order (see the module
 * doc); the provider must then read them one at a time,
 * `processingConcurrency: 1`, or I/O timing reorders them again.
 */
export class ShardCoverageInjector {
  private readonly queued: Record<TransformMode, QueuedCoverage[]> = { ssr: [], web: [] };
  /** Per module, the code the first shard to dump it executed, and its comparable form. */
  private readonly code: Record<TransformMode, Map<string, { raw: string | undefined; comparable: string | undefined }>> = { ssr: new Map(), web: new Map() };
  private readonly tests = new Map<number, Set<string>>();
  private written = 0;

  constructor(
    private readonly provider: RawCoverageSink,
    private readonly vitenode: TransformCacheSink,
    private readonly writeFile: (path: string, text: string) => Promise<void>,
  ) {}

  async add(dump: ShardDump): Promise<Result<void>> {
    for (const mode of TRANSFORM_MODES) {
      const coverage = dump.modes[mode];
      if (!coverage) continue;
      // Modules this shard executed with a source map `file` other than the
      // first shard's: by how many characters its script is longer.
      const lengthDelta = new Map<string, number>();
      for (const [path, source] of Object.entries(coverage.transforms)) {
        const known = this.code[mode];
        const comparable = comparableTransform(source.code);
        const first = known.get(path);
        if (first !== undefined) {
          if (first.comparable !== comparable) {
            return { success: false, error: `${path} (${mode}) was transformed differently by two shards; their offsets cannot be merged` };
          }
          if (first.raw !== source.code) lengthDelta.set(path, (first.raw?.length ?? 0) - (source.code?.length ?? 0));
          continue;
        }
        known.set(path, { raw: source.code, comparable });
        const entry: FetchCacheEntry = { timestamp: 0, result: { code: source.code, map: source.map } };
        this.vitenode.fetchCaches[mode].set(path, entry);
        this.vitenode.fetchCache.set(path, entry);
      }
      for (const testCoverage of coverage.processes) {
        const ran = this.tests.get(dump.shard.index) ?? new Set<string>();
        for (const test of testCoverage.test?.split(' ') ?? []) ran.add(test);
        this.tests.set(dump.shard.index, ran);
        const file = join(this.provider.coverageFilesDirectory, `${mode}-${String(this.written).padStart(6, '0')}.json`);
        const result = lengthDelta.size === 0 ? testCoverage.result : testCoverage.result.map((script) => onFirstShardsCode(script, lengthDelta));
        await this.writeFile(file, JSON.stringify({ result }));
        this.queued[mode].push({ test: testCoverage.test, at: this.written, file });
        this.written++;
      }
    }
    return { success: true, data: undefined };
  }

  /** The test files each shard's dump covers, by shard index. */
  testsByShard(): ReadonlyMap<number, ReadonlySet<string>> {
    return this.tests;
  }

  /** Registers every written file with the provider, in canonical order; returns how many. */
  finish(): number {
    const perMode: Record<TransformMode, string[]> = { ssr: [], web: [] };
    for (const mode of TRANSFORM_MODES) {
      perMode[mode] = [...this.queued[mode]].sort(byTestFile).map((queued) => queued.file);
    }
    this.provider.coverageFiles.set(DEFAULT_PROJECT, perMode);
    return this.written;
  }
}
