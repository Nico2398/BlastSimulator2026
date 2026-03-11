import { describe, it, expect, beforeEach } from 'vitest';
import { t, setLocale, getLocale } from '../../src/core/i18n/I18n.js';

beforeEach(() => {
  setLocale('en');
});

describe('i18n — locale management', () => {
  it('default locale is en', () => {
    expect(getLocale()).toBe('en');
  });

  it('setLocale changes locale', () => {
    setLocale('fr');
    expect(getLocale()).toBe('fr');
  });

  it('switching locale changes all subsequent t() calls', () => {
    setLocale('en');
    expect(t('game.subtitle')).toBe('Dig. Blast. Profit.');
    setLocale('fr');
    expect(t('game.subtitle')).toBe('Creuse. Explose. Profite.');
    setLocale('en');
    expect(t('game.subtitle')).toBe('Dig. Blast. Profit.');
  });
});

describe('i18n — translations', () => {
  it('game.title is untranslated brand name in both locales', () => {
    setLocale('en');
    expect(t('game.title')).toBe('BlastSimulator2026');
    setLocale('fr');
    expect(t('game.title')).toBe('BlastSimulator2026');
  });

  it('game.subtitle is translated in en', () => {
    setLocale('en');
    expect(t('game.subtitle')).toBe('Dig. Blast. Profit.');
  });

  it('game.subtitle is translated in fr', () => {
    setLocale('fr');
    expect(t('game.subtitle')).toBe('Creuse. Explose. Profite.');
  });
});

describe('i18n — interpolation', () => {
  it('t() with numeric parameter interpolates correctly', () => {
    setLocale('en');
    expect(t('blast.fragments', { count: 42 })).toBe('42 fragments detected');
  });

  it('t() with string parameter interpolates correctly', () => {
    setLocale('en');
    expect(t('test.greeting', { name: 'Bob' })).toBe('Hello, Bob!');
  });

  it('t() with missing key returns the key itself', () => {
    const result = t('nonexistent.key');
    expect(result).toBe('nonexistent.key');
  });
});
