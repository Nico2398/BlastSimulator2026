import type { GameState } from '../../src/core/state/GameState.js';
import type { ProbeRunConfig } from './probe-config.js';

export const CASH_SAMPLE_TICKS = [1000, 3000, 6000, 10000] as const;

export interface ProbeMetrics {
  cashAt: Record<number, number | null>;
  lowPointCash: number;
  lowPointTick: number;
  bankruptTick: number | null;
  firstBlastSoldShareAt6000: number | null;
  blastsFired: number;
  warehouseFullTick: number | null;
  ticksHaulWaitedOnFullStorage: number;
  boulderSoldShare: number | null;
  gradeReachedTick: Record<number, number>;
  affordableTick: {
    warehouseT2: number | null;
    researchCenter: number | null;
    secondHauler: number | null;
  };
}

export interface RunResult {
  config: ProbeRunConfig;
  metrics: ProbeMetrics;
  endTick: number;
  endReason: string | null;
}

export class MetricsObserver {
  onTick(_state: GameState): void {
    throw new Error('not implemented');
  }

  finalize(): ProbeMetrics {
    throw new Error('not implemented');
  }
}
