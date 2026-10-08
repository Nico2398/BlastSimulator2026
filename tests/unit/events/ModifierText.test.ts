import { describe, it, expect } from 'vitest';
import type { ActiveModifier } from '../../../src/core/events/ActiveModifiers.js';
import { modifierSummary } from '../../../src/core/events/ModifierText.js';

function mod(over: Partial<ActiveModifier>): ActiveModifier {
  return {
    id: 1, kind: 'work_rate', sourceEventId: 'e', role: null, targetId: null,
    category: null, magnitude: 1.5, startTick: 0, endTick: 100, ...over,
  };
}

describe('modifierSummary', () => {
  it('shows factor with two decimals and hours left', () => {
    const s = modifierSummary(mod({}), 88);
    expect(s).toContain('×1.50');
    expect(s).toContain('12h');
  });

  it('shows permanent marker when endTick is null', () => {
    expect(modifierSummary(mod({ endTick: null }), 5)).toContain('permanent');
  });

  it('prefixes positive morale drift with a plus', () => {
    expect(modifierSummary(mod({ kind: 'morale_drift', magnitude: 2 }), 0)).toContain('+2');
  });

  it('shows negative morale drift without a plus', () => {
    const s = modifierSummary(mod({ kind: 'morale_drift', magnitude: -3 }), 0);
    expect(s).toContain('-3');
    expect(s).not.toContain('+');
  });

  it('formats recurring charge as money', () => {
    expect(modifierSummary(mod({ kind: 'recurring_charge', magnitude: 500 }), 0)).toContain('500');
  });

  it('names the held weather', () => {
    const s = modifierSummary(mod({ kind: 'forced_weather', magnitude: 0 }), 0);
    expect(s).not.toContain('×');
    expect(s).not.toContain('{value}');
  });

  it('falls back to sunny for an out-of-range weather index', () => {
    const a = modifierSummary(mod({ kind: 'forced_weather', magnitude: 999 }), 0);
    expect(a).not.toContain('undefined');
    expect(a).not.toContain('{value}');
  });

  it('shows event category and weight', () => {
    const s = modifierSummary(mod({ kind: 'event_weight', category: 'union', magnitude: 2 }), 0);
    expect(s).toContain('Union ×2.00');
  });

  it('defaults event_weight category to union when null', () => {
    expect(modifierSummary(mod({ kind: 'event_weight', category: null, magnitude: 1 }), 0)).toContain('×1.00');
  });

  it.each(['work_stoppage', 'blast_ban', 'haul_pause', 'drill_ban', 'out_of_service'] as const)(
    '%s label carries no value',
    kind => {
      const s = modifierSummary(mod({ kind }), 0);
      expect(s).not.toContain('×');
      expect(s).not.toContain('{value}');
    },
  );

  it('appends the role when limited to one', () => {
    const s = modifierSummary(mod({ kind: 'work_stoppage', role: 'driller' }), 0);
    expect(s).toMatch(/\(.+\)/);
  });

  it('omits role suffix when for everyone', () => {
    expect(modifierSummary(mod({ kind: 'work_stoppage' }), 0)).not.toMatch(/\(.+\)/);
  });
});
