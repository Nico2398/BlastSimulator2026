// BlastSimulator2026 — Play log analysis
// Pure helpers over a recorded play log: what a user action or a game step added, which cues are missing,
// which repeat, and a count table. `npm run audio:smoke` asserts with these; they know no browser.

import { COMMAND_CUES } from '../ui/commandCueTable.js';
import type { PlayRecord } from './playLog.js';

/** `kind:id`, the form expectations are written in: `play:hire`, `level:amb_rain_heavy`, `duck:ambient`. */
export function cueKey(record: Pick<PlayRecord, 'kind' | 'id'>): string {
  return `${record.kind}:${record.id}`;
}

/** Every cue id a console command can play (including the second cue of a pair). */
function commandCueIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const verb of Object.values(COMMAND_CUES)) {
    for (const rule of [verb.otherwise, ...Object.values(verb.subs ?? {})]) {
      if (rule?.cue !== undefined) ids.add(rule.cue);
      if (rule?.then !== undefined) ids.add(rule.then.cue);
    }
  }
  return ids;
}

const COMMAND_CUE_IDS = commandCueIds();

/** A sound the player's own interaction makes: an interface cue, or the cue of a command they issued. */
export function isInterfaceCue(record: PlayRecord): boolean {
  return record.kind === 'play' && (record.id.startsWith('ui_') || COMMAND_CUE_IDS.has(record.id));
}

/** The expectations (`kind:id`) that no record satisfies, in the order given. */
export function missingCues(records: readonly PlayRecord[], expected: readonly string[]): string[] {
  const seen = new Set(records.map(cueKey));
  return expected.filter(key => !seen.has(key));
}

/** How many records are `key`. */
export function countCue(records: readonly PlayRecord[], key: string): number {
  return records.filter(record => cueKey(record) === key).length;
}

/** `kind:id` keys played more than once, with their counts; `ignore` lists keys allowed to repeat (hover ticks). */
export function repeatedCues(records: readonly PlayRecord[], ignore: ReadonlySet<string> = new Set()): Array<readonly [string, number]> {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (record.kind !== 'play') continue;
    const key = cueKey(record);
    if (!ignore.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].filter(([, n]) => n > 1);
}

interface CueCount {
  readonly key: string;
  readonly count: number;
  /** Of `count`, how many the player refused (cooldown, voice budget, not loaded, null player). */
  readonly dropped: number;
}

/** One row per `kind:id`, most frequent first (ties by key). */
export function countCues(records: readonly PlayRecord[]): CueCount[] {
  const rows = new Map<string, { count: number; dropped: number }>();
  for (const record of records) {
    const key = cueKey(record);
    const row = rows.get(key) ?? { count: 0, dropped: 0 };
    row.count += 1;
    if (record.dropped === true) row.dropped += 1;
    rows.set(key, row);
  }
  return [...rows].map(([key, row]) => ({ key, ...row })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** A fixed-width table of cue counts, `dropped` shown only when the player refused any. */
export function formatCueTable(counts: readonly CueCount[]): string {
  if (counts.length === 0) return '(no sound requests)';
  const width = Math.max(...counts.map(row => row.key.length), 'cue'.length);
  const lines = counts.map(row => `${row.key.padEnd(width)}  ${String(row.count).padStart(5)}  ${row.dropped > 0 ? `${row.dropped} dropped` : ''}`.trimEnd());
  return [`${'cue'.padEnd(width)}  ${'count'.padStart(5)}`, `${'-'.repeat(width)}  -----`, ...lines].join('\n');
}
