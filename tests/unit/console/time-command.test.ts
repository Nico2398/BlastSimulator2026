import { describe, it, expect, beforeEach } from 'vitest';
import { createRunner } from '../../../src/console-api.js';

describe('time command (#1751)', () => {
  let runner: ReturnType<typeof createRunner>;
  const st = () => runner.ctx.state!;

  beforeEach(() => {
    runner = createRunner();
    runner.runner.run('new_game mine_type:desert seed:42');
  });

  it('plain `time speed N` leaves a paused game paused', () => {
    runner.runner.run('time pause');
    const r = runner.runner.run('time speed 2');
    expect(r.success).toBe(true);
    expect(st().timeScale).toBe(2);
    expect(st().isPaused).toBe(true);
  });

  it('`time speed N resume:true` sets the speed and resumes', () => {
    runner.runner.run('time pause');
    const r = runner.runner.run('time speed 4 resume:true');
    expect(r.success).toBe(true);
    expect(st().timeScale).toBe(4);
    expect(st().isPaused).toBe(false);
  });

  it('`resume:true` on a running game keeps it running', () => {
    runner.runner.run('time speed 8 resume:true');
    expect(st().timeScale).toBe(8);
    expect(st().isPaused).toBe(false);
  });

  it('an invalid speed with resume:true fails and changes nothing', () => {
    runner.runner.run('time speed 2');
    runner.runner.run('time pause');
    const r = runner.runner.run('time speed 3 resume:true');
    expect(r.success).toBe(false);
    expect(st().timeScale).toBe(2);
    expect(st().isPaused).toBe(true);
  });

  it('time pause twice stays paused with the speed kept', () => {
    runner.runner.run('time speed 4');
    expect(runner.runner.run('time pause').success).toBe(true);
    expect(runner.runner.run('time pause').success).toBe(true);
    expect(st().isPaused).toBe(true);
    expect(st().timeScale).toBe(4);
  });
});
