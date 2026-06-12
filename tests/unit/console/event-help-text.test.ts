import { describe, it, expect } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';

describe('event command help text', () => {
  it('shows fire <id> syntax in help output', () => {
    const { runner } = createRunner();
    const result = runner.run('help');
    expect(result.success).toBe(true);
    expect(result.output).toContain('fire <id>');
  });
});
