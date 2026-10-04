// BlastSimulator2026 — persisted player settings (locale, audio volumes).

import type { Locale } from '../core/i18n/I18n.js';
import type { VolumeChannel } from '../audio/AudioManager.js';

export const SETTINGS_STORAGE_KEY = 'bs_settings_v1';

export interface StoredSettings {
  locale?: Locale;
  volumes?: Partial<Record<VolumeChannel, number>>;
}

export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function loadSettings(_storage?: SettingsStorage | null): StoredSettings {
  // TODO: implement
  return {};
}

export function saveLocale(_locale: Locale, _storage?: SettingsStorage | null): void {
  // TODO: implement
}

export function saveVolume(_channel: VolumeChannel, _value: number, _storage?: SettingsStorage | null): void {
  // TODO: implement
}
