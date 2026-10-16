// Building inspector money and prerequisite i18n keys (#1820)
import { describe, it, expect } from 'vitest';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';

const E = en as Record<string, string>;
const F = fr as Record<string, string>;

const NEW_KEYS: Record<string, string[]> = {
  'inspector.action.cost_label': ['action', 'cost'],
  'inspector.reason.research_no_center': [],
  'inspector.reason.research_needs_tier': ['tier'],
  'inspector.wait.no_vehicle': ['role'],
  'inspector.wait.no_driver': ['role'],
};

describe('building inspector i18n keys (#1820)', () => {
  for (const [key, params] of Object.entries(NEW_KEYS)) {
    it(`${key} exists in en and fr, differs, and keeps its placeholders`, () => {
      expect(typeof E[key], key).toBe('string');
      expect(typeof F[key], key).toBe('string');
      expect(E[key]).not.toBe(F[key]);
      for (const p of params) {
        expect(E[key]).toContain(`{${p}}`);
        expect(F[key]).toContain(`{${p}}`);
      }
    });
  }

  it('the English strings carry the dollar sign before the amount', () => {
    expect(E['inspector.upkeep_value']).toBe('${cost}/h');
    expect(E['inspector.action.cost_label']).toBe('{action} · ${cost}');
    expect(E['inspector.action.research_cost']).toContain('${cost}');
    expect(E['inspector.reason.cash']).toContain('${need}');
    expect(E['inspector.reason.cash']).toContain('${have}');
    expect(E['inspector.research_pending']).toContain('${cost}');
    expect(E['inspector.course_row']).toContain('${fee}');
  });

  it('the French strings place the sign after the amount', () => {
    expect(F['inspector.upkeep_value']).toBe('{cost} $ par h');
    expect(F['inspector.action.cost_label']).toContain('{cost} $');
    expect(F['inspector.action.research_cost']).toContain('{cost} $');
    expect(F['inspector.reason.cash']).toContain('{need} $');
    expect(F['inspector.reason.cash']).toContain('{have} $');
    expect(F['inspector.research_pending']).toContain('{cost} $');
    expect(F['inspector.course_row']).toContain('{fee} $');
  });
});
