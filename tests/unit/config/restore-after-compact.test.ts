// BlastSimulator2026 — Compaction can land anywhere; the run state comes back
//
// The runner compacts early (CLAUDE_CODE_AUTO_COMPACT_WINDOW) so no turn
// re-reads a near-full context, and a compaction can land mid-step. What makes
// that safe is `restore-after-compact.mjs`: after every compaction it prints
// the run state kept on disk — TDD cycles, the blind marker, the plan's
// `## Progress`, the last verify — back into the context.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { hookScript, runHook, type HookRegistry } from '../../helpers/claudeHooks';

const ROOT = join(import.meta.dirname, '../../..');
const HOOK = 'restore-after-compact.mjs';
let project: string;

function write(path: string, text: string): void {
  mkdirSync(join(project, path, '..'), { recursive: true });
  writeFileSync(join(project, path), text);
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'compact-hook-'));
  execFileSync('git', ['init', '-q', '-b', 'pipeline/impl-42-7'], { cwd: project });
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

const run = () => runHook(HOOK, '{"hook_event_name":"SessionStart","source":"compact"}', { CLAUDE_PROJECT_DIR: project });

describe('after a compaction', () => {
  it('prints nothing outside a pipeline run', () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('restores the cycle, the blind phase, the progress and the last verify', () => {
    write('.agentic/tdd/42-7.json', JSON.stringify({
      label: '42-7', phase: 'red', implBranch: 'pipeline/impl-42-7', testsBranch: 'pipeline/tests-42-7',
      featureBranch: 'pipeline/feature-42-7', red: 'abcdef1234567',
    }));
    write('.agentic/tdd/blind.json', JSON.stringify({ label: '42-7', testsBranch: 'pipeline/tests-42-7', worktree: '/work/game-tests-42-7' }));
    write('.agentic/plan/42-7.md', '# Plan\n\n## Contract\n- C1 adds\n\n## Progress\n- plan done — next: skeleton\n- skeleton done — 1a2b3c4 — next: split\n');
    write('.agentic/verify/last.txt', 'VERIFY: PASS\n');

    const { status, stdout } = run();
    expect(status).toBe(0);
    expect(stdout).toContain('Blind phase open for 42-7');
    expect(stdout).toContain('/work/game-tests-42-7');
    expect(stdout).toContain('TDD 42-7: phase `red`');
    expect(stdout).toContain('- skeleton done — 1a2b3c4 — next: split');
    expect(stdout).not.toContain('C1 adds');
    expect(stdout).toContain('VERIFY: PASS');
    expect(stdout).toContain('Branch `pipeline/impl-42-7`');
  });
});

describe('registration', () => {
  const settings = JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8')) as { hooks?: HookRegistry };

  it('runs on SessionStart after a compaction', () => {
    const entries = (settings.hooks?.SessionStart ?? []).filter((entry) => entry.matcher === 'compact');
    const scripts = entries.flatMap((entry) => (entry.hooks ?? []).map((hook) => hookScript(hook)));
    expect(scripts.some((script) => script.endsWith(`/${HOOK}`))).toBe(true);
  });

  it('the runner compacts early on both Claude steps', () => {
    const runner = readFileSync(join(ROOT, '.github/workflows/claude-runner.yml'), 'utf8');
    expect(runner.match(/CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000'/g)).toHaveLength(2);
  });
});
