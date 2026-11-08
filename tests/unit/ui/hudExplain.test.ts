// BlastSimulator2026 — Unit tests: HUD explanation texts (#2169)
import { describe, it, expect, afterEach } from 'vitest';
import {
  modifierExplain, weatherExplain, boardExplain, minimapLayerExplain,
} from '../../../src/ui/hudExplain.js';
import type { ActiveModifier, ModifierKind } from '../../../src/core/events/ActiveModifiers.js';
import { ALL_WEATHER_STATES } from '../../../src/core/weather/WeatherCycle.js';
import { MINIMAP_LAYERS } from '../../../src/ui/miniMapLayers.js';
import { formatGameClock } from '../../../src/ui/formatGameClock.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import { BOARD_CONFIDENCE_MET_GAIN, BOARD_CONFIDENCE_MISS_PENALTY } from '../../../src/core/config/balance.js';
import { mod } from '../../helpers/eventEffectWorld.js';

afterEach(() => setLocale('en'));

const ALL_KINDS: readonly ModifierKind[] = [
  'work_stoppage', 'work_rate', 'morale_drift', 'salary_factor', 'recurring_charge',
  'blast_ban', 'haul_pause', 'drill_ban', 'survey_cost', 'research_cost',
  'contract_price', 'explosive_price', 'upkeep_surcharge', 'forced_weather',
  'event_weight', 'out_of_service', 'permit_delay',
];

function modifier(kind: ModifierKind, extra: Partial<Omit<ActiveModifier, 'id' | 'kind'>> = {}): ActiveModifier {
  const base: Partial<Omit<ActiveModifier, 'id' | 'kind'>> = { magnitude: 1.25, endTick: 200 };
  if (kind === 'event_weight') base.category = 'union';
  if (kind === 'out_of_service') { base.targetId = 3; base.targetKind = 'vehicle'; }
  if (kind === 'forced_weather') base.magnitude = 1;
  return { id: 1, ...mod({ kind, ...base, ...extra }) };
}

/** A bare i18n key leaking through t() when a translation is missing. */
const looksLikeKey = (s: string): boolean => /^[a-z_]+(\.[a-z_0-9]+)+$/.test(s.trim());

describe('modifierExplain (#2169)', () => {
  for (const kind of ALL_KINDS) {
    it(`${kind}: non-empty translated text, never a bare key`, () => {
      const text = modifierExplain(modifier(kind), 10);
      expect(text.trim().length).toBeGreaterThan(5);
      expect(looksLikeKey(text)).toBe(false);
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('NaN');
    });
  }

  it('every kind reads differently from every other', () => {
    const texts = new Set(ALL_KINDS.map(k => modifierExplain(modifier(k), 10)));
    expect(texts.size).toBe(ALL_KINDS.length);
  });

  it('a timed modifier states the game clock of its end', () => {
    const text = modifierExplain(modifier('work_stoppage', { endTick: 100 }), 10);
    expect(text).toContain(formatGameClock(100));
  });

  it('a different end tick gives a different clock in the text', () => {
    const a = modifierExplain(modifier('blast_ban', { endTick: 100 }), 10);
    const b = modifierExplain(modifier('blast_ban', { endTick: 150 }), 10);
    expect(a).not.toBe(b);
    expect(b).toContain(formatGameClock(150));
    expect(b).not.toContain(formatGameClock(100));
  });

  it('a permanent modifier says it is permanent and names no end clock', () => {
    const text = modifierExplain(modifier('salary_factor', { endTick: null }), 10);
    expect(text).toMatch(/permanent/i);
    expect(text).not.toContain(formatGameClock(200));
  });

  it('a permanent and a timed modifier of one kind read differently', () => {
    expect(modifierExplain(modifier('work_rate', { endTick: null }), 10))
      .not.toBe(modifierExplain(modifier('work_rate', { endTick: 200 }), 10));
  });

  it('a role-limited modifier names the role', () => {
    const text = modifierExplain(modifier('work_stoppage', { role: 'driller' }), 10);
    expect(text).toContain(t('role.driller'));
  });

  it('an unrestricted modifier does not name a role', () => {
    const text = modifierExplain(modifier('work_stoppage', { role: null }), 10);
    for (const role of ['driller', 'blaster', 'driver', 'surveyor', 'manager']) {
      expect(text).not.toContain(t(`role.${role}`));
    }
  });

  it('is translated: differs between en and fr', () => {
    setLocale('en');
    const en = modifierExplain(modifier('haul_pause'), 10);
    setLocale('fr');
    const fr = modifierExplain(modifier('haul_pause'), 10);
    expect(fr.trim().length).toBeGreaterThan(5);
    expect(fr).not.toBe(en);
    expect(looksLikeKey(fr)).toBe(false);
  });
});

describe('weatherExplain (#2169)', () => {
  for (const weather of ALL_WEATHER_STATES) {
    it(`${weather}: names the weather and its effect`, () => {
      const text = weatherExplain(weather);
      expect(text).toContain(t(`hud.weather.${weather}`));
      expect(text).toContain(t(`ui.weather.effect.${weather}`));
    });
  }

  it('each weather reads differently', () => {
    expect(new Set(ALL_WEATHER_STATES.map(w => weatherExplain(w))).size).toBe(ALL_WEATHER_STATES.length);
  });

  it('follows the locale', () => {
    setLocale('en');
    const en = weatherExplain('storm');
    setLocale('fr');
    const fr = weatherExplain('storm');
    expect(fr).not.toBe(en);
    expect(fr).toContain(t('hud.weather.storm'));
    expect(fr).toContain(t('ui.weather.effect.storm'));
  });
});

describe('boardExplain (#2169)', () => {
  it('states the confidence gain and the miss penalty from balance', () => {
    const text = boardExplain();
    expect(text).toContain(String(BOARD_CONFIDENCE_MET_GAIN));
    expect(text).toContain(String(BOARD_CONFIDENCE_MISS_PENALTY));
  });

  it('is non-empty translated text that differs between en and fr', () => {
    setLocale('en');
    const en = boardExplain();
    setLocale('fr');
    const fr = boardExplain();
    expect(en.trim().length).toBeGreaterThan(10);
    expect(looksLikeKey(en)).toBe(false);
    expect(fr).not.toBe(en);
    expect(fr).toContain(String(BOARD_CONFIDENCE_MET_GAIN));
    expect(fr).toContain(String(BOARD_CONFIDENCE_MISS_PENALTY));
  });
});

describe('minimapLayerExplain (#2169)', () => {
  for (const layer of MINIMAP_LAYERS) {
    it(`${layer.id}: non-empty translated text`, () => {
      const text = minimapLayerExplain(layer.id);
      expect(text.trim().length).toBeGreaterThan(5);
      expect(looksLikeKey(text)).toBe(false);
    });
  }

  it('every layer reads differently', () => {
    expect(new Set(MINIMAP_LAYERS.map(l => minimapLayerExplain(l.id))).size).toBe(MINIMAP_LAYERS.length);
  });

  it('follows the locale', () => {
    setLocale('en');
    const en = MINIMAP_LAYERS.map(l => minimapLayerExplain(l.id));
    setLocale('fr');
    const fr = MINIMAP_LAYERS.map(l => minimapLayerExplain(l.id));
    fr.forEach((text, i) => expect(text).not.toBe(en[i]));
  });
});
