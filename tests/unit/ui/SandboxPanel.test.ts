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
import {
  SANDBOX_DIFFICULTIES,
  sandboxBiomeTraits,
  sandboxDifficultyDetails,
  type SandboxDifficultyId,
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

  /** Selects a biome then a difficulty the way a player clicking through the form would. */
  function selectBiomeAndDifficulty(biome: string, difficulty: string): void {
    const biomeSelect = control('biome') as HTMLSelectElement;
    biomeSelect.value = biome;
    biomeSelect.dispatchEvent(new Event('change'));

    const difficultySelect = control('difficulty') as HTMLSelectElement;
    difficultySelect.value = difficulty;
    difficultySelect.dispatchEvent(new Event('change'));
  }

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
    selectBiomeAndDifficulty('alpine_granite', 'hard');

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

    selectBiomeAndDifficulty('tropical_karst', 'easy');

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
    selectBiomeAndDifficulty('alpine_granite', 'hard');

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

  // ---- #1686: biome and difficulty details ----

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
      'bs-sandbox-biome-terrain', 'bs-sandbox-difficulty-cash', 'bs-sandbox-difficulty-opening',
    ]) {
      expect(document.getElementById(id), id).toBeTruthy();
    }
  });

  it('shows the details for the default selection as soon as the panel opens', () => {
    panel.show();
    const biome = getBiome(SANDBOX_DEFAULTS.biome)!;
    expect(text('bs-sandbox-biome-desc')).toBe(t(biome.descKey));
    expect(text('bs-sandbox-biome-hardness').trim()).not.toBe('');
    expect(digits(text('bs-sandbox-difficulty-cash'))).toContain(String(SANDBOX_DIFFICULTIES[SANDBOX_DEFAULTS.difficulty].startingCash));
    expect(text('bs-sandbox-difficulty-opening').trim()).not.toBe('');
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
    changeSelect('difficulty', 'easy');
    const shown = text('bs-sandbox-difficulty-opening');
    expect(shown).toContain('1× Drill Rig (Pokey McPoke)');
    for (const v of sandboxDifficultyDetails('easy').vehicles) {
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
      changeSelect('difficulty', 'easy');
      const shown = text('bs-sandbox-difficulty-opening');
      for (const v of sandboxDifficultyDetails('easy').vehicles) {
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

  it('changing the difficulty updates the starting cash', () => {
    panel.show();
    for (const id of SANDBOX_DIFFICULTY_ORDER) {
      changeSelect('difficulty', id);
      expect(digits(text('bs-sandbox-difficulty-cash')), id).toContain(String(SANDBOX_DIFFICULTIES[id].startingCash));
    }
  });

  it('changing the difficulty updates the opening text', () => {
    panel.show();
    changeSelect('difficulty', 'hard');
    const hard = text('bs-sandbox-difficulty-opening');
    changeSelect('difficulty', 'easy');
    const easy = text('bs-sandbox-difficulty-opening');
    expect(hard.trim()).not.toBe('');
    expect(easy.trim()).not.toBe('');
    expect(easy).not.toBe(hard);

    // The easy kit adds a rock fragmenter over the hard kit.
    const names = (id: SandboxDifficultyId) => sandboxDifficultyDetails(id).vehicles
      .map(v => t(getVehicleDefByTier(v.role, v.tier).nameKey));
    for (const name of names('hard')) expect(hard, name).toContain(name);
    for (const name of names('easy')) expect(easy, name).toContain(name);
    const hardOnly = new Set(names('hard'));
    const extra = names('easy').filter(n => !hardOnly.has(n));
    expect(extra.length).toBeGreaterThan(0);
    for (const name of extra) expect(hard, name).not.toContain(name);
  });

  it('hard kit line lists the rock digger (#1874)', () => {
    panel.show();
    changeSelect('difficulty', 'hard');
    const hard = text('bs-sandbox-difficulty-opening');
    const digger = sandboxDifficultyDetails('hard').vehicles.find(v => v.role === 'rock_digger');
    expect(digger, 'hard details list a rock digger').toBeDefined();
    expect(hard).toContain(`${digger!.count}× ${t('vehicle_type.rock_digger')} (${vehicleDisplayName('rock_digger', digger!.tier)})`);
  });

  it('a biome change keeps the difficulty details, and vice versa', () => {
    panel.show();
    changeSelect('difficulty', 'easy');
    const cash = text('bs-sandbox-difficulty-cash');
    const opening = text('bs-sandbox-difficulty-opening');
    changeSelect('biome', 'volcanic_flats');
    expect(text('bs-sandbox-difficulty-cash')).toBe(cash);
    expect(text('bs-sandbox-difficulty-opening')).toBe(opening);

    const desc = text('bs-sandbox-biome-desc');
    changeSelect('difficulty', 'hard');
    expect(text('bs-sandbox-biome-desc')).toBe(desc);
  });

  it('renders details for a retained selection when re-shown', () => {
    panel.show();
    selectBiomeAndDifficulty('volcanic_flats', 'easy');
    panel.hide();
    panel.show();
    expect(text('bs-sandbox-biome-desc')).toBe(t(getBiome('volcanic_flats')!.descKey));
    expect(digits(text('bs-sandbox-difficulty-cash'))).toContain(String(SANDBOX_DIFFICULTIES.easy.startingCash));
  });

  it('changing selections retains the seed value and the other selection', () => {
    panel.show();
    const seed = control('seed') as HTMLInputElement;
    seed.value = '4242';
    seed.dispatchEvent(new Event('input'));
    changeSelect('difficulty', 'hard');
    changeSelect('biome', 'volcanic_flats');
    expect((control('seed') as HTMLInputElement).value).toBe('4242');
    expect((control('difficulty') as HTMLSelectElement).value).toBe('hard');
    expect(panel.getConfig()).toEqual({ biome: 'volcanic_flats', difficulty: 'hard', seed: 4242 });
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
    changeSelect('difficulty', 'easy');
    const shown = text('bs-sandbox-difficulty-opening');
    expect(shown).toContain('buildings: 1× Freight Warehouse (The Pile), 1× Spoil Heap (The Dump)');
    const buildings = sandboxDifficultyDetails('easy').buildings;
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
      changeSelect('difficulty', 'easy');
      const shown = text('bs-sandbox-difficulty-opening');
      for (const b of sandboxDifficultyDetails('easy').buildings) {
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
