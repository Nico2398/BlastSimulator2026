/**
 * BlastSimulator2026 — The coverage provider of a CI coverage shard
 *
 * vitest's own v8 provider in every respect but the last step: where it would
 * convert the shard's raw V8 coverage to istanbul and judge it, it writes a
 * shard dump instead (scripts/lib/coverage-shards.ts holds the format, and why
 * converting per shard and merging afterwards measures something else). Its
 * workers run the v8 module's own collection hooks unchanged.
 *
 * Loaded by vitest.coverage-shard.config.ts as `customProviderModule`. vitest
 * executes this module inside every test worker too, for the collection hooks,
 * so the provider class — and the istanbul tooling behind it — is only imported
 * when the main process asks for the provider.
 *
 * @module coverage-shard-provider
 */

import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import v8 from '@vitest/coverage-v8';
import type { CoverageProvider, CoverageProviderModule } from 'vitest';
import { buildShardDump, shardDumpFileName } from './coverage-shards.js';

const shardProviderModule: CoverageProviderModule = {
  startCoverage: () => v8.startCoverage(),
  takeCoverage: () => v8.takeCoverage(),
  stopCoverage: () => v8.stopCoverage(),
  async getProvider(): Promise<CoverageProvider> {
    const { V8CoverageProvider } = await import('@vitest/coverage-v8/dist/provider.js');

    class ShardDumpCoverageProvider extends V8CoverageProvider {
      override async reportCoverage(): Promise<void> {
        await Promise.all(this.pendingPromises);
        this.pendingPromises = [];
        const shard = this.ctx.config.shard ?? { index: 1, count: 1 };
        const dump = await buildShardDump({
          shard,
          root: this.ctx.config.root,
          coverageFiles: this.coverageFiles,
          testFiles: new Set(this.ctx.state.getFiles().map((file) => file.filepath)),
          shouldInstrument: (filePath) => this.testExclude.shouldInstrument(filePath),
          fetchCaches: this.ctx.vitenode.fetchCaches,
        });
        if (!dump.success) throw new Error(dump.error);
        await mkdir(this.options.reportsDirectory, { recursive: true });
        const file = join(this.options.reportsDirectory, shardDumpFileName(shard));
        await writeFile(file, JSON.stringify(dump.data), 'utf8');
        const runs = Object.values(dump.data.modes).reduce((sum, mode) => sum + mode.processes.length, 0);
        this.ctx.logger.log(`Coverage shard ${shard.index}/${shard.count}: ${runs} test file coverage(s) written to ${file}`);
        this.coverageFiles = new Map();
        await rm(this.coverageFilesDirectory, { recursive: true, force: true });
      }
    }

    return new ShardDumpCoverageProvider();
  },
};

export default shardProviderModule;
