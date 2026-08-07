// SandboxPanel — DOM tests (jsdom)
// @vitest-environment jsdom
//
// #504: sandbox setup collapsed to 3 controls — biome, difficulty, seed —
// plus reroll/back/start buttons. Everything else the old panel rendered
// (size, depth, cash, goal, events, prices, decay, mixed_rock, explosives)
// is gone.

import { describe, it, expect, beforeEach } from 'vitest';
import { SandboxPanel } from '../../../src/ui/SandboxPanel.js';
import {
  SANDBOX_DEFAULTS,
  SANDBOX_FIELDS,
  SANDBOX_DIFFICULTY_ORDER,
  randomSandboxSeed,
} from '../../../src/core/campaign/Sandbox.js';
import type { SandboxConfig } from '../../../src/core/campaign/Sandbox.js';

const REMOVED_FIELD_IDS = [
  'bs-sandbox-size',
  'bs-sandbox-depth',
  'bs-sandbox-startingCash',
  'bs-sandbox-cash',
  'bs-sandbox-unlockThreshold',
  'bs-sandbox-goal',
  'bs-sandbox-eventFreqMultiplier',
  'bs-sandbox-events',
  'bs-sandbox-contractPriceMultiplier',
  'bs-sandbox-prices',
  'bs-sandbox-scoreDecayRate',
  'bs-sandbox-decay',
  'bs-sandbox-mixedRockHardness',
  'bs-sandbox-mixed_rock',
  'bs-sandbox-availableExplosives',
  'bs-sandbox-explosives',
  'bs-sandbox-explosive-boomite',
];

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

  it('renders exactly the three configurable controls, with stable ids', () => {
    panel.show();
    expect(SANDBOX_FIELDS.map(f => String(f.key))).toEqual(['biome', 'difficulty', 'seed']);
    expect(control('biome')).toBeTruthy();
    expect(control('difficulty')).toBeTruthy();
    expect(control('seed')).toBeTruthy();
  });

  it('renders the reroll, back and start buttons', () => {
    panel.show();
    expect(document.getElementById('bs-sandbox-randomize')).toBeTruthy();
    expect(document.getElementById('bs-sandbox-back')).toBeTruthy();
    expect(document.getElementById('bs-sandbox-start')).toBeTruthy();
  });

  it('no DOM element exists for any field removed by #504', () => {
    panel.show();
    for (const id of REMOVED_FIELD_IDS) {
      expect(document.getElementById(id), `unexpected element #${id}`).toBeNull();
    }
  });

  it('offers every biome the catalog knows', () => {
    panel.show();
    const select = control('biome') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(select.options.length).toBe(SANDBOX_FIELDS.find(f => f.key === 'biome')!.options!().length);
  });

  it('offers exactly the three named difficulty presets', () => {
    panel.show();
    const select = control('difficulty') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    const values = Array.from(select.options).map(o => o.value);
    expect(values).toEqual(SANDBOX_DIFFICULTY_ORDER);
  });

  it('starts with the defaults and reports them back', () => {
    const rand = () => 0;
    const freshContainer = document.createElement('div');
    document.body.appendChild(freshContainer);
    const freshPanel = new SandboxPanel(freshContainer, rand);

    freshPanel.show();

    expect(freshPanel.getConfig()).toEqual({ ...SANDBOX_DEFAULTS, seed: randomSandboxSeed(rand) });
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

  it('picks up a changed difficulty', () => {
    panel.show();
    const select = control('difficulty') as HTMLSelectElement;
    select.value = 'hard';
    select.dispatchEvent(new Event('change'));
    expect(panel.getConfig().difficulty).toBe('hard');
  });

  it('the reroll button writes a new value into the seed input', () => {
    panel.show();
    const seed = control('seed') as HTMLInputElement;
    const before = seed.value;

    (document.getElementById('bs-sandbox-randomize') as HTMLButtonElement).click();

    expect(seed.value).not.toBe(before);
    expect(Number(seed.value)).toBe(panel.getConfig().seed);
  });

  it('the reroll button changes the seed across repeated clicks', () => {
    panel.show();
    const seed = control('seed') as HTMLInputElement;

    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      (document.getElementById('bs-sandbox-randomize') as HTMLButtonElement).click();
      seen.add(seed.value);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('reroll changes only the seed, leaving biome and difficulty untouched', () => {
    panel.show();
    const biomeSelect = control('biome') as HTMLSelectElement;
    biomeSelect.value = 'alpine_granite';
    biomeSelect.dispatchEvent(new Event('change'));

    const difficultySelect = control('difficulty') as HTMLSelectElement;
    difficultySelect.value = 'hard';
    difficultySelect.dispatchEvent(new Event('change'));

    const seed = control('seed') as HTMLInputElement;
    const seedBefore = seed.value;

    (document.getElementById('bs-sandbox-randomize') as HTMLButtonElement).click();

    expect(seed.value).not.toBe(seedBefore);
    expect(panel.getConfig().biome).toBe('alpine_granite');
    expect(panel.getConfig().difficulty).toBe('hard');
  });

  it('opening the panel twice with an injected rand sequence yields two different seed values', () => {
    let calls = 0;
    const seq = [0.1, 0.9, 0.3, 0.7];
    const rand = () => seq[calls++ % seq.length]!;
    const freshContainer = document.createElement('div');
    document.body.appendChild(freshContainer);
    const freshPanel = new SandboxPanel(freshContainer, rand);

    freshPanel.show();
    const first = (document.getElementById('bs-sandbox-seed') as HTMLInputElement).value;
    freshPanel.hide();
    freshPanel.show();
    const second = (document.getElementById('bs-sandbox-seed') as HTMLInputElement).value;

    expect(second).not.toBe(first);
  });

  it('hands the assembled config to onStart reflecting the selected biome and difficulty', () => {
    let got: SandboxConfig | null = null;
    panel.setOnStart((c) => { got = c; });
    panel.show();

    const biomeSelect = control('biome') as HTMLSelectElement;
    biomeSelect.value = 'tropical_karst';
    biomeSelect.dispatchEvent(new Event('change'));

    const difficultySelect = control('difficulty') as HTMLSelectElement;
    difficultySelect.value = 'easy';
    difficultySelect.dispatchEvent(new Event('change'));

    const seed = control('seed') as HTMLInputElement;
    seed.value = '999';
    seed.dispatchEvent(new Event('input'));

    (document.getElementById('bs-sandbox-start') as HTMLButtonElement).click();

    expect(got).not.toBeNull();
    expect(got!.biome).toBe('tropical_karst');
    expect(got!.difficulty).toBe('easy');
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

  it('keeps a biome/difficulty edit across a hide/show cycle', () => {
    // The seed is documented to reroll on every show() (#504), but biome and
    // difficulty are not — an edit there must survive re-opening the panel.
    panel.show();
    const biomeSelect = control('biome') as HTMLSelectElement;
    biomeSelect.value = 'alpine_granite';
    biomeSelect.dispatchEvent(new Event('change'));

    const difficultySelect = control('difficulty') as HTMLSelectElement;
    difficultySelect.value = 'hard';
    difficultySelect.dispatchEvent(new Event('change'));

    panel.hide();
    panel.show();
    expect(panel.getConfig().biome).toBe('alpine_granite');
    expect(panel.getConfig().difficulty).toBe('hard');
  });

  it('dispose removes the panel from the document', () => {
    panel.show();
    expect(document.getElementById('bs-sandbox-panel')).toBeTruthy();
    panel.dispose();
    expect(document.getElementById('bs-sandbox-panel')).toBeNull();
  });
});
