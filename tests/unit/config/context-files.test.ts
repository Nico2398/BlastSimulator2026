// BlastSimulator2026 — Context file integrity
// Agent, skill, command, and rule frontmatter fails silently: an unrecognised
// field is ignored, so a tool restriction or a preloaded skill can stop
// applying without any error. This suite turns that into a test failure.

import { describe, it, expect } from 'vitest';
import { validateContextFiles } from '../../../scripts/validate-context.js';

describe('context files', () => {
  it('pass every frontmatter, tool, skill, hook, and cross-runtime sync check', () => {
    const issues = validateContextFiles();
    const report = issues.map((i) => `${i.file}: ${i.message}`).join('\n');
    expect(report).toBe('');
  });
});
