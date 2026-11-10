// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlastWorkshop } from '../../../../src/ui/panels/BlastWorkshop.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { addHole } from '../../../../src/core/mining/DrillPlan.js';
import { createCharge } from '../../../../src/core/mining/ChargePlan.js';
import { VoxelGrid } from '../../../../src/core/world/VoxelGrid.js';
import { assembleBlastPlan } from '../../../../src/core/mining/BlastPlan.js';
import { wetHoleIdsFor } from '../../../../src/core/mining/WetHoles.js';
import { planHeatmap, sectionAtZ } from '../../../../src/core/mining/EnergyHeatmap.js';
import { FRAGMENTATION_BANDS } from '../../../../src/core/mining/FragmentationBand.js';

const holeCounter = { nextHoleId: 1 };

function makeState() {
  return createGame({ seed: 1, mineType: 'desert' });
}

function makeWorkshop(): { workshop: BlastWorkshop; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const workshop = new BlastWorkshop(container);
  workshop.setGameConsole(vi.fn().mockReturnValue({ success: true, output: '' }));
  return { workshop, container };
}

function tabButton(root: HTMLElement, label: string): HTMLButtonElement {
  return Array.from(root.querySelectorAll('button')).find(b => b.textContent?.includes(label)) as HTMLButtonElement;
}

beforeEach(() => {
  holeCounter.nextHoleId = 1;
  document.body.innerHTML = '';
});

describe('BlastWorkshop', () => {
  it('is hidden initially', () => {
    const { workshop } = makeWorkshop();
    expect(workshop.visible).toBe(false);
  });

  it('show()/hide() toggle visibility', () => {
    const { workshop } = makeWorkshop();
    workshop.show();
    expect(workshop.visible).toBe(true);
    workshop.hide();
    expect(workshop.visible).toBe(false);
  });

  it('renders exactly 4 step labels: Drill, Charge, Preview, Blast (no Sequence)', () => {
    const { workshop } = makeWorkshop();
    for (const label of ['Drill', 'Charge', 'Preview', 'Blast']) {
      expect(workshop.root.textContent).toContain(label);
    }
    expect(workshop.root.textContent).not.toContain('Sequence');
  });

  it('step tabs carry data-step 1..4 and there is no data-step 5', () => {
    const { workshop } = makeWorkshop();
    const steps = Array.from(workshop.root.querySelectorAll('[data-step]')).map(e => e.getAttribute('data-step'));
    for (const n of ['1', '2', '3', '4']) expect(steps).toContain(n);
    expect(steps).not.toContain('5');
    expect(workshop.root.querySelector('[data-step="4"]')!.textContent).toContain('Blast');
    expect(workshop.root.querySelector('[data-step="3"]')!.textContent).toContain('Preview');
  });

  it('the load-bearing data-action selectors resolve under #bs-blast-panel', () => {
    const { workshop } = makeWorkshop();
    expect(workshop.root.id).toBe('bs-blast-panel');
    expect(workshop.root.querySelector('[data-action="auto-sequence"]')).toBeNull();
    for (const action of ['grid-tool', 'clear-holes', 'charge-all', 'execute']) {
      expect(workshop.root.querySelector(`[data-action="${action}"]`), `missing [data-action="${action}"]`).not.toBeNull();
    }
  });

  it('defaults to the Drill step for a fresh, empty plan', () => {
    const { workshop } = makeWorkshop();
    workshop.show();
    workshop.update(makeState(), 'sunny');

    const drillGridBtn = workshop.root.querySelector('[data-action="grid-tool"]') as HTMLElement;
    expect(drillGridBtn.closest('div[style*="display: none"]')).toBeNull();
    const chargeAllBtn = workshop.root.querySelector('[data-action="charge-all"]') as HTMLElement;
    expect(chargeAllBtn.closest('div[style*="display: none"]')).not.toBeNull();
  });

  // currentStep (PR #616 review round, item 7): the scenario harness's own
  // "ask the game, not the DOM" read of which tab is active, so a scenario's
  // ensureStep action can assert-or-click instead of assuming a tab a
  // preceding step left active is still active.
  it('currentStep defaults to Drill (1)', () => {
    const { workshop } = makeWorkshop();
    expect(workshop.currentStep).toBe(1);
  });

  it('currentStep tracks a manual tab click', () => {
    const { workshop } = makeWorkshop();
    workshop.show();
    tabButton(workshop.root, 'Charge').click();
    expect(workshop.currentStep).toBe(2);
  });

  it('currentStep tracks auto-advance, matching which controls are actually visible', () => {
    const { workshop } = makeWorkshop();
    workshop.show();
    const state = makeState();
    const hole = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    const chargeResult = createCharge('boomite', 5, 2, hole.depth);
    if ('charge' in chargeResult) state.chargesByHole[hole.id] = chargeResult.charge;

    workshop.update(state, 'sunny');

    expect(workshop.currentStep).toBe(4);
  });

  it('auto-advances to Charge once holes exist but are not fully charged', () => {
    const { workshop } = makeWorkshop();
    workshop.show();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);

    workshop.update(state, 'sunny');

    const chargeAllBtn = workshop.root.querySelector('[data-action="charge-all"]') as HTMLElement;
    expect(chargeAllBtn.closest('div[style*="display: none"]')).toBeNull();
  });

  it('auto-advances to Fire once drilled and charged (no sequencing needed)', () => {
    const { workshop } = makeWorkshop();
    workshop.show();
    const state = makeState();
    const hole = addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15);
    const chargeResult = createCharge('boomite', 5, 2, hole.depth);
    if ('charge' in chargeResult) state.chargesByHole[hole.id] = chargeResult.charge;

    workshop.update(state, 'sunny');

    expect(workshop.currentStep).toBe(4);
    const fireBtn = workshop.root.querySelector('#bs-blast-fire') as HTMLElement;
    expect(fireBtn.closest('div[style*="display: none"]')).toBeNull();
  });

  it('manually clicking a tab stops auto-advance so the plan changing does not yank the view away', () => {
    const { workshop } = makeWorkshop();
    workshop.show();
    const state = makeState();
    workshop.update(state, 'sunny');

    tabButton(workshop.root, 'Preview').click();
    addHole(holeCounter, state.drillHoles, 10, 10, 8, 0.15); // would normally auto-suggest Drill (already there) then Charge
    workshop.update(state, 'sunny');

    const previewText = workshop.root.textContent ?? '';
    expect(previewText).toContain('Analysis Suite'); // Preview's own body stayed visible, Preview-specific text
  });

  it('reopening the panel resets auto-advance even after a manual tab pick', () => {
    const { workshop } = makeWorkshop();
    workshop.show();
    const state = makeState();
    workshop.update(state, 'sunny');
    tabButton(workshop.root, 'Charge').click(); // manual pick, disables auto-advance
    workshop.hide();

    workshop.show(); // fresh open re-enables auto-advance
    workshop.update(state, 'sunny');

    const gridBtn = workshop.root.querySelector('[data-action="grid-tool"]') as HTMLElement;
    expect(gridBtn.closest('div[style*="display: none"]')).toBeNull();
  });

  it('the close button fires the registered close handler', () => {
    const { workshop } = makeWorkshop();
    const onClose = vi.fn();
    workshop.setCloseHandler(onClose);

    const closeBtn = Array.from(workshop.root.querySelectorAll('button')).find(b => !b.dataset['action'] && b.textContent === '') as HTMLButtonElement;
    closeBtn.click();

    expect(onClose).toHaveBeenCalled();
  });

  it('dispose() removes the panel from the DOM', () => {
    const { workshop, container } = makeWorkshop();
    workshop.dispose();
    expect(container.contains(workshop.root)).toBe(false);
  });

  it('refreshLocale() does not throw and keeps the panel functional', () => {
    const { workshop } = makeWorkshop();
    workshop.show();
    workshop.update(makeState(), 'sunny');

    expect(() => workshop.refreshLocale()).not.toThrow();
    workshop.update(makeState(), 'sunny');
    expect(workshop.root.textContent).toContain('Drill');
  });

  // ── Short-viewport reachability (#958) ──
  //
  // #bs-panel-body is the single outer scroll owner for every step (Drill,
  // Charge, Preview, Fire all mount into it — see BlastWorkshop.ts's
  // constructor). Bounding an inner list (e.g. Drill's hole list) must never
  // come at the cost of this outer container's own scrollability — otherwise
  // a short viewport with every inner wrapper already at its own max-height
  // would have nowhere left to scroll to reach a step's later controls.

  it('keeps #bs-panel-body scrollable (overflow-y:auto unchanged) regardless of how many holes the Drill step holds', () => {
    const { workshop } = makeWorkshop();
    workshop.show();

    const emptyBodyEl = workshop.root.querySelector('#bs-panel-body') as HTMLElement;
    expect(emptyBodyEl.style.overflowY).toBe('auto');

    const state = makeState();
    for (let i = 0; i < 50; i++) addHole(holeCounter, state.drillHoles, i, 0, 8, 0.15);
    workshop.update(state, 'sunny');

    const fullBodyEl = workshop.root.querySelector('#bs-panel-body') as HTMLElement;
    expect(fullBodyEl.style.overflowY).toBe('auto');
  });
});


// ── Energy heatmap toggle, legend and section (#2200) ────────────────────────

const TOGGLE = '[data-action="toggle-energy-heatmap"]';
const LEGEND = '[data-role="heatmap-legend"]';
const SECTION = '[data-role="heatmap-section"]';
const SECTION_HOLE = '[data-role="heatmap-section-hole"]';

/** True when the element exists and neither it nor an ancestor inside the panel is hidden. */
function isShown(root: HTMLElement, el: Element | null): boolean {
  for (let node: Element | null = el; node && node !== root.parentElement; node = node.parentElement) {
    if (node instanceof HTMLElement && (node.style.display === 'none' || node.hidden)) return false;
  }
  return el !== null;
}

function rockGrid(): VoxelGrid {
  const grid = new VoxelGrid(30, 30);
  for (let z = 5; z <= 20; z++)
    for (let y = 0; y <= 8; y++)
      for (let x = 5; x <= 20; x++)
        grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId: 'molite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
  return grid;
}

function chargeHole(state: ReturnType<typeof makeState>, id: string, depth: number, amountKg = 8, stemmingM = 4): void {
  const result = createCharge('boomite', amountKg, stemmingM, depth);
  if (!('charge' in result)) throw new Error(`fixture charge refused: ${result.error}`);
  state.chargesByHole[id] = result.charge;
}

/** Three charged holes: H1 (12,12) and H2 (16,12) share z = 12; H3 (12,16) sits on its own z. */
function heatmapFixture() {
  const { workshop } = makeWorkshop();
  const state = makeState();
  state.softwareTier = 0;
  const grid = rockGrid();
  const h1 = addHole(holeCounter, state.drillHoles, 12, 12, 8, 0.15);
  const h2 = addHole(holeCounter, state.drillHoles, 16, 12, 8, 0.15);
  const h3 = addHole(holeCounter, state.drillHoles, 12, 16, 8, 0.15);
  for (const h of [h1, h2, h3]) chargeHole(state, h.id, h.depth);
  workshop.setGridProvider(() => grid);
  workshop.show();
  workshop.update(state, 'sunny');
  return { workshop, state, grid, ids: [h1.id, h2.id, h3.id] as const };
}

function expectedSection(state: ReturnType<typeof makeState>, grid: VoxelGrid, z: number) {
  const plan = assembleBlastPlan(state.drillHoles, state.chargesByHole);
  return sectionAtZ(planHeatmap(plan, grid, wetHoleIdsFor(state)).bands, z);
}

function sectionCells(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`${SECTION} [data-band]`));
}

function pickSectionHole(root: HTMLElement, id: string): void {
  const select = root.querySelector<HTMLSelectElement>(SECTION_HOLE)!;
  select.value = id;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('BlastWorkshop — energy heatmap toggle', () => {
  it('starts off, with aria-pressed false', () => {
    const { workshop } = makeWorkshop();
    const toggle = workshop.root.querySelector(TOGGLE)!;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(workshop.energyHeatmapVisible).toBe(false);
  });

  it('is visible on every step, at software tier 0', () => {
    const { workshop } = makeWorkshop();
    workshop.show();
    const state = makeState();
    state.softwareTier = 0;
    workshop.update(state, 'sunny');
    for (const step of ['1', '2', '3', '4']) {
      (workshop.root.querySelector(`[data-step="${step}"]`) as HTMLElement).click();
      expect(isShown(workshop.root, workshop.root.querySelector(TOGGLE)), `step ${step}`).toBe(true);
    }
  });

  it('is still visible at a higher software tier', () => {
    const { workshop } = makeWorkshop();
    workshop.show();
    const state = makeState();
    state.softwareTier = 4;
    workshop.update(state, 'sunny');
    expect(isShown(workshop.root, workshop.root.querySelector(TOGGLE))).toBe(true);
  });

  it('a click flips the state, aria-pressed and calls the handler with the new value', () => {
    const { workshop } = makeWorkshop();
    const handler = vi.fn();
    workshop.setEnergyHeatmapToggleHandler(handler);
    const toggle = workshop.root.querySelector<HTMLElement>(TOGGLE)!;

    toggle.click();
    expect(handler).toHaveBeenLastCalledWith(true);
    expect(workshop.energyHeatmapVisible).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    toggle.click();
    expect(handler).toHaveBeenLastCalledWith(false);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(workshop.energyHeatmapVisible).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('a click with no handler registered does not throw', () => {
    const { workshop } = makeWorkshop();
    expect(() => workshop.root.querySelector<HTMLElement>(TOGGLE)!.click()).not.toThrow();
    expect(workshop.energyHeatmapVisible).toBe(true);
  });

  it('setEnergyHeatmapVisible syncs the button and getter without firing the handler', () => {
    const { workshop } = makeWorkshop();
    const handler = vi.fn();
    workshop.setEnergyHeatmapToggleHandler(handler);

    workshop.setEnergyHeatmapVisible(true);
    expect(workshop.energyHeatmapVisible).toBe(true);
    expect(workshop.root.querySelector(TOGGLE)!.getAttribute('aria-pressed')).toBe('true');
    workshop.setEnergyHeatmapVisible(false);
    expect(workshop.energyHeatmapVisible).toBe(false);
    expect(workshop.root.querySelector(TOGGLE)!.getAttribute('aria-pressed')).toBe('false');
    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps its state across update() and a tab change', () => {
    const { workshop, state } = heatmapFixture();
    workshop.setEnergyHeatmapVisible(true);
    workshop.update(state, 'sunny');
    (workshop.root.querySelector('[data-step="2"]') as HTMLElement).click();
    workshop.update(state, 'sunny');
    expect(workshop.energyHeatmapVisible).toBe(true);
    expect(workshop.root.querySelector(TOGGLE)!.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('BlastWorkshop — energy heatmap legend', () => {
  it('is not shown while the heatmap is off', () => {
    const { workshop } = heatmapFixture();
    expect(isShown(workshop.root, workshop.root.querySelector(LEGEND))).toBe(false);
  });

  it('shows one entry per band once the heatmap is on, each naming the band and its consequence', () => {
    const { workshop, state } = heatmapFixture();
    workshop.setEnergyHeatmapVisible(true);
    workshop.update(state, 'sunny');

    const legend = workshop.root.querySelector<HTMLElement>(LEGEND)!;
    expect(isShown(workshop.root, legend)).toBe(true);
    const entries = Array.from(legend.querySelectorAll<HTMLElement>('[data-band]'));
    expect(entries.map(e => e.dataset['band']).sort()).toEqual([...FRAGMENTATION_BANDS].sort());
    const texts = entries.map(e => (e.textContent ?? '').trim());
    for (const t of texts) expect(t.length).toBeGreaterThanOrEqual(12);
    expect(new Set(texts).size).toBe(FRAGMENTATION_BANDS.length);
  });

  it('disappears again when switched off', () => {
    const { workshop, state } = heatmapFixture();
    workshop.setEnergyHeatmapVisible(true);
    workshop.update(state, 'sunny');
    workshop.setEnergyHeatmapVisible(false);
    workshop.update(state, 'sunny');
    expect(isShown(workshop.root, workshop.root.querySelector(LEGEND))).toBe(false);
    expect(isShown(workshop.root, workshop.root.querySelector(SECTION))).toBe(false);
  });

  it('is shown by a click on the toggle itself', () => {
    const { workshop, state } = heatmapFixture();
    workshop.root.querySelector<HTMLElement>(TOGGLE)!.click();
    workshop.update(state, 'sunny');
    expect(isShown(workshop.root, workshop.root.querySelector(LEGEND))).toBe(true);
    expect(isShown(workshop.root, workshop.root.querySelector(SECTION))).toBe(true);
  });
});

describe('BlastWorkshop — energy heatmap section', () => {
  it('is not shown while the heatmap is off', () => {
    const { workshop } = heatmapFixture();
    expect(isShown(workshop.root, workshop.root.querySelector(SECTION))).toBe(false);
  });

  it('offers one option per hole, valued by hole id, and starts on the first hole', () => {
    const { workshop, state, ids } = heatmapFixture();
    workshop.setEnergyHeatmapVisible(true);
    workshop.update(state, 'sunny');

    const select = workshop.root.querySelector<HTMLSelectElement>(SECTION_HOLE)!;
    expect(select.tagName).toBe('SELECT');
    expect(Array.from(select.options).map(o => o.value)).toEqual([...ids]);
    expect(select.value).toBe(ids[0]);
  });

  it('draws the plane of voxels sharing the chosen hole\'s z, straight from the plan\'s bands', () => {
    const { workshop, state, grid } = heatmapFixture();
    workshop.setEnergyHeatmapVisible(true);
    workshop.update(state, 'sunny');

    const expected = expectedSection(state, grid, 12);
    expect(expected.length).toBeGreaterThan(0);
    const cells = sectionCells(workshop.root);
    expect(cells).toHaveLength(expected.length);
    expect(cells.map(c => c.dataset['intensity']).sort()).toEqual(expected.map(c => c.intensity.toFixed(2)).sort());
    expect(cells.map(c => c.dataset['band']).sort()).toEqual(expected.map(c => c.band).sort());
  });

  it('every cell titles its exact intensity and band', () => {
    const { workshop, state } = heatmapFixture();
    workshop.setEnergyHeatmapVisible(true);
    workshop.update(state, 'sunny');

    const cells = sectionCells(workshop.root);
    for (const cell of cells) {
      expect(cell.getAttribute('title'), cell.outerHTML).toContain(cell.dataset['intensity']!);
    }
    // The title names the band, not just the number: strip the digits and cells of different bands still differ.
    const nameOf = (c: HTMLElement) => c.getAttribute('title')!.replace(/[0-9.,\s-]/g, '');
    const byBand = new Map<string, string>();
    for (const c of cells) byBand.set(c.dataset['band']!, nameOf(c));
    expect(byBand.size).toBeGreaterThan(1);
    expect(new Set(byBand.values()).size).toBe(byBand.size);
  });

  it('draws only filled cells: air above the surface is omitted', () => {
    const { workshop, state, grid } = heatmapFixture();
    workshop.setEnergyHeatmapVisible(true);
    workshop.update(state, 'sunny');
    const expected = expectedSection(state, grid, 12);
    expect(expected.every(c => grid.getVoxel(c.x, c.y, c.z)!.density > 0)).toBe(true);
    expect(sectionCells(workshop.root)).toHaveLength(expected.length);
  });

  it('marks the columns of the holes lying on the plane with data-hole', () => {
    const { workshop, state, ids } = heatmapFixture();
    workshop.setEnergyHeatmapVisible(true);
    workshop.update(state, 'sunny');
    const section = workshop.root.querySelector(SECTION)!;
    expect(section.querySelector(`[data-hole="${ids[0]}"]`)).not.toBeNull();
    expect(section.querySelector(`[data-hole="${ids[1]}"]`)).not.toBeNull();
    expect(section.querySelector(`[data-hole="${ids[2]}"]`)).toBeNull();
  });

  it('picking another hole redraws the plane at that hole\'s z', () => {
    const { workshop, state, grid, ids } = heatmapFixture();
    workshop.setEnergyHeatmapVisible(true);
    workshop.update(state, 'sunny');

    pickSectionHole(workshop.root, ids[2]);
    workshop.update(state, 'sunny');

    expect(workshop.root.querySelector<HTMLSelectElement>(SECTION_HOLE)!.value).toBe(ids[2]);
    const expected = expectedSection(state, grid, 16);
    const cells = sectionCells(workshop.root);
    expect(cells).toHaveLength(expected.length);
    expect(cells.map(c => c.dataset['intensity']).sort()).toEqual(expected.map(c => c.intensity.toFixed(2)).sort());
    const section = workshop.root.querySelector(SECTION)!;
    expect(section.querySelector(`[data-hole="${ids[2]}"]`)).not.toBeNull();
    expect(section.querySelector(`[data-hole="${ids[0]}"]`)).toBeNull();
  });

  it('falls back to the first hole when the selected hole is removed', () => {
    const { workshop, state, grid, ids } = heatmapFixture();
    workshop.setEnergyHeatmapVisible(true);
    workshop.update(state, 'sunny');
    pickSectionHole(workshop.root, ids[2]);
    workshop.update(state, 'sunny');

    state.drillHoles.splice(state.drillHoles.findIndex(h => h.id === ids[2]), 1);
    delete state.chargesByHole[ids[2]];
    workshop.update(state, 'sunny');

    const select = workshop.root.querySelector<HTMLSelectElement>(SECTION_HOLE)!;
    expect(Array.from(select.options).map(o => o.value)).toEqual([ids[0], ids[1]]);
    expect(select.value).toBe(ids[0]);
    expect(sectionCells(workshop.root)).toHaveLength(expectedSection(state, grid, 12).length);
  });

  it('redraws when a charge changes', () => {
    const { workshop, state, ids } = heatmapFixture();
    workshop.setEnergyHeatmapVisible(true);
    workshop.update(state, 'sunny');
    const before = sectionCells(workshop.root).map(c => c.dataset['intensity']).join(',');

    chargeHole(state, ids[0], 8, 3, 4);
    workshop.update(state, 'sunny');
    const after = sectionCells(workshop.root).map(c => c.dataset['intensity']).join(',');
    expect(after).not.toBe(before);
  });

  it('shows no cells and offers no hole for an empty plan, without throwing', () => {
    const { workshop } = makeWorkshop();
    workshop.setGridProvider(() => rockGrid());
    workshop.show();
    workshop.setEnergyHeatmapVisible(true);
    expect(() => workshop.update(makeState(), 'sunny')).not.toThrow();
    expect(sectionCells(workshop.root)).toHaveLength(0);
    expect(workshop.root.querySelector<HTMLSelectElement>(SECTION_HOLE)?.options.length ?? 0).toBe(0);
  });

  it('shows no cells when holes carry no charge', () => {
    const { workshop } = makeWorkshop();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 12, 12, 8, 0.15);
    workshop.setGridProvider(() => rockGrid());
    workshop.show();
    workshop.setEnergyHeatmapVisible(true);
    workshop.update(state, 'sunny');
    expect(sectionCells(workshop.root)).toHaveLength(0);
  });

  it('shows no cells, and does not throw, without a grid', () => {
    const { workshop } = makeWorkshop();
    const state = makeState();
    const hole = addHole(holeCounter, state.drillHoles, 12, 12, 8, 0.15);
    chargeHole(state, hole.id, hole.depth);
    workshop.show();
    workshop.setEnergyHeatmapVisible(true);
    expect(() => workshop.update(state, 'sunny')).not.toThrow();
    expect(sectionCells(workshop.root)).toHaveLength(0);
  });

  it('#2200 C8: an overcharged hole under heavy stemming reads fines or dust at its charge and intact or cracked near the collar', () => {
    const { workshop } = makeWorkshop();
    const state = makeState();
    const hole = addHole(holeCounter, state.drillHoles, 12, 12, 8, 0.15);
    chargeHole(state, hole.id, hole.depth, 8, 4);
    workshop.setGridProvider(() => rockGrid());
    workshop.show();
    workshop.setEnergyHeatmapVisible(true);
    workshop.update(state, 'sunny');

    const section = workshop.root.querySelector(SECTION)!;
    const marked = Array.from(section.querySelectorAll<HTMLElement>(`[data-hole="${hole.id}"]`));
    expect(marked.length).toBeGreaterThan(0);
    const column = marked.flatMap(el => (el.matches('[data-band]') ? [el] : Array.from(el.querySelectorAll<HTMLElement>('[data-band]'))));
    expect(column.length).toBeGreaterThan(3);

    // Top to bottom: the collar under its stemming is coarse, the charge at the bottom of the hole is
    // ground fine, and the floor under the hole's bottom keeps none of the energy, so it stays intact.
    const bands = column.map(c => c.dataset['band']!);
    const fine = (b: string) => b === 'fines' || b === 'dust';
    const coarse = (b: string) => b === 'intact' || b === 'cracked';
    expect(coarse(bands[0]!)).toBe(true);
    const lastFine = bands.map(fine).lastIndexOf(true);
    expect(lastFine).toBeGreaterThan(0);
    expect(bands.slice(lastFine + 1).every(b => b === 'intact')).toBe(true);
  });
});
