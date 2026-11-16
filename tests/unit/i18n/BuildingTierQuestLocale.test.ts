// BlastSimulator2026 — Locale for building-tier quests; every research string gone (#2283 C8)

import { describe, it, expect } from 'vitest';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';
import { getQuest } from '../../../src/core/economy/QuestCatalog.js';

const E = en as Record<string, string>;
const F = fr as Record<string, string>;

const NEW_KEYS: Record<string, string[]> = {
  'quest.giver.architect': [],
  'quest.objective.buildings_built': ['current', 'needed'],
  'quest.objective.crew_housed': ['current', 'needed'],
  'entities.build_tier_locked': ['tier', 'type', 'quest'],
  'entities.build_upgrade_tier_locked': ['tier', 'type', 'quest'],
  'inspector.reason.quest_required': ['tier', 'quest'],
};

describe('building-tier quest keys exist in both locales (#2283 C8)', () => {
  for (const [key, params] of Object.entries(NEW_KEYS)) {
    it(`${key} exists in en and fr, differs between them, and keeps its placeholders`, () => {
      expect(typeof E[key], `en ${key}`).toBe('string');
      expect(typeof F[key], `fr ${key}`).toBe('string');
      expect(E[key]!.trim().length).toBeGreaterThan(0);
      expect(F[key]!.trim().length).toBeGreaterThan(0);
      expect(E[key]).not.toBe(F[key]);
      for (const p of params) {
        expect(E[key], `en ${key}`).toContain(`{${p}}`);
        expect(F[key], `fr ${key}`).toContain(`{${p}}`);
      }
    });
  }

  it.each(['quest_building_t2', 'quest_building_t3'])('%s title and pitch exist in both locales and differ between them', (id) => {
    const q = getQuest(id)!;
    for (const key of [q.titleKey, q.pitchKey]) {
      expect(typeof E[key], `en ${key}`).toBe('string');
      expect(typeof F[key], `fr ${key}`).toBe('string');
      expect(E[key]).not.toBe(F[key]);
    }
  });

  it('the two quests have different titles and pitches in each language', () => {
    const a = getQuest('quest_building_t2')!;
    const b = getQuest('quest_building_t3')!;
    for (const L of [E, F]) {
      expect(L[a.titleKey]).not.toBe(L[b.titleKey]);
      expect(L[a.pitchKey]).not.toBe(L[b.pitchKey]);
    }
  });
});

describe('the Research Center strings are gone (#2283 C8)', () => {
  const GONE_PREFIXES = [
    'research.', 'building.research_center', 'notification.research', 'notification.title.research',
    'ui.build.research', 'ui.build.queue_research', 'ui.build.row.util_research', 'ui.explain.building_util_research',
    'inspector.research', 'inspector.section.research', 'inspector.action.research', 'inspector.reason.research',
    'ui.modifier.research', 'ui.hud_explain.modifier.research',
  ];
  const GONE_KEYS = [
    'entities.build_not_researched', 'entities.build_upgrade_not_researched', 'ui.event.effect.what.research',
  ];

  it.each([['en', E], ['fr', F]] as const)('%s has no research key', (_locale, L) => {
    const left = Object.keys(L).filter(k => GONE_PREFIXES.some(p => k.startsWith(p)) || GONE_KEYS.includes(k));
    expect(left).toEqual([]);
  });

  it.each([['en', E], ['fr', F]] as const)('%s has no key whose name mentions research', (_locale, L) => {
    expect(Object.keys(L).filter(k => /research/i.test(k))).toEqual([]);
  });

  it.each([['en', E, /research/i], ['fr', F, /recherche/i]] as const)('%s: no player text sends the player to a Research Center', (_locale, L, word) => {
    const offenders = Object.entries(L).filter(([k, v]) => /^(inspector|ui\.build|ui\.event|building|entities|notification|event\.politics_tax_reform)/.test(k) && word.test(v)).map(([k]) => k);
    expect(offenders).toEqual([]);
  });

  it('the upgrade tooltip no longer asks for research', () => {
    expect(E['inspector.tip.upgrade']).not.toMatch(/research/i);
    expect(F['inspector.tip.upgrade']).not.toMatch(/recherche/i);
  });

  it('the tax reform event now promises an explosives discount, not a research one', () => {
    expect(E['event.politics_tax_reform.res0']).not.toMatch(/research/i);
    expect(F['event.politics_tax_reform.res0']).not.toMatch(/recherche/i);
    expect(E['event.politics_tax_reform.res0']).toMatch(/explosive/i);
    expect(F['event.politics_tax_reform.res0']).toMatch(/explosif/i);
  });
});
