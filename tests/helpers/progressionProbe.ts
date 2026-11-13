// BlastSimulator2026 — Shared checks of the progression probe's integration tests
//
// The probe's integration cases are split across several files so their long
// runs execute in parallel: a file runs on one worker, and the single file they
// were took 183 s under coverage (~9.5 min on a CI runner), CI's longest job
// once the coverage job was sharded after the #2142–#2199 timeouts — the
// reinvest-vs-opening comparison alone is 93 s of it. These are the checks
// every one of them reads a run result with.

import { expect } from 'vitest';
import { runCommand, type RunnerWithContext } from '../../src/console/createRunner.js';
import type { ProbeRunConfig } from '../../scripts/shared/probe-config.js';
import type { RunResult } from '../../scripts/shared/probe-metrics.js';

export const METRIC_KEYS = [
  'cashAt', 'lowPointCash', 'lowPointTick', 'bankruptTick', 'firstBlastSoldShareAt6000',
  'blastsFired', 'warehouseFullTick', 'ticksHaulWaitedOnFullStorage', 'boulderSoldShare',
  'gradeReachedTick', 'affordableTick', 'firstSaleTick', 'salesCostRatio', 'salesCostWindows',
];

/** Collect every leaf value with its path. */
function leaves(v: unknown, path = ''): Array<[string, unknown]> {
  if (v !== null && typeof v === 'object') {
    return Object.entries(v as object).flatMap(([k, c]) => leaves(c, path ? `${path}.${k}` : k));
  }
  return [[path, v]];
}

export function expectFiniteOrAllowedNull(r: RunResult, horizon: number): void {
  // Off the progression ladder (no grade state) every pit sample reads null.
  // A run that ends in game over never reaches the later samples: those stay null, and `bankruptTick` says why.
  const sampledAfterEnd = (tick: number): boolean => r.endReason?.startsWith('game_over') === true && tick > r.endTick;
  const offLadder = Object.values(r.metrics.pitDepthAt ?? {}).every(v => v === null);
  for (const [path, value] of leaves(r.metrics)) {
    if (value === null) {
      const m = /^cashAt\.(\d+)$/.exec(path);
      const pit = /^pitDepthAt\.(\d+)$/.exec(path);
      const allowed =
        (m !== null && (Number(m[1]) > horizon || sampledAfterEnd(Number(m[1])))) ||
        (pit !== null && (offLadder || Number(pit[1]) > horizon || sampledAfterEnd(Number(pit[1])))) ||
        path === 'firstBlastSoldShareAt6000' ||
        path === 'boulderSoldShare' ||
        path === 'boulderOreSoldShare' ||
        path === 'catalogBoughtTick' ||
        path === 'bankruptTick' ||
        path === 'firstSaleTick' ||
        path === 'salesCostRatio' ||
        path.startsWith('salesCostWindows.') ||
        path === 'warehouseFullTick' ||
        path.startsWith('affordableTick.');
      expect(allowed, `unexpected null at ${path}`).toBe(true);
    } else {
      expect(typeof value, path).toBe('number');
      expect(Number.isFinite(value as number), path).toBe(true);
    }
  }
}

/** `runProbe`'s start: the default sandbox start, then `then` on the started game; keeps the engine for the assertions. */
export function startSandbox(cfg: ProbeRunConfig, kept: { engine?: RunnerWithContext }, then: (engine: RunnerWithContext) => void = () => {}) {
  return (engine: RunnerWithContext): boolean => {
    kept.engine = engine;
    if (!runCommand(engine, `sandbox start biome:${cfg.biome} kit:${cfg.kit} seed:${cfg.seed}`).success) return false;
    then(engine);
    return true;
  };
}
