// loadingSiteInfo — briefing row builders for the loading screen (#1321)

import { describe, it, expect } from 'vitest';
import { buildLoadingSiteInfo, buildSandboxLoadingSiteInfo } from '../../../src/ui/loadingSiteInfo.js';
import { getAllLevels, getLevel } from '../../../src/core/campaign/Level.js';
import { getAllExplosives } from '../../../src/core/world/ExplosiveCatalog.js';
import { SANDBOX_DEFAULTS } from '../../../src/core/campaign/Sandbox.js';

describe('loadingSiteInfo briefing', () => {
  it('sandbox briefing has cash and explosives rows but no target row', () => {
    const rows = buildSandboxLoadingSiteInfo(SANDBOX_DEFAULTS).briefing ?? [];
    expect(rows.map(r => r.labelKey)).toEqual(['loading.brief.starting_cash', 'loading.brief.explosives']);
  });

  it('campaign briefing still includes the target row', () => {
    const level = getAllLevels()[0]!;
    const keys = (buildLoadingSiteInfo(level).briefing ?? []).map(r => r.labelKey);
    expect(keys).toEqual(['loading.brief.starting_cash', 'loading.brief.explosives', 'loading.brief.target']);
  });

  it('maps each campaign level biome to its category key', () => {
    const map: Record<string, string> = {
      desert_badlands: 'ui.portfolio.biome.desert',
      alpine_granite: 'ui.portfolio.biome.mountain',
      tropical_karst: 'ui.portfolio.biome.tropical',
      volcanic_flats: 'ui.portfolio.biome.volcanic',
    };
    for (const level of getAllLevels()) {
      const info = buildLoadingSiteInfo(level);
      expect(info.biomeCategoryKey).toBe(map[level.biome]);
      expect(info.siteNumber).toBe(level.difficultyTier);
      expect(info.difficulty).toBe(level.difficultyTier);
      expect(info.descriptionKey).toBe(level.descKey);
    }
  });

  it('unknown campaign biome falls back to mountain category', () => {
    const level = { ...getAllLevels()[0]!, biome: 'unknown_biome' };
    expect(buildLoadingSiteInfo(level).biomeCategoryKey).toBe('ui.portfolio.biome.mountain');
  });

  it('explosives row counts available explosives', () => {
    const base = getAllLevels()[0]!;
    const level = { ...base, preset: { grade: 0, tier: 1 as const, completedQuests: [] } };
    const row = (buildLoadingSiteInfo(level).briefing ?? []).find(r => r.labelKey === 'loading.brief.explosives');
    expect(row?.value).toBe(String(getAllExplosives().filter(e => e.tier === 1).length));
  });

  it('the tutorial counts the tier 1 explosives its quest-derived list opens, not a level list (#2318)', () => {
    const tutorial = getLevel('tutorial_pit')!;
    const row = (buildLoadingSiteInfo(tutorial).briefing ?? []).find(r => r.labelKey === 'loading.brief.explosives');
    expect(row?.value).toBe(String(getAllExplosives().filter(e => e.tier === 1).length));
  });

  it('a level whose preset completed the tier 2 explosive quest counts tier 1 and tier 2', () => {
    const base = getAllLevels()[0]!;
    const level = { ...base, preset: { grade: 0, tier: 1 as const, completedQuests: ['quest_explosive_t2'] } };
    const row = (buildLoadingSiteInfo(level).briefing ?? []).find(r => r.labelKey === 'loading.brief.explosives');
    expect(row?.value).toBe(String(getAllExplosives().filter(e => e.tier <= 2).length));
  });

  it('a level with no preset counts the tier 1 explosives only', () => {
    const { preset: _preset, ...bare } = getLevel('tutorial_pit')!;
    const rows = buildLoadingSiteInfo(bare).briefing ?? [];
    const withPreset = buildLoadingSiteInfo(getLevel('tutorial_pit')!).briefing ?? [];
    const count = (rs: typeof rows) => rs.find(r => r.labelKey === 'loading.brief.explosives')!.value;
    expect(count(rows)).toBe(count(withPreset));
  });

  it('sandbox info has no site number, zero difficulty and sandbox subtitle for each biome', () => {
    const cases: Array<[string, string]> = [
      ['desert_badlands', 'ui.portfolio.biome.desert'],
      ['alpine_granite', 'ui.portfolio.biome.mountain'],
      ['tropical_karst', 'ui.portfolio.biome.tropical'],
    ];
    for (const [biome, key] of cases) {
      const info = buildSandboxLoadingSiteInfo({ ...SANDBOX_DEFAULTS, biome });
      expect(info.siteNumber).toBeNull();
      expect(info.difficulty).toBe(0);
      expect(info.descriptionKey).toBe('loading.sandbox_subtitle');
      expect(info.biomeCategoryKey).toBe(key);
    }
  });
});
