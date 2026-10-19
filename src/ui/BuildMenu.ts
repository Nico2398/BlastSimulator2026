// BlastSimulator2026 — Build panel (CH1.7, redesign P10)
// Catalog of buildable types with tier selection; clicking arms the shared
// placement tool. Also lists placed buildings (identity, HP, utilization,
// badge, Locate; no action buttons, #1768 — the inspector drives Move,
// Upgrade, Research and Demolish through armMove / requestUpgrade /
// queueResearchFor). Terrain ramps (carved, not a building)
// get their own small section between the two lists.
//
// Root id, the catalog rows' `data-build-type`, the buy button's
// `.bs-build-buy-btn`, and the ramp button's `.bs-build-ramp-btn` are
// preserved from the pre-redesign panel so tutorialStages.ts keeps
// resolving `#bs-build-panel [data-build-type="freight_warehouse"]
// .bs-build-buy-btn` and `#bs-build-panel .bs-build-ramp-btn` unchanged —
// same convention ContractsPanel.ts established for #bs-contract-panel in
// P5. `.bs-build-tier-sel` (catalog tier `<select>`), `.bs-build-placed-row`
// + `data-building-id` (placed rows) are additionally load-bearing — scenario
// defs and BuildMenu.test.ts click or assert on them directly, so they carry
// over unchanged too.
//
// This was the one panel the P0-P9 redesign never reached — still the
// pre-redesign `.bs-ui`/`.bs-panel` dark/gold chrome with a plain text
// title and a bottom Close button. This pass is chrome-only: same catalog
// logic, same placed-row list, same ramp tool, same research-queue
// handling, just rebuilt onto the shared `bsx-root` docked-panel
// convention (46px header with icon chip + title + close button,
// scrollable body) that every other panel already uses.

import { PanelBase } from './panels/PanelBase.js';
import { t } from '../core/i18n/I18n.js';
import { el, button, emptyState, panelRoot, panelHeader, panelBody, flashStatus } from './dom.js';
import { iconEl } from './icons.js';
import { LocaleTextRegistry } from './localeText.js';
import type { ClaimRefusalReason } from '../core/world/PlayableArea.js';
import type { GameState } from '../core/state/GameState.js';
import type { Rect } from '../core/world/WorldGen.js';
import { RESERVATION_REFUSAL, reservationBlocking, terrainReservations, type TerrainReservation } from '../core/entities/PlacementReservations.js';
import { buildingFootprintOccupants } from '../core/nav/NavGridSync.js';
import {
  getAllBuildingTypes,
  getBuildingDef,
  getDefSize,
  getMoveCost,
  isTierUnlocked,
  isSingleTierType,
  getResearchProgress,
  getResearchTicksRemaining,
  isFootprintBuildable,
  type BuildingType,
  type BuildingTier,
  type Building,
  rectOverlapsOccupants,
} from '../core/entities/Building.js';
import { placementRefusalReason, hoverRefusal, claimRefusalText, type PlacementKit } from './scene/PlacementKit.js';
import type { TileRegion } from './tutorialPickerRegion.js';
import { rampDefFromEndpoints, rampEndTile, validateRampOrder } from '../core/mining/Ramp.js';
import { rampFootLine } from './rampFootLine.js';
import { RAMP_WIDTH_OPTIONS, RAMP_DEFAULT_WIDTH, getResearchTaskDef, type RampWidth } from '../core/config/balance.js';
import { researchCostFor } from '../core/events/ActiveModifiers.js';
import { formatMoney } from '../core/economy/formatMoney.js';
import type { GameConsoleFn } from './gameConsole.js';
import type { ConfirmModalConfig } from './panels/ConfirmModal.js';
import { buildingCardEffects, buildingCardLine, buildingCardTooltip } from './catalogCardText.js';
import { buildingActionRules } from './buildingActionRules.js';
import { memoizedPlacementCutoff, cutoffLine, buildPlacementCutoffConfirm } from './placementCutoffConfirm.js';
import type { PlacementCutoff } from '../core/entities/Building.js';
import { applyRowSelection, type ListSelection } from './selectionRoute.js';
import { placedRowModel, siteRowModel, type SiteRowModel } from './panels/placedRowModel.js';
import { focusCameraOn } from './locateButton.js';
import {
  makeSiteRow, onRowBodyClick, placedInfoBlock, siteSignature, syncPlacedRow, syncSiteRow,
} from './buildMenuRows.js';

/** Footprint rect of a `sizeX` x `sizeZ` building whose origin tile is (x, z). */
function rectAt(x: number, z: number, sizeX: number, sizeZ: number): Rect {
  return { minX: x, minZ: z, maxX: x + sizeX, maxZ: z + sizeZ };
}

export class BuildMenu extends PanelBase {
  private readonly bodyEl: HTMLElement;
  private readonly catalogEl: HTMLElement;
  private readonly placedEl: HTMLElement;
  /** Construction-site rows (planned buildings, rebuilds included); the wrapper hides while empty. */
  private readonly siteWrapEl: HTMLElement;
  private readonly siteEl: HTMLElement;
  private selectBuildingCb?: (buildingId: number) => void;
  private selection: ListSelection = null;
  private lastSiteSignature = '';
  private readonly statusEl: HTMLElement;
  private placementKit: PlacementKit | null = null;
  /** Ground-truth height sampler (#1008) used to refuse a footprint over uneven ground; unset means no footprint check runs. */
  private surfaceHeightSampler: ((x: number, z: number) => number) | null = null;
  /** Non-mutating claim preview for a footprint rect (#1396); unset skips the claim check. */
  private claimAreaPreview: ((rect: Rect) => ClaimRefusalReason | null) | null = null;
  private rampDepth = 8;
  private rampWidth: RampWidth = RAMP_DEFAULT_WIDTH;
  private gameConsole?: GameConsoleFn;
  /** Latest state, for tier-unlock checks before arming the placement tool. */
  private lastState: GameState | null = null;
  /** Selected placement tier per building type. */
  private readonly selectedTiers = new Map<BuildingType, BuildingTier>();
  /** Last cash value used for button state refresh. */
  private lastCash = -1;
  /** Last placed-building signature (id:tier pairs) for change detection.
   *  Building count alone misses an upgrade, which destroys the old id and
   *  places a new one — the count stays flat while the id and tier both change. */
  private lastPlacedSignature: string | null = null;
  /** Serialized `unlockedTiers` for change detection — a completed research
   *  task changes tier availability without changing cash or placed count. */
  private lastUnlockedSignature = '';
  /** Serialized `researchQueue` contents for change detection — queuing
   *  research hides the "Queue Research" button without changing cash,
   *  placed count, or unlockedTiers. */
  private lastResearchQueueSignature = '';
  /** Serialized `plannedBuildings` contents for change detection (#556) —
   *  a construction site starting or completing changes each catalog row's
   *  under-construction count without changing cash or placed count. */
  private lastPlannedBuildingsSignature = '';
  /** Per-type under-construction count span, populated by makeCatalogRow. */
  private readonly underConstructionEls = new Map<BuildingType, HTMLElement>();
  private readonly locale = new LocaleTextRegistry();


  private onConfirmRequestCb?: (config: ConfirmModalConfig) => void;
  private flowResultCb?: (message: string) => void;

  /** Routes confirm requests (upgrade cutoff, placement cutoff) to a modal (#1399); unset means they proceed unconfirmed or do nothing. */
  setConfirmHandler(cb: (config: ConfirmModalConfig) => void): void {
    this.onConfirmRequestCb = cb;
  }

  constructor(container: HTMLElement) {
    super(panelRoot('bs-build-panel'));

    const { header, titleEl } = panelHeader({
      icon: 'build',
      accent: 'amber',
      onClose: () => this.onCloseCb?.(),
    });
    this.locale.bindText(titleEl, 'ui.build.title');

    this.bodyEl = panelBody(10);

    this.catalogEl = el('div');
    this.catalogEl.id = 'bs-build-catalog';
    this.catalogEl.style.cssText = 'display:flex;flex-direction:column;gap:8px';

    this.placedEl = el('div');
    this.placedEl.id = 'bs-build-placed';
    this.placedEl.style.cssText = 'display:flex;flex-direction:column;gap:6px';

    this.siteEl = el('div');
    this.siteEl.id = 'bs-build-sites';
    this.siteEl.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    this.siteWrapEl = el('div', { children: [this.sectionLabel('ui.build.site_section'), this.siteEl] });
    this.siteWrapEl.style.cssText = 'display:none;flex-direction:column;gap:6px';

    this.statusEl = el('div', {
      attrs: { style: 'font:400 10px/1.4 var(--bsx-font-ui);color:var(--bsx-text-micro);min-height:14px' },
    });

    this.bodyEl.append(
      this.catalogEl,
      this.makeTerrainSection(),
      this.sectionLabel('ui.build.placed_buildings'),
      this.placedEl,
      this.siteWrapEl,
      this.statusEl,
    );
    this.el.append(header, this.bodyEl);
    container.appendChild(this.el);

    this.buildCatalog();
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }
  setPlacementKit(kit: PlacementKit): void { this.placementKit = kit; }
  /** Register the non-mutating claim preview for a footprint rect, used to show a refused ghost before Confirm (#1396). */
  setClaimAreaPreview(
    fn: (rect: Rect) => ClaimRefusalReason | null,
  ): void {
    this.claimAreaPreview = fn;
  }
  /** Register the terrain-height sampler used to refuse a footprint over uneven ground (#1008). */
  setSurfaceHeightSampler(fn: (x: number, z: number) => number): void {
    this.surfaceHeightSampler = fn;
  }

  /** Re-render locale-dependent text (catalog, placed list, sections) after a language change. */
  refreshLocale(): void {
    this.locale.refresh();
    // Catalog and placed rows are built on demand, not per tick, so they keep
    // the previous locale until something structural changes. Rebuild both.
    this.buildCatalog();
    this.refreshCatalogButtons(this.lastCash);
    this.refreshPlacedList(this.lastState?.buildings.buildings ?? []);
    this.refreshSiteList();
  }

  show(): void {
    super.show();
    this.applySelection();
  }


  update(state: GameState): void {
    this.lastState = state;
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
    if (placedSig !== this.lastPlacedSignature) {
      this.lastPlacedSignature = placedSig;
      this.refreshPlacedList(state.buildings.buildings);
    }
    const siteModels = new Map(state.plannedBuildings.map((pb) => [pb.buildingId, siteRowModel(pb, state)]));
    this.syncSites(state, siteModels);
    this.syncLiveRows(state, siteModels);
    if (unlockedChanged || queueChanged) this.refreshCatalogButtons(state.cash);
    else if (state.buildings.researchQueue.length > 0) this.refreshResearchProgress();

    const plannedSig = state.plannedBuildings.map((pb) => `${pb.id}:${pb.type}`).join(',');
    if (plannedSig !== this.lastPlannedBuildingsSignature) {
      this.lastPlannedBuildingsSignature = plannedSig;
      this.refreshUnderConstructionCounts(state);
    }
  }

  /** Rebuild the site rows when the set of new-construction sites changed (an upgrade shows on its placed row). */
  private syncSites(state: GameState, models: ReadonlyMap<number, SiteRowModel>): void {
    const sig = siteSignature(state.plannedBuildings.filter((pb) => pb.upgrade !== true));
    if (sig === this.lastSiteSignature) return;
    this.lastSiteSignature = sig;
    this.refreshSiteList(models);
  }

  /** Rebuild the site rows; without `models` they are computed from the last observed state. */
  private refreshSiteList(models?: ReadonlyMap<number, SiteRowModel>): void {
    const state = this.lastState;
    const sites = (state?.plannedBuildings ?? []).filter((pb) => pb.upgrade !== true);
    this.siteWrapEl.style.display = state && sites.length > 0 ? 'flex' : 'none';
    this.siteEl.replaceChildren(...(state ? sites : []).map((pb) =>
      makeSiteRow(pb, models?.get(pb.buildingId) ?? siteRowModel(pb, state!), () => this.selectBuildingCb?.(pb.buildingId))));
    this.applySelection();
  }

  /** Write HP, utilization, badge and site progress into the existing rows. */
  private syncLiveRows(state: GameState, siteModels: ReadonlyMap<number, SiteRowModel>): void {
    const byId = new Map(state.buildings.buildings.map((b) => [b.id, b]));
    for (const row of Array.from(this.placedEl.children) as HTMLElement[]) {
      const b = byId.get(Number(row.dataset['buildingId']));
      if (b) syncPlacedRow(row, placedRowModel(b, state));
    }
    for (const row of Array.from(this.siteEl.children) as HTMLElement[]) {
      const model = siteModels.get(Number(row.dataset['buildingId']));
      if (model) syncSiteRow(row, model);
    }
  }

  private applySelection(): void {
    applyRowSelection([this.placedEl, this.siteEl], this.selection, 'building', 'data-building-id');
  }

  /** Update each catalog row's "N under construction" count (#556). */
  private refreshUnderConstructionCounts(state: GameState): void {
    for (const [type, target] of this.underConstructionEls) {
      const count = state.plannedBuildings.filter((pb) => pb.type === type).length;
      target.textContent = count > 0 ? t('ui.build.under_construction_count', { count }) : '';
    }
  }

  setStatus(msg: string): void {
    flashStatus(this.statusEl, msg);
    if (!this.visible && msg) this.flowResultCb?.(msg);
  }


  /**
   * Latest state feed for the inspector-driven flows (#1758); the panel itself only refreshes while open.
   * Leaves `lastCash` alone: `update` compares against it to re-apply affordability on the rendered rows.
   */
  observe(state: GameState): void {
    this.lastState = state;
  }

  /** Arm the footprint placement tool that moves placed building `buildingId` (the inspector's Move, #1758). */
  armMove(buildingId: number): void {
    const b = this.lastState?.buildings.buildings.find((x) => x.id === buildingId);
    if (!b) return;
    this.armBuildingPointTool(b.type, b.tier, `${t('ui.build.move')} #${b.id}`, (x, z) => {
      const cmdResult = this.gameConsole?.(`build move ${b.id} to:${x},${z}`);
      this.setStatus(cmdResult?.success ? t('ui.build.moved') : (cmdResult?.output ?? ''));
      return cmdResult?.success === true;
    }, b.id);
  }

  /** Order the next-tier upgrade of `buildingId`: research guard, then the cutoff confirm, then `build upgrade` (#1758). */
  requestUpgrade(buildingId: number): void {
    const state = this.lastState;
    const b = state?.buildings.buildings.find((x) => x.id === buildingId);
    if (!state || !b) return;
    const { upgrade } = buildingActionRules(state, b);
    if (upgrade.kind === 'locked') {
      this.setStatus(t('ui.build.research_required', { tier: upgrade.nextTier! }));
      return;
    }
    const doUpgrade = (): void => {
      const cmdResult = this.gameConsole?.(`build upgrade ${b.id}`);
      this.setStatus(cmdResult?.success ? t('ui.build.upgraded') : (cmdResult?.output ?? ''));
    };
    const requestConfirm = this.onConfirmRequestCb;
    if (upgrade.cutoff !== null && requestConfirm) requestConfirm(buildPlacementCutoffConfirm(upgrade.cutoff, doUpgrade));
    else doUpgrade();
  }

  /** Wire placed-row click-to-select (main.ts owns ScenePicking). */
  setSelectBuildingHandler(cb: (buildingId: number) => void): void {
    this.selectBuildingCb = cb;
  }

  /** Mirror the scene selection so the matching placed row highlights. */
  setSelectedEntity(sel: ListSelection): void {
    this.selection = sel;
    this.applySelection();
  }

  /** Routes a flow's result message somewhere visible while the panel is closed (#1758). */
  setFlowResultHandler(cb: (message: string) => void): void {
    this.flowResultCb = cb;
  }

  /**
   * Queue a Research Center task for `type` tier `tier` and report progress.
   * Called by the catalog row's "Queue Research" button (place-blocked) and, via
   * `queueResearchFor`, by the inspector's Research action (upgrade-blocked) —
   * the only in-game paths to unlock tier 2/3.
   */
  queueResearch(type: BuildingType, tier: BuildingTier): void {
    if (tier === 1) return;
    this.setStatus(this.runResearchQueue(type, tier).message);
  }

  /** Runs `research queue` and words the outcome; shared by the catalog button and the inspector. */
  private runResearchQueue(type: BuildingType, tier: BuildingTier): { ok: boolean; message: string } {
    const cmdResult = this.gameConsole?.(`research queue type:${type} tier:${tier}`);
    if (!cmdResult?.success) {
      return { ok: false, message: t(BuildMenu.RESEARCH_FAILURE_KEYS[cmdResult?.code ?? ''] ?? 'ui.build.research_queue_failed') };
    }
    const task = this.lastState?.buildings.researchQueue.find(
      (r) => r.targetType === type && r.targetTier === tier,
    );
    this.refreshCatalogButtons(this.lastCash);
    return {
      ok: true,
      message: task ? t('ui.build.research_queued', { ticks: getResearchTicksRemaining(task) }) : t('ui.build.research_queued_generic'),
    };
  }

  /** Inspector entry: null on success (status set) or nothing to research; else the translated refusal, with no status set. */
  queueResearchFor(buildingId: number): string | null {
    const b = this.lastState?.buildings.buildings.find((x) => x.id === buildingId);
    const nextTier = b ? this.nextTierOf(b) : null;
    if (!b || nextTier === null) return null;
    const result = this.runResearchQueue(b.type, nextTier);
    if (!result.ok) return result.message;
    this.setStatus(result.message);
    return null;
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

  // ── Terrain tools (carved terrain, not a building) ─────────────────────────

  /**
   * Ramp and level-ground orders both carve the voxel grid rather than place
   * a building, so they share one "Terrain" section with one header — two
   * `sectionLabel('ui.build.ramp_section')` calls back to back rendered the
   * heading twice (#1009 review finding 3).
   */
  private makeTerrainSection(): HTMLElement {
    const wrap = el('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px';

    const rampBtn = el('button', { className: 'bsx-btn bsx-btn-primary bs-build-ramp-btn' });
    rampBtn.style.cssText = 'width:100%';
    this.locale.bindText(rampBtn, 'ui.build.ramp');
    rampBtn.addEventListener('click', () => this.armRampTool());

    const levelGroundBtn = el('button', { className: 'bsx-btn bsx-btn-primary bs-build-level-ground-btn' });
    levelGroundBtn.style.cssText = 'width:100%';
    this.locale.bindText(levelGroundBtn, 'ui.build.level_ground');
    levelGroundBtn.addEventListener('click', () => this.armLevelGroundTool());

    wrap.append(this.sectionLabel('ui.build.ramp_section'), rampBtn, levelGroundBtn);
    return wrap;
  }

  /**
   * Why `rect` (min inclusive, max exclusive) would be refused before Confirm (#1396): the site claim
   * over the whole rect, or a building / construction site already covering part of it. Null when
   * clear. `movingId` is a building being moved, which does not block its own new spot.
   */
  private rectRefusal(rect: Rect, movingId?: number): string | null {
    const claim = this.claimAreaPreview?.(rect) ?? null;
    if (claim) return claimRefusalText(claim);
    if (!this.lastState) return null;
    const moving = movingId === undefined ? undefined : this.lastState.buildings.buildings.find((b) => b.id === movingId);
    const occupants = buildingFootprintOccupants(this.lastState).filter((o) => o !== moving);
    return rectOverlapsOccupants(occupants, rect) ? t('shell.placement.refused_occupied') : null;
  }

  /** Why `rect` (min inclusive, max exclusive) covers a ramp corridor or a drill hole (#1390); null when clear. */
  private reservationRefusal(rect: Rect, reservations: ReadonlyArray<TerrainReservation>): string | null {
    const kind = reservationBlocking(reservations, rect);
    return kind === null ? null : t(RESERVATION_REFUSAL[kind].errorKey);
  }

  /** Current ramp and drill-hole reservations; computed once per refresh or hover, not per building. */
  private currentReservations(): TerrainReservation[] {
    return this.lastState ? terrainReservations(this.lastState) : [];
  }

  /** Footprint of `b` at its own tile for `tier`. */
  private footprintRect(b: Building, tier: BuildingTier): Rect {
    const { sizeX, sizeZ } = getDefSize(getBuildingDef(b.type, tier));
    return rectAt(b.x, b.z, sizeX, sizeZ);
  }

  /** What `rect` would cut off from the crew (#1391); memoized by rect and nav revision. */
  private cutoffFor(rect: Rect, freed?: Rect): PlacementCutoff | null {
    return this.lastState ? memoizedPlacementCutoff(this.lastState, rect, freed) : null;
  }

  /** A rectangle drag, like Drill.ts's grid tool — the whole dragged area is the order, no extra parameters to tune. */
  private armLevelGroundTool(): void {
    const kit = this.placementKit;
    if (!kit) return;
    const { controller, overlay, strip } = kit;
    if (controller.isArmed) { controller.cancel(); return; }

    const refresh = (): void => {
      if (controller.currentPhase === 'idle') { overlay.clear(); strip.hide(); return; }
      const sel = controller.selection;
      const rectRefusal = sel
        ? this.rectRefusal({
          minX: Math.min(sel.x1, sel.x2), minZ: Math.min(sel.z1, sel.z2),
          maxX: Math.max(sel.x1, sel.x2) + 1, maxZ: Math.max(sel.z1, sel.z2) + 1,
        })
        : null;
      overlay.update(sel ? { shape: 'rect', x1: sel.x1, z1: sel.z1, x2: sel.x2, z2: sel.z2, refused: !!rectRefusal } : null);
      const area = sel ? (sel.x2 - sel.x1 + 1) * (sel.z2 - sel.z1 + 1) : 0;
      strip.show({
        icon: 'grid',
        title: t('ui.build.level_ground'),
        subtitle: '',
        fields: [],
        result: sel ? `${area}` : '—',
        confirmEnabled: controller.canConfirm && !rectRefusal,
        confirmDisabledReason: placementRefusalReason(controller) ?? rectRefusal ?? undefined,
        instruction: t('ui.build.level_ground_instruction'),
      });
    };

    controller.setConfirmHandler((sel) => {
      const cmd = this.gameConsole?.(`level_ground minX:${sel.x1} maxX:${sel.x2} minZ:${sel.z1} maxZ:${sel.z2}`);
      if (!cmd?.success) {
        this.setStatus(cmd?.output ?? '');
        return false;
      }
      this.setStatus(t('ui.build.level_ground_ordered'));
      overlay.flashConfirm();
      return true;
    });
    controller.setChangeHandler(refresh);
    controller.arm({ shape: 'rect' });
    refresh();
  }

  /**
   * Arm-time only (#1210): when the step pins the drag to a fixed exact
   * region, clamp the depth field DOWN (never up) to the deepest depth that
   * region's own fixed line still geometrically validates for. Cash is
   * forced to `Infinity` so only geometry (the slope/length gate), never
   * affordability, drives the clamp. Purely geometric — works for any
   * exact-pinned region, not just the tutorial's 12-tile box-cut strip.
   */
  private clampDepthToExactRegion(region: TileRegion): void {
    const rampDef = rampDefFromEndpoints(region.x1, region.z1, region.x2, region.z2, this.rampDepth);
    let depth = this.rampDepth;
    while (depth > 1 && !validateRampOrder({ ...rampDef, targetDepth: depth }, Infinity).success) {
      depth--;
    }
    this.rampDepth = depth;
  }

  /** Moves the ramp width one option up or down `RAMP_WIDTH_OPTIONS`, clamped at both ends. */
  private stepRampWidth(delta: 1 | -1): void {
    const i = RAMP_WIDTH_OPTIONS.indexOf(this.rampWidth) + delta;
    this.rampWidth = RAMP_WIDTH_OPTIONS[Math.min(RAMP_WIDTH_OPTIONS.length - 1, Math.max(0, i))]!;
  }

  /** Ramps are a line drag (start → end), not a rectangle — the width is chosen on the param strip. */
  private armRampTool(): void {
    const kit = this.placementKit;
    if (!kit) return;
    const { controller, overlay, strip } = kit;
    if (controller.isArmed) { controller.cancel(); return; }

    const refresh = (): void => {
      if (controller.currentPhase === 'idle') { overlay.clear(); strip.hide(); return; }
      const sel = controller.selection;
      // One source of truth (#1210): the same RampDef + validateRampOrder call
      // the console command runs decides the UI gate here, so the two can
      // never disagree again about a length/depth/cash combination.
      const rampDef = sel ? { ...rampDefFromEndpoints(sel.x1, sel.z1, sel.x2, sel.z2, this.rampDepth), width: this.rampWidth } : null;
      const validation = rampDef ? validateRampOrder(rampDef, this.lastState?.cash ?? 0) : null;
      const confirmEnabled = controller.canConfirm && (validation?.success ?? false);
      // The preview turns red live, mid-drag included, whenever this ramp would be refused (#1211).
      overlay.update(sel ? { shape: 'line', x1: sel.x1, z1: sel.z1, x2: sel.x2, z2: sel.z2, width: this.rampWidth, refused: !confirmEnabled } : null);
      let confirmDisabledReason: string | undefined;
      if (!controller.canConfirm) {
        confirmDisabledReason = placementRefusalReason(controller);
      } else if (validation && !validation.success) {
        confirmDisabledReason = validation.messageKey ? t(validation.messageKey, validation.messageParams) : validation.message;
      }
      const sampler = this.surfaceHeightSampler;
      const endTile = rampDef ? rampEndTile(rampDef) : null;
      const footLine = sel && rampDef && endTile && sampler
        ? rampFootLine(sampler(sel.x1, sel.z1), sampler(endTile.x, endTile.z), this.rampDepth, rampDef.length)
        : '';
      strip.show({
        icon: 'down',
        title: t('ui.build.ramp'),
        subtitle: footLine,
        fields: [
          { key: 'depth', label: t('ui.build.ramp_depth'), value: this.rampDepth, format: v => `${v}m`, onDec: () => { this.rampDepth = Math.max(1, this.rampDepth - 1); refresh(); }, onInc: () => { this.rampDepth = Math.min(40, this.rampDepth + 1); refresh(); } },
          { key: 'width', label: t('ui.build.ramp_width'), value: this.rampWidth, format: v => `${v}m`, onDec: () => { this.stepRampWidth(-1); refresh(); }, onInc: () => { this.stepRampWidth(1); refresh(); } },
        ],
        result: rampDef ? `${rampDef.length} ${t('ui.tile_select.tiles')}` : '—',
        confirmEnabled,
        confirmDisabledReason,
        instruction: t('ui.build.ramp_instruction'),
      });
    };

    controller.setConfirmHandler((sel) => {
      const cmd = this.gameConsole?.(`build_ramp start:${sel.x1},${sel.z1} end:${sel.x2},${sel.z2} depth:${this.rampDepth} width:${this.rampWidth}`);
      if (!cmd?.success) {
        this.setStatus(cmd?.output ?? '');
        return false;
      }
      this.setStatus(t('ui.build.ramp_ordered'));
      overlay.flashConfirm();
      return true;
    });
    controller.setChangeHandler(refresh);
    controller.arm({ shape: 'line' });
    if (controller.activeRegion?.exact) this.clampDepthToExactRegion(controller.activeRegion);
    refresh();
  }

  /** Point + real footprint ghost, shared by placing a new building and moving an existing one. */
  private armBuildingPointTool(type: BuildingType, tier: BuildingTier, title: string, onConfirm: (x: number, z: number) => boolean, movingId?: number): void {
    const kit = this.placementKit;
    if (!kit) return;
    const { controller, overlay, strip } = kit;
    if (controller.isArmed) { controller.cancel(); return; }
    const def = getBuildingDef(type, tier);
    const moving = movingId === undefined ? undefined : this.lastState?.buildings.buildings.find((b) => b.id === movingId);
    const freedRect = moving ? this.footprintRect(moving, moving.tier) : undefined;
    const { sizeX, sizeZ } = getDefSize(def);
    let acceptedCutoff = false;
    /** Cutoff for the tile, unless a hard refusal already applies (then the cutoff is moot). */
    const cutoffAt = (at: { x: number; z: number } | null, rectReason: string | null): PlacementCutoff | null => {
      if (!at || rectReason || !controller.canConfirm) return null;
      return this.cutoffFor(rectAt(at.x, at.z, sizeX, sizeZ), freedRect);
    };

    const refresh = (): void => {
      if (controller.currentPhase === 'idle') { overlay.clear(); strip.hide(); return; }
      const sel = controller.selection;
      const at = sel ? { x: sel.x1, z: sel.z1 } : controller.previewOrigin;
      let rectReason: string | null = null;
      if (at) {
        const reservations = this.currentReservations();
        const rect = rectAt(at.x, at.z, sizeX, sizeZ);
        rectReason = this.rectRefusal(rect, movingId) ?? this.reservationRefusal(rect, reservations);
      }
      const hover = hoverRefusal(controller, rectReason);
      const cutoff = cutoffAt(at, rectReason);
      overlay.update(at ? { shape: 'point', x: at.x, z: at.z, footprintCells: def.footprint, refused: hover.refused || cutoff !== null } : null);
      strip.show({
        icon: 'build',
        title,
        subtitle: `$${(moving ? getMoveCost(moving) : def.constructionCost).toLocaleString('en-US')}`,
        fields: [],
        result: sel ? `(${sel.x1}, ${sel.z1})` : '—',
        confirmEnabled: controller.canConfirm && !rectReason,
        confirmDisabledReason: hover.reason,
        instruction: cutoff ? cutoffLine(cutoff) : t('ui.build.place_instruction'),
      });
    };

    controller.setConfirmHandler((sel) => {
      const cutoff = acceptedCutoff ? null : cutoffAt({ x: sel.x1, z: sel.z1 }, null);
      if (cutoff && this.onConfirmRequestCb) {
        this.onConfirmRequestCb(buildPlacementCutoffConfirm(cutoff, () => {
          acceptedCutoff = true;
          controller.confirm();
          acceptedCutoff = false;
        }));
        return false;
      }
      if (!onConfirm(sel.x1, sel.z1)) return false;
      overlay.flashConfirm();
      return true;
    });
    controller.setChangeHandler(refresh);
    controller.arm({ shape: 'point' });
    controller.setFootprintCheck(
      this.surfaceHeightSampler
        ? (x, z) => isFootprintBuildable(def.footprint, x, z, this.surfaceHeightSampler!)
        : null,
    );
    refresh();
  }

  // ── Catalog (place new buildings) ──────────────────────────────────────────

  private buildCatalog(): void {
    this.underConstructionEls.clear();
    this.catalogEl.replaceChildren(...getAllBuildingTypes().map((type) => this.makeCatalogRow(type)));
    if (this.lastState) this.refreshUnderConstructionCounts(this.lastState);
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

    const descEl = el('span', {
      className: 'bs-build-desc',
      attrs: { style: 'font:400 10px/1.3 var(--bsx-font-ui);color:var(--bsx-text-micro)' },
    });
    const effectsEl = el('span', {
      className: 'bs-build-effects',
      attrs: { style: 'font:500 9px/1.3 var(--bsx-font-mono);color:var(--bsx-text-micro)' },
    });
    const refreshCardText = (tier: BuildingTier): void => {
      const def = getBuildingDef(type, tier);
      descEl.textContent = buildingCardLine(def);
      effectsEl.textContent = buildingCardEffects(def);
      row.title = buildingCardTooltip(def);
    };
    refreshCardText((this.selectedTiers.get(type) ?? 1) as BuildingTier);

    const constructionEl = el('span', {
      className: 'bs-build-under-construction',
      attrs: { style: 'font:500 9px/1.3 var(--bsx-font-mono);color:var(--bsx-text-micro)' },
    });
    this.underConstructionEls.set(type, constructionEl);

    info.append(nameEl, costEl, descEl, effectsEl, constructionEl);

    // Tier selector
    const tierSel = el('select', { className: 'bs-build-tier-sel' });
    tierSel.style.cssText = 'flex:0 0 auto;font:600 10px/1 var(--bsx-font-mono);width:44px;padding:4px 2px;border-radius:4px;border:1px solid var(--bsx-hairline-strong);background:var(--bsx-well);color:var(--bsx-text-secondary)';
    tierSel.title = t('ui.build.select_tier');
    // A single-tier type has nothing to choose (#1530).
    if (isSingleTierType(type)) tierSel.style.display = 'none';
    for (const tier of [1, 2, 3] as BuildingTier[]) {
      tierSel.appendChild(el('option', { text: `T${tier}`, attrs: { value: String(tier) } }));
    }
    tierSel.value = String(this.selectedTiers.get(type) ?? 1);
    tierSel.addEventListener('change', () => {
      const selected = parseInt(tierSel.value, 10) as BuildingTier;
      this.selectedTiers.set(type, selected);
      this.updateCostDisplay(costEl, type, selected);
      refreshCardText(selected);
      this.refreshCatalogButtons(this.lastCash);
    });

    const placeBtn = button('primary', t('ui.build.place'), {
      onClick: () => {
        const tier = (this.selectedTiers.get(type) ?? 1) as BuildingTier;
        if (this.isTierLocked(type, tier)) {
          this.setStatus(t('ui.build.research_required', { tier }));
          return;
        }
        this.armBuildingPointTool(type, tier, t(`building.${type}.t${tier}.name`), (x, z) => {
          const cmdResult = this.gameConsole?.(`build ${type} at:${x},${z} tier:${tier}`);
          this.setStatus(cmdResult?.success ? t('ui.build.ordered') : (cmdResult?.output ?? t('ui.build.invalid_placement')));
          return cmdResult?.success === true;
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
    target.textContent = t('ui.build.cost', { cost: formatMoney(def.constructionCost) });
  }

  /** Research price after live research_cost modifiers. */
  private researchCost(base: number): number {
    const s = this.lastState;
    return s ? researchCostFor(base, s.events.activeModifiers, s.tickCount) : base;
  }

  /**
   * Catalog rows only (placed rows carry no research button): label the row's
   * research button with its cost and duration, or — when a task for that
   * building/tier is already queued — hide it and show the live progress.
   */
  private syncResearchControls(
    row: HTMLElement,
    type: BuildingType,
    tier: BuildingTier,
    locked: boolean,
  ): void {
    const btn = row.querySelector<HTMLButtonElement>('.bs-build-research-btn');
    if (!btn) return;
    const researchTier = tier > 1 ? (tier as 2 | 3) : null;
    if (researchTier !== null) {
      const def = getResearchTaskDef(type, researchTier);
      btn.textContent = t('ui.build.queue_research_cost', { cost: formatMoney(this.researchCost(def.cost)), duration: def.ticks });
    }
    const task = locked && researchTier !== null
      ? this.lastState?.buildings.researchQueue.find((r) => r.targetType === type && r.targetTier === researchTier)
      : undefined;
    btn.style.display = locked && !task ? '' : 'none';
    const existing = row.querySelector<HTMLElement>('.bs-build-research-progress');
    if (task) {
      const { fraction } = getResearchProgress(task);
      let progressEl = existing;
      if (!progressEl) {
        progressEl = el('span', { className: 'bs-build-research-progress' });
        progressEl.style.cssText = 'flex:1 1 100%;font:500 9px/1.2 var(--bsx-font-mono);color:var(--bsx-text-micro)';
        row.append(progressEl);
      }
      progressEl.textContent = t('ui.build.research_progress', {
        percent: Math.round(fraction * 100),
        remaining: getResearchTicksRemaining(task),
      });
    } else {
      existing?.remove();
    }
  }

  /** True when `tier` of `type` still needs research (tier 1 is always available). */
  private isTierLocked(type: BuildingType, tier: BuildingTier): boolean {
    return tier > 1 && !!this.lastState && !isTierUnlocked(this.lastState.buildings, type, tier);
  }

  private nextTierOf(b: Building): BuildingTier | null {
    return b.tier < 3 && !isSingleTierType(b.type) ? ((b.tier + 1) as BuildingTier) : null;
  }

  /** Update progress text on existing catalog rows in place (called every tick while research is queued). */
  private refreshResearchProgress(): void {
    for (const row of Array.from(this.catalogEl.children) as HTMLElement[]) this.syncCatalogRow(row);
  }

  private refreshCatalogButtons(cash: number): void {
    for (const row of Array.from(this.catalogEl.children) as HTMLElement[]) this.syncCatalogRow(row, cash);
  }

  /** Sync one catalog row: buy-button state (when `cash` given) and research controls. */
  private syncCatalogRow(row: HTMLElement, cash?: number): void {
    const type = row.dataset['buildType'] as BuildingType | undefined;
    if (!type) return;
    const tier = (this.selectedTiers.get(type) ?? 1) as BuildingTier;
    const locked = this.isTierLocked(type, tier);
    if (cash !== undefined) {
      const btn = row.querySelector<HTMLButtonElement>('.bs-build-buy-btn');
      if (btn) btn.disabled = cash < getBuildingDef(type, tier).constructionCost || locked;
    }
    this.syncResearchControls(row, type, tier, locked);
  }

  // ── Placed buildings list ──────────────────────────────────────────────────

  private refreshPlacedList(buildings: Building[]): void {
    const state = this.lastState;
    if (buildings.length === 0 || !state) {
      this.placedEl.replaceChildren(emptyState(t('ui.build.none_placed')));
      return;
    }
    this.placedEl.replaceChildren(...buildings.map((b) => this.makePlacedRow(b, state)));
    this.applySelection();
  }

  /** Identity, HP, utilization, badge and Locate; actions live in the inspector (#1768). */
  private makePlacedRow(b: Building, state: GameState): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bs-build-placed-row';
    row.dataset['buildingId'] = String(b.id);
    row.style.cssText =
      'display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:7px 8px;' +
      'border:1px solid var(--bsx-hairline);border-radius:6px;background:var(--bsx-card)';

    const info = placedInfoBlock(b, placedRowModel(b, state), () => focusCameraOn(b.x, b.z));
    onRowBodyClick(row, () => this.selectBuildingCb?.(b.id));
    row.append(info);
    return row;
  }
}
