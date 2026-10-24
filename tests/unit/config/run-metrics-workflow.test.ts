// BlastSimulator2026 — Every runner run exports its metrics
//
// The pipeline's design is now decided on measurements: what a run cost per
// model and per agent, how far the lead's context grew, what the cache saved.
// These cases pin the runner steps that export them, reading the shipped
// workflow: they run whatever the attempt did, they never decide the run's
// outcome, and the branch push raises no event.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../../..');
const runner = readFileSync(join(ROOT, '.github/workflows/claude-runner.yml'), 'utf8');

function step(name: string): string {
  const start = runner.indexOf(`- name: ${name}`);
  expect(start, name).toBeGreaterThan(-1);
  const next = runner.indexOf('\n      - name:', start + 1);
  return runner.slice(start, next === -1 ? undefined : next);
}

describe('run metrics export', () => {
  it('extracts after both attempts, whatever they did, without deciding the run', () => {
    const extract = step('Export run metrics');
    expect(extract).toContain('if: always()');
    expect(extract).toContain('continue-on-error: true');
    expect(extract).toContain('npm run -s metrics -- extract');
    expect(extract).toContain('--since "$STARTED_AT"');
    expect(runner.indexOf('- name: Export run metrics')).toBeGreaterThan(runner.indexOf('- name: Did the retry settle its issue?'));
  });

  it('uploads the sanitized records, never a transcript', () => {
    const upload = step('Upload run metrics');
    expect(upload).toContain('path: ${{ steps.metrics.outputs.dir }}');
    expect(upload).not.toMatch(/\.claude\/projects|execution_file/);
  });

  // GITHUB_TOKEN raises no workflow event: a metrics commit must not start CI
  // or wake the merge gate.
  it('appends to the metrics branch under GITHUB_TOKEN and warns rather than fails', () => {
    const append = step('Append run metrics to the agentic-metrics branch');
    expect(append).toContain('secrets.GITHUB_TOKEN');
    expect(append).not.toContain('PAT_TOKEN_COPILOT_AUTOMATION');
    expect(append).toContain('continue-on-error: true');
    expect(append).toContain('::warning::');
  });
});
