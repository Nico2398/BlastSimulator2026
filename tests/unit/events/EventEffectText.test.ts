import { describe, it, expect } from 'vitest';
import { effectChips, effectChipText } from '../../../src/core/events/EventEffectText.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import type { EventEffect } from '../../../src/core/events/EventSystem.js';

describe('effectChips', () => {
  it('returns no chips for undefined specs', () => {
    expect(effectChips(undefined)).toEqual([]);
  });

  it('returns no chips for an empty list', () => {
    expect(effectChips([])).toEqual([]);
  });

  it('keeps numeric and string fields as params and drops the type', () => {
    const [chip] = effectChips([{ type: 'ban', what: 'blast', hours: 6 }]);
    expect(chip!.params).toEqual({ what: 'blast', hours: 6 });
    expect(chip!.textKey).toBe('ui.event.effect.ban');
  });

  it('scopes a role-limited spec to its role', () => {
    const [chip] = effectChips([{ type: 'work_stoppage', hours: 4, role: 'driller' }]);
    expect(chip!.params!['scope']).toBe('driller');
  });

  it('scopes a spec without role to everyone', () => {
    const [chip] = effectChips([{ type: 'work_rate', pct: -20, hours: 4 }]);
    expect(chip!.params!['scope']).toBe('all');
  });

  it('uses the permanent key for a salary with null days', () => {
    const [chip] = effectChips([{ type: 'salary', pct: 10, days: null }]);
    expect(chip!.textKey).toBe('ui.event.effect.salary_permanent');
  });

  it('uses the plain key for a timed salary', () => {
    const [chip] = effectChips([{ type: 'salary', pct: 10, days: 5 }]);
    expect(chip!.textKey).toBe('ui.event.effect.salary');
  });

  it('gives employee_joins a default role when none is set', () => {
    const [chip] = effectChips([{ type: 'employee_joins' }]);
    expect(typeof chip!.params!['role']).toBe('string');
  });

  it('keeps the explicit role of employee_joins', () => {
    const [chip] = effectChips([{ type: 'employee_joins', role: 'surveyor' }]);
    expect(chip!.params!['role']).toBe('surveyor');
  });
});

describe('effectChips with a leaver (#1908)', () => {
  const spec = { type: 'employee_leaves', pick: 'random' } as const;

  it('names the leaver and role', () => {
    const [chip] = effectChips([spec], { name: 'Ada Quill', role: 'driller' });
    expect(chip!.textKey).toBe('ui.event.effect.employee_leaves_named');
    expect(chip!.params).toEqual({ name: 'Ada Quill', role: 'driller' });
  });

  it("uses the nobody key for 'nobody'", () => {
    const [chip] = effectChips([spec], 'nobody');
    expect(chip!.textKey).toBe('ui.event.effect.employee_leaves_nobody');
  });

  it('keeps the generic chip without a leaver', () => {
    const [chip] = effectChips([spec]);
    expect(chip!.textKey).toBe('ui.event.effect.employee_leaves');
    expect(chip!.params).toEqual({ pick: 'random' });
  });

  it('leaves non-leave specs untouched', () => {
    const [chip] = effectChips([{ type: 'ban', what: 'blast', hours: 6 }], { name: 'Ada', role: 'driller' });
    expect(chip!.textKey).toBe('ui.event.effect.ban');
  });

  it('applies the leaver to every employee_leaves spec only', () => {
    const chips = effectChips([{ type: 'work_stoppage', hours: 1 }, spec], 'nobody');
    expect(chips.map(c => c.textKey)).toEqual(['ui.event.effect.work_stoppage', 'ui.event.effect.employee_leaves_nobody']);
  });

  it('renders the named sentence in English', () => {
    const [chip] = effectChips([spec], { name: 'Ada Quill', role: 'driller' });
    const text = effectChipText(chip!);
    expect(text).toContain('Ada Quill');
    expect(text).toContain('quits the crew.');
    expect(text).not.toContain('{');
  });

  it('renders the nobody sentence in English', () => {
    const [chip] = effectChips([spec], 'nobody');
    expect(effectChipText(chip!)).toBe('Nobody is left to quit.');
  });

  it('renders both sentences in French', () => {
    setLocale('fr');
    try {
      const [named] = effectChips([spec], { name: 'Ada Quill', role: 'driller' });
      expect(effectChipText(named!)).toContain("quitte l'équipe.");
      expect(effectChipText(effectChips([spec], 'nobody')[0]!)).toBe('Personne ne reste pour partir.');
    } finally {
      setLocale('en');
    }
  });
});

describe('effectChipText', () => {
  it('is undefined without a textKey', () => {
    expect(effectChipText({ kind: 'other', key: 'x', delta: 0 })).toBeUndefined();
  });

  it('returns the bare template when no params exist', () => {
    const e: EventEffect = { kind: 'other', key: 'x', delta: 0, textKey: 'ui.modifier.permanent' };
    expect(effectChipText(e)).toBe('permanent');
  });

  it('localizes a scope of all', () => {
    const [chip] = effectChips([{ type: 'salary', pct: 10, days: 5 }]);
    expect(effectChipText(chip!)).toBe('Salaries change by 10% for 5 days (all staff).');
  });

  it('localizes a role scope through the role namespace', () => {
    const [chip] = effectChips([{ type: 'salary', pct: 10, days: null, role: 'driller' }]);
    const text = effectChipText(chip!)!;
    expect(text).not.toContain('role.driller');
    expect(text).not.toContain('{scope}');
  });

  it('localizes namespaced string params', () => {
    const [chip] = effectChips([{ type: 'forced_weather', weather: 'storm', hours: 3 }]);
    const text = effectChipText(chip!)!;
    expect(text).toContain('Storm');
    expect(text).toContain('3h');
  });

  it('formats money params', () => {
    const text = effectChipText({
      kind: 'other', key: 'x', delta: 0, textKey: 'ui.event.effect.bonus_per_employee',
      params: { amount: 1234 },
    } as EventEffect)!;
    expect(text).toContain('1,234');
  });

  it('passes through plain numbers and unnamespaced strings', () => {
    const text = effectChipText({
      kind: 'other', key: 'x', delta: 0, textKey: 'ui.event.effect.ban',
      params: { hours: 7, other: 'abc' },
    } as EventEffect)!;
    expect(text).toContain('7');
  });
});
