// BlastSimulator2026 — Report formatting
// Plain-text table of the rendered mixes for the terminal.

import { linearstep } from '../../core/math/Linearstep.js';
import type { MixReport } from './labReport.js';

const COLUMNS: ReadonlyArray<readonly [string, (mix: MixReport) => string]> = [
  ['mix', mix => mix.name],
  ['length', mix => `${mix.stats.durationS.toFixed(1)} s`],
  ['peak dBFS', mix => mix.stats.peakDbfs.toFixed(1)],
  ['RMS dBFS', mix => mix.stats.gatedRmsDbfs.toFixed(1)],
  ['crest dB', mix => mix.stats.crestFactorDb.toFixed(1)],
  ['LUFS int', mix => mix.stats.integratedLufs.toFixed(1)],
  ['LUFS st max', mix => mix.stats.shortTermMaxLufs.toFixed(1)],
  ['clips', mix => String(mix.stats.clipCount)],
  ['drive %', mix => (mix.stats.clipperDrive * 100).toFixed(3)],
  ['DC', mix => mix.stats.dcOffset.toFixed(4)],
  ['mono loss dB', mix => mix.stats.monoLossDb.toFixed(1)],
  ['voices', mix => String(mix.peakVoices)],
  ['dropped', mix => `${mix.dropped}/${mix.requested}`],
];

/** One header line, one rule and one row per mix, columns right-aligned (the first left-aligned). */
export function formatMixTable(mixes: readonly MixReport[]): string {
  const rows = [COLUMNS.map(([title]) => title), ...mixes.map(mix => COLUMNS.map(([, cell]) => cell(mix)))];
  const widths = COLUMNS.map((_, column) => Math.max(...rows.map(row => (row[column] ?? '').length)));
  const line = (row: readonly string[]): string => row
    .map((cell, column) => (column === 0 ? cell.padEnd(widths[column] ?? 0) : cell.padStart(widths[column] ?? 0)))
    .join('  ');
  const [header = [], ...body] = rows;
  return [line(header), widths.map(width => '-'.repeat(width)).join('  '), ...body.map(line)].join('\n');
}

/** The per-second RMS envelope of a mix as a compact bar line, for a quick look at where the mix is loud. */
export function formatEnvelope(mix: MixReport, floorDb = -60): string {
  const blocks = ' .:-=+*#%@';
  return mix.stats.envelopeDbfs
    .map((db) => {
      const level = linearstep(floorDb, 0, db);
      return blocks[Math.min(blocks.length - 1, Math.floor(level * blocks.length))] ?? ' ';
    })
    .join('');
}
