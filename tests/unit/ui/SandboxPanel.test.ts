// SandboxPanel — DOM tests (jsdom)
// @vitest-environment jsdom
//
// #504: sandbox setup collapsed to 3 controls — biome, starting kit (#1891), seed —
// plus reroll/back/start buttons. Everything else the old panel rendered
// (size, depth, cash, goal, events, prices, decay, mixed_rock, explosives)
// is gone.

import { describe, it, expect, beforeEach } from 'vitest';
import { SandboxPanel } from '../../../src/ui/SandboxPanel.js';
import {
  SANDBOX_DEFAULTS,
  SANDBOX_FIELDS,
  SANDBOX_KIT_ORDER,
  randomSandboxSeed,
} from '../../../src/core/campaign/Sandbox.js';
import type { SandboxConfig } from '../../../src/core/campaign/Sandbox.js';
import {
  SANDBOX_KITS,
  sandboxBiomeTraits,
  sandboxKitDetails,
  type SandboxKitId,
} from '../../../src/core/campaign/Sandbox.js';
import { getAllBiomes, getBiome } from '../../../src/core/world/BiomeCatalog.js';
import { t, setLocale, getLocale } from '../../../src/core/i18n/I18n.js';
import { ORE_DEPTH_UNBOUNDED, getAllOres } from '../../../src/core/world/OreCatalog.js';
import { vehicleDisplayName, buildingDisplayName } from '../../../src/ui/fleetDetailSections.js';
import { getVehicleDefByTier } from '../../../src/core/entities/Vehicle.js';
import { getBuildingDef } from '../../../src/core/entities/Building.js';

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

  /** Selects a biome then a kit the way a player clicking through the form would. */
  function selectBiomeAndKit(biome: string, kit: string): void {
    const biomeSelect = control('biome') as HTMLSelectElement;
    biomeSelect.value = biome;
    biomeSelect.dispatchEvent(new Event('change'));

    const kitSelect = control('kit') as HTMLSelectElement;
    kitSelect.value = kit;
    kitSelect.dispatchEvent(new Event('change'));
  }

  it('starts hidden and shows on demand', () => {
    expect(panel.visible).toBe(false);
    panel.show();
    expect(panel.visible).toBe(true);
  });

  it('renders exactly the three configurable controls, with stable ids', () => {
    panel.show();
    expect(SANDBOX_FIELDS.map(f => String(f.key))).toEqual(['biome', 'kit', 'seed']);
    expect(control('biome')).toBeTruthy();
    expect(control('kit')).toBeTruthy();
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

  it('offers exactly the two named starting kits', () => {
    panel.show();
    const select = control('kit') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    const values = Array.from(select.options).map(o => o.value);
    expect(values).toEqual(SANDBOX_KIT_ORDER);
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

  it('picks up a changed kit', () => {
    panel.show();
    const select = control('kit') as HTMLSelectElement;
    select.value = 'digger';
    select.dispatchEvent(new Event('change'));
    expect(panel.getConfig().kit).toBe('digger');
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

  it('reroll changes only the seed, leaving biome and kit untouched', () => {
    panel.show();
    selectBiomeAndKit('alpine_granite', 'digger');

    const seed = control('seed') as HTMLInputElement;
    const seedBefore = seed.value;

    (document.getElementById('bs-sandbox-randomize') as HTMLButtonElement).click();

    expect(seed.value).not.toBe(seedBefore);
    expect(panel.getConfig().biome).toBe('alpine_granite');
    expect(panel.getConfig().kit).toBe('digger');
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

  it('hands the assembled config to onStart reflecting the selected biome and kit', () => {
    let got: SandboxConfig | null = null;
    panel.setOnStart((c) => { got = c; });
    panel.show();

    selectBiomeAndKit('tropical_karst', 'full');

    const seed = control('seed') as HTMLInputElement;
    seed.value = '999';
    seed.dispatchEvent(new Event('input'));

    (document.getElementById('bs-sandbox-start') as HTMLButtonElement).click();

    expect(got).not.toBeNull();
    expect(got!.biome).toBe('tropical_karst');
    expect(got!.kit).toBe('full');
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

  it('keeps a biome/kit edit across a hide/show cycle', () => {
    // The seed is documented to reroll on every show() (#504), but biome and
    // kit are not — an edit there must survive re-opening the panel.
    panel.show();
    selectBiomeAndKit('alpine_granite', 'digger');

    panel.hide();
    panel.show();
    expect(panel.getConfig().biome).toBe('alpine_granite');
    expect(panel.getConfig().kit).toBe('digger');
  });

  it('dispose removes the panel from the document', () => {
    panel.show();
    expect(document.getElementById('bs-sandbox-panel')).toBeTruthy();
    panel.dispose();
    expect(document.getElementById('bs-sandbox-panel')).toBeNull();
  });

  // ---- #1686: biome and kit details ----

  const text = (id: string) => document.getElementById(id)?.textContent ?? '';
  const digits = (s: string) => s.replace(/\D/g, '');
  const changeSelect = (key: string, value: string) => {
    const sel = control(key) as HTMLSelectElement;
    sel.value = value;
    sel.dispatchEvent(new Event('change'));
  };

  it('renders every detail element with a stable id', () => {
    panel.show();
    for (const id of [
      'bs-sandbox-biome-desc', 'bs-sandbox-biome-hardness', 'bs-sandbox-biome-ores',
      'bs-sandbox-biome-terrain', 'bs-sandbox-kit-cash', 'bs-sandbox-kit-opening',
    ]) {
      expect(document.getElementById(id), id).toBeTruthy();
    }
  });

  it('shows the details for the default selection as soon as the panel opens', () => {
    panel.show();
    const biome = getBiome(SANDBOX_DEFAULTS.biome)!;
    expect(text('bs-sandbox-biome-desc')).toBe(t(biome.descKey));
    expect(text('bs-sandbox-biome-hardness').trim()).not.toBe('');
    expect(digits(text('bs-sandbox-kit-cash'))).toContain(String(SANDBOX_KITS[SANDBOX_DEFAULTS.kit].startingCash));
    expect(text('bs-sandbox-kit-opening').trim()).not.toBe('');
  });

  it('changing the biome swaps in that biome description', () => {
    panel.show();
    for (const b of getAllBiomes()) {
      changeSelect('biome', b.id);
      expect(text('bs-sandbox-biome-desc'), b.id).toBe(t(b.descKey));
    }
  });

  it('changing the biome updates the hardness text with the catalog tier range', () => {
    panel.show();
    changeSelect('biome', 'desert_badlands');
    const desert = text('bs-sandbox-biome-hardness');
    const dt = sandboxBiomeTraits('desert_badlands');
    expect(desert).toContain(String(dt.hardnessTierMin));
    expect(desert).toContain(String(dt.hardnessTierMax));

    changeSelect('biome', 'volcanic_flats');
    const volcanic = text('bs-sandbox-biome-hardness');
    const vt = sandboxBiomeTraits('volcanic_flats');
    expect(volcanic).toContain(String(vt.hardnessTierMin));
    expect(volcanic).toContain(String(vt.hardnessTierMax));
    expect(volcanic).not.toBe(desert);
  });

  it('changing the biome updates the ores text with each ore name and depth window', () => {
    panel.show();
    for (const id of ['desert_badlands', 'volcanic_flats', 'alpine_granite']) {
      changeSelect('biome', id);
      const shown = text('bs-sandbox-biome-ores');
      for (const ore of sandboxBiomeTraits(id).ores) {
        expect(shown, `${id}/${ore.oreId}`).toContain(t(ore.nameKey));
      }
      const tr = sandboxBiomeTraits(id);
      expect(shown).toContain(String(tr.oreDepthMin));
      if (tr.oreDepthMax >= ORE_DEPTH_UNBOUNDED) {
        expect(shown, id).toContain(`from ${tr.oreDepthMin} m down`);
      } else {
        expect(shown, id).toContain(`depth ${tr.oreDepthMin}-${tr.oreDepthMax} m`);
      }
    }
  });

  it('open-ended ore depth reads "from N m down" and never leaks the sentinel (#1731)', () => {
    panel.show();
    for (const id of ['tropical_karst', 'volcanic_flats']) {
      changeSelect('biome', id);
      const shown = text('bs-sandbox-biome-ores');
      const min = sandboxBiomeTraits(id).oreDepthMin;
      expect(shown, id).toContain(`from ${min} m down`);
      expect(shown, id).not.toContain('999');
      expect(shown, id).not.toContain(`${min}-`);
    }
  });

  it('biomes with a finite deepest ore keep the "depth min-max m" window (#1731)', () => {
    panel.show();
    let finite = 0;
    for (const b of getAllBiomes()) {
      const tr = sandboxBiomeTraits(b.id);
      if (tr.ores.length === 0 || tr.oreDepthMax >= ORE_DEPTH_UNBOUNDED) continue;
      finite++;
      changeSelect('biome', b.id);
      const shown = text('bs-sandbox-biome-ores');
      expect(shown, b.id).toContain(`depth ${tr.oreDepthMin}-${tr.oreDepthMax} m`);
      expect(shown, b.id).not.toContain('from');
    }
    expect(finite).toBeGreaterThan(0);
  });

  it('a biome with no ores shows no ores line (#1731)', () => {
    panel.show();
    for (const b of getAllBiomes()) {
      changeSelect('biome', b.id);
      const has = sandboxBiomeTraits(b.id).ores.length > 0;
      expect(document.getElementById('bs-sandbox-biome-ores') !== null, b.id).toBe(has);
    }
  });

  it('the unbounded depth sentinel equals the deepest ore depthMax (#1731)', () => {
    const treranium = getAllOres().find(o => o.id === 'treranium')!;
    expect(treranium.depthMax).toBe(ORE_DEPTH_UNBOUNDED);
  });

  it('opening line names each vehicle as "N× <type> (<model>)" (#1731)', () => {
    panel.show();
    changeSelect('kit', 'full');
    const shown = text('bs-sandbox-kit-opening');
    expect(shown).toContain('1× Drill Rig (Pokey McPoke)');
    for (const v of sandboxKitDetails('full').vehicles) {
      expect(shown).toContain(`${v.count}× ${t(`vehicle_type.${v.role}`)} (${vehicleDisplayName(v.role, v.tier)})`);
    }
  });

  it('opening line vehicle entries are localized in French (#1731)', () => {
    const prev = getLocale();
    setLocale('fr');
    try {
      document.body.innerHTML = '';
      const c = document.createElement('div');
      document.body.appendChild(c);
      new SandboxPanel(c).show();
      changeSelect('kit', 'full');
      const shown = text('bs-sandbox-kit-opening');
      for (const v of sandboxKitDetails('full').vehicles) {
        const type = t(`vehicle_type.${v.role}`);
        expect(shown).toContain(`${v.count}× ${type} (${vehicleDisplayName(v.role, v.tier)})`);
      }
    } finally {
      setLocale(prev);
    }
  });

  it('shows the terrain ruggedness label for the biome', () => {
    panel.show();
    for (const b of getAllBiomes()) {
      changeSelect('biome', b.id);
      expect(text('bs-sandbox-biome-terrain'), b.id).toContain(t(`sandbox.terrain.${sandboxBiomeTraits(b.id).ruggedness}`));
    }
  });

  it('changing the kit updates the starting cash', () => {
    panel.show();
    for (const id of SANDBOX_KIT_ORDER) {
      changeSelect('kit', id);
      expect(digits(text('bs-sandbox-kit-cash')), id).toContain(String(SANDBOX_KITS[id].startingCash));
    }
  });

  it('changing the kit updates the opening text', () => {
    panel.show();
    changeSelect('kit', 'digger');
    const digger = text('bs-sandbox-kit-opening');
    changeSelect('kit', 'full');
    const full = text('bs-sandbox-kit-opening');
    expect(digger.trim()).not.toBe('');
    expect(full.trim()).not.toBe('');
    expect(full).not.toBe(digger);

    // The full kit adds a rock fragmenter over the digger kit.
    const names = (id: SandboxKitId) => sandboxKitDetails(id).vehicles
      .map(v => t(getVehicleDefByTier(v.role, v.tier).nameKey));
    for (const name of names('digger')) expect(digger, name).toContain(name);
    for (const name of names('full')) expect(full, name).toContain(name);
    const diggerOnly = new Set(names('digger'));
    const extra = names('full').filter(n => !diggerOnly.has(n));
    expect(extra.length).toBeGreaterThan(0);
    for (const name of extra) expect(digger, name).not.toContain(name);
  });

  it('digger kit line lists the rock digger (#1874)', () => {
    panel.show();
    changeSelect('kit', 'digger');
    const shown = text('bs-sandbox-kit-opening');
    const digger = sandboxKitDetails('digger').vehicles.find(v => v.role === 'rock_digger');
    expect(digger, 'digger details list a rock digger').toBeDefined();
    expect(shown).toContain(`${digger!.count}× ${t('vehicle_type.rock_digger')} (${vehicleDisplayName('rock_digger', digger!.tier)})`);
  });

  it('full kit line lists the rock fragmenter, digger kit line does not (#1891)', () => {
    panel.show();
    changeSelect('kit', 'full');
    expect(text('bs-sandbox-kit-opening')).toContain(t('vehicle_type.rock_fragmenter'));
    changeSelect('kit', 'digger');
    expect(text('bs-sandbox-kit-opening')).not.toContain(t('vehicle_type.rock_fragmenter'));
  });

  it('renders a kit select with one option per kit and no difficulty control (#1891)', () => {
    panel.show();
    const select = document.getElementById('bs-sandbox-kit') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(Array.from(select.options).map(o => o.value)).toEqual(['digger', 'full']);
    expect(document.getElementById('bs-sandbox-difficulty')).toBeNull();
    expect(document.getElementById('bs-sandbox-difficulty-cash')).toBeNull();
    expect(document.getElementById('bs-sandbox-difficulty-opening')).toBeNull();
  });

  it('kit option labels come from sandbox.kit.* and the field label reads "Starting kit" (#1891)', () => {
    panel.show();
    const select = document.getElementById('bs-sandbox-kit') as HTMLSelectElement;
    for (const opt of Array.from(select.options)) {
      expect(opt.textContent).toBe(t(`sandbox.kit.${opt.value}`));
    }
    const label = document.querySelector('label[for="bs-sandbox-kit"]');
    expect(label?.textContent).toBe(t('sandbox.field.kit'));
    expect(label?.textContent).toBe('Starting kit');
  });

  it.each(['en', 'fr'] as const)('no panel text mentions difficulty in %s (#1891)', (locale) => {
    const prev = getLocale();
    setLocale(locale);
    try {
      document.body.innerHTML = '';
      const c = document.createElement('div');
      document.body.appendChild(c);
      const p = new SandboxPanel(c);
      p.show();
      for (const id of SANDBOX_KIT_ORDER) {
        changeSelect('kit', id);
        expect(document.getElementById('bs-sandbox-panel')!.textContent).not.toMatch(/difficult/i);
      }
    } finally {
      setLocale(prev);
    }
  });

  it('French kit field label is "Équipement de départ" (#1891)', () => {
    const prev = getLocale();
    setLocale('fr');
    try {
      expect(t('sandbox.field.kit')).toBe('Équipement de départ');
    } finally {
      setLocale(prev);
    }
  });

  it('a biome change keeps the kit details, and vice versa', () => {
    panel.show();
    changeSelect('kit', 'full');
    const cash = text('bs-sandbox-kit-cash');
    const opening = text('bs-sandbox-kit-opening');
    changeSelect('biome', 'volcanic_flats');
    expect(text('bs-sandbox-kit-cash')).toBe(cash);
    expect(text('bs-sandbox-kit-opening')).toBe(opening);

    const desc = text('bs-sandbox-biome-desc');
    changeSelect('kit', 'digger');
    expect(text('bs-sandbox-biome-desc')).toBe(desc);
  });

  it('renders details for a retained selection when re-shown', () => {
    panel.show();
    selectBiomeAndKit('volcanic_flats', 'full');
    panel.hide();
    panel.show();
    expect(text('bs-sandbox-biome-desc')).toBe(t(getBiome('volcanic_flats')!.descKey));
    expect(digits(text('bs-sandbox-kit-cash'))).toContain(String(SANDBOX_KITS.full.startingCash));
  });

  it('changing selections retains the seed value and the other selection', () => {
    panel.show();
    const seed = control('seed') as HTMLInputElement;
    seed.value = '4242';
    seed.dispatchEvent(new Event('input'));
    changeSelect('kit', 'digger');
    changeSelect('biome', 'volcanic_flats');
    expect((control('seed') as HTMLInputElement).value).toBe('4242');
    expect((control('kit') as HTMLSelectElement).value).toBe('digger');
    expect(panel.getConfig()).toEqual({ biome: 'volcanic_flats', kit: 'digger', seed: 4242 });
  });

  it('biome select option text is the full translated name, never shortened', () => {
    panel.show();
    const select = control('biome') as HTMLSelectElement;
    for (const opt of Array.from(select.options)) {
      const b = getBiome(opt.value)!;
      expect(opt.textContent).toBe(t(b.nameKey));
    }
  });

  it('biome select has no fixed width and a min-width of at least 180px', () => {
    panel.show();
    const select = control('biome') as HTMLSelectElement;
    // 'auto' sizes to content; any px/% width would be a fixed width.
    expect(['', 'auto']).toContain(select.style.width);
    expect(select.style.cssText).not.toMatch(/(^|;)\s*width\s*:(?!\s*auto)/);
    expect(parseInt(select.style.maxWidth, 10)).toBeGreaterThanOrEqual(180);
    expect(parseInt(select.style.minWidth, 10)).toBeGreaterThanOrEqual(180);
  });
  // ---- #1739: kit buildings name their role; panel is on the bsx design system ----

  it('buildingDisplayName reads "<type name> (<joke name>)" (#1739)', () => {
    expect(buildingDisplayName('freight_warehouse', 1)).toBe('Freight Warehouse (The Pile)');
    expect(buildingDisplayName('spoil_heap', 1)).toBe('Spoil Heap (The Dump)');
    for (const [type, tier] of [['driving_center', 2], ['living_quarters', 3]] as const) {
      expect(buildingDisplayName(type, tier)).toBe(`${t(`building.${type}.name`)} (${t(getBuildingDef(type, tier).nameKey)})`);
    }
  });

  it('opening line names each building as "N× <type> (<joke name>)" (#1739)', () => {
    panel.show();
    changeSelect('kit', 'full');
    const shown = text('bs-sandbox-kit-opening');
    expect(shown).toContain('buildings: 1× Freight Warehouse (The Pile), 1× Spoil Heap (The Dump)');
    const buildings = sandboxKitDetails('full').buildings;
    expect(buildings.length).toBeGreaterThan(0);
    for (const b of buildings) {
      expect(shown).toContain(`${b.count}× ${buildingDisplayName(b.type, b.tier)}`);
    }
  });

  it('opening line building entries are localized in French (#1739)', () => {
    const prev = getLocale();
    setLocale('fr');
    try {
      document.body.innerHTML = '';
      const c = document.createElement('div');
      document.body.appendChild(c);
      new SandboxPanel(c).show();
      changeSelect('kit', 'full');
      const shown = text('bs-sandbox-kit-opening');
      for (const b of sandboxKitDetails('full').buildings) {
        const type = t(`building.${b.type}.name`);
        const joke = t(getBuildingDef(b.type, b.tier).nameKey);
        expect(type).not.toBe(`building.${b.type}.name`);
        expect(shown).toContain(`${b.count}× ${type} (${joke})`);
      }
    } finally {
      setLocale(prev);
    }
  });

  const legacyClass = /(^|\s)bs-(btn|btn-primary|btn-danger|input|select|panel|panel-title|ui)(\s|$)/;
  const legacyPalette = /#e8e0d0|#d8d0c0|#c0a060|#6a5030|#ffe0a0|#9a8868|#a09070|#d0c8b0|#060402|#ffc840|rgba\(\s*8\s*,\s*6\s*,\s*3|rgba\(\s*200\s*,\s*160\s*,\s*60|rgba\(\s*220\s*,\s*150\s*,\s*0|rgba\(\s*255\s*,\s*200\s*,\s*64/i;

  it('the panel subtree carries no legacy bs- chrome class (#1739)', () => {
    panel.show();
    const root = document.getElementById('bs-sandbox-panel')!;
    const offenders = [root, ...Array.from(root.querySelectorAll('*'))]
      .filter(e => legacyClass.test(e.getAttribute('class') ?? ''))
      .map(e => `${e.tagName}#${e.id}.${e.getAttribute('class')}`);
    expect(offenders).toEqual([]);
  });

  it('no inline style in the panel subtree uses a pre-redesign palette literal (#1739)', () => {
    panel.show();
    const root = document.getElementById('bs-sandbox-panel')!;
    const offenders = [root, ...Array.from(root.querySelectorAll('*'))]
      .filter(e => legacyPalette.test(e.getAttribute('style') ?? ''))
      .map(e => `${e.tagName}#${e.id}: ${e.getAttribute('style')}`);
    expect(offenders).toEqual([]);
  });

  it('Back, Start and randomise are bsx buttons; Start is the primary one (#1739)', () => {
    panel.show();
    for (const id of ['bs-sandbox-back', 'bs-sandbox-start', 'bs-sandbox-randomize']) {
      expect(document.getElementById(id)!.classList.contains('bsx-btn'), id).toBe(true);
    }
    expect(document.getElementById('bs-sandbox-start')!.classList.contains('bsx-btn-primary')).toBe(true);
  });

  it('the panel draws inside the bsx root so it inherits the bsx font and palette (#1739)', () => {
    panel.show();
    const root = document.getElementById('bs-sandbox-panel')!;
    expect(root.classList.contains('bsx-root') || root.closest('.bsx-root') !== null).toBe(true);
  });
});
