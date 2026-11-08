// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { LocaleTextRegistry } from '../../../src/ui/localeText.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';

afterEach(() => setLocale('en'));

describe('LocaleTextRegistry.bindExplain', () => {
  it('sets data-explain to the translation now and marks the element explainable', () => {
    setLocale('en');
    const reg = new LocaleTextRegistry();
    const node = document.createElement('span');
    const out = reg.bindExplain(node, 'ui.crew.ticks_left', { n: 3 });

    expect(out).toBe(node);
    expect(node.getAttribute('data-explain')).toBe(t('ui.crew.ticks_left', { n: 3 }));
    expect(t('ui.crew.ticks_left', { n: 3 })).not.toBe('ui.crew.ticks_left');
    expect(node.getAttribute('tabindex')).toBe('0');
    expect(node.classList.contains('bsx-explainable')).toBe(true);
  });

  it('works without params', () => {
    setLocale('en');
    const reg = new LocaleTextRegistry();
    const node = reg.bindExplain(document.createElement('div'), 'ui.crew.skill_maxed');
    expect(node.getAttribute('data-explain')).toBe(t('ui.crew.skill_maxed'));
  });

  it('follows a language change on refresh()', () => {
    setLocale('en');
    const reg = new LocaleTextRegistry();
    const node = reg.bindExplain(document.createElement('span'), 'ui.crew.ticks_left', { n: 5 });
    const en = node.getAttribute('data-explain');

    setLocale('fr');
    reg.refresh();
    const fr = node.getAttribute('data-explain');

    expect(fr).toBe(t('ui.crew.ticks_left', { n: 5 }));
    expect(fr).not.toBe(en);
    setLocale('en');
    reg.refresh();
    expect(node.getAttribute('data-explain')).toBe(en);
  });

  it('does not touch the element text or title', () => {
    setLocale('en');
    const reg = new LocaleTextRegistry();
    const node = document.createElement('span');
    node.textContent = 'label';
    reg.bindExplain(node, 'ui.crew.skill_maxed');
    expect(node.textContent).toBe('label');
    expect(node.title).toBe('');
  });

  it('keeps independent bindings apart', () => {
    setLocale('en');
    const reg = new LocaleTextRegistry();
    const a = reg.bindExplain(document.createElement('span'), 'ui.crew.ticks_left', { n: 1 });
    const b = reg.bindExplain(document.createElement('span'), 'ui.crew.skill_maxed');
    setLocale('fr');
    reg.refresh();
    expect(a.getAttribute('data-explain')).toBe(t('ui.crew.ticks_left', { n: 1 }));
    expect(b.getAttribute('data-explain')).toBe(t('ui.crew.skill_maxed'));
  });
});
