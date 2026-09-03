// @vitest-environment jsdom
// BlastSimulator2026 — ParamStrip, the armed-placement bottom strip
//
// 183 statements with no test at all: the module sat under vitest.config.ts's
// `src/ui/**` coverage exclusion, so neither the coverage gate nor the suite
// had anything to say about it. Three callers drive it (Drill step, BuildMenu,
// SurveyPanel) through PlacementKit.
//
// The behaviour worth pinning is not the styling — it is the signature-gated
// rebuild (show() called every frame must not rebuild the DOM under a player's
// cursor), the refusal reason reaching the screen rather than only a tooltip
// (#489), and the selectors scenarios target: [data-field], the preserved
// #bs-tile-select-confirm id, and #bs-param-strip-reason.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ParamStrip, type ParamStripConfig } from '../../../../src/ui/scene/ParamStrip.js';

function makeConfig(over: Partial<ParamStripConfig> = {}): ParamStripConfig {
  return {
    icon: 'drill',
    title: 'DRILL GRID',
    subtitle: '3 × 4',
    fields: [],
    result: '12 holes · $2,400',
    confirmEnabled: true,
    instruction: 'Drag across the bench',
    ...over,
  };
}

function field(key: string, value: number, over: Partial<ParamStripConfig['fields'][number]> = {}) {
  return { key, label: key.toUpperCase(), value, onDec: vi.fn(), onInc: vi.fn(), ...over };
}

describe('ParamStrip', () => {
  let container: HTMLElement;
  let strip: ParamStrip;

  beforeEach(() => {
    document.body.replaceChildren();
    container = document.createElement('div');
    document.body.appendChild(container);
    strip = new ParamStrip(container);
  });

  const root = () => container.querySelector('#bs-param-strip') as HTMLElement;
  const bar = () => container.querySelector('#bs-param-strip-bar') as HTMLElement;
  const reason = () => container.querySelector('#bs-param-strip-reason') as HTMLElement;
  const confirm = () => container.querySelector('#bs-tile-select-confirm') as HTMLButtonElement;

  it('mounts hidden, so an unarmed tool shows nothing', () => {
    expect(root()).not.toBeNull();
    expect(root().style.display).toBe('none');
  });

  it('shows on show() and hides again on hide()', () => {
    strip.show(makeConfig());
    expect(root().style.display).toBe('flex');
    strip.hide();
    expect(root().style.display).toBe('none');
  });

  it('renders the title, subtitle, result and instruction it is handed', () => {
    strip.show(makeConfig());
    expect(bar().textContent).toContain('DRILL GRID');
    expect(bar().textContent).toContain('3 × 4');
    expect(bar().textContent).toContain('12 holes · $2,400');
    expect(root().textContent).toContain('Drag across the bench');
  });

  it('gives every field a [data-field] hook a click-only scenario can target', () => {
    strip.show(makeConfig({ fields: [field('spacing', 4), field('depth', 6)] }));
    expect([...bar().querySelectorAll('[data-field]')].map(e => e.getAttribute('data-field')))
      .toEqual(['spacing', 'depth']);
  });

  it('renders no field blocks for a variant with nothing to tune', () => {
    strip.show(makeConfig({ fields: [] }));
    expect(bar().querySelectorAll('[data-field]')).toHaveLength(0);
  });

  it('applies a field format function to the displayed value', () => {
    strip.show(makeConfig({ fields: [field('depth', 6, { format: (v: number) => `${v.toFixed(1)} m` })] }));
    expect(bar().querySelector('[data-field="depth"]')!.textContent).toContain('6.0 m');
  });

  it('fires the caller handlers from Confirm and ESC', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    strip.setConfirmHandler(onConfirm);
    strip.setCancelHandler(onCancel);
    strip.show(makeConfig());

    confirm().click();
    expect(onConfirm).toHaveBeenCalledTimes(1);

    const buttons = [...bar().querySelectorAll('button')];
    buttons[buttons.length - 1]!.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables Confirm when the caller says the action is not available', () => {
    strip.show(makeConfig({ confirmEnabled: false }));
    expect(confirm().disabled).toBe(true);
  });

  // #489: a refusal hung only on the button's `title` needs a hover the player
  // has no reason to attempt, so it reached the screen as nothing at all.
  it('renders a disabled reason as visible text, not just a tooltip', () => {
    strip.show(makeConfig({ confirmEnabled: false, confirmDisabledReason: 'No driller on site' }));
    expect(reason().textContent).toBe('No driller on site');
    expect(reason().style.display).toBe('block');
  });

  it('hides the reason line once Confirm is available again', () => {
    strip.show(makeConfig({ confirmEnabled: false, confirmDisabledReason: 'No driller on site' }));
    strip.show(makeConfig({ confirmEnabled: true, confirmDisabledReason: 'No driller on site' }));
    expect(reason().style.display).toBe('none');
    expect(reason().textContent).toBe('');
  });

  it('colours the result differently when it warns', () => {
    strip.show(makeConfig({ result: '$9,000', resultWarn: true }));
    const warned = bar().innerHTML;
    strip.show(makeConfig({ result: '$9,000', resultWarn: false }));
    expect(bar().innerHTML).not.toBe(warned);
  });

  // show() runs every frame while a tool is armed. Rebuilding each time would
  // replace the DOM under the player's cursor mid-drag.
  it('does not rebuild when nothing in the config changed', () => {
    strip.show(makeConfig({ fields: [field('spacing', 4)] }));
    const before = bar().firstElementChild;
    strip.show(makeConfig({ fields: [field('spacing', 4)] }));
    expect(bar().firstElementChild).toBe(before);
  });

  it('rebuilds when a field value changes', () => {
    strip.show(makeConfig({ fields: [field('spacing', 4)] }));
    const before = bar().firstElementChild;
    strip.show(makeConfig({ fields: [field('spacing', 5)] }));
    expect(bar().firstElementChild).not.toBe(before);
  });

  it('rebuilds after hide(), since the strip was torn down in between', () => {
    strip.show(makeConfig());
    const before = bar().firstElementChild;
    strip.hide();
    strip.show(makeConfig());
    expect(bar().firstElementChild).not.toBe(before);
  });

  it('rebuilds on the next show() after refreshLocale(), for a language switch', () => {
    strip.show(makeConfig());
    const before = bar().firstElementChild;
    strip.refreshLocale();
    strip.show(makeConfig());
    expect(bar().firstElementChild).not.toBe(before);
  });

  it('dispose() takes the strip off the page', () => {
    strip.dispose();
    expect(container.querySelector('#bs-param-strip')).toBeNull();
  });
});
