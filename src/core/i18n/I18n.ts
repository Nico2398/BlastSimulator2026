// BlastSimulator2026 — i18n module
// Pure TypeScript, no side effects, no DOM.
// Usage: t('blast.fragments', { count: 42 }) → "42 fragments detected"

import enLocale from './locales/en.json' assert { type: 'json' };
import frLocale from './locales/fr.json' assert { type: 'json' };

type Locale = 'en' | 'fr';
type Params = Record<string, string | number>;
type LocaleData = Record<string, string>;

const locales: Record<Locale, LocaleData> = {
  en: enLocale as LocaleData,
  fr: frLocale as LocaleData,
};

let currentLocale: Locale = 'en';

/** Get the active locale code. */
export function getLocale(): Locale {
  return currentLocale;
}

/** Switch the active locale for all subsequent t() calls. */
export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

/**
 * Translate a key with optional interpolation.
 * @param key  - dot-separated translation key (e.g. 'blast.fragments')
 * @param params - optional interpolation values ({ count: 42 })
 * @returns translated string, or the key itself if not found
 *
 * Example: t('blast.fragments', { count: 42 }) → "42 fragments detected"
 */
export function t(key: string, params?: Params): string {
  const data = locales[currentLocale];
  const template = data[key];

  if (template === undefined) {
    return key;
  }

  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    return value !== undefined ? String(value) : `{${name}}`;
  });
}
