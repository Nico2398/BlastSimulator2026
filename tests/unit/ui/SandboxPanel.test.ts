// SandboxPanel — DOM tests (jsdom)
// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import { SandboxPanel } from '../../../src/ui/SandboxPanel.js';
import { SANDBOX_DEFAULTS, SANDBOX_FIELDS, SANDBOX_SIZE_MAX } from '../../../src/core/campaign/Sandbox.js';
import type { SandboxConfig } from '../../../src/core/campaign/Sandbox.js';

describe('SandboxPanel', () => {
  let container: HTMLElement;
  let panel: SandboxPanel;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    panel = new SandboxPanel(container);
  });

  const control = (key: string) => document.getElementById(`bs-sandbox-${key}`);

  it('starts hidden and shows on demand', () => {
    expect(panel.visible).toBe(false);
    panel.show();
    expect(panel.visible).toBe(true);
  });

  it('renders a control for every configurable field', () => {
    panel.show();
    for (const field of SANDBOX_FIELDS) {
      expect(control(String(field.key)), `missing control for ${String(field.key)}`).toBeTruthy();
    }
  });

  it('offers every biome the catalog knows', () => {
    panel.show();
    const select = control('biome') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(select.options.length).toBe(SANDBOX_FIELDS.find(f => f.key === 'biome')!.options!().length);
  });

  it('starts with the defaults and reports them back', () => {
    panel.show();
    expect(panel.getConfig()).toEqual(SANDBOX_DEFAULTS);
  });

  it('picks up an edited seed so a known map can be replayed', () => {
    panel.show();
    const seed = control('seed') as HTMLInputElement;
    seed.value = '4242';
    seed.dispatchEvent(new Event('input'));
    expect(panel.getConfig().seed).toBe(4242);
  });

  it('picks up a changed biome', () => {
    panel.show();
    const select = control('biome') as HTMLSelectElement;
    select.value = 'alpine_granite';
    select.dispatchEvent(new Event('change'));
    expect(panel.getConfig().biome).toBe('alpine_granite');
  });

  it('clamps an out-of-range size as it is typed', () => {
    panel.show();
    const size = control('size') as HTMLInputElement;
    size.value = '100000';
    size.dispatchEvent(new Event('input'));
    expect(panel.getConfig().size).toBe(SANDBOX_SIZE_MAX);
  });

  it('the randomise button changes the seed and writes it into the visible field', () => {
    panel.show();
    const seed = control('seed') as HTMLInputElement;
    const before = panel.getConfig().seed;

    const seen = new Set<number>();
    for (let i = 0; i < 25; i++) {
      (document.getElementById('bs-sandbox-randomize') as HTMLButtonElement).click();
      const now = panel.getConfig().seed;
      seen.add(now);
      // What is shown must match what will be used, or the player writes down
      // a seed that does not rebuild their map.
      expect(Number(seed.value)).toBe(now);
    }
    expect(seen.size).toBeGreaterThan(1);
    expect([...seen].some(s => s !== before)).toBe(true);
  });

  it('toggles the mixed-rock flag', () => {
    panel.show();
    const box = control('mixedRockHardness') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(panel.getConfig().mixedRockHardness).toBe(true);
  });

  it('collects ticked explosives, and treats none ticked as no restriction', () => {
    panel.show();
    expect(panel.getConfig().availableExplosives).toEqual([]);

    const boomite = document.getElementById('bs-sandbox-explosive-boomite') as HTMLInputElement;
    boomite.checked = true;
    boomite.dispatchEvent(new Event('change'));
    expect(panel.getConfig().availableExplosives).toEqual(['boomite']);

    boomite.checked = false;
    boomite.dispatchEvent(new Event('change'));
    expect(panel.getConfig().availableExplosives).toEqual([]);
  });

  it('hands the assembled config to onStart and closes', () => {
    let got: SandboxConfig | null = null;
    panel.setOnStart((c) => { got = c; });
    panel.show();

    const seed = control('seed') as HTMLInputElement;
    seed.value = '999';
    seed.dispatchEvent(new Event('input'));
    (document.getElementById('bs-sandbox-start') as HTMLButtonElement).click();

    expect(got).not.toBeNull();
    expect(got!.seed).toBe(999);
    expect(panel.visible).toBe(false);
  });

  it('back closes without starting anything', () => {
    let started = false;
    let backed = false;
    panel.setOnStart(() => { started = true; });
    panel.setOnBack(() => { backed = true; });
    panel.show();

    (document.getElementById('bs-sandbox-back') as HTMLButtonElement).click();
    expect(started).toBe(false);
    expect(backed).toBe(true);
    expect(panel.visible).toBe(false);
  });

  it('keeps edits across a hide/show cycle', () => {
    panel.show();
    const seed = control('seed') as HTMLInputElement;
    seed.value = '4242';
    seed.dispatchEvent(new Event('input'));

    panel.hide();
    panel.show();
    expect(panel.getConfig().seed).toBe(4242);
    expect((control('seed') as HTMLInputElement).value).toBe('4242');
  });

  it('dispose removes the panel from the document', () => {
    panel.show();
    expect(document.getElementById('bs-sandbox-panel')).toBeTruthy();
    panel.dispose();
    expect(document.getElementById('bs-sandbox-panel')).toBeNull();
  });
});
