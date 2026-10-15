// BlastSimulator2026 — `research queue` refusal i18n guards (#1808)
//
// The four QUEUE_BLOCK codes route through t() with new research.queue_* keys
// and name the building by its translated display name (never the raw id).

import { describe, it, expect, afterEach } from 'vitest';
import type { GameContext } from '../../../src/console/commands/world.js';
import { researchCommand } from '../../../src/console/commands/research.js';
import { tickCommand } from '../../../src/console/commands/events.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import { placeBuilding, type BuildingType } from '../../../src/core/entities/Building.js';
import { makeGameContext } from '../../helpers/gameContext.js';
import enLocale from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import frLocale from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };

const EN = enLocale as Record<string, string>;
const FR = frLocale as Record<string, string>;

afterEach(() => setLocale('en'));

function makeCtx(): GameContext {
  return makeGameContext({ mineType: 'desert', seed: '42', size: '32', cash: '500000' });
}

function placeResearchCenter(ctx: GameContext): void {
  const result = placeBuilding(ctx.state!.buildings, 'research_center', 20, 20, 32, 32, 1, 0, 0);
  if (!result.success) throw new Error(`setup: ${result.error}`);
}

type Code = 'no_research_center' | 'already_unlocked' | 'already_queued' | 'conditions_not_met';

interface Case {
  code: Code;
  key: string;
  type: BuildingType;
  tier: 2 | 3;
  /** Brings ctx to the state in which the queue request hits `code`. */
  setup: (ctx: GameContext) => void;
}

const CASES: Case[] = [
  { code: 'no_research_center', key: 'research.queue_no_center', type: 'driving_center', tier: 2, setup: () => {} },
  {
    code: 'already_unlocked',
    key: 'research.queue_already_unlocked',
    type: 'driving_center',
    tier: 2,
    setup: (ctx) => {
      placeResearchCenter(ctx);
      researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
      tickCommand(ctx, ['1'], {});
    },
  },
  {
    code: 'already_queued',
    key: 'research.queue_already_queued',
    type: 'geology_lab',
    tier: 2,
    setup: (ctx) => {
      placeResearchCenter(ctx);
      const first = researchCommand(ctx, ['queue'], { type: 'geology_lab', tier: '2' });
      if (!first.success) throw new Error(`setup: ${first.output}`);
    },
  },
  {
    code: 'conditions_not_met',
    key: 'research.queue_conditions_not_met',
    type: 'geology_lab',
    tier: 3,
    setup: (ctx) => placeResearchCenter(ctx),
  },
];

describe('research queue refusals — locale keys exist in both languages (#1808)', () => {
  for (const c of CASES) {
    it(`${c.key} in en.json and fr.json, with {type}`, () => {
      expect(EN[c.key], `en.json lacks ${c.key}`).toBeDefined();
      expect(FR[c.key], `fr.json lacks ${c.key}`).toBeDefined();
      expect(EN[c.key]).toContain('{type}');
      expect(FR[c.key]).toContain('{type}');
    });
  }
});

describe('research queue refusals — translated, display-named (#1808)', () => {
  for (const c of CASES) {
    for (const locale of ['en', 'fr'] as const) {
      it(`${c.code} (${locale}) prints t(${c.key}) with the display name`, () => {
        const ctx = makeCtx();
        c.setup(ctx);
        setLocale(locale);
        const name = t(`building.${c.type}.name`);
        const result = researchCommand(ctx, ['queue'], { type: c.type, tier: String(c.tier) });
        expect(result.success).toBe(false);
        expect(result.code).toBe(c.code);
        const template = (locale === 'en' ? EN : FR)[c.key];
        expect(template, `${locale}.json lacks ${c.key}`).toBeDefined();
        expect(result.output).toBe(t(c.key, { type: name, tier: c.tier }));
        expect(result.output).not.toBe(c.key);
        expect(result.output).toContain(name);
        expect(result.output).not.toContain(c.type);
      });
    }

    it(`${c.code} — fr output differs from en output`, () => {
      const enCtx = makeCtx();
      c.setup(enCtx);
      const enOut = researchCommand(enCtx, ['queue'], { type: c.type, tier: String(c.tier) }).output;
      const frCtx = makeCtx();
      c.setup(frCtx);
      setLocale('fr');
      const frOut = researchCommand(frCtx, ['queue'], { type: c.type, tier: String(c.tier) }).output;
      expect(frOut).not.toBe(enOut);
    });
  }
});

describe('research queue usage, funds and success messages — translated (#1808)', () => {
  for (const locale of ['en', 'fr'] as const) {
    it(`queue_usage (${locale}) prints t(research.queue_usage)`, () => {
      const ctx = makeCtx();
      setLocale(locale);
      const result = researchCommand(ctx, ['queue'], {});
      expect(result.success).toBe(false);
      expect(result.code).toBe('usage');
      expect(result.output).toBe(t('research.queue_usage'));
    });

    it(`queue_insufficient_funds (${locale}) prints t() with the cost`, () => {
      const ctx = makeCtx();
      placeResearchCenter(ctx);
      ctx.state!.cash = 0;
      setLocale(locale);
      const result = researchCommand(ctx, ['queue'], { type: 'geology_lab', tier: '2' });
      expect(result.success).toBe(false);
      expect(result.code).toBe('insufficient_funds');
      expect(result.output).toMatch(/\d/);
      expect(result.output).not.toBe('research.queue_insufficient_funds');
      expect(result.output.startsWith(t('research.queue_insufficient_funds', { cost: 0 }).split('0')[0]!)).toBe(true);
    });

    it(`queue_queued (${locale}) prints t() with name, tier, ticks and cost`, () => {
      const ctx = makeCtx();
      placeResearchCenter(ctx);
      setLocale(locale);
      const cashBefore = ctx.state!.cash;
      const result = researchCommand(ctx, ['queue'], { type: 'geology_lab', tier: '2' });
      expect(result.success).toBe(true);
      const task = ctx.state!.buildings.researchQueue[0]!;
      const cost = cashBefore - ctx.state!.cash;
      const key = task.ticksRemaining > 0 ? 'research.queue_queued' : 'research.queue_queued_instant';
      expect(result.output).toBe(
        t(key, { type: t('building.geology_lab.name'), tier: 2, ticks: task.ticksRemaining, cost }),
      );
      expect(result.output).not.toContain('{');
    });
  }

  it('queue_usage and queued outputs differ between en and fr', () => {
    const enCtx = makeCtx();
    const en = researchCommand(enCtx, ['queue'], {}).output;
    setLocale('fr');
    const fr = researchCommand(makeCtx(), ['queue'], {}).output;
    expect(fr).not.toBe(en);
  });

  it('default usage line is translated and differs per locale', () => {
    const en = researchCommand(makeCtx(), ['bogus'], {}).output;
    expect(en).toBe(t('research.usage'));
    setLocale('fr');
    const fr = researchCommand(makeCtx(), ['bogus'], {}).output;
    expect(fr).toBe(t('research.usage'));
    expect(fr).not.toBe(en);
  });
});
