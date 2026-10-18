import type { ProbeOptions } from './probe-config.js';
import type { RunResult } from './probe-metrics.js';

export function formatTable(_results: readonly RunResult[]): string {
  throw new Error('not implemented');
}

export function toJson(_results: readonly RunResult[], _opts: ProbeOptions): string {
  throw new Error('not implemented');
}
