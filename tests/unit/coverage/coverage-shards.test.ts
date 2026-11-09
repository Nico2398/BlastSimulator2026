// BlastSimulator2026 — Coverage shard dumps (scripts/lib/coverage-shards.ts)
//
// CI judges the coverage thresholds once, over the dumps its five test shards
// upload. Every way a shard set can be incomplete must refuse the verdict — a
// missing shard would read every file it measured as untested — and a dump must
// arrive at the provider re-rooted, tagged and in canonical order, because the
// provider's fold is order-sensitive (the module doc holds the measurements).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import type { ScriptCov } from '@bcoe/v8-coverage';
import {
  SHARD_DUMP_FORMAT,
  ShardCoverageInjector,
  buildShardDump,
  listShardDumps,
  parseShardDump,
  readShardDump,
  rebaseShardDump,
  shardDumpFileName,
  type FetchCacheEntry,
  type ShardDump,
  type TransformMode,
} from '../../../scripts/lib/coverage-shards';
import shardProviderModule from '../../../scripts/lib/coverage-shard-provider';

const SHARD_ROOT = '/runner/work/repo';

function script(path: string, count = 1): ScriptCov {
  return {
    scriptId: '1',
    url: pathToFileURL(path).href,
    functions: [{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 10, count }] }],
  };
}

function dump(index: number, count: number, overrides: Partial<ShardDump> = {}): ShardDump {
  return {
    format: SHARD_DUMP_FORMAT,
    shard: { index, count },
    root: SHARD_ROOT,
    modes: {
      ssr: {
        processes: [{ test: `tests/unit/shard-${index}.test.ts`, result: [script(`${SHARD_ROOT}/src/a.ts`)] }],
        transforms: { [`${SHARD_ROOT}/src/a.ts`]: { code: 'const a = 1;', map: { sources: [`${SHARD_ROOT}/src/a.ts`], mappings: '' } } },
      },
    },
    ...overrides,
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coverage-shards-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeDumps(count: number, indices: readonly number[]): void {
  for (const index of indices) {
    writeFileSync(join(dir, shardDumpFileName({ index, count })), JSON.stringify(dump(index, count)));
  }
}

describe('listShardDumps fails closed on an incomplete shard set', () => {
  it('lists exactly shards 1..N, in shard order', () => {
    writeDumps(3, [3, 1, 2]);
    const listed = listShardDumps(dir, 3);
    expect(listed).toEqual({
      success: true,
      data: [1, 2, 3].map((index) => join(dir, shardDumpFileName({ index, count: 3 }))),
    });
  });

  it('names every missing shard', () => {
    writeDumps(5, [1, 3, 5]);
    const listed = listShardDumps(dir, 5);
    expect(listed.success).toBe(false);
    if (!listed.success) {
      expect(listed.error).toContain('coverage-shard-2-of-5.json');
      expect(listed.error).toContain('coverage-shard-4-of-5.json');
    }
  });

  it('refuses a shard of another count, even beside a complete set', () => {
    writeDumps(2, [1, 2]);
    writeDumps(3, [3]);
    const listed = listShardDumps(dir, 2);
    expect(listed.success).toBe(false);
    if (!listed.success) expect(listed.error).toContain('unexpected file coverage-shard-3-of-3.json');
  });

  it('refuses a stray file', () => {
    writeDumps(1, [1]);
    writeFileSync(join(dir, 'coverage-final.json'), '{}');
    expect(listShardDumps(dir, 1).success).toBe(false);
  });

  it('refuses an empty or absent directory', () => {
    expect(listShardDumps(dir, 1).success).toBe(false);
    expect(listShardDumps(join(dir, 'nowhere'), 1).success).toBe(false);
  });

  it('refuses a shard count that is not a positive integer', () => {
    writeDumps(1, [1]);
    expect(listShardDumps(dir, 0).success).toBe(false);
    expect(listShardDumps(dir, 1.5).success).toBe(false);
  });
});

describe('readShardDump refuses a dump it cannot trust', () => {
  it('reads a well-formed dump', () => {
    writeDumps(2, [2]);
    const read = readShardDump(join(dir, 'coverage-shard-2-of-2.json'), { index: 2, count: 2 });
    expect(read).toEqual({ success: true, data: dump(2, 2) });
  });

  it('refuses a truncated (corrupt) file', () => {
    const path = join(dir, 'coverage-shard-1-of-1.json');
    writeFileSync(path, JSON.stringify(dump(1, 1)).slice(0, 40));
    const read = readShardDump(path, { index: 1, count: 1 });
    expect(read.success).toBe(false);
    if (!read.success) expect(read.error).toMatch(/coverage-shard-1-of-1\.json: not JSON/);
  });

  it('refuses a dump whose content names another shard than its file', () => {
    const path = join(dir, 'coverage-shard-1-of-2.json');
    writeFileSync(path, JSON.stringify(dump(2, 2)));
    const read = readShardDump(path, { index: 1, count: 2 });
    expect(read.success).toBe(false);
    if (!read.success) expect(read.error).toContain('names itself shard 2/2');
  });

  it('refuses an unreadable path', () => {
    expect(readShardDump(join(dir, 'missing.json'), { index: 1, count: 1 }).success).toBe(false);
  });
});

describe('parseShardDump checks every field the merge relies on', () => {
  const valid = dump(1, 1);
  it.each([
    ['another format', { ...valid, format: 'istanbul' }],
    ['no shard identity', { ...valid, shard: { index: '1', count: 1 } }],
    ['a relative root', { ...valid, root: 'runner/work' }],
    ['an unknown transform mode', { ...valid, modes: { browser: valid.modes.ssr } }],
    ['a mode without processes', { ...valid, modes: { ssr: { transforms: {} } } }],
    ['a test file coverage without its test', { ...valid, modes: { ssr: { processes: [{ result: [] }], transforms: {} } } }],
    ['a script without functions', { ...valid, modes: { ssr: { processes: [{ test: null, result: [{ url: 'file:///x' }] }], transforms: {} } } }],
  ])('refuses %s', (_, value) => {
    expect(parseShardDump(JSON.stringify(value)).success).toBe(false);
  });

  it('accepts a shard that ran no test file at all', () => {
    expect(parseShardDump(JSON.stringify({ ...valid, modes: {} })).success).toBe(true);
  });
});

describe('rebaseShardDump normalises absolute paths to the merging root', () => {
  it('moves script URLs, transform keys and absolute source-map sources', () => {
    const rebased = rebaseShardDump(dump(1, 1), '/home/me/repo');
    expect(rebased.success).toBe(true);
    if (!rebased.success) return;
    const ssr = rebased.data.modes.ssr;
    expect(rebased.data.root).toBe('/home/me/repo');
    expect(ssr?.processes[0]?.result[0]?.url).toBe('file:///home/me/repo/src/a.ts');
    expect(Object.keys(ssr?.transforms ?? {})).toEqual(['/home/me/repo/src/a.ts']);
    expect(ssr?.transforms['/home/me/repo/src/a.ts']?.map).toEqual({ sources: ['/home/me/repo/src/a.ts'], mappings: '' });
  });

  it('keeps the code byte for byte: V8 offsets index into it', () => {
    const rebased = rebaseShardDump(dump(1, 1), '/elsewhere');
    expect(rebased.success && rebased.data.modes.ssr?.transforms['/elsewhere/src/a.ts']?.code).toBe('const a = 1;');
  });

  it('leaves relative source-map sources alone', () => {
    const relative = dump(1, 1);
    const source = relative.modes.ssr?.transforms[`${SHARD_ROOT}/src/a.ts`];
    if (source) source.map = { sources: ['a.ts'] };
    const rebased = rebaseShardDump(relative, '/elsewhere');
    expect(rebased.success && rebased.data.modes.ssr?.transforms['/elsewhere/src/a.ts']?.map).toEqual({ sources: ['a.ts'] });
  });

  it('is the identity when the roots agree', () => {
    expect(rebaseShardDump(dump(1, 1), SHARD_ROOT)).toEqual({ success: true, data: dump(1, 1) });
  });

  it('refuses a measured script outside the shard root', () => {
    const outside = dump(1, 1);
    outside.modes.ssr?.processes[0]?.result.push(script('/opt/elsewhere/src/b.ts'));
    const rebased = rebaseShardDump(outside, '/home/me/repo');
    expect(rebased.success).toBe(false);
    if (!rebased.success) expect(rebased.error).toContain('/opt/elsewhere/src/b.ts');
  });
});

/** An in-memory stand-in for the provider and vite-node the injector writes to. */
function sinks(): {
  provider: { coverageFiles: Map<string | symbol, Record<TransformMode, string[]>>; coverageFilesDirectory: string };
  vitenode: { fetchCaches: Record<TransformMode, Map<string, FetchCacheEntry>>; fetchCache: Map<string, FetchCacheEntry> };
  written: Map<string, string>;
  write: (path: string, text: string) => Promise<void>;
} {
  const written = new Map<string, string>();
  return {
    provider: { coverageFiles: new Map(), coverageFilesDirectory: '/tmp/provider' },
    vitenode: { fetchCaches: { ssr: new Map(), web: new Map() }, fetchCache: new Map() },
    written,
    write: async (path, text) => {
      written.set(path, text);
    },
  };
}

function shardWith(index: number, tests: readonly (string | null)[]): ShardDump {
  return dump(index, 2, {
    modes: {
      ssr: {
        processes: tests.map((test, i) => ({ test, result: [script(`${SHARD_ROOT}/src/a.ts`, index * 10 + i)] })),
        transforms: { [`${SHARD_ROOT}/src/a.ts`]: { code: 'const a = 1;' } },
      },
    },
  });
}

describe('ShardCoverageInjector hands the provider every test file, in canonical order', () => {
  it('registers the raw files sorted by test file path, whatever shard ran them', async () => {
    const { provider, vitenode, written, write } = sinks();
    const injector = new ShardCoverageInjector(provider, vitenode, write);
    expect((await injector.add(shardWith(1, ['tests/c.test.ts', null, 'tests/a.test.ts']))).success).toBe(true);
    expect((await injector.add(shardWith(2, ['tests/b.test.ts']))).success).toBe(true);
    expect(injector.finish()).toBe(4);

    const files = provider.coverageFiles.get(Symbol.for('default-project'));
    expect(files?.web).toEqual([]);
    const counts = (files?.ssr ?? []).map((file) => {
      const raw = JSON.parse(written.get(file) ?? '{}') as { result: ScriptCov[] };
      return raw.result[0]?.functions[0]?.ranges[0]?.count;
    });
    // a (shard 1, third), b (shard 2), c (shard 1, first), then the untagged one.
    expect(counts).toEqual([12, 20, 10, 11]);
  });

  it('puts every transformed module in both of vite-node\'s fetch caches', async () => {
    const { provider, vitenode, write } = sinks();
    const injector = new ShardCoverageInjector(provider, vitenode, write);
    await injector.add(dump(1, 1));
    const path = `${SHARD_ROOT}/src/a.ts`;
    expect(vitenode.fetchCaches.ssr.get(path)?.result.code).toBe('const a = 1;');
    expect(vitenode.fetchCache.get(path)?.result.code).toBe('const a = 1;');
    expect(vitenode.fetchCaches.web.size).toBe(0);
  });

  it('refuses two shards that transformed one module differently', async () => {
    const { provider, vitenode, write } = sinks();
    const injector = new ShardCoverageInjector(provider, vitenode, write);
    await injector.add(dump(1, 2));
    const other = dump(2, 2);
    const source = other.modes.ssr?.transforms[`${SHARD_ROOT}/src/a.ts`];
    if (source) source.code = 'const a = 2;';
    const added = await injector.add(other);
    expect(added.success).toBe(false);
    if (!added.success) expect(added.error).toContain('transformed differently');
  });
});

describe('buildShardDump reads what the provider holds at the end of a shard', () => {
  let raw: string;
  beforeEach(() => {
    raw = join(dir, 'raw');
    mkdirSync(raw);
  });

  it('keeps the measured scripts of each test file and tags the test file', async () => {
    const root = '/repo';
    const file = join(raw, 'coverage-0.json');
    writeFileSync(file, JSON.stringify({
      result: [
        script('/repo/tests/unit/a.test.ts'),
        script('/repo/src/a.ts'),
        script('/repo/scripts/helper.ts'),
        { scriptId: '9', url: 'node:fs', functions: [] },
      ],
    }));
    const built = await buildShardDump({
      shard: { index: 2, count: 5 },
      root,
      coverageFiles: new Map([[Symbol.for('default-project'), { ssr: [file], web: [] }]]),
      testFiles: new Set(['/repo/tests/unit/a.test.ts']),
      shouldInstrument: (path) => path.startsWith('/repo/src/'),
      fetchCaches: {
        ssr: new Map([['/repo/src/a.ts?v=1', { timestamp: 1, result: { code: 'x', map: { sources: ['a.ts'] } } }]]),
        web: new Map(),
      },
    });
    expect(built).toEqual({
      success: true,
      data: {
        format: SHARD_DUMP_FORMAT,
        shard: { index: 2, count: 5 },
        root,
        modes: {
          ssr: {
            processes: [{ test: 'tests/unit/a.test.ts', result: [script('/repo/src/a.ts')] }],
            transforms: { '/repo/src/a.ts': { code: 'x', map: { sources: ['a.ts'] } } },
          },
        },
      },
    });
  });

  it('refuses a workspace project it cannot place', async () => {
    const built = await buildShardDump({
      shard: { index: 1, count: 1 },
      root: '/repo',
      coverageFiles: new Map([['browser', { ssr: [], web: [] }]]),
      testFiles: new Set(),
      shouldInstrument: () => true,
      fetchCaches: { ssr: new Map(), web: new Map() },
    });
    expect(built.success).toBe(false);
  });
});

// vitest.coverage-shard.config.ts names this module by path, so a shard's
// workers collect with it too: it must keep the v8 module's collection hooks.
describe('scripts/lib/coverage-shard-provider.ts', () => {
  it('collects with the v8 hooks and builds a v8 provider that writes a dump instead of reporting', async () => {
    expect(typeof shardProviderModule.startCoverage).toBe('function');
    expect(typeof shardProviderModule.takeCoverage).toBe('function');
    expect(typeof shardProviderModule.stopCoverage).toBe('function');
    const provider = await shardProviderModule.getProvider();
    const { V8CoverageProvider } = await import('@vitest/coverage-v8/dist/provider.js');
    expect(provider).toBeInstanceOf(V8CoverageProvider);
    expect(Object.getPrototypeOf(provider).reportCoverage).not.toBe(V8CoverageProvider.prototype.reportCoverage);
  });
});
