// @vitest-environment jsdom
// BlastSimulator2026 — buildingExplain (#2171): explanation texts of the build menu, placed rows and inspector.
import { describe, it, expect, afterEach } from 'vitest';
import {
  tierCompareExplain, placedRowTitle, badgeExplain, utilizationExplain, buildingHpExplain, upkeepExplain,
} from '../../../src/ui/buildingExplain.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import {
  BUILDING_TIERS, getAllBuildingTypes, getBuildingDef, isSingleTierType, type Building, type BuildingType,
} from '../../../src/core/entities/Building.js';
import { formatMoney } from '../../../src/core/economy/formatMoney.js';
import { formatGameDuration } from '../../../src/ui/formatGameDuration.js';

afterEach(() => setLocale('en'));

const BARE_KEY = /^[a-z_]+(\.[a-z0-9_]+)+$/;
const MULTI_TIER = getAllBuildingTypes().filter((type) => !isSingleTierType(type));

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

/** True when `text` quotes the amount plainly, rounded, or grouped. */
function quotesAmount(text: string, n: number): boolean {
  return text.includes(String(n)) || text.includes(formatMoney(n)) || text.includes(n.toLocaleString('en-US'))
    || text.includes(n.toLocaleString('fr-FR'));
}

function building(over: Partial<Building> = {}): Building {
  return { id: 3, type: 'living_quarters', tier: 1, x: 17, z: 23, hp: 50, active: true, occupantIds: [], ...over };
}

function stateWith(tickCount = 100): Pick<GameState, 'events' | 'tickCount'> {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.tickCount = tickCount;
  return s;
}

describe('buildingExplain — tierCompareExplain', () => {
  it.each(MULTI_TIER)('%s lists the cost, max HP and upkeep of every tier', (type) => {
    const text = tierCompareExplain(type);
    for (const tier of BUILDING_TIERS) {
      const def = getBuildingDef(type, tier);
      expect(quotesAmount(text, def.constructionCost)).toBe(true);
      expect(quotesAmount(text, def.maxHp)).toBe(true);
      expect(quotesAmount(text, def.operatingCostPerTick)).toBe(true);
    }
  });

  it('mentions each tier with its name or its number', () => {
    for (const tier of BUILDING_TIERS) {
      const text = tierCompareExplain('management_office');
      expect(text.includes(t(`building.management_office.t${tier}.name`)) || text.includes(`T${tier}`)).toBe(true);
    }
  });

  it('reads one line per tier', () => {
    const lines = tierCompareExplain('management_office').split('\n').filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(BUILDING_TIERS.length);
  });

  it('differs between types', () => {
    expect(tierCompareExplain('management_office')).not.toBe(tierCompareExplain('driving_center'));
  });

  it('reads the numbers from the defs, not from locale text', () => {
    const def = getBuildingDef('management_office', 2) as { constructionCost: number };
    const original = def.constructionCost;
    def.constructionCost = 987654;
    try {
      expect(quotesAmount(tierCompareExplain('management_office'), 987654)).toBe(true);
    } finally {
      def.constructionCost = original;
    }
  });

  it('is translated', () => {
    expectTranslated(() => tierCompareExplain('management_office'));
  });
});

describe('buildingExplain — placedRowTitle', () => {
  it('reads #id tier name (x,z)', () => {
    expect(placedRowTitle({ id: 12, type: 'management_office', tier: 3, x: 4, z: 9 })).toBe('#12 Corner Office Supreme (4,9)');
  });

  it('follows the tier', () => {
    expect(placedRowTitle({ id: 1, type: 'management_office', tier: 1, x: 0, z: 0 })).toBe('#1 The Cupboard (0,0)');
  });

  it('never leaks the raw type or the English "T<n> at" form', () => {
    const title = placedRowTitle({ id: 12, type: 'management_office', tier: 2, x: 4, z: 9 });
    expect(title).not.toContain('management_office');
    expect(title).not.toMatch(/\bT\d at\b/);
  });

  it('is translated to French', () => {
    setLocale('fr');
    const title = placedRowTitle({ id: 12, type: 'management_office', tier: 2, x: 4, z: 9 });
    expect(title).toBe(`#12 ${t('building.management_office.t2.name')} (4,9)`);
    expect(title).not.toMatch(BARE_KEY);
  });
});

describe('buildingExplain — badgeExplain', () => {
  const closed = { closureEventId: 'lawsuit_back_taxes', closureTicksRemaining: 37 };
  const none = { closureEventId: null, closureTicksRemaining: null };

  it('out_of_service names the closing event', () => {
    expect(badgeExplain('out_of_service', closed)).toContain(t('event.lawsuit_back_taxes.title'));
  });

  it('out_of_service quotes the time left', () => {
    const text = badgeExplain('out_of_service', closed);
    expect(text.includes('37') || text.includes(formatGameDuration(37))).toBe(true);
  });

  it('out_of_service reads differently for another event and another time', () => {
    expect(badgeExplain('out_of_service', closed))
      .not.toBe(badgeExplain('out_of_service', { closureEventId: 'lawsuit_bad_coffee', closureTicksRemaining: 5 }));
  });

  it('a permanent closure says so instead of quoting a time', () => {
    const text = badgeExplain('out_of_service', { closureEventId: 'lawsuit_back_taxes', closureTicksRemaining: null });
    expect(text).toContain(t('event.lawsuit_back_taxes.title'));
    expect(text).not.toMatch(/null|undefined|NaN/);
  });

  it('a closure with no known event still reads as a sentence', () => {
    const text = badgeExplain('out_of_service', { closureEventId: null, closureTicksRemaining: 4 });
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toMatch(/null|undefined|NaN/);
  });

  it('demolition_ordered and upgrading each explain what the status means', () => {
    const demolition = badgeExplain('demolition_ordered', none);
    const upgrading = badgeExplain('upgrading', none);
    expect(demolition).toMatch(/demoli/i);
    expect(upgrading).toMatch(/upgrad/i);
    expect(demolition).not.toBe(upgrading);
  });

  it('every badge is translated', () => {
    expectTranslated(() => badgeExplain('out_of_service', closed));
    expectTranslated(() => badgeExplain('demolition_ordered', none));
    expectTranslated(() => badgeExplain('upgrading', none));
  });

  it('the French out_of_service text names the event in French', () => {
    setLocale('fr');
    expect(badgeExplain('out_of_service', closed)).toContain(t('event.lawsuit_back_taxes.title'));
  });
});

describe('buildingExplain — utilizationExplain', () => {
  it('beds counts people inside against beds', () => {
    expect(utilizationExplain(building(), 'beds')).toMatch(/bed|people|occupan/i);
  });

  it('kg says how much is stored', () => {
    expect(utilizationExplain(building({ type: 'spoil_heap' }), 'kg')).toMatch(/kg/i);
  });

  it('research says it is the research queue', () => {
    expect(utilizationExplain(building({ type: 'research_center' }), 'research')).toMatch(/research|queue/i);
  });

  it('gives each kind a text of its own', () => {
    const texts = new Set([
      utilizationExplain(building(), 'beds'),
      utilizationExplain(building({ type: 'spoil_heap' }), 'kg'),
      utilizationExplain(building({ type: 'research_center' }), 'research'),
    ]);
    expect(texts.size).toBe(3);
  });

  it('is translated for every kind', () => {
    expectTranslated(() => utilizationExplain(building(), 'beds'));
    expectTranslated(() => utilizationExplain(building({ type: 'spoil_heap' }), 'kg'));
    expectTranslated(() => utilizationExplain(building({ type: 'research_center' }), 'research'));
  });

  it('never prints a NaN or an undefined for any type', () => {
    for (const type of getAllBuildingTypes() as BuildingType[]) {
      for (const kind of ['beds', 'kg', 'research'] as const) {
        expect(utilizationExplain(building({ type }), kind)).not.toMatch(/NaN|undefined/);
      }
    }
  });
});

describe('buildingExplain — buildingHpExplain', () => {
  it('says low HP damages and 0 HP destroys the building', () => {
    const text = buildingHpExplain();
    expect(text).toMatch(/damage/i);
    expect(text).toMatch(/destroy/i);
  });

  it('is translated', () => {
    expectTranslated(buildingHpExplain);
  });
});

describe('buildingExplain — upkeepExplain', () => {
  const surcharge = (s: Pick<GameState, 'events'>, id: number, eventId: string, magnitude: number, endTick: number | null = null): void => {
    s.events.activeModifiers.push({
      id, kind: 'upkeep_surcharge', sourceEventId: eventId, role: null, targetId: null,
      category: null, magnitude, startTick: 0, endTick,
    });
  };

  it('with no modifier says upkeep is the base cost per hour', () => {
    const text = upkeepExplain(stateWith());
    expect(text).toMatch(/base/i);
    expect(text).toMatch(/hour/i);
  });

  it('names each source event and its factor', () => {
    const s = stateWith();
    surcharge(s, 1, 'lawsuit_back_taxes', 1.5);
    surcharge(s, 2, 'lawsuit_bad_coffee', 1.2);
    const text = upkeepExplain(s);
    expect(text).toContain(t('event.lawsuit_back_taxes.title'));
    expect(text).toContain(t('event.lawsuit_bad_coffee.title'));
    expect(text.includes('1.5') || text.includes('150')).toBe(true);
    expect(text.includes('1.2') || text.includes('120')).toBe(true);
  });

  it('ignores a surcharge that has lapsed', () => {
    const s = stateWith(100);
    surcharge(s, 1, 'lawsuit_back_taxes', 1.5, 100);
    expect(upkeepExplain(s)).toBe(upkeepExplain(stateWith(100)));
  });

  it('ignores modifiers of other kinds', () => {
    const s = stateWith();
    s.events.activeModifiers.push({
      id: 9, kind: 'work_stoppage', sourceEventId: 'lawsuit_bad_coffee', role: null, targetId: null,
      category: null, magnitude: 0, startTick: 0, endTick: null,
    });
    expect(upkeepExplain(s)).not.toContain(t('event.lawsuit_bad_coffee.title'));
  });

  it('differs once a surcharge is live', () => {
    const s = stateWith();
    const plain = upkeepExplain(s);
    surcharge(s, 1, 'lawsuit_back_taxes', 1.5);
    expect(upkeepExplain(s)).not.toBe(plain);
  });

  it('is translated with and without a surcharge', () => {
    expectTranslated(() => upkeepExplain(stateWith()));
    const s = stateWith();
    surcharge(s, 1, 'lawsuit_back_taxes', 1.5);
    expectTranslated(() => upkeepExplain(s));
  });
});
