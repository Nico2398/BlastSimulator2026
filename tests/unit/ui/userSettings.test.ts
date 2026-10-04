// BlastSimulator2026 — persisted player settings (#1324)

import { describe, it, expect } from 'vitest';
import {
  loadSettings,
  saveLocale,
  saveVolume,
  SETTINGS_STORAGE_KEY,
  type SettingsStorage,
} from '../../../src/ui/userSettings.js';

function fakeStorage(initial?: string): SettingsStorage & { raw: () => string | null } {
  let value: string | null = initial ?? null;
  return {
    getItem: (key: string) => (key === SETTINGS_STORAGE_KEY ? value : null),
    setItem: (key: string, v: string) => { if (key === SETTINGS_STORAGE_KEY) value = v; },
    raw: () => value,
  };
}

const throwingStorage: SettingsStorage = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('quota'); },
};

describe('userSettings — storage key', () => {
  it('is bs_settings_v1', () => {
    expect(SETTINGS_STORAGE_KEY).toBe('bs_settings_v1');
  });
});

describe('loadSettings', () => {
  it('returns saved locale and volumes', () => {
    const s = fakeStorage(JSON.stringify({ locale: 'fr', volumes: { master: 0.5, ambient: 0.2 } }));
    expect(loadSettings(s)).toEqual({ locale: 'fr', volumes: { master: 0.5, ambient: 0.2 } });
  });

  it('returns {} when nothing is stored', () => {
    expect(loadSettings(fakeStorage())).toEqual({});
  });

  it('returns {} for corrupt JSON', () => {
    expect(loadSettings(fakeStorage('{not json'))).toEqual({});
  });

  it.each(['[1,2]', '42', '"fr"', 'null', 'true'])('returns {} for non-object JSON %s', (raw) => {
    expect(loadSettings(fakeStorage(raw))).toEqual({});
  });

  it('drops an unknown locale', () => {
    const s = fakeStorage(JSON.stringify({ locale: 'de', volumes: { master: 0.3 } }));
    const out = loadSettings(s);
    expect(out.locale).toBeUndefined();
    expect(out.volumes).toEqual({ master: 0.3 });
  });

  it('drops NaN and string volumes', () => {
    const s = fakeStorage(JSON.stringify({ volumes: { master: 'loud', effects: null, ambient: 0.7, ui: {} } }));
    expect(loadSettings(s).volumes).toEqual({ ambient: 0.7 });
  });

  it('clamps out-of-range volumes to 0..1', () => {
    const s = fakeStorage(JSON.stringify({ volumes: { master: -1, effects: 5 } }));
    expect(loadSettings(s).volumes).toEqual({ master: 0, effects: 1 });
  });

  it('ignores unknown channels', () => {
    const s = fakeStorage(JSON.stringify({ volumes: { bass: 0.9, master: 0.4 } }));
    expect(loadSettings(s).volumes).toEqual({ master: 0.4 });
  });

  it('preserves a volume of 0', () => {
    const s = fakeStorage(JSON.stringify({ volumes: { ui: 0 } }));
    expect(loadSettings(s).volumes).toEqual({ ui: 0 });
  });

  it('does not throw when getItem throws', () => {
    expect(() => loadSettings(throwingStorage)).not.toThrow();
    expect(loadSettings(throwingStorage)).toEqual({});
  });

  it('returns {} for null storage', () => {
    expect(loadSettings(null)).toEqual({});
  });
});

describe('saveLocale / saveVolume', () => {
  it('saveLocale persists the locale under the key', () => {
    const s = fakeStorage();
    saveLocale('fr', s);
    expect(JSON.parse(s.raw()!).locale).toBe('fr');
    expect(loadSettings(s).locale).toBe('fr');
  });

  it('saveVolume stores the 0..1 fraction', () => {
    const s = fakeStorage();
    saveVolume('effects', 0.35, s);
    expect(JSON.parse(s.raw()!).volumes.effects).toBe(0.35);
  });

  it('saveVolume preserves the saved locale and other volumes', () => {
    const s = fakeStorage();
    saveLocale('fr', s);
    saveVolume('master', 0.5, s);
    saveVolume('ui', 0, s);
    expect(loadSettings(s)).toEqual({ locale: 'fr', volumes: { master: 0.5, ui: 0 } });
  });

  it('saveLocale preserves saved volumes', () => {
    const s = fakeStorage();
    saveVolume('ambient', 0.1, s);
    saveLocale('en', s);
    expect(loadSettings(s)).toEqual({ locale: 'en', volumes: { ambient: 0.1 } });
  });

  it('saving over corrupt JSON recovers', () => {
    const s = fakeStorage('garbage');
    saveLocale('fr', s);
    expect(loadSettings(s)).toEqual({ locale: 'fr' });
  });

  it('never throws when setItem/getItem throw', () => {
    expect(() => saveLocale('fr', throwingStorage)).not.toThrow();
    expect(() => saveVolume('master', 0.5, throwingStorage)).not.toThrow();
  });

  it('never throws with null storage', () => {
    expect(() => saveLocale('fr', null)).not.toThrow();
    expect(() => saveVolume('master', 0.5, null)).not.toThrow();
  });
});
