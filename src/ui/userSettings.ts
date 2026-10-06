// BlastSimulator2026 — persisted player settings (locale, audio volumes).

import type { Locale } from '../core/i18n/I18n.js';
import type { VolumeChannel } from '../audio/AudioManager.js';
import { AUDIO_DEFAULT_VOLUMES } from '../core/config/balance.js';
import { resolveStorage } from '../persistence/browserStorage.js';

export const SETTINGS_STORAGE_KEY = 'bs_settings_v1';

interface StoredSettings {
  locale?: Locale;
  volumes?: Partial<Record<VolumeChannel, number>>;
}

export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

const VOLUME_CHANNELS = Object.keys(AUDIO_DEFAULT_VOLUMES) as VolumeChannel[];

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function loadSettings(storage?: SettingsStorage | null): StoredSettings {
  try {
    const store = resolveStorage(storage);
    const raw = store?.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const data = parsed as { locale?: unknown; volumes?: unknown };
    const out: StoredSettings = {};
    if (data.locale === 'en' || data.locale === 'fr') out.locale = data.locale;
    if (typeof data.volumes === 'object' && data.volumes !== null && !Array.isArray(data.volumes)) {
      const src = data.volumes as Record<string, unknown>;
      const volumes: Partial<Record<VolumeChannel, number>> = {};
      for (const ch of VOLUME_CHANNELS) {
        const v = src[ch];
        if (typeof v === 'number' && Number.isFinite(v)) volumes[ch] = clampVolume(v);
      }
      out.volumes = volumes;
    }
    return out;
  } catch {
    return {};
  }
}

function writeSettings(update: (s: StoredSettings) => void, storage?: SettingsStorage | null): void {
  try {
    const store = resolveStorage(storage);
    if (!store) return;
    const current = loadSettings(store);
    update(current);
    store.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // storage blocked or full — settings simply do not persist
  }
}

export function saveLocale(locale: Locale, storage?: SettingsStorage | null): void {
  writeSettings(s => { s.locale = locale; }, storage);
}

export function saveVolume(channel: VolumeChannel, value: number, storage?: SettingsStorage | null): void {
  if (!Number.isFinite(value)) return;
  writeSettings(s => { s.volumes = { ...s.volumes, [channel]: clampVolume(value) }; }, storage);
}
