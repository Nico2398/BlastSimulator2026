// @vitest-environment jsdom
// BlastSimulator2026 — Interface sounds by DOM delegation
// Real DOM events against a DOM built with the repo's own button() factory, asserting on what a
// recording player was asked to play. Nothing here can hear anything; it proves which cue each control
// requests, the rate limits, the silences and the lifecycle.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installUiSounds, type UiSoundOptions } from '../../../../src/audio/ui/installUiSounds.js';
import { UI_SOUND_CONFIG } from '../../../../src/core/config/audio/ui.js';
import { button, el } from '../../../../src/ui/dom.js';
import { RecordingPlayer } from './recordingPlayer.js';

let player: RecordingPlayer;
let now: number;
let dispose: () => void;
let root: HTMLElement;

function install(options: UiSoundOptions = {}): void {
  dispose = installUiSounds(document, player, { now: () => now, ...options });
}

function mount<T extends HTMLElement>(node: T, parent: HTMLElement = root): T {
  parent.appendChild(node);
  return node;
}

function click(target: Element): MouseEvent {
  const e = new MouseEvent('click', { bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

function pointer(type: 'pointerdown' | 'pointerover', target: Element, buttons = 0): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, buttons }));
}

function slider(value: string, attrs: Record<string, string> = {}): HTMLInputElement {
  const input = el('input', { attrs: { type: 'range', ...attrs } });
  input.value = value;
  return mount(input);
}

beforeEach(() => {
  player = new RecordingPlayer();
  now = 1000;
  root = document.createElement('div');
  document.body.appendChild(root);
  document.body.className = '';
  install();
});

afterEach(() => {
  dispose();
  root.remove();
});

describe('click tone', () => {
  it('plays the plain click for an ordinary button, also when the child span was hit', () => {
    const btn = mount(button('ghost', 'Open'));
    click(btn);
    click(btn.querySelector('span')!);
    expect(player.ids).toEqual(['ui_click', 'ui_click']);
  });

  it('confirms on a primary button', () => {
    click(mount(button('primary', 'Hire')));
    expect(player.ids).toEqual(['ui_confirm']);
  });

  it.each(['danger', 'danger-solid'] as const)('lowers and softens the click on a %s button', variant => {
    click(mount(button(variant, 'Fire')));
    expect(player.calls).toEqual([{
      id: 'ui_click',
      opts: { pitchCents: UI_SOUND_CONFIG.dangerPitchCents, gainDb: UI_SOUND_CONFIG.dangerGainDb },
    }]);
  });

  it('denies a locked (enabled but unavailable) button', () => {
    click(mount(button('locked', 'Research')));
    expect(player.ids).toEqual(['ui_denied']);
  });

  it('keeps the warn variant on the plain click', () => {
    click(mount(button('warn', 'Careful')));
    expect(player.ids).toEqual(['ui_click']);
  });

  it('follows the state a toggle is about to take, not the one it has', () => {
    const toggle = mount(button('ghost', 'Layer'));
    toggle.setAttribute('aria-pressed', 'false');
    click(toggle);
    toggle.setAttribute('aria-pressed', 'true');
    click(toggle);
    expect(player.ids).toEqual(['ui_toggle_on', 'ui_toggle_off']);
  });

  it('treats a language pill as a tab', () => {
    click(mount(el('button', { attrs: { 'data-lang': 'fr' } })));
    expect(player.ids).toEqual(['ui_tab']);
  });

  it.each([
    ['rail panel button', { 'data-panel': 'build' }],
    ['panel close button', { 'data-panel-close': '' }],
    ['speed button', { 'data-speed': '4' }],
    ['pause button', { 'data-action': 'pause-toggle' }],
  ])('stays silent on a %s, whose sound comes from elsewhere', (_label, attrs) => {
    const btn = mount(el('button', { attrs }));
    btn.setAttribute('aria-pressed', 'true');
    click(btn);
    expect(player.calls).toEqual([]);
  });

  it('clicks a [role=button] and a select, and ignores everything else', () => {
    click(mount(el('div', { attrs: { role: 'button' } })));
    click(mount(el('select')));
    click(mount(el('div')));
    click(document.body);
    expect(player.ids).toEqual(['ui_click', 'ui_click']);
  });

  it('ignores a click on a range input', () => {
    click(slider('50'));
    expect(player.calls).toEqual([]);
  });
});

describe('data-sfx override', () => {
  it('mutes a control with none, whatever its variant', () => {
    const btn = mount(button('locked', 'Quiet'));
    btn.setAttribute('data-sfx', 'none');
    click(btn);
    expect(player.calls).toEqual([]);
  });

  it('swaps the tone for an allowed cue id, ahead of the inferred one', () => {
    const btn = mount(button('primary', 'Back'));
    btn.setAttribute('data-sfx', 'ui_back');
    btn.setAttribute('aria-pressed', 'true');
    click(btn);
    expect(player.ids).toEqual(['ui_back']);
  });

  it('applies to every control inside a marked ancestor', () => {
    const group = mount(el('div', { attrs: { 'data-sfx': 'none' } }));
    click(mount(button('ghost', 'Inside'), group));
    expect(player.calls).toEqual([]);
  });

  it('ignores a value that is not an allowed cue and infers the tone instead', () => {
    const btn = mount(button('primary', 'Odd'));
    btn.setAttribute('data-sfx', 'blast_boom');
    click(btn);
    expect(player.ids).toEqual(['ui_confirm']);
  });
});

describe('disabled controls', () => {
  it('denies a press on a disabled button, from pointerdown', () => {
    pointer('pointerdown', mount(button('primary', 'No funds', { disabled: true })));
    expect(player.ids).toEqual(['ui_denied']);
  });

  it('denies through the child span of a disabled button', () => {
    const btn = mount(button('primary', 'No funds', { disabled: true }));
    pointer('pointerdown', btn.querySelector('span')!);
    expect(player.ids).toEqual(['ui_denied']);
  });

  it('rate-limits repeated denials, pointerdown and the click that jsdom delivers alike', () => {
    const btn = mount(button('ghost', 'No', { disabled: true }));
    pointer('pointerdown', btn);
    click(btn);
    pointer('pointerdown', btn);
    expect(player.ids).toEqual(['ui_denied']);
    now += UI_SOUND_CONFIG.deniedMinGapMs;
    pointer('pointerdown', btn);
    expect(player.ids).toEqual(['ui_denied', 'ui_denied']);
  });

  it('denies an aria-disabled control', () => {
    const btn = mount(el('div', { attrs: { role: 'button', 'aria-disabled': 'true' } }));
    click(btn);
    expect(player.ids).toEqual(['ui_denied']);
  });

  it('respects data-sfx=none on a disabled control', () => {
    const btn = mount(button('ghost', 'Mute', { disabled: true }));
    btn.setAttribute('data-sfx', 'none');
    pointer('pointerdown', btn);
    click(btn);
    expect(player.calls).toEqual([]);
  });

  it('plays nothing for a pointerdown on an enabled control or on bare ground', () => {
    pointer('pointerdown', mount(button('ghost', 'Fine')));
    pointer('pointerdown', document.body);
    expect(player.calls).toEqual([]);
  });
});

describe('silence guards', () => {
  it('stays silent when a guard installed before it swallows the click', () => {
    const btn = mount(button('ghost', 'Swallowed'));
    dispose();
    const guard = (e: Event): void => { e.preventDefault(); e.stopImmediatePropagation(); };
    document.addEventListener('click', guard, true);
    install();
    click(btn);
    document.removeEventListener('click', guard, true);
    expect(player.calls).toEqual([]);
  });

  it('stays silent on a defaultPrevented event that does reach it', () => {
    const btn = mount(button('ghost', 'Prevented'));
    const e = new MouseEvent('click', { bubbles: true, cancelable: true });
    e.preventDefault();
    btn.dispatchEvent(e);
    expect(player.calls).toEqual([]);
  });

  it('stays silent for every event kind on a tutorial-inert target', () => {
    dispose();
    install({ isInert: target => (target as Element).closest('[data-inert]') !== null });
    const wrap = mount(el('div', { attrs: { 'data-inert': '' } }));
    const btn = mount(button('ghost', 'Railed'), wrap);
    const disabled = mount(button('ghost', 'Railed off', { disabled: true }), wrap);
    const range = mount(el('input', { attrs: { type: 'range' } }), wrap);
    const select = mount(el('select'), wrap);
    click(btn);
    pointer('pointerover', btn);
    pointer('pointerdown', disabled);
    range.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(player.calls).toEqual([]);
  });
});

describe('hover', () => {
  it('ticks once on entering a control and not again for movement inside it', () => {
    const btn = mount(button('ghost', 'Hover'));
    pointer('pointerover', btn);
    pointer('pointerover', btn);
    pointer('pointerover', btn.querySelector('span')!);
    expect(player.ids).toEqual(['ui_hover']);
  });

  it('ticks again after the pointer left to bare ground and came back', () => {
    const btn = mount(button('ghost', 'Hover'));
    pointer('pointerover', btn);
    pointer('pointerover', document.body);
    now += UI_SOUND_CONFIG.hoverMinGapMs;
    pointer('pointerover', btn);
    expect(player.ids).toEqual(['ui_hover', 'ui_hover']);
  });

  it('holds a minimum gap between ticks while sweeping across controls', () => {
    const a = mount(button('ghost', 'A'));
    const b = mount(button('ghost', 'B'));
    const c = mount(button('ghost', 'C'));
    pointer('pointerover', a);
    now += UI_SOUND_CONFIG.hoverMinGapMs - 1;
    pointer('pointerover', b);
    now += 1;
    pointer('pointerover', c);
    expect(player.ids).toEqual(['ui_hover', 'ui_hover']);
  });

  it('does not replay on the control it settled on after a gap-suppressed entry', () => {
    const a = mount(button('ghost', 'A'));
    const b = mount(button('ghost', 'B'));
    pointer('pointerover', a);
    pointer('pointerover', b);
    now += 10_000;
    pointer('pointerover', b.querySelector('span')!);
    expect(player.ids).toEqual(['ui_hover']);
  });

  it('is silent while a pointer button is held, and does not replay once released', () => {
    const a = mount(button('ghost', 'A'));
    const b = mount(button('ghost', 'B'));
    pointer('pointerover', a);
    now += 1000;
    pointer('pointerover', b, 1);
    now += 1000;
    pointer('pointerover', b);
    expect(player.ids).toEqual(['ui_hover']);
  });

  it('skips disabled controls and data-sfx=none', () => {
    const off = mount(button('ghost', 'Off', { disabled: true }));
    const none = mount(button('ghost', 'None'));
    none.setAttribute('data-sfx', 'none');
    pointer('pointerover', off);
    now += 1000;
    pointer('pointerover', none);
    expect(player.calls).toEqual([]);
  });

  it('does not tick when a re-render swaps the control under a resting pointer', () => {
    const old = mount(button('ghost', 'Old'));
    pointer('pointerover', old);
    old.remove();
    now += 1000;
    pointer('pointerover', mount(button('ghost', 'New')));
    expect(player.ids).toEqual(['ui_hover']);
    now += 1000;
    pointer('pointerover', mount(button('ghost', 'Other')));
    expect(player.ids).toEqual(['ui_hover', 'ui_hover']);
  });
});

describe('sliders and dropdowns', () => {
  it('ticks on slider input with a pitch that rises across the travel', () => {
    const range = slider('0', { min: '0', max: '1', step: '0.01' });
    range.dispatchEvent(new Event('input', { bubbles: true }));
    now += UI_SOUND_CONFIG.valueMinGapMs;
    range.value = '0.5';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    now += UI_SOUND_CONFIG.valueMinGapMs;
    range.value = '1';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    const pitches = player.calls.map(c => c.opts?.pitchCents);
    expect(player.ids).toEqual(['ui_slider', 'ui_slider', 'ui_slider']);
    expect(pitches[0]).toBeCloseTo(-UI_SOUND_CONFIG.sliderPitchSpanCents / 2, 6);
    expect(pitches[1]).toBeCloseTo(0, 6);
    expect(pitches[2]).toBeCloseTo(UI_SOUND_CONFIG.sliderPitchSpanCents / 2, 6);
  });

  it('thins a drag to the minimum gap', () => {
    const range = slider('10');
    for (let i = 0; i < 10; i++) {
      range.value = String(10 + i);
      range.dispatchEvent(new Event('input', { bubbles: true }));
      now += UI_SOUND_CONFIG.valueMinGapMs / 4;
    }
    expect(player.calls.length).toBe(3);
  });

  it('ticks on a dropdown change as a tab, sharing the gap with sliders', () => {
    const select = mount(el('select'));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    now += UI_SOUND_CONFIG.valueMinGapMs;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(player.ids).toEqual(['ui_tab', 'ui_tab']);
  });

  it('honours data-sfx=none on both', () => {
    const range = slider('5', { 'data-sfx': 'none' });
    const select = mount(el('select', { attrs: { 'data-sfx': 'none' } }));
    range.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(player.calls).toEqual([]);
  });

  it('ignores input on non-range fields and change on non-selects', () => {
    const text = mount(el('input', { attrs: { type: 'text' } }));
    text.dispatchEvent(new Event('input', { bubbles: true }));
    text.dispatchEvent(new Event('change', { bubbles: true }));
    expect(player.calls).toEqual([]);
  });

  it('survives a range with no usable bounds', () => {
    const range = slider('abc', { min: '5', max: '5' });
    range.dispatchEvent(new Event('input', { bubbles: true }));
    expect(player.calls[0]?.opts?.pitchCents).toBe(0);
  });

  it('falls back to the middle for a non-numeric value', () => {
    const range = slider('50', { min: '0', max: '100' });
    Object.defineProperty(range, 'value', { value: 'not-a-number', configurable: true });
    range.dispatchEvent(new Event('input', { bubbles: true }));
    expect(player.calls[0]?.opts?.pitchCents).toBe(0);
  });
});

describe('lifecycle and fault tolerance', () => {
  it('stops everything once disposed, and disposing twice is harmless', () => {
    const btn = mount(button('ghost', 'Gone'));
    dispose();
    click(btn);
    pointer('pointerover', btn);
    slider('1').dispatchEvent(new Event('input', { bubbles: true }));
    dispose();
    expect(player.calls).toEqual([]);
  });

  it('is idempotent per document: installing again replaces the first install', () => {
    const first = dispose;
    install();
    click(mount(button('ghost', 'Once')));
    expect(player.ids).toEqual(['ui_click']);
    first();
    player.clear();
    click(mount(button('ghost', 'Still wired')));
    expect(player.ids).toEqual(['ui_click']);
  });

  it('swallows an audio fault so the click handler chain still runs', () => {
    const btn = mount(button('ghost', 'Fragile'));
    let reached = false;
    btn.addEventListener('click', () => { reached = true; });
    player.throwOnPlay = true;
    expect(() => click(btn)).not.toThrow();
    pointer('pointerover', btn);
    expect(reached).toBe(true);
  });

  it('swallows a fault thrown by the inert check', () => {
    dispose();
    install({ isInert: () => { throw new Error('boom'); } });
    const btn = mount(button('ghost', 'Fragile'));
    let reached = false;
    btn.addEventListener('click', () => { reached = true; });
    expect(() => click(btn)).not.toThrow();
    expect(reached).toBe(true);
    expect(player.calls).toEqual([]);
  });

  it('uses the real clock when none is injected', () => {
    dispose();
    dispose = installUiSounds(document, player);
    pointer('pointerover', mount(button('ghost', 'A')));
    pointer('pointerover', mount(button('ghost', 'B')));
    expect(player.ids).toEqual(['ui_hover']);
  });
});
