import type { ProbeOptions, ProbeRunConfig } from './probe-config.js';
import type { RunResult } from './probe-metrics.js';

export function runProbe(_config: ProbeRunConfig): RunResult {
  throw new Error('not implemented');
}

export function runMatrix(
  _opts: ProbeOptions,
  _onResult?: (result: RunResult) => void,
): RunResult[] {
  throw new Error('not implemented');
}
