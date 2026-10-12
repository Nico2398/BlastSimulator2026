// BlastSimulator2026 — Crowding statistics
// Turns a recorder's list of plays into the numbers the owner's bar is about: plays per real minute per
// sound and per bus, the busiest second, how many voices sound at once, and what the engine refused.

import { SOUND_CATALOG, type OneShotId, type SoundBus } from '../../src/audio/SoundCatalog.js';
import type { PlayRecord } from './audioCrowding.js';

const SECONDS_PER_MINUTE = 60;
const WINDOW_S = 1;

interface IdStats {
  readonly id: OneShotId;
  readonly bus: SoundBus;
  readonly requested: number;
  readonly heard: number;
  readonly perMinute: number;
  /** Most accepted plays in any one second. */
  readonly maxPerSecond: number;
}

interface CrowdStats {
  readonly durationS: number;
  readonly byId: ReadonlyMap<OneShotId, IdStats>;
  readonly perMinuteByBus: Readonly<Record<SoundBus, number>>;
  readonly totalPerMinute: number;
  readonly maxPerSecond: number;
  /** Most one-shots sounding at the same instant (beds not counted). */
  readonly maxVoices: number;
  readonly requested: number;
  readonly heard: number;
}

/** Largest number of `times` inside any window of `windowS` seconds. `times` must be sorted. */
export function maxInWindow(times: readonly number[], windowS: number = WINDOW_S): number {
  let best = 0;
  let from = 0;
  for (let to = 0; to < times.length; to++) {
    while (times[to]! - times[from]! >= windowS) from++;
    best = Math.max(best, to - from + 1);
  }
  return best;
}

/** Most sounds overlapping at one instant: sweep over start and end events. */
export function maxOverlap(plays: readonly Pick<PlayRecord, 'startS' | 'durationS'>[]): number {
  const edges = plays.flatMap(p => [{ at: p.startS, delta: 1 }, { at: p.startS + p.durationS, delta: -1 }]);
  edges.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let live = 0;
  let best = 0;
  for (const edge of edges) {
    live += edge.delta;
    best = Math.max(best, live);
  }
  return best;
}

/** Sounds of the blast timeline: the shot itself and the rock coming down. */
export const isBlastSound = (id: string): boolean => id.startsWith('blast_') || id.startsWith('debris_');

/** Most plays that start inside any `windowS` seconds. */
export function peakIn(plays: readonly Pick<PlayRecord, 'startS'>[], windowS: number): number {
  return maxInWindow(plays.map(p => p.startS).sort((a, b) => a - b), windowS);
}

const sortedTimes = (plays: readonly PlayRecord[]): number[] => plays.map(p => p.startS).sort((a, b) => a - b);

export function summarize(plays: readonly PlayRecord[], durationS: number): CrowdStats {
  const minutes = Math.max(durationS, 1) / SECONDS_PER_MINUTE;
  const heard = plays.filter(p => p.accepted);
  const byId = new Map<OneShotId, IdStats>();
  for (const id of new Set(plays.map(p => p.id))) {
    const mine = plays.filter(p => p.id === id);
    const mineHeard = mine.filter(p => p.accepted);
    byId.set(id, {
      id,
      bus: SOUND_CATALOG[id].bus,
      requested: mine.length,
      heard: mineHeard.length,
      perMinute: mineHeard.length / minutes,
      maxPerSecond: maxInWindow(sortedTimes(mineHeard)),
    });
  }
  const perMinuteByBus: Record<SoundBus, number> = { ui: 0, effects: 0, ambient: 0 };
  for (const p of heard) perMinuteByBus[p.bus] += 1 / minutes;
  return {
    durationS,
    byId,
    perMinuteByBus,
    totalPerMinute: heard.length / minutes,
    maxPerSecond: maxInWindow(sortedTimes(heard)),
    maxVoices: maxOverlap(heard),
    requested: plays.length,
    heard: heard.length,
  };
}

/** Plain-text table of a run, busiest sound first. */
export function formatStats(label: string, stats: CrowdStats): string {
  const rows = [...stats.byId.values()].sort((a, b) => b.heard - a.heard);
  const lines = rows.map(r => `  ${r.id.padEnd(20)} ${r.bus.padEnd(8)} req ${String(r.requested).padStart(4)}  heard ${String(r.heard).padStart(4)}  ${r.perMinute.toFixed(2).padStart(7)}/min  max ${r.maxPerSecond}/s`);
  const bus = (['ui', 'effects', 'ambient'] as const).map(b => `${b} ${stats.perMinuteByBus[b].toFixed(1)}/min`).join(', ');
  return [
    `${label}: ${stats.durationS.toFixed(0)} s real, requested ${stats.requested}, heard ${stats.heard} (${stats.totalPerMinute.toFixed(1)}/min), busiest second ${stats.maxPerSecond}, max voices ${stats.maxVoices}`,
    `  by bus: ${bus}`,
    ...lines,
  ].join('\n');
}
