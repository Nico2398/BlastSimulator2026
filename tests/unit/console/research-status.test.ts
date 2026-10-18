// BlastSimulator2026 — `research status` shows centre speed, slots and active tasks (#1936)
//
// Contract (key params): research.status_header {speed, active, slots};
// research.status_no_center {}; research.status_task_active / _pending
// {index, name, remaining, cost} where remaining = Math.ceil(ticksRemaining).

import { describe, it, expect, afterEach } from 'vitest';
import type { GameContext } from '../../../src/console/commands/world.js';
import { researchCommand } from '../../../src/console/commands/research.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import { makeGameContext } from '../../helpers/gameContext.js';

afterEach(() => setLocale('en'));

function makeCtx(centerTier: 1 | 2 | 3 | null, tasks = 0, ticks = 50): GameContext {
  const ctx = makeGameContext({ mineType: 'desert', seed: '42', size: '32', cash: '500000' });
  const b = ctx.state!.buildings;
  if (centerTier) b.buildings.push({ id: b.nextId++, type: 'research_center', tier: centerTier, x: 20, z: 20, hp: 100, active: true, occupantIds: [] });
  const types = ['driving_center', 'geology_lab', 'management_office', 'blasting_academy'] as const;
  for (let i = 0; i < tasks; i++) {
    b.researchQueue.push({ targetType: types[i % 4]!, targetTier: 3, ticksRemaining: ticks, cost: 12000, conditions: [] });
  }
  return ctx;
}

const status = (ctx: GameContext) => researchCommand(ctx, ['status'], {}).output;
const line = (key: string, i: number, name: string, remaining: number) =>
  t(key, { index: i, name, remaining, cost: 12000 });

describe('research status (#1936)', () => {
  it.each([[1, 1, 1], [2, 1.5, 2], [3, 2, 3]] as const)('tier %i header shows speed %f and %i slots', (tier, speed, slots) => {
    expect(status(makeCtx(tier, 5))).toContain(t('research.status_header', { speed, active: slots, slots }));
  });

  it('header counts fewer active than slots when the queue is short', () => {
    expect(status(makeCtx(3, 2))).toContain(t('research.status_header', { speed: 2, active: 2, slots: 3 }));
  });

  it('marks exactly `slots` tasks in progress and the rest pending (tier 2, 4 queued)', () => {
    const out = status(makeCtx(2, 4));
    const names = ['driving_center', 'geology_lab', 'management_office', 'blasting_academy'];
    names.forEach((n, i) => {
      const name = t(`building.${n}.name`);
      const key = i < 2 ? 'research.status_task_active' : 'research.status_task_pending';
      const other = i < 2 ? 'research.status_task_pending' : 'research.status_task_active';
      expect(out).toContain(line(key, i, name, 50));
      expect(out).not.toContain(line(other, i, name, 50));
    });
  });

  it('tier 1 keeps a single task in progress', () => {
    const out = status(makeCtx(1, 3));
    expect(out).toContain(line('research.status_task_active', 0, t('building.driving_center.name'), 50));
    expect(out).toContain(line('research.status_task_pending', 1, t('building.geology_lab.name'), 50));
    expect(out).toContain(line('research.status_task_pending', 2, t('building.management_office.name'), 50));
  });

  it('shows fractional ticks remaining rounded up', () => {
    const out = status(makeCtx(2, 1, 48.5));
    expect(out).toContain(line('research.status_task_active', 0, t('building.driving_center.name'), 49));
    expect(out).not.toContain('48.5');
  });

  it('with a center and an empty queue still shows the header', () => {
    const out = status(makeCtx(3));
    expect(out).toContain(t('research.status_header', { speed: 2, active: 0, slots: 3 }));
  });

  it('no active center: prints the no-center header and no speed header', () => {
    const out = status(makeCtx(null));
    expect(out).toContain(t('research.status_no_center'));
    expect(out).not.toContain(t('research.status_header', { speed: 1, active: 0, slots: 1 }));
  });

  it('closed center counts as no active center', () => {
    const ctx = makeCtx(3, 1);
    ctx.state!.buildings.buildings[0]!.outOfService = true;
    expect(status(ctx)).toContain(t('research.status_no_center'));
  });

  it('is translated: fr output differs from en', () => {
    const enOut = status(makeCtx(2, 2));
    setLocale('fr');
    expect(status(makeCtx(2, 2))).not.toBe(enOut);
  });

  it('output has no raw key leakage', () => {
    expect(status(makeCtx(3, 3))).not.toMatch(/research\.status_/);
    expect(status(makeCtx(null))).not.toMatch(/research\.status_/);
  });
});
