// @vitest-environment jsdom
// BlastSimulator2026 — MiniMap legend lists every drawn layer, readable (#1424)
//
// Vehicles were drawn as #c0c040 dots with no legend entry, and the legend
// text (#908070) was too dim. The legend is now built from MINIMAP_LAYERS,
// the same catalog the draw code takes its fills from.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { MiniMap } from '../../../src/ui/MiniMap.js';
import { MINIMAP_LAYERS, layerColor } from '../../../src/ui/miniMapLayers.js';
import { makeGameContext } from '../../helpers/gameContext.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';
import { contrastRatio, composite } from '../../../scripts/shared/a11y-contrast.js';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';

/** WCAG AA minimum for normal-size text. */
const WCAG_AA_NORMAL_TEXT = 4.5;
const MIN_LEGEND_FONT_PX = 10;
const TEXT_SECONDARY = '#c9d1db';
/** Panel background rgba(16,20,26,.95). */
const PANEL_BG = [16, 20, 26, 0.95] as const;
/** Darkest and brightest scene pixels the translucent panel can sit over. */
const SCENE_DARK = [0, 0, 0] as const;
const SCENE_LIGHT = [255, 255, 255] as const;
const EXPECTED_IDS = ['rock', 'ore', 'building', 'vehicle', 'crew', 'hole'];

const hex = (rgb: readonly [number, number, number]): string =>
  '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');

/** Fake 2D context recording every fillStyle assignment into `fills`. */
function recordingContext(fills: string[]): Record<string, unknown> {
  const noop = () => undefined;
  let style = '';
  const ctx: Record<string, unknown> = {
    fillRect: noop, drawImage: noop, clearRect: noop, fillText: noop,
    beginPath: noop, arc: noop, fill: noop, moveTo: noop, lineTo: noop, stroke: noop,
    strokeStyle: '', lineWidth: 0, font: '', textAlign: '', globalAlpha: 1,
  };
  Object.defineProperty(ctx, 'fillStyle', {
    get: () => style,
    set: (v: string) => { style = v; fills.push(v); },
  });
  return ctx;
}

function stubContexts(fills: string[]): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    return recordingContext(fills) as unknown as CanvasRenderingContext2D;
  } as never);
}

function legendEntries(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('#bs-minimap [data-layer]'));
}

function legendLabel(entry: HTMLElement): HTMLElement {
  return (entry.querySelector('[data-legend-label]') as HTMLElement | null) ?? entry;
}

function legendSwatch(entry: HTMLElement): HTMLElement {
  return (entry.querySelector('[data-legend-swatch]') as HTMLElement | null)
    ?? (entry.firstElementChild as HTMLElement);
}

describe('MiniMap legend (#1424)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    setLocale('en');
  });

  it('catalog holds exactly the six drawn layers with distinct colours and label keys', () => {
    expect(MINIMAP_LAYERS.map((l) => l.id)).toEqual(EXPECTED_IDS);
    expect(new Set(MINIMAP_LAYERS.map((l) => l.color)).size).toBe(EXPECTED_IDS.length);
    expect(new Set(MINIMAP_LAYERS.map((l) => l.labelKey)).size).toBe(EXPECTED_IDS.length);
    for (const l of MINIMAP_LAYERS) expect(layerColor(l.id)).toBe(l.color);
  });

  it('renders exactly one legend entry per catalog layer, swatch in the catalog colour', () => {
    stubContexts([]);
    const minimap = new MiniMap(document.body);
    const entries = legendEntries();
    expect(entries.map((e) => e.dataset['layer'])).toEqual(EXPECTED_IDS);
    for (const layer of MINIMAP_LAYERS) {
      const entry = entries.find((e) => e.dataset['layer'] === layer.id)!;
      const probe = document.createElement('span');
      probe.style.background = layer.color;
      expect(legendSwatch(entry).style.background).toBe(probe.style.background);
      expect(legendLabel(entry).textContent).toBe(t(layer.labelKey));
    }
    minimap.dispose();
  });

  it('lists vehicles with the colour the vehicle dots are drawn in', () => {
    stubContexts([]);
    const minimap = new MiniMap(document.body);
    expect(layerColor('vehicle')).toBe('#c0c040');
    const entry = legendEntries().find((e) => e.dataset['layer'] === 'vehicle')!;
    expect(entry).toBeDefined();
    const probe = document.createElement('span');
    probe.style.background = layerColor('vehicle');
    expect(legendSwatch(entry).style.background).toBe(probe.style.background);
    expect(legendLabel(entry).textContent).toBe(t('ui.minimap.vehicle'));
    expect(legendLabel(entry).textContent).not.toBe('ui.minimap.vehicle');
    minimap.dispose();
  });

  it('assigns every catalog colour as a fill during update and draws no uncatalogued layer colour', () => {
    const fills: string[] = [];
    stubContexts(fills);
    const minimap = new MiniMap(document.body);
    const state = makeGameContext({ seed: 42, size: 32, staffed: true }).state!;
    expect(state.vehicles.vehicles.length).toBeGreaterThan(0);
    expect(state.employees.employees.some((e) => e.alive)).toBe(true);
    state.drillHoles.push({ id: 'h1', x: 4, z: 4, depth: 8, diameter: 0.1 });
    expect(placeBuilding(state.buildings, 'freight_warehouse', 6, 6, 32, 32).success).toBe(true);
    state.surveyResults.push({
      id: 1, method: 'seismic', centerX: 8, centerZ: 8, completedTick: 0, surveyorId: 1,
      estimates: { '8,8': { ore_a: 0.8 } }, confidence: 0.9,
    } as never);

    minimap.update(state);
    // Rock: the flat tint is what paints a site whose NavGrid is not built yet.
    state.navGrid = null as never;
    minimap.update(state);

    const assigned = new Set(fills.map((f) => f.toLowerCase()));
    for (const layer of MINIMAP_LAYERS) {
      expect(assigned.has(layer.color.toLowerCase()), `${layer.id} ${layer.color} never filled`).toBe(true);
    }
    // Every flat hex layer fill is a catalog colour; the only other hex is the void-cell shade.
    const catalog = new Set(MINIMAP_LAYERS.map((l) => l.color.toLowerCase()));
    const VOID_SHADE = '#0a0e12';
    const hexFills = [...assigned].filter((f) => f.startsWith('#') && f !== VOID_SHADE);
    for (const f of hexFills) expect(catalog.has(f), `${f} is drawn but not in the legend`).toBe(true);
    minimap.dispose();
  });

  it('colours legend labels with the secondary text token at a readable size', () => {
    stubContexts([]);
    const minimap = new MiniMap(document.body);
    const entries = legendEntries();
    expect(entries).toHaveLength(EXPECTED_IDS.length);
    for (const entry of entries) {
      const label = legendLabel(entry);
      const style = label.style.cssText + ';' + (label.parentElement?.style.cssText ?? '');
      expect(style).toContain('var(--bsx-text-secondary)');
      expect(style).not.toContain('#908070');
      const size = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(style);
      expect(size, 'font-size px declared').not.toBeNull();
      expect(Number(size![1])).toBeGreaterThanOrEqual(MIN_LEGEND_FONT_PX);
    }
    minimap.dispose();
  });

  it('keeps label contrast at WCAG AA over the translucent panel on dark and light scenes', () => {
    for (const scene of [SCENE_DARK, SCENE_LIGHT]) {
      const panel = hex(composite(PANEL_BG, scene));
      expect(contrastRatio(TEXT_SECONDARY, panel)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    }
    // The old colour fails the same check on the light scene.
    expect(contrastRatio('#908070', hex(composite(PANEL_BG, SCENE_LIGHT)))).toBeLessThan(WCAG_AA_NORMAL_TEXT);
  });

  it('defines ui.minimap.vehicle in both locales with different text', () => {
    const enMap = en as Record<string, string>;
    const frMap = fr as Record<string, string>;
    expect(enMap['ui.minimap.vehicle']).toBeTruthy();
    expect(frMap['ui.minimap.vehicle']).toBeTruthy();
    expect(frMap['ui.minimap.vehicle']).not.toBe(enMap['ui.minimap.vehicle']);
  });

  it('shows the French vehicle label after a locale refresh', () => {
    stubContexts([]);
    const minimap = new MiniMap(document.body);
    setLocale('fr');
    minimap.refreshLocale();
    const entry = legendEntries().find((e) => e.dataset['layer'] === 'vehicle')!;
    expect(legendLabel(entry).textContent).toBe((fr as Record<string, string>)['ui.minimap.vehicle']);
    expect(legendLabel(entry).textContent).toBe(t('ui.minimap.vehicle'));
    minimap.dispose();
  });

  it('sizes the legend container with min-height so wrapped rows are not clipped', () => {
    stubContexts([]);
    const minimap = new MiniMap(document.body);
    const container = legendEntries()[0]!.parentElement!;
    expect(container.children.length).toBe(EXPECTED_IDS.length);
    expect(container.style.minHeight).not.toBe('');
    expect(container.style.height).toBe('');
    minimap.dispose();
  });
});
