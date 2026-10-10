// Locks the #1590 design: the blast report's delay is rendered playback time,
// never a wall clock. Wall time and frame time diverge on slow frames and in a
// hidden tab, which is how the report came to cover the blast three times.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = readFileSync(resolve(__dirname, '../../../src/ui/panels/BlastReportModal.ts'), 'utf8');

// Strip comments so prose explaining the old design does not trip the rule.
const CODE = SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('BlastReportModal has no wall clock (#1590)', () => {
  it('does not reference performance.now', () => {
    expect(CODE).not.toMatch(/performance\s*\.\s*now/);
  });

  it('does not reference Date.now', () => {
    expect(CODE).not.toMatch(/Date\s*\.\s*now/);
  });

  it('does not construct a Date', () => {
    expect(CODE).not.toMatch(/new\s+Date\s*\(/);
  });

  it('does not take an injectable clock or use timers', () => {
    expect(CODE).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
    expect(CODE).not.toMatch(/\bnow\s*:\s*\(\)\s*=>\s*number/);
  });

  it('gates on the playback helper and the seconds constant', () => {
    expect(CODE).toMatch(/isBlastPlaybackComplete/);
    expect(CODE).toMatch(/BLAST_REPORT_MIN_PLAYBACK_S/);
  });
});
