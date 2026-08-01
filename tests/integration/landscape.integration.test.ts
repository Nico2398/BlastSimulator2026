import { describe, it, expect, beforeEach } from 'vitest';
import { createRunner, runCommand, type RunnerWithContext } from '../../src/console/createRunner.js';

describe('Console — landscape_info / lazy landscape build (#458 T2.1)', () => {
  let engine: RunnerWithContext;

  beforeEach(() => {
    engine = createRunner();
  });

  it('new_game leaves the landscape unbuilt (lazy — no cost paid until requested)', () => {
    runCommand(engine, 'new_game mine_type:desert_badlands seed:42 size:32');
    expect(engine.ctx.landscape).toBeNull();
  });

  it('landscape_info builds and reports the landscape on first call', () => {
    runCommand(engine, 'new_game mine_type:desert_badlands seed:42 size:32');
    const result = runCommand(engine, 'landscape_info');
    expect(result.success).toBe(true);
    expect(result.output).toContain('Tiles:');
    expect(result.output).toContain('129x129');
    expect(engine.ctx.landscape).not.toBeNull();
    expect(engine.ctx.landscape!.tiles.length).toBeGreaterThan(0);
  });

  it('landscape_info is idempotent — a second call reuses the cached map', () => {
    runCommand(engine, 'new_game mine_type:desert_badlands seed:42 size:32');
    runCommand(engine, 'landscape_info');
    const first = engine.ctx.landscape;
    runCommand(engine, 'landscape_info');
    expect(engine.ctx.landscape).toBe(first); // same object reference, not rebuilt
  });

  it('fails cleanly with no game loaded', () => {
    const result = runCommand(engine, 'landscape_info');
    expect(result.success).toBe(false);
    expect(engine.ctx.landscape).toBeNull();
  });

  it('a fresh new_game invalidates a previously-built landscape', () => {
    runCommand(engine, 'new_game mine_type:desert_badlands seed:42 size:32');
    runCommand(engine, 'landscape_info');
    expect(engine.ctx.landscape).not.toBeNull();

    runCommand(engine, 'new_game mine_type:alpine_granite seed:99 size:32');
    expect(engine.ctx.landscape).toBeNull(); // stale map cleared, not silently reused across games
  });

  it('does not affect the playable grid or any other command output', () => {
    runCommand(engine, 'new_game mine_type:desert_badlands seed:42 size:32');
    const before = runCommand(engine, 'terrain_info');
    runCommand(engine, 'landscape_info');
    const after = runCommand(engine, 'terrain_info');
    expect(after.output).toBe(before.output);
  });
});
