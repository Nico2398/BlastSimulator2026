// BlastSimulator2026 — Build Menu UI (CH1.7)
// Shows building catalog with tier selection; clicking enters placement mode.
// Also lists placed buildings with Move, Upgrade, and Demolish actions.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import {
  getAllBuildingTypes,
  getBuildingDef,
  type BuildingType,
  type BuildingTier,
  type Building,
} from '../core/entities/Building.js';
import { TileSelectOverlay } from './TileSelectOverlay.js';

export type GameConsoleFn = (cmd: string) => string;

export class BuildMenu {
  private readonly el: HTMLElement;
  private readonly catalogEl: HTMLElement;
  private readonly placedEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly tileSelect: TileSelectOverlay;
  private gameConsole?: GameConsoleFn;
  private worldSizeX = 40;
  private worldSizeZ = 40;
  /** Selected placement tier per building type. */
  private readonly selectedTiers = new Map<BuildingType, BuildingTier>();
  /** Last cash value used for button state refresh. */
  private lastCash = -1;
  /** Last placed-building count for change detection. */
  private lastPlacedCount = -1;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bs-build-panel';
    this.el.classList.add('bs-ui', 'bs-panel');
    this.el.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'bs-panel-title';
    title.textContent = t('ui.build.title');

    this.catalogEl = document.createElement('div');
    this.catalogEl.id = 'bs-build-catalog';

    const placedTitle = document.createElement('div');
    placedTitle.style.cssText =
      'font-size:10px;color:#c0a060;margin-top:8px;font-weight:bold;' +
      'text-transform:uppercase;letter-spacing:0.05em';
    placedTitle.textContent = t('ui.build.placed_buildings');

    this.placedEl = document.createElement('div');
    this.placedEl.id = 'bs-build-placed';

    this.statusEl = document.createElement('div');
    this.statusEl.style.cssText = 'font-size:10px;color:#a08060;margin-top:6px;min-height:14px';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bs-btn';
    closeBtn.style.cssText = 'width:100%;margin-top:6px';
    closeBtn.textContent = t('ui.build.close');
    closeBtn.addEventListener('click', () => this.hide());

    this.el.append(title, this.catalogEl, placedTitle, this.placedEl, this.statusEl, closeBtn);
    container.appendChild(this.el);

    // TileSelectOverlay appended to document.body so it escapes panel stacking context
    this.tileSelect = new TileSelectOverlay(document.body);
    this.buildCatalog();
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  show(): void { this.el.style.display = ''; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  update(state: GameState): void {
    if (state.world) {
      this.worldSizeX = state.world.sizeX;
      this.worldSizeZ = state.world.sizeZ;
    }
    if (state.cash !== this.lastCash) {
      this.lastCash = state.cash;
      this.refreshCatalogButtons(state.cash);
    }
    const placedCount = state.buildings.buildings.length;
    if (placedCount !== this.lastPlacedCount) {
      this.lastPlacedCount = placedCount;
      this.refreshPlacedList(state.buildings.buildings);
    }
  }

  setStatus(msg: string): void {
    this.statusEl.textContent = msg;
    setTimeout(() => { if (this.statusEl.textContent === msg) this.statusEl.textContent = ''; }, 3000);
  }

  dispose(): void { this.el.remove(); this.tileSelect.dispose(); }

  // ── Catalog (place new buildings) ──────────────────────────────────────────

  private buildCatalog(): void {
    this.catalogEl.innerHTML = '';
    for (const type of getAllBuildingTypes()) {
      this.catalogEl.appendChild(this.makeCatalogRow(type));
    }
  }

  private makeCatalogRow(type: BuildingType): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bs-build-row';
    row.dataset['buildType'] = type;

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0';

    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-size:11px;color:#d0b090;font-weight:bold';
    nameEl.textContent = t(`building.${type}.name`);

    const costEl = document.createElement('div');
    costEl.className = 'bs-build-cost';
    costEl.style.cssText = 'font-size:10px;color:#a08060';
    this.updateCostDisplay(costEl, type, 1);
    info.append(nameEl, costEl);

    // Tier selector
    const tierSel = document.createElement('select');
    tierSel.className = 'bs-input bs-build-tier-sel';
    tierSel.style.cssText = 'font-size:10px;width:48px;padding:1px 2px;margin-right:4px';
    tierSel.title = t('ui.build.select_tier');
    for (const tier of [1, 2, 3] as BuildingTier[]) {
      const opt = document.createElement('option');
      opt.value = String(tier);
      opt.textContent = `T${tier}`;
      tierSel.appendChild(opt);
    }
    tierSel.value = '1';
    tierSel.addEventListener('change', () => {
      const selected = parseInt(tierSel.value, 10) as BuildingTier;
      this.selectedTiers.set(type, selected);
      this.updateCostDisplay(costEl, type, selected);
    });

    const placeBtn = document.createElement('button');
    placeBtn.className = 'bs-btn bs-btn-primary bs-build-buy-btn';
    placeBtn.style.cssText = 'padding:2px 8px;font-size:10px;white-space:nowrap';
    placeBtn.textContent = t('ui.build.place');
    placeBtn.addEventListener('click', () => {
      const tier = (this.selectedTiers.get(type) ?? 1) as BuildingTier;
      this.tileSelect.open({
        mode: 'point',
        worldSizeX: this.worldSizeX,
        worldSizeZ: this.worldSizeZ,
        title: t(`building.${type}.t${tier}.name`),
        onConfirm: (result) => {
          const output = this.gameConsole?.(`build ${type} at:${result.x},${result.z} tier:${tier}`);
          const placed = output?.startsWith('Built');
          this.setStatus(placed ? t('ui.build.placed') : (output ?? t('ui.build.invalid_placement')));
        },
      });
    });

    row.append(info, tierSel, placeBtn);
    return row;
  }

  private updateCostDisplay(el: HTMLElement, type: BuildingType, tier: BuildingTier): void {
    const def = getBuildingDef(type, tier);
    el.textContent = t('ui.build.cost', { cost: String(def.constructionCost) });
  }

  private refreshCatalogButtons(cash: number): void {
    const rows = this.catalogEl.querySelectorAll<HTMLElement>('.bs-build-row');
    rows.forEach((row) => {
      const type = row.dataset['buildType'] as BuildingType | undefined;
      if (!type) return;
      const tier = (this.selectedTiers.get(type) ?? 1) as BuildingTier;
      const def = getBuildingDef(type, tier);
      const btn = row.querySelector('.bs-build-buy-btn') as HTMLButtonElement | null;
      if (btn) btn.disabled = cash < def.constructionCost;
    });
  }

  // ── Placed buildings list ──────────────────────────────────────────────────

  private refreshPlacedList(buildings: Building[]): void {
    this.placedEl.innerHTML = '';
    if (buildings.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:10px;color:#806040;padding:2px 0';
      empty.textContent = t('ui.build.none_placed');
      this.placedEl.appendChild(empty);
      return;
    }
    for (const b of buildings) {
      this.placedEl.appendChild(this.makePlacedRow(b));
    }
  }

  private makePlacedRow(b: Building): HTMLElement {
    const def = getBuildingDef(b.type, b.tier);
    const row = document.createElement('div');
    row.className = 'bs-build-placed-row';
    row.style.cssText =
      'display:flex;align-items:center;gap:4px;padding:2px 0;' +
      'border-bottom:1px solid rgba(200,160,60,0.1)';

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;font-size:10px;color:#c0a060;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    info.title = `${b.type} T${b.tier} at (${b.x},${b.z})`;
    info.textContent = `#${b.id} ${t(`building.${b.type}.t${b.tier}.name`)} (${b.x},${b.z})`;

    const moveBtn = document.createElement('button');
    moveBtn.className = 'bs-btn';
    moveBtn.style.cssText = 'padding:1px 5px;font-size:9px';
    moveBtn.textContent = t('ui.build.move');
    moveBtn.addEventListener('click', () => {
      this.tileSelect.open({
        mode: 'point',
        worldSizeX: this.worldSizeX,
        worldSizeZ: this.worldSizeZ,
        title: `${t('ui.build.move')} #${b.id}`,
        onConfirm: (result) => {
          const output = this.gameConsole?.(`build move ${b.id} to:${result.x},${result.z}`);
          this.setStatus(output?.startsWith('Building') ? t('ui.build.moved') : (output ?? ''));
        },
      });
    });

    const upgradeBtn = document.createElement('button');
    upgradeBtn.className = 'bs-btn bs-btn-primary';
    upgradeBtn.style.cssText = 'padding:1px 5px;font-size:9px';
    upgradeBtn.textContent = t('ui.build.upgrade');
    upgradeBtn.disabled = b.tier >= 3;
    if (b.tier < 3) {
      const nextDef = getBuildingDef(b.type, (b.tier + 1) as BuildingTier);
      upgradeBtn.title = `$${def.demolishCost + nextDef.constructionCost}`;
    }
    upgradeBtn.addEventListener('click', () => {
      const output = this.gameConsole?.(`build upgrade ${b.id}`);
      this.setStatus(output?.startsWith('Upgraded') ? t('ui.build.upgraded') : (output ?? ''));
    });

    const demolishBtn = document.createElement('button');
    demolishBtn.className = 'bs-btn';
    demolishBtn.style.cssText = 'padding:1px 5px;font-size:9px;color:#ff6644';
    demolishBtn.textContent = t('ui.build.demolish');
    demolishBtn.title = `$${def.demolishCost}`;
    demolishBtn.addEventListener('click', () => {
      const output = this.gameConsole?.(`build destroy ${b.id}`);
      this.setStatus(output?.startsWith('Building') ? t('ui.build.demolished') : (output ?? ''));
    });

    row.append(info, moveBtn, upgradeBtn, demolishBtn);
    return row;
  }
}
