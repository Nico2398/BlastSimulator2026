// @vitest-environment jsdom
// BlastSimulator2026 — syncLangPills unit tests (#492 section 2)
//
// Pure DOM helper: given an EN/FR pill pair and the active Locale, exactly
// the matching pill ends up with the `active` class. Both MainMenu and
// SettingsPanel are expected to route their pill toggling through this
// single function instead of each carrying its own copy — so a defect here
// would surface as a failure in every caller's behavioral tests too.

import { describe, it, expect, beforeEach } from 'vitest';
import { syncLangPills } from '../../../src/ui/langPills.js';

describe('syncLangPills', () => {
  let enPill: HTMLElement;
  let frPill: HTMLElement;

  beforeEach(() => {
    enPill = document.createElement('button');
    frPill = document.createElement('button');
  });

  it('marks only the EN pill active when locale is en', () => {
    syncLangPills(enPill, frPill, 'en');
    expect(enPill.classList.contains('active')).toBe(true);
    expect(frPill.classList.contains('active')).toBe(false);
  });

  it('marks only the FR pill active when locale is fr', () => {
    syncLangPills(enPill, frPill, 'fr');
    expect(frPill.classList.contains('active')).toBe(true);
    expect(enPill.classList.contains('active')).toBe(false);
  });

  it('re-syncing after a locale change removes the previously active pill (boundary: repeated calls)', () => {
    syncLangPills(enPill, frPill, 'en');
    syncLangPills(enPill, frPill, 'fr');
    expect(enPill.classList.contains('active')).toBe(false);
    expect(frPill.classList.contains('active')).toBe(true);
  });

  it('does not touch unrelated classes already present on the pills', () => {
    enPill.classList.add('bsx-menu-lang-pill');
    frPill.classList.add('bsx-menu-lang-pill');
    syncLangPills(enPill, frPill, 'en');
    expect(enPill.classList.contains('bsx-menu-lang-pill')).toBe(true);
    expect(frPill.classList.contains('bsx-menu-lang-pill')).toBe(true);
  });
});
