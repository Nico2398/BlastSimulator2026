// #1891: the sandbox panel hands main.ts a SandboxConfig whose field is `kit`;
// main.ts must emit `kit:` in the console command, never the retired `difficulty:`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('main.ts sandbox start command (#1891)', () => {
  const src = readFileSync(join(__dirname, '../../../src/main.ts'), 'utf8');
  const line = src.split('\n').find(l => l.includes('sandbox start biome:')) ?? '';

  it('emits kit: from the config', () => {
    expect(line).toContain('kit:${config.kit}');
  });

  it('no longer emits difficulty:', () => {
    expect(line).not.toContain('difficulty:');
    expect(line).not.toContain('config.difficulty');
  });
});
