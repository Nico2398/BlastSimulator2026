import { describe, it, expect, afterEach } from 'vitest';
import { starExplain, difficultyExplain, levelEndStatExplain, type LevelEndStatId } from '../../../src/ui/levelExplain.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import { STAR_ECOLOGY_MIN } from '../../../src/core/config/balance.js';
import { getCampaignLevels } from '../../../src/core/campaign/Campaign.js';
import { formatDollars } from '../../../src/core/economy/formatMoney.js';

afterEach(() => setLocale('en'));

const BARE_KEY = /^[a-z_]+(\.[a-z_0-9]+)+$/;
const ALL_STAT_IDS: readonly LevelEndStatId[] = [
  'profit', 'days', 'blasts', 'volume', 'max_depth', 'unique_ores', 'casualties', 'best_safety',
  'quarters_survived', 'final_balance', 'salaries_paid', 'fines_paid', 'exposure_at_arrest',
  'arrangements_made', 'corruption_level', 'final_ecology', 'best_ecology', 'final_wellbeing', 'shift_mode',
];
const MAX_TIER = Math.max(...getCampaignLevels().map(l => l.difficultyTier));

describe('starExplain', () => {
  it.each([true, false])('earned=%s is non-empty and never a bare locale key', (earned) => {
    const text = starExplain(earned, 80000);
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toMatch(BARE_KEY);
  });

  it.each([true, false])('earned=%s names the ecology minimum from balance', (earned) => {
    expect(starExplain(earned, 80000)).toContain(String(STAR_ECOLOGY_MIN));
  });

  it.each([true, false])('earned=%s names the level profit target as the card formats it', (earned) => {
    expect(starExplain(earned, 80000)).toContain(formatDollars(80000));
    expect(starExplain(earned, 250000)).toContain(formatDollars(250000));
    expect(starExplain(earned, 250000)).not.toContain(formatDollars(80000));
  });

  it('an earned star reads differently from an unearned one', () => {
    expect(starExplain(true, 80000)).not.toBe(starExplain(false, 80000));
  });

  it('is translated: fr differs from en, is non-empty and still names the ecology minimum', () => {
    setLocale('en');
    const en = starExplain(true, 80000);
    setLocale('fr');
    const fr = starExplain(true, 80000);
    expect(fr.trim().length).toBeGreaterThan(0);
    expect(fr).not.toMatch(BARE_KEY);
    expect(fr).not.toBe(en);
    expect(fr).toContain(String(STAR_ECOLOGY_MIN));
  });

  it('earned/unearned also differ in fr', () => {
    setLocale('fr');
    expect(starExplain(true, 80000)).not.toBe(starExplain(false, 80000));
  });

  it('a zero target still yields a text', () => {
    expect(starExplain(false, 0).trim().length).toBeGreaterThan(0);
  });
});

describe('difficultyExplain', () => {
  it('is non-empty and never a bare locale key', () => {
    const text = difficultyExplain(2, 250000);
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toMatch(BARE_KEY);
  });

  it('names the tier out of the highest campaign tier and the profit target', () => {
    const text = difficultyExplain(2, 250000);
    expect(text).toContain('2');
    expect(text).toContain(String(MAX_TIER));
    expect(text).toContain(formatDollars(250000));
  });

  it('the lowest and highest tier both have a text, and they differ', () => {
    const low = difficultyExplain(1, 80000);
    const high = difficultyExplain(MAX_TIER, 1000000);
    expect(low.trim().length).toBeGreaterThan(0);
    expect(high.trim().length).toBeGreaterThan(0);
    expect(low).not.toBe(high);
    expect(high).toContain(formatDollars(1000000));
  });

  it('is translated: fr differs from en', () => {
    setLocale('en');
    const en = difficultyExplain(3, 800000);
    setLocale('fr');
    const fr = difficultyExplain(3, 800000);
    expect(fr.trim().length).toBeGreaterThan(0);
    expect(fr).not.toMatch(BARE_KEY);
    expect(fr).not.toBe(en);
  });
});

describe('levelEndStatExplain', () => {
  it.each(ALL_STAT_IDS)('%s has a non-empty text that is not a bare locale key', (id) => {
    const text = levelEndStatExplain(id);
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toMatch(BARE_KEY);
  });

  it('every stat reads differently from every other', () => {
    const texts = new Set(ALL_STAT_IDS.map(id => levelEndStatExplain(id)));
    expect(texts.size).toBe(ALL_STAT_IDS.length);
  });

  it.each(ALL_STAT_IDS)('%s is translated: fr is non-empty and differs from en', (id) => {
    setLocale('en');
    const en = levelEndStatExplain(id);
    setLocale('fr');
    const fr = levelEndStatExplain(id);
    expect(fr.trim().length).toBeGreaterThan(0);
    expect(fr).not.toMatch(BARE_KEY);
    expect(fr).not.toBe(en);
  });
});
