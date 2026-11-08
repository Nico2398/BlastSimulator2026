// @vitest-environment jsdom
// BlastSimulator2026 — panelExplain (#2170): explanation texts of the management panels.
import { describe, it, expect, afterEach } from 'vitest';
import {
  heldExplain, penaltyExplain, earlyBonusExplain, negotiateExplain, offSiteExplain, buyerExplain,
  marketRowExplain, permitStrikesExplain, financeCategoryExplain, eventChipExplain,
  vehicleHpExplain, vehicleStatusExplain,
} from '../../../src/ui/panelExplain.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import { BUYER_TIERS } from '../../../src/core/economy/BuyerTiers.js';
import { marketTooltipKey } from '../../../src/ui/panels/ContractsMarketStrip.js';
import { formatTrendPct } from '../../../src/core/economy/OreSaturation.js';
import { t } from '../../../src/core/i18n/I18n.js';
import {
  CONTRACT_EARLY_BONUS_DEADLINE_FRACTION, NEGOTIATION_MAX_IMPROVEMENT, NEGOTIATION_MAX_WORSENING,
  PERMIT_STRIKES_TO_SUSPEND, PERMIT_STRIKE_WINDOW_TICKS, PERMIT_SUSPENSION_TICKS,
  STUCK_THRESHOLD, MOVE_STUCK_ABANDON_TICKS,
} from '../../../src/core/config/balance.js';
import { formatGameDuration } from '../../../src/ui/formatGameDuration.js';
import type { Transaction } from '../../../src/core/economy/Finance.js';
import type { VehicleStatusKind } from '../../../src/core/entities/VehicleStatus.js';

afterEach(() => setLocale('en'));

const STATUS_KINDS: readonly VehicleStatusKind[] = ['broken', 'stuck', 'waiting', 'hauling', 'working', 'moving', 'idle'];
const BARE_KEY = /^[a-z_]+(\.[a-z0-9_]+)+$/;

/** True when `text` quotes `n` plainly, with a thousands separator, or as a game duration. */
function quotes(text: string, n: number): boolean {
  return text.includes(String(n)) || text.includes(n.toLocaleString('en-US')) || text.includes(formatGameDuration(n));
}

/** Runs a builder in en then fr and checks both are real, different sentences. */
function expectTranslated(build: () => string): void {
  setLocale('en');
  const en = build();
  setLocale('fr');
  const fr = build();
  expect(en.trim().length).toBeGreaterThan(0);
  expect(fr.trim().length).toBeGreaterThan(0);
  expect(en).not.toMatch(BARE_KEY);
  expect(fr).not.toMatch(BARE_KEY);
  expect(fr).not.toBe(en);
}

function tx(amount: number, description: string, category: Transaction['category'] = 'sales'): Transaction {
  return { tick: 1, amount, type: 'income', category, description };
}

describe('panelExplain — contract texts', () => {
  it('heldExplain says automatic delivery stops until resumed', () => {
    expect(heldExplain()).toMatch(/deliver/i);
    expect(heldExplain()).toMatch(/resum|release/i);
  });

  it('penaltyExplain says it is charged when the deadline passes', () => {
    expect(penaltyExplain(900)).toMatch(/deadline/i);
  });

  it('earlyBonusExplain quotes the deadline percentage derived from the balance constant', () => {
    const pct = Math.round(CONTRACT_EARLY_BONUS_DEADLINE_FRACTION * 100);
    expect(earlyBonusExplain(1234)).toContain(`${pct}%`);
  });

  it('earlyBonusExplain quotes the bonus amount', () => {
    expect(earlyBonusExplain(1234)).toContain('1,234');
    expect(earlyBonusExplain(1234)).not.toBe(earlyBonusExplain(5678));
  });

  it('negotiateExplain quotes the best and worst case and the single attempt', () => {
    const text = negotiateExplain();
    expect(text).toContain(`${Math.round(NEGOTIATION_MAX_IMPROVEMENT * 100)}%`);
    expect(text).toContain(`${Math.round(NEGOTIATION_MAX_WORSENING * 100)}%`);
    expect(text).toMatch(/once|one attempt|single|1 attempt/i);
  });

  it('offSiteExplain says the ore is not on this site', () => {
    expect(offSiteExplain()).toMatch(/site/i);
  });

  it('every contract text is translated and differs between en and fr', () => {
    expectTranslated(heldExplain);
    expectTranslated(() => penaltyExplain(900));
    expectTranslated(() => earlyBonusExplain(900));
    expectTranslated(negotiateExplain);
    expectTranslated(offSiteExplain);
  });
});

describe('panelExplain — buyerExplain', () => {
  it.each(BUYER_TIERS.map(b => b.id))('%s explains itself in a non-empty, translated sentence', (id) => {
    expectTranslated(() => buyerExplain(id));
  });

  it('gives each tier a text of its own', () => {
    const texts = new Set(BUYER_TIERS.map(b => buyerExplain(b.id)));
    expect(texts.size).toBe(BUYER_TIERS.length);
  });
});

describe('panelExplain — marketRowExplain', () => {
  it('quotes a falling trend with its sign', () => {
    expect(marketRowExplain(-20, 0.4)).toContain(formatTrendPct(-20));
  });

  it('quotes a rising trend with an explicit plus', () => {
    expect(marketRowExplain(12, 0)).toContain(formatTrendPct(12));
  });

  it('carries the joke tip of its saturation level', () => {
    for (const sat of [0, 0.3, 1]) {
      expect(marketRowExplain(-5, sat)).toContain(t(marketTooltipKey(sat)));
    }
  });

  it('reads differently for a different saturation', () => {
    expect(marketRowExplain(0, 0)).not.toBe(marketRowExplain(0, 1));
  });

  it('is translated', () => {
    expectTranslated(() => marketRowExplain(-20, 0.4));
  });
});

describe('panelExplain — permitStrikesExplain', () => {
  it('quotes the strike count, the window and the suspension from balance', () => {
    const text = permitStrikesExplain();
    expect(text).toContain(String(PERMIT_STRIKES_TO_SUSPEND));
    expect(quotes(text, PERMIT_STRIKE_WINDOW_TICKS)).toBe(true);
    expect(quotes(text, PERMIT_SUSPENSION_TICKS)).toBe(true);
  });

  it('says blasting is banned', () => {
    expect(permitStrikesExplain()).toMatch(/blast/i);
  });

  it('is translated', () => {
    expectTranslated(permitStrikesExplain);
  });
});

describe('panelExplain — financeCategoryExplain', () => {
  const list = [tx(900, 'Ore to Acme'), tx(500, 'Scrap lot'), tx(100, 'Pebbles')];

  it('quotes the transaction count', () => {
    expect(financeCategoryExplain(list, 50)).toContain('3');
  });

  it('names the largest entries by description', () => {
    const text = financeCategoryExplain(list, 50);
    expect(text).toContain('Ore to Acme');
  });

  it('leaves the smallest entries out when there are many', () => {
    const many = Array.from({ length: 12 }, (_, i) => tx(1000 - i * 10, `Entry number ${i}`));
    const text = financeCategoryExplain(many, 50);
    expect(text).toContain('Entry number 0');
    expect(text).not.toContain('Entry number 11');
    expect(text).toContain('12');
  });

  it('reads differently for a different share', () => {
    expect(financeCategoryExplain(list, 25)).not.toBe(financeCategoryExplain(list, 60));
  });

  it('copes with transactions that have no description', () => {
    const text = financeCategoryExplain([tx(10, ''), tx(20, '')], 100);
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it('copes with an empty list', () => {
    expect(() => financeCategoryExplain([], 0)).not.toThrow();
  });

  it('is translated', () => {
    expectTranslated(() => financeCategoryExplain(list, 50));
  });
});

describe('panelExplain — eventChipExplain', () => {
  it('explains a cash change as cash', () => {
    const text = eventChipExplain('cash', 'cash', -3000);
    expect(text).toMatch(/cash/i);
    expect(text).toMatch(/3,?000/);
  });

  it('explains a safety score chip with the name in full and the amount', () => {
    const text = eventChipExplain('score', 'safety', -5);
    expect(text).toMatch(/safety/i);
    expect(text).toContain('5');
  });

  it.each([
    ['wellBeing', /well-?being/i],
    ['ecology', /ecolog/i],
    ['nuisance', /neighbo/i],
  ] as const)('names the %s score in full words', (key, pattern) => {
    expect(eventChipExplain('score', key, 7)).toMatch(pattern);
  });

  it('tells a rise from a fall', () => {
    expect(eventChipExplain('score', 'safety', 5)).not.toBe(eventChipExplain('score', 'safety', -5));
  });

  it('says an other-kind effect is lasting', () => {
    expect(eventChipExplain('other', 'work_stoppage')).toMatch(/lasting/i);
  });

  it('still explains a chip with no known amount', () => {
    expect(eventChipExplain('cash', 'cash').trim().length).toBeGreaterThan(0);
    expect(eventChipExplain('score', 'safety').trim().length).toBeGreaterThan(0);
  });

  it('is translated for every kind', () => {
    expectTranslated(() => eventChipExplain('cash', 'cash', -3000));
    expectTranslated(() => eventChipExplain('score', 'safety', -5));
    expectTranslated(() => eventChipExplain('other', 'work_stoppage'));
  });
});

describe('panelExplain — vehicle texts', () => {
  it('vehicleHpExplain says an empty HP breaks the vehicle until repaired', () => {
    expect(vehicleHpExplain()).toMatch(/broken/i);
    expect(vehicleHpExplain()).toMatch(/repair/i);
  });

  it('vehicleHpExplain is translated', () => {
    expectTranslated(vehicleHpExplain);
  });

  it.each(STATUS_KINDS)('vehicleStatusExplain(%s) is a translated sentence', (kind) => {
    expectTranslated(() => vehicleStatusExplain(kind));
  });

  it('gives each status a reason of its own', () => {
    expect(new Set(STATUS_KINDS.map(vehicleStatusExplain)).size).toBe(STATUS_KINDS.length);
  });

  it('stuck quotes a stuck figure from balance', () => {
    const text = vehicleStatusExplain('stuck');
    expect(text.includes(String(STUCK_THRESHOLD)) || text.includes(String(MOVE_STUCK_ABANDON_TICKS))).toBe(true);
  });

});
