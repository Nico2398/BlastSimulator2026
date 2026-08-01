// BlastSimulator2026 — Build Menu UI (CH1.7)
// Shows building catalog with tier selection; clicking enters placement mode.
// Also lists placed buildings with Move, Upgrade, and Demolish actions.

import { t } from '../core/i18n/I18n.js';
import { LocaleTextRegistry } from './localeText.js';
import type { GameState } from '../core/state/GameState.js';
import {
  getAllBuildingTypes,
  getBuildingDef,
  isTierUnlocked,
  isResearchQueued,
  type BuildingType,
  type BuildingTier,
  type Building,
} from '../core/entities/Building.js';
import { TileSelectOverlay } from './TileSelectOverlay.js';
import { makeSiteTileFill } from './siteTileShading.js';

import type { CommandResult } from '../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

export class BuildMenu {
  private readonly el: HTMLElement;
  private readonly catalogEl: HTMLElement;
  private readonly placedEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly tileSelect: TileSelectOverlay;
  private gameConsole?: GameConsoleFn;
  private worldSizeX = 40;
  private worldSizeZ = 40;
  /** Latest state, so the placement picker can draw the site. */
  private lastState: GameState | null = null;
  /** Selected placement tier per building type. */
  private readonly selectedTiers = new Map<BuildingType, BuildingTier>();
  /** Last cash value used for button state refresh. */
  private lastCash = -1;
  /** Last placed-building signature (id:tier pairs) for change detection.
   *  Building count alone misses an upgrade, which destroys the old id and
   *  places a new one — the count stays flat while the id and tier both change. */
  private lastPlacedSignature = '';
  /** Serialized `unlockedTiers` for change detection — a completed research
   *  task changes tier availability without changing cash or placed count. */
  private lastUnlockedSignature = '';
  /** Serialized `researchQueue` contents for change detection — queuing
   *  research hides the "Queue Research" button without changing cash,
   *  placed count, or unlockedTiers. */
  private lastResearchQueueSignature = '';
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bs-build-panel';
    this.el.classList.add('bs-ui', 'bs-panel');
    this.el.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'bs-panel-title';
    this.locale.bindText(title, 'ui.build.title');

    this.catalogEl = document.createElement('div');
    this.catalogEl.id = 'bs-build-catalog';

    const placedTitle = document.createElement('div');
    placedTitle.style.cssText =
      'font-size:10px;color:#c0a060;margin-top:8px;font-weight:bold;' +
      'text-transform:uppercase;letter-spacing:0.05em';
    this.locale.bindText(placedTitle, 'ui.build.placed_buildings');

    this.placedEl = document.createElement('div');
    this.placedEl.id = 'bs-build-placed';

    this.statusEl = document.createElement('div');
    this.statusEl.style.cssText = 'font-size:10px;color:#a08060;margin-top:6px;min-height:14px';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bs-btn';
    closeBtn.style.cssText = 'width:100%;margin-top:6px';
    this.locale.bindText(closeBtn, 'ui.build.close');
    closeBtn.addEventListener('click', () => this.hide());

    this.el.append(
      title, this.catalogEl,
      this.makeRampSection(),
      placedTitle, this.placedEl, this.statusEl, closeBtn,
    );
    container.appendChild(this.el);

    // TileSelectOverlay appended to document.body so it escapes panel stacking context
    this.tileSelect = new TileSelectOverlay(document.body);
    this.buildCatalog();
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  /** Re-render locale-dependent text (catalog, placed list, sections) after a language change. */
  refreshLocale(): void {
    this.locale.refresh();
    // Catalog and placed rows are built on demand, not per tick, so they keep
    // the previous locale until something structural changes. Rebuild both.
    this.buildCatalog();
    this.refreshCatalogButtons(this.lastCash);
    this.refreshPlacedList(this.lastState?.buildings.buildings ?? []);
  }

  show(): void { this.el.style.display = ''; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  update(state: GameState): void {
    this.lastState = state;
    if (state.world) {
      this.worldSizeX = state.world.sizeX;
      this.worldSizeZ = state.world.sizeZ;
    }
    if (state.cash !== this.lastCash) {
      this.lastCash = state.cash;
      this.refreshCatalogButtons(state.cash);
    }
    const placedSig = state.buildings.buildings.map((b) => `${b.id}:${b.tier}`).join(',');
    const unlockedSig = JSON.stringify(state.buildings.unlockedTiers);
    const unlockedChanged = unlockedSig !== this.lastUnlockedSignature;
    if (unlockedChanged) this.lastUnlockedSignature = unlockedSig;
    const queueSig = state.buildings.researchQueue.map((r) => `${r.targetType}:${r.targetTier}`).join(',');
    const queueChanged = queueSig !== this.lastResearchQueueSignature;
    if (queueChanged) this.lastResearchQueueSignature = queueSig;
    if (placedSig !== this.lastPlacedSignature || unlockedChanged || queueChanged) {
      this.lastPlacedSignature = placedSig;
      this.refreshPlacedList(state.buildings.buildings);
    }
    if (unlockedChanged || queueChanged) this.refreshCatalogButtons(state.cash);
  }

  setStatus(msg: string): void {
    this.statusEl.textContent = msg;
    setTimeout(() => { if (this.statusEl.textContent === msg) this.statusEl.textContent = ''; }, 3000);
  }

  dispose(): void { this.el.remove(); this.tileSelect.dispose(); }

  /**
   * Queue a Research Center task for `type` tier `tier` and report progress.
   * Shared by the catalog row (place-blocked) and the placed-row (upgrade-blocked)
   * "Queue Research" buttons — the only in-game path to unlock tier 2/3.
   */
  private queueResearch(type: BuildingType, tier: BuildingTier): void {
    if (tier === 1) return;
    const cmdResult = this.gameConsole?.(`research queue type:${type} tier:${tier}`);
    if (!cmdResult?.success) {
      this.setStatus(t(BuildMenu.RESEARCH_FAILURE_KEYS[cmdResult?.code ?? ''] ?? 'ui.build.research_queue_failed'));
      return;
    }
    const task = this.lastState?.buildings.researchQueue.find(
      (r) => r.targetType === type && r.targetTier === tier,
    );
    this.setStatus(
      task ? t('ui.build.research_queued', { ticks: task.ticksRemaining }) : t('ui.build.research_queued_generic'),
    );
    this.refreshCatalogButtons(this.lastCash);
    if (this.lastState) this.refreshPlacedList(this.lastState.buildings.buildings);
  }

  /** Maps `research queue`'s failure `code` (src/console/commands/research.ts)
   *  to a translated status message — the raw `output` is core's plain-English
   *  string and must never reach the player. */
  private static readonly RESEARCH_FAILURE_KEYS: Record<string, string> = {
    no_research_center: 'ui.build.research_failed_no_research_center',
    already_unlocked: 'ui.build.research_failed_already_unlocked',
    already_queued: 'ui.build.research_failed_already_queued',
    conditions_not_met: 'ui.build.research_failed_conditions_not_met',
    insufficient_funds: 'ui.build.research_failed_insufficient_funds',
    usage: 'ui.build.research_queue_failed',
  };

  // ── Ramp (carved terrain, not a building) ─────────────────────────────────

  /**
   * Ramps are carved into the voxel grid rather than placed as a building, so
   * they need their own control: drag the run from the upper bench to the lower.
   */
  private makeRampSection(): HTMLElement {
    const wrap = document.createElement('div');

    const header = document.createElement('div');
    header.className = 'bs-section-header';
    header.style.marginTop = '8px';
    this.locale.bindText(header, 'ui.build.ramp_section');

    const btn = document.createElement('button');
    btn.className = 'bs-btn bs-btn-primary bs-build-ramp-btn';
    btn.style.cssText = 'width:100%';
    this.locale.bindText(btn, 'ui.build.ramp');
    btn.addEventListener('click', () => {
      this.tileSelect.open({
        mode: 'area',
        worldSizeX: this.worldSizeX,
        worldSizeZ: this.worldSizeZ,
        title: t('ui.build.ramp'),
        ...(this.lastState ? { tileFill: makeSiteTileFill(this.lastState) } : {}),
        extraFields: [
          { id: 'depth', label: t('ui.build.ramp_depth'), defaultValue: 8, min: 1, max: 40, step: 1 },
        ],
        onConfirm: (result) => {
          const x2 = result.x2 ?? result.x;
          const z2 = result.z2 ?? result.z;
          const depth = result.fields['depth'] ?? 8;
          const cmd = this.gameConsole?.(
            `build_ramp start:${result.x},${result.z} end:${x2},${z2} depth:${depth}`,
          );
          this.setStatus(cmd?.success ? t('ui.build.ramp_built') : (cmd?.output ?? ''));
        },
      });
    });

    wrap.append(header, btn);
    return wrap;
  }

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
    // A basis rather than pure flex:1 — with a nowrap action button the name
    // column collapsed to nothing and the label overflowed across the controls.
    info.style.cssText = 'flex:1 1 50%;min-width:0;overflow-wrap:break-word';

    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-size:11px;color:#d0b090;font-weight:bold';
    nameEl.textContent = t(`building.${type}.name`);

    const costEl = document.createElement('div');
    costEl.className = 'bs-build-cost';
    // nowrap: the French format puts the currency symbol after the amount, so
    // "12000 $" broke across two lines and pushed the row out of shape.
    costEl.style.cssText = 'font-size:10px;color:#a08060;white-space:nowrap';
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
    tierSel.value = String(this.selectedTiers.get(type) ?? 1);
    tierSel.addEventListener('change', () => {
      const selected = parseInt(tierSel.value, 10) as BuildingTier;
      this.selectedTiers.set(type, selected);
      this.updateCostDisplay(costEl, type, selected);
      this.refreshCatalogButtons(this.lastCash);
    });

    const placeBtn = document.createElement('button');
    placeBtn.className = 'bs-btn bs-btn-primary bs-build-buy-btn';
    placeBtn.style.cssText = 'padding:2px 8px;font-size:10px;white-space:normal;line-height:1.25;flex:0 1 auto;min-width:0';
    placeBtn.textContent = t('ui.build.place');
    placeBtn.addEventListener('click', () => {
      const tier = (this.selectedTiers.get(type) ?? 1) as BuildingTier;
      if (tier > 1 && this.lastState && !isTierUnlocked(this.lastState.buildings, type, tier)) {
        this.setStatus(t('ui.build.research_required', { tier }));
        return;
      }
      this.tileSelect.open({
        mode: 'point',
        worldSizeX: this.worldSizeX,
        worldSizeZ: this.worldSizeZ,
        title: t(`building.${type}.t${tier}.name`),
        ...(this.lastState ? { tileFill: makeSiteTileFill(this.lastState) } : {}),
        onConfirm: (result) => {
          const cmdResult = this.gameConsole?.(`build ${type} at:${result.x},${result.z} tier:${tier}`);
          this.setStatus(cmdResult?.success ? t('ui.build.placed') : (cmdResult?.output ?? t('ui.build.invalid_placement')));
        },
      });
    });

    const researchBtn = document.createElement('button');
    researchBtn.className = 'bs-btn bs-build-research-btn';
    researchBtn.style.cssText = 'padding:2px 6px;font-size:10px;white-space:normal;line-height:1.25;flex:0 1 auto;min-width:0;display:none';
    researchBtn.textContent = t('ui.build.queue_research_button');
    researchBtn.addEventListener('click', () => {
      const tier = (this.selectedTiers.get(type) ?? 1) as BuildingTier;
      this.queueResearch(type, tier);
    });

    row.append(info, tierSel, placeBtn, researchBtn);
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
      const locked = tier > 1 && !!this.lastState && !isTierUnlocked(this.lastState.buildings, type, tier);
      const queued = locked && !!this.lastState && isResearchQueued(this.lastState.buildings, type, tier);
      const btn = row.querySelector('.bs-build-buy-btn') as HTMLButtonElement | null;
      if (btn) btn.disabled = cash < def.constructionCost || locked;
      const researchBtn = row.querySelector('.bs-build-research-btn') as HTMLButtonElement | null;
      if (researchBtn) researchBtn.style.display = locked && !queued ? '' : 'none';
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
    row.dataset['buildingId'] = String(b.id);
    row.style.cssText =
      'display:flex;align-items:center;gap:4px;padding:2px 0;' +
      'border-bottom:1px solid rgba(200,160,60,0.1)';

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;font-size:10px;color:#c0a060;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    info.title = `${b.type} T${b.tier} at (${b.x},${b.z})`;
    info.textContent = `#${b.id} ${t(`building.${b.type}.t${b.tier}.name`)} (${b.x},${b.z})`;

    const moveBtn = document.createElement('button');
    moveBtn.className = 'bs-btn bs-build-move-btn';
    moveBtn.style.cssText = 'padding:1px 5px;font-size:9px';
    moveBtn.textContent = t('ui.build.move');
    moveBtn.addEventListener('click', () => {
      this.tileSelect.open({
        mode: 'point',
        worldSizeX: this.worldSizeX,
        worldSizeZ: this.worldSizeZ,
        title: `${t('ui.build.move')} #${b.id}`,
        ...(this.lastState ? { tileFill: makeSiteTileFill(this.lastState) } : {}),
        onConfirm: (result) => {
          const cmdResult = this.gameConsole?.(`build move ${b.id} to:${result.x},${result.z}`);
          this.setStatus(cmdResult?.success ? t('ui.build.moved') : (cmdResult?.output ?? ''));
        },
      });
    });

    const nextTier = b.tier < 3 ? ((b.tier + 1) as BuildingTier) : null;
    const nextLocked = nextTier !== null && !!this.lastState && !isTierUnlocked(this.lastState.buildings, b.type, nextTier);
    const nextQueued = nextTier !== null && nextLocked && !!this.lastState && isResearchQueued(this.lastState.buildings, b.type, nextTier);

    const upgradeBtn = document.createElement('button');
    upgradeBtn.className = 'bs-btn bs-btn-primary bs-build-upgrade-btn';
    upgradeBtn.style.cssText = 'padding:1px 5px;font-size:9px';
    upgradeBtn.textContent = t('ui.build.upgrade');
    upgradeBtn.disabled = nextTier === null;
    if (nextTier !== null) {
      const nextDef = getBuildingDef(b.type, nextTier);
      upgradeBtn.title = `$${def.demolishCost + nextDef.constructionCost}`;
    }
    upgradeBtn.addEventListener('click', () => {
      if (nextTier !== null && nextLocked) {
        this.setStatus(t('ui.build.research_required', { tier: nextTier }));
        return;
      }
      const cmdResult = this.gameConsole?.(`build upgrade ${b.id}`);
      this.setStatus(cmdResult?.success ? t('ui.build.upgraded') : (cmdResult?.output ?? ''));
    });

    const researchBtn = document.createElement('button');
    researchBtn.className = 'bs-btn bs-build-research-btn';
    researchBtn.style.cssText = 'padding:1px 5px;font-size:9px';
    researchBtn.textContent = t('ui.build.queue_research_button');
    researchBtn.style.display = nextTier !== null && nextLocked && !nextQueued ? '' : 'none';
    researchBtn.addEventListener('click', () => {
      if (nextTier !== null) this.queueResearch(b.type, nextTier);
    });

    const demolishBtn = document.createElement('button');
    demolishBtn.className = 'bs-btn bs-build-demolish-btn';
    demolishBtn.style.cssText = 'padding:1px 5px;font-size:9px;color:#ff6644';
    demolishBtn.textContent = t('ui.build.demolish');
    demolishBtn.title = `$${def.demolishCost}`;
    demolishBtn.addEventListener('click', () => {
      const cmdResult = this.gameConsole?.(`build destroy ${b.id}`);
      this.setStatus(cmdResult?.success ? t('ui.build.demolished') : (cmdResult?.output ?? ''));
    });

    row.append(info, moveBtn, upgradeBtn, researchBtn, demolishBtn);
    return row;
  }
}
