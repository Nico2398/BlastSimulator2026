// BlastSimulator2026 — Build panel (CH1.7, redesign P10)
// Catalog of buildable types with tier selection; clicking arms the shared
// placement tool. Also lists placed buildings with Move, Upgrade, Queue
// Research, and Demolish actions. Terrain ramps (carved, not a building)
// get their own small section between the two lists.
//
// Root id, the catalog rows' `data-build-type`, the buy button's
// `.bs-build-buy-btn`, and the ramp button's `.bs-build-ramp-btn` are
// preserved from the pre-redesign panel so tutorialStages.ts keeps
// resolving `#bs-build-panel [data-build-type="freight_warehouse"]
// .bs-build-buy-btn` and `#bs-build-panel .bs-build-ramp-btn` unchanged —
// same convention ContractsPanel.ts established for #bs-contract-panel in
// P5. `.bs-build-tier-sel` (catalog tier `<select>`), `.bs-build-placed-row`
// + `data-building-id` (placed rows), and `.bs-build-move-btn`
// /`.bs-build-upgrade-btn`/`.bs-build-research-btn`/`.bs-build-demolish-btn`
// (placed-row actions) are additionally load-bearing — scenario defs
// (research-center-gate, building-tier-system-visual) and
// BuildMenu.test.ts (#462, placed-row layout) all click or assert on them
// directly, so they carry over unchanged too.
//
// This was the one panel the P0-P9 redesign never reached — still the
// pre-redesign `.bs-ui`/`.bs-panel` dark/gold chrome with a plain text
// title and a bottom Close button. This pass is chrome-only: same catalog
// logic, same placed-row logic, same ramp tool, same research-queue
// handling, just rebuilt onto the shared `bsx-root` docked-panel
// convention (46px header with icon chip + title + close button,
// scrollable body) that every other panel already uses.

import { t } from '../core/i18n/I18n.js';
import { el, button, emptyState } from './dom.js';
import { iconEl } from './icons.js';
import { LocaleTextRegistry } from './localeText.js';
import type { GameState } from '../core/state/GameState.js';
import {
  getAllBuildingTypes,
  getBuildingDef,
  getDemolishCost,
  getUpgradeCost,
  getMoveCost,
  isTierUnlocked,
  isResearchQueued,
  type BuildingType,
  type BuildingTier,
  type Building,
} from '../core/entities/Building.js';
import { placementRefusalReason, type PlacementKit } from './scene/PlacementKit.js';

import type { CommandResult } from '../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

export class BuildMenu {
  private readonly el: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly catalogEl: HTMLElement;
  private readonly placedEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private placementKit: PlacementKit | null = null;
  private rampDepth = 8;
  private gameConsole?: GameConsoleFn;
  private onCloseCb?: () => void;
  /** Latest state, for tier-unlock checks before arming the placement tool. */
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
    this.el = el('div', { className: 'bsx-root', attrs: { id: 'bs-build-panel' } });
    this.el.style.cssText = [
      'flex-direction:column', 'width:372px', 'max-height:100%',
      'border-radius:8px', 'background:var(--bsx-panel)', 'border:1px solid var(--bsx-hairline-strong)',
      'box-shadow:0 18px 44px rgba(0,0,0,.55)', 'overflow:hidden', 'pointer-events:all',
    ].join(';');
    this.el.style.display = 'none';

    const header = el('div');
    header.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;gap:10px;height:46px;padding:0 12px;background:#1a2028;border-bottom:1px solid var(--bsx-hairline)';
    const iconChip = el('div', { children: [iconEl('build', 15)] });
    iconChip.style.cssText = 'width:26px;height:26px;border-radius:5px;display:flex;align-items:center;justify-content:center;background:rgba(255,176,46,.14);color:var(--bsx-amber)';
    const titleEl = this.locale.bindText(
      el('div', { attrs: { style: 'font:700 12px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-primary)' } }),
      'ui.build.title',
    );
    const closeBtn = el('button', { children: [iconEl('x', 12)] });
    closeBtn.style.cssText = 'margin-left:auto;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:1px solid var(--bsx-hairline-strong);border-radius:4px;background:transparent;color:var(--bsx-text-muted);cursor:pointer';
    closeBtn.addEventListener('click', () => this.onCloseCb?.());
    header.append(iconChip, titleEl, closeBtn);

    this.bodyEl = el('div');
    this.bodyEl.style.cssText = 'flex:1 1 auto;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px';

    this.catalogEl = el('div');
    this.catalogEl.id = 'bs-build-catalog';
    this.catalogEl.style.cssText = 'display:flex;flex-direction:column;gap:8px';

    this.placedEl = el('div');
    this.placedEl.id = 'bs-build-placed';
    this.placedEl.style.cssText = 'display:flex;flex-direction:column;gap:6px';

    this.statusEl = el('div', {
      attrs: { style: 'font:400 10px/1.4 var(--bsx-font-ui);color:var(--bsx-text-micro);min-height:14px' },
    });

    this.bodyEl.append(
      this.catalogEl,
      this.makeRampSection(),
      this.sectionLabel('ui.build.placed_buildings'),
      this.placedEl,
      this.statusEl,
    );
    this.el.append(header, this.bodyEl);
    container.appendChild(this.el);

    this.buildCatalog();
  }

  get root(): HTMLElement { return this.el; }
  setCloseHandler(cb: () => void): void { this.onCloseCb = cb; }
  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }
  setPlacementKit(kit: PlacementKit): void { this.placementKit = kit; }

  /** Re-render locale-dependent text (catalog, placed list, sections) after a language change. */
  refreshLocale(): void {
    this.locale.refresh();
    // Catalog and placed rows are built on demand, not per tick, so they keep
    // the previous locale until something structural changes. Rebuild both.
    this.buildCatalog();
    this.refreshCatalogButtons(this.lastCash);
    this.refreshPlacedList(this.lastState?.buildings.buildings ?? []);
  }

  show(): void { this.el.style.display = 'flex'; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  update(state: GameState): void {
    this.lastState = state;
    if (state.cash !== this.lastCash) {
      this.lastCash = state.cash;
      this.refreshCatalogButtons(state.cash);
      this.refreshPlacedButtons(state.cash);
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

  dispose(): void { this.el.remove(); }

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

  // ── Section headers (bsx-section look, static text bound for locale refresh) ──

  private sectionLabel(key: string): HTMLElement {
    const wrap = el('div', { className: 'bsx-section' });
    const label = this.locale.bindText(el('span', { className: 'bsx-section-label' }), key);
    wrap.append(label, el('span', { className: 'bsx-section-rule' }));
    return wrap;
  }

  // ── Ramp (carved terrain, not a building) ─────────────────────────────────

  /**
   * Ramps are carved into the voxel grid rather than placed as a building, so
   * they need their own control: drag the run from the upper bench to the lower.
   */
  private makeRampSection(): HTMLElement {
    const wrap = el('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px';

    const btn = el('button', { className: 'bsx-btn bsx-btn-primary bs-build-ramp-btn' });
    btn.style.cssText = 'width:100%';
    this.locale.bindText(btn, 'ui.build.ramp');
    btn.addEventListener('click', () => this.armRampTool());

    wrap.append(this.sectionLabel('ui.build.ramp_section'), btn);
    return wrap;
  }

  /** Ramps are a line drag (start → end), not a rectangle — the corridor width comes from the vehicle profile, not the drag. */
  private armRampTool(): void {
    const kit = this.placementKit;
    if (!kit) return;
    const { controller, overlay, strip } = kit;
    if (controller.isArmed) { controller.cancel(); return; }

    const refresh = (): void => {
      if (controller.currentPhase === 'idle') { overlay.clear(); strip.hide(); return; }
      const sel = controller.selection;
      overlay.update(sel ? { shape: 'line', x1: sel.x1, z1: sel.z1, x2: sel.x2, z2: sel.z2 } : null);
      const tiles = sel ? Math.round(Math.hypot(sel.x2 - sel.x1, sel.z2 - sel.z1)) + 1 : 0;
      strip.show({
        icon: 'down',
        title: t('ui.build.ramp'),
        subtitle: '',
        fields: [
          { key: 'depth', label: t('ui.build.ramp_depth'), value: this.rampDepth, format: v => `${v}m`, onDec: () => { this.rampDepth = Math.max(1, this.rampDepth - 1); refresh(); }, onInc: () => { this.rampDepth = Math.min(40, this.rampDepth + 1); refresh(); } },
        ],
        result: sel ? `${tiles} ${t('ui.tile_select.tiles')}` : '—',
        confirmEnabled: controller.canConfirm,
        confirmDisabledReason: placementRefusalReason(controller),
        instruction: t('ui.build.ramp_instruction'),
      });
    };

    controller.setConfirmHandler((sel) => {
      const cmd = this.gameConsole?.(`build_ramp start:${sel.x1},${sel.z1} end:${sel.x2},${sel.z2} depth:${this.rampDepth}`);
      this.setStatus(cmd?.success ? t('ui.build.ramp_built') : (cmd?.output ?? ''));
      overlay.flashConfirm();
    });
    controller.setChangeHandler(refresh);
    controller.arm({ shape: 'line' });
    refresh();
  }

  /** Point + real footprint ghost, shared by placing a new building and moving an existing one. */
  private armBuildingPointTool(type: BuildingType, tier: BuildingTier, title: string, onConfirm: (x: number, z: number) => void): void {
    const kit = this.placementKit;
    if (!kit) return;
    const { controller, overlay, strip } = kit;
    if (controller.isArmed) { controller.cancel(); return; }
    const def = getBuildingDef(type, tier);

    const refresh = (): void => {
      if (controller.currentPhase === 'idle') { overlay.clear(); strip.hide(); return; }
      const sel = controller.selection;
      overlay.update(sel ? { shape: 'point', x: sel.x1, z: sel.z1, footprintCells: def.footprint } : null);
      strip.show({
        icon: 'build',
        title,
        subtitle: `$${def.constructionCost.toLocaleString('en-US')}`,
        fields: [],
        result: sel ? `(${sel.x1}, ${sel.z1})` : '—',
        confirmEnabled: controller.canConfirm,
        confirmDisabledReason: placementRefusalReason(controller),
        instruction: t('ui.build.place_instruction'),
      });
    };

    controller.setConfirmHandler((sel) => {
      onConfirm(sel.x1, sel.z1);
      overlay.flashConfirm();
    });
    controller.setChangeHandler(refresh);
    controller.arm({ shape: 'point' });
    refresh();
  }

  // ── Catalog (place new buildings) ──────────────────────────────────────────

  private buildCatalog(): void {
    this.catalogEl.replaceChildren(...getAllBuildingTypes().map((type) => this.makeCatalogRow(type)));
  }

  private makeCatalogRow(type: BuildingType): HTMLElement {
    const row = el('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:9px 10px;border:1px solid var(--bsx-hairline);border-radius:6px;background:var(--bsx-card)';
    row.dataset['buildType'] = type;

    const iconChip = el('div', { children: [iconEl('build', 13)] });
    iconChip.style.cssText = 'flex:0 0 auto;width:24px;height:24px;border-radius:4px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.06);color:var(--bsx-amber)';

    // A basis rather than pure flex:1 — with a nowrap action button the name
    // column collapsed to nothing and the label overflowed across the controls.
    const info = el('div');
    info.style.cssText = 'flex:1 1 40%;min-width:0;overflow-wrap:break-word;display:flex;flex-direction:column;gap:2px';

    const nameEl = el('span', {
      text: t(`building.${type}.name`),
      attrs: { style: 'font:600 11px/1.3 var(--bsx-font-ui);color:var(--bsx-text-primary)' },
    });

    const costEl = el('span', {
      className: 'bsx-mono',
      // nowrap: the French format puts the currency symbol after the amount, so
      // "12000 $" broke across two lines and pushed the row out of shape.
      attrs: { style: 'font:500 10px/1 var(--bsx-font-mono);color:var(--bsx-text-micro);white-space:nowrap' },
    });
    this.updateCostDisplay(costEl, type, this.selectedTiers.get(type) ?? 1);
    info.append(nameEl, costEl);

    // Tier selector
    const tierSel = el('select', { className: 'bs-build-tier-sel' });
    tierSel.style.cssText = 'flex:0 0 auto;font:600 10px/1 var(--bsx-font-mono);width:44px;padding:4px 2px;border-radius:4px;border:1px solid var(--bsx-hairline-strong);background:var(--bsx-well);color:var(--bsx-text-secondary)';
    tierSel.title = t('ui.build.select_tier');
    for (const tier of [1, 2, 3] as BuildingTier[]) {
      tierSel.appendChild(el('option', { text: `T${tier}`, attrs: { value: String(tier) } }));
    }
    tierSel.value = String(this.selectedTiers.get(type) ?? 1);
    tierSel.addEventListener('change', () => {
      const selected = parseInt(tierSel.value, 10) as BuildingTier;
      this.selectedTiers.set(type, selected);
      this.updateCostDisplay(costEl, type, selected);
      this.refreshCatalogButtons(this.lastCash);
    });

    const placeBtn = button('primary', t('ui.build.place'), {
      onClick: () => {
        const tier = (this.selectedTiers.get(type) ?? 1) as BuildingTier;
        if (tier > 1 && this.lastState && !isTierUnlocked(this.lastState.buildings, type, tier)) {
          this.setStatus(t('ui.build.research_required', { tier }));
          return;
        }
        this.armBuildingPointTool(type, tier, t(`building.${type}.t${tier}.name`), (x, z) => {
          const cmdResult = this.gameConsole?.(`build ${type} at:${x},${z} tier:${tier}`);
          this.setStatus(cmdResult?.success ? t('ui.build.placed') : (cmdResult?.output ?? t('ui.build.invalid_placement')));
        });
      },
    });
    placeBtn.classList.add('bs-build-buy-btn');
    placeBtn.style.cssText = 'flex:0 1 auto;min-width:0;height:auto;padding:6px 9px;font-size:9px;white-space:normal;line-height:1.25';

    const researchBtn = button('locked', t('ui.build.queue_research_button'), {
      onClick: () => {
        const tier = (this.selectedTiers.get(type) ?? 1) as BuildingTier;
        this.queueResearch(type, tier);
      },
    });
    researchBtn.classList.add('bs-build-research-btn');
    researchBtn.style.cssText = 'flex:0 1 auto;min-width:0;height:auto;padding:6px 8px;font-size:9px;white-space:normal;line-height:1.2;display:none';

    row.append(iconChip, info, tierSel, placeBtn, researchBtn);
    return row;
  }

  private updateCostDisplay(target: HTMLElement, type: BuildingType, tier: BuildingTier): void {
    const def = getBuildingDef(type, tier);
    target.textContent = t('ui.build.cost', { cost: String(def.constructionCost) });
  }

  /**
   * Re-apply move/upgrade/demolish disabled state on already-rendered placed
   * rows per affordability, mirroring `refreshCatalogButtons`. Does not
   * rebuild the list — only toggles `disabled` on existing DOM buttons.
   */
  private refreshPlacedButtons(cash: number): void {
    const buildings = this.lastState?.buildings.buildings ?? [];
    for (const row of Array.from(this.placedEl.children) as HTMLElement[]) {
      const idStr = row.dataset['buildingId'];
      if (!idStr) continue;
      const b = buildings.find((bb) => bb.id === Number(idStr));
      if (!b) continue;

      const moveBtn = row.querySelector<HTMLButtonElement>('.bs-build-move-btn');
      if (moveBtn) moveBtn.disabled = cash < getMoveCost(b);

      const demolishBtn = row.querySelector<HTMLButtonElement>('.bs-build-demolish-btn');
      if (demolishBtn) demolishBtn.disabled = cash < getDemolishCost(b);

      const upgradeBtn = row.querySelector<HTMLButtonElement>('.bs-build-upgrade-btn');
      if (upgradeBtn) {
        const nextTier = b.tier < 3 ? ((b.tier + 1) as BuildingTier) : null;
        upgradeBtn.disabled = nextTier === null || cash < getUpgradeCost(b, nextTier);
      }
    }
  }

  private refreshCatalogButtons(cash: number): void {
    for (const row of Array.from(this.catalogEl.children) as HTMLElement[]) {
      const type = row.dataset['buildType'] as BuildingType | undefined;
      if (!type) continue;
      const tier = (this.selectedTiers.get(type) ?? 1) as BuildingTier;
      const def = getBuildingDef(type, tier);
      const locked = tier > 1 && !!this.lastState && !isTierUnlocked(this.lastState.buildings, type, tier);
      const queued = locked && !!this.lastState && isResearchQueued(this.lastState.buildings, type, tier);
      const btn = row.querySelector<HTMLButtonElement>('.bs-build-buy-btn');
      if (btn) btn.disabled = cash < def.constructionCost || locked;
      const researchBtn = row.querySelector<HTMLButtonElement>('.bs-build-research-btn');
      if (researchBtn) researchBtn.style.display = locked && !queued ? '' : 'none';
    }
  }

  // ── Placed buildings list ──────────────────────────────────────────────────

  private refreshPlacedList(buildings: Building[]): void {
    if (buildings.length === 0) {
      this.placedEl.replaceChildren(emptyState(t('ui.build.none_placed')));
      return;
    }
    this.placedEl.replaceChildren(...buildings.map((b) => this.makePlacedRow(b)));
  }

  private makePlacedRow(b: Building): HTMLElement {
    const def = getBuildingDef(b.type, b.tier);
    const row = document.createElement('div');
    row.className = 'bs-build-placed-row';
    row.dataset['buildingId'] = String(b.id);
    row.style.cssText =
      'display:flex;align-items:center;gap:4px;padding:7px 8px;' +
      'border:1px solid var(--bsx-hairline);border-radius:6px;background:var(--bsx-card)';

    const info = document.createElement('div');
    info.style.cssText = 'flex:1 1 50%;min-width:0;font-size:10px;color:var(--bsx-text-tinted);overflow-wrap:break-word';
    info.title = `${b.type} T${b.tier} at (${b.x},${b.z})`;
    info.textContent = `#${b.id} ${t(`building.${b.type}.t${b.tier}.name`)} (${b.x},${b.z})`;

    const moveBtn = document.createElement('button');
    moveBtn.className = 'bsx-btn bs-build-move-btn';
    moveBtn.style.cssText = 'padding:1px 5px;font-size:9px;flex:0 1 auto;white-space:normal;min-width:0;height:auto';
    moveBtn.textContent = t('ui.build.move');
    moveBtn.title = `$${getMoveCost(b)}`;
    moveBtn.disabled = this.lastCash < getMoveCost(b);
    moveBtn.addEventListener('click', () => {
      this.armBuildingPointTool(b.type, b.tier, `${t('ui.build.move')} #${b.id}`, (x, z) => {
        const cmdResult = this.gameConsole?.(`build move ${b.id} to:${x},${z}`);
        this.setStatus(cmdResult?.success ? t('ui.build.moved') : (cmdResult?.output ?? ''));
      });
    });

    const nextTier = b.tier < 3 ? ((b.tier + 1) as BuildingTier) : null;
    const nextLocked = nextTier !== null && !!this.lastState && !isTierUnlocked(this.lastState.buildings, b.type, nextTier);
    const nextQueued = nextTier !== null && nextLocked && !!this.lastState && isResearchQueued(this.lastState.buildings, b.type, nextTier);

    const upgradeBtn = document.createElement('button');
    upgradeBtn.className = 'bsx-btn bsx-btn-primary bs-build-upgrade-btn';
    upgradeBtn.style.cssText = 'padding:1px 5px;font-size:9px;flex:0 1 auto;white-space:normal;min-width:0;height:auto';
    upgradeBtn.textContent = t('ui.build.upgrade');
    upgradeBtn.disabled = nextTier === null;
    if (nextTier !== null) {
      const upgradeCost = getUpgradeCost(b, nextTier);
      upgradeBtn.title = `$${upgradeCost}`;
      upgradeBtn.disabled = this.lastCash < upgradeCost;
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
    researchBtn.className = 'bsx-btn bsx-btn-locked bs-build-research-btn';
    researchBtn.style.cssText = 'padding:1px 5px;font-size:9px;flex:0 1 auto;white-space:normal;min-width:0;height:auto';
    researchBtn.textContent = t('ui.build.queue_research_button');
    researchBtn.style.display = nextTier !== null && nextLocked && !nextQueued ? '' : 'none';
    researchBtn.addEventListener('click', () => {
      if (nextTier !== null) this.queueResearch(b.type, nextTier);
    });

    const demolishBtn = document.createElement('button');
    demolishBtn.className = 'bsx-btn bsx-btn-danger bs-build-demolish-btn';
    demolishBtn.style.cssText = 'padding:1px 5px;font-size:9px;flex:0 1 auto;white-space:normal;min-width:0;height:auto';
    demolishBtn.textContent = t('ui.build.demolish');
    demolishBtn.title = `$${def.demolishCost}`;
    demolishBtn.disabled = this.lastCash < getDemolishCost(b);
    demolishBtn.addEventListener('click', () => {
      const cmdResult = this.gameConsole?.(`build destroy ${b.id}`);
      this.setStatus(cmdResult?.success ? t('ui.build.demolished') : (cmdResult?.output ?? ''));
    });

    row.append(info, moveBtn, upgradeBtn, researchBtn, demolishBtn);
    return row;
  }
}
