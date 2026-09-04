// BlastSimulator2026 — UI Manager (10.x, redesign P1)
// Orchestrates all UI panels. Wires game console, handles panel routing, drives per-tick updates.

import { injectStyles } from './styles.js';
import { injectTokens } from './tokens.js';
import { registerIcons } from './icons.js';
import { BlastWorkshop } from './panels/BlastWorkshop.js';
import { PreflightModal } from './panels/PreflightModal.js';
import { BlastReportModal } from './panels/BlastReportModal.js';
import { ConfirmModal } from './panels/ConfirmModal.js';
import { ContractsPanel } from './panels/ContractsPanel.js';
import { FinancesPanel } from './panels/FinancesPanel.js';
import { OperationsPanel } from './panels/OperationsPanel.js';
import { BuildMenu } from './BuildMenu.js';
import { FleetPanel } from './panels/FleetPanel.js';
import { CrewPanel } from './panels/CrewPanel.js';
import { EventModal } from './panels/EventModal.js';
import { SurveyPanel } from './panels/SurveyPanel.js';
import { ShadyPanel } from './panels/ShadyPanel.js';
import { SettingsPanel } from './panels/SettingsPanel.js';
import { MiniMap } from './MiniMap.js';
import { TopBar } from './shell/TopBar.js';
import { ToolRail } from './shell/ToolRail.js';
import { Toasts } from './shell/Toasts.js';
import { ActivityLog } from './shell/ActivityLog.js';
import { NotificationCenter, type NotifyInput } from './notify/NotificationCenter.js';
import type { PlacementKit } from './scene/PlacementKit.js';
import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import type { WeatherCycleState } from '../core/weather/WeatherCycle.js';
import type { Random } from '../core/math/Random.js';
import type { AudioManager } from '../audio/AudioManager.js';
import type { SaveBackend } from '../core/state/SaveBackend.js';

import type { GameConsoleFn } from './gameConsole.js';


export type PanelName = 'blast' | 'contracts' | 'finances' | 'ops' | 'build' | 'vehicles' | 'employees' | 'survey' | 'shady' | 'settings';

export class UIManager {
  private readonly topBar: TopBar;
  private readonly toolRail: ToolRail;
  private readonly toasts: Toasts;
  private readonly activityLog: ActivityLog;
  private readonly notificationCenter = new NotificationCenter();
  private readonly blastUI: BlastWorkshop;
  private readonly preflightModal: PreflightModal;
  private readonly blastReportModal: BlastReportModal;
  private readonly confirmModal: ConfirmModal;
  private readonly contractsPanel: ContractsPanel;
  private readonly financesPanel: FinancesPanel;
  private readonly operationsPanel: OperationsPanel;
  private readonly buildMenu: BuildMenu;
  private readonly fleetPanel: FleetPanel;
  private readonly crewPanel: CrewPanel;
  private readonly eventModal: EventModal;
  private readonly surveyPanel: SurveyPanel;
  private readonly shadyPanel: ShadyPanel;
  private readonly settingsPanel: SettingsPanel;
  private readonly miniMap: MiniMap;

  private activePanel: PanelName | null = null;
  private onLanguageChange?: (lang: string) => void;
  /** One-shot guard for the "A new contact" toast — fires once, the moment the rail icon itself reveals. */
  private shadyRevealed = false;
  /** Escape-key handlers, most-recently-registered first. Each returns true if it consumed the key. */
  private readonly escLayers: Array<() => boolean> = [];

  constructor(container: HTMLElement) {
    injectStyles();
    // Redesign foundation (P0): additive token stylesheet + icon registry.
    // Coexists with the legacy stylesheet until each surface migrates.
    injectTokens();
    registerIcons();

    // Left column — panels (temporary adapter, per the implementation plan:
    // panel bodies migrate to the new dock chrome surface-by-surface in
    // P4-P9; P1 only replaces the shell around them).
    const leftCol = document.createElement('div');
    leftCol.id = 'bs-left-col';
    // max-height, not height: when the column's content overflows, max-height
    // clamps its used height to a definite value, which is what each panel's
    // own `max-height:100%` (BuildMenu.ts and its 8 siblings) resolves
    // against — so the panels are bounded and their bodies scroll without
    // this needing to be a fixed height. Verified against
    // crew-panel-short-viewport.json: reverting this line alone keeps that
    // scenario green, while reverting CrewPanel's roster-row `flex-shrink:0`
    // fails it.
    leftCol.style.cssText = 'position:fixed;top:70px;left:8px;z-index:100;display:flex;flex-direction:column;gap:6px;max-height:calc(100vh - 80px);overflow-y:auto;pointer-events:none';

    // Right column — minimap
    const rightCol = document.createElement('div');
    rightCol.id = 'bs-right-col';
    rightCol.style.cssText = 'position:fixed;top:70px;right:8px;z-index:100';

    container.appendChild(leftCol);
    container.appendChild(rightCol);

    // Shell
    this.topBar = new TopBar(container);
    this.toolRail = new ToolRail(container, (panel) => this.togglePanel(panel));
    this.toasts = new Toasts(container);
    this.activityLog = new ActivityLog(container);

    this.topBar.setSpeedChangeHandler((speed) => this.onSpeedChangeCb?.(speed));
    this.topBar.setTogglePauseHandler(() => this.onTogglePauseCb?.());
    this.topBar.setNavigateHandler((panel) => this.showPanel(panel));
    this.topBar.setOpenLogHandler(() => this.activityLog.toggle());

    // Panels in left column
    this.blastUI = new BlastWorkshop(leftCol);
    this.blastUI.setCloseHandler(() => this.hideAllPanels());
    // Full-screen overlays, not docked panel content — mounted at the root
    // container like eventModal, not leftCol.
    this.preflightModal = new PreflightModal(container);
    this.blastUI.setFireRequestedHandler(() => this.preflightModal.show());
    this.blastReportModal = new BlastReportModal(container);
    // Shared confirm-before-destructive-action overlay — no owner panel of
    // its own; CrewPanel/FleetPanel (P6) will reach it once they exist.
    this.confirmModal = new ConfirmModal(container);
    this.contractsPanel = new ContractsPanel(leftCol);
    this.contractsPanel.setCloseHandler(() => this.hideAllPanels());
    this.contractsPanel.setNavigateHandler((panel) => this.showPanel(panel));
    this.financesPanel = new FinancesPanel(leftCol);
    this.financesPanel.setCloseHandler(() => this.hideAllPanels());
    this.operationsPanel = new OperationsPanel(leftCol);
    this.operationsPanel.setCloseHandler(() => this.hideAllPanels());
    this.buildMenu = new BuildMenu(leftCol);
    this.buildMenu.setCloseHandler(() => this.hideAllPanels());
    this.fleetPanel = new FleetPanel(leftCol);
    this.fleetPanel.setCloseHandler(() => this.hideAllPanels());
    // FleetPanel's no-driver warning cross-links to Crew ('crew' is its own
    // vocabulary — this.showPanel takes the PanelName key, 'employees').
    this.fleetPanel.setNavigateHandler(() => this.showPanel('employees'));
    this.fleetPanel.setConfirmHandler(config => this.confirmModal.show(config));
    this.crewPanel = new CrewPanel(leftCol);
    this.crewPanel.setCloseHandler(() => this.hideAllPanels());
    this.crewPanel.setConfirmHandler(config => this.confirmModal.show(config));
    this.surveyPanel = new SurveyPanel(leftCol);
    this.surveyPanel.setCloseHandler(() => this.hideAllPanels());
    this.shadyPanel = new ShadyPanel(leftCol);
    this.shadyPanel.setCloseHandler(() => this.hideAllPanels());
    this.shadyPanel.setConfirmHandler(config => this.confirmModal.show(config));
    // Settings appended to root container so its z-index:10000 beats the main menu (z-index:9999).
    // Inside leftCol's fixed stacking context it would be capped at z:100 relative to root.
    this.settingsPanel = new SettingsPanel(container);
    this.settingsPanel.setCloseHandler(() => this.hideAllPanels());
    this.settingsPanel.setConfirmHandler(config => this.confirmModal.show(config));

    // Event modal (redesign P8, supersedes EventDialog.ts), appended to container
    this.eventModal = new EventModal(container);

    // MiniMap on right
    this.miniMap = new MiniMap(rightCol);

    // Esc cascade: activity log drawer closes before the active panel does.
    this.escLayers.push(() => {
      if (this.activityLog.visible) { this.activityLog.hide(); return true; }
      return false;
    });
    // Full-screen modals close before the panel underneath them does.
    this.escLayers.push(() => {
      if (this.preflightModal.visible) { this.preflightModal.hide(); return true; }
      if (this.blastReportModal.visible) { this.blastReportModal.hide(); return true; }
      if (this.confirmModal.visible) { this.confirmModal.hide(); return true; }
      return false;
    });

    // A language switch inside the settings panel has to re-render every panel
    // already on screen, then let whoever else is listening (main.ts refreshes
    // the main menu behind the panel) react.
    this.settingsPanel.setLanguageChangeHandler((lang) => {
      this.refreshLocale();
      this.onLanguageChange?.(lang);
    });

    // TopBar/ToolRail/Toasts/MiniMap are HUD chrome — nothing to show before a
    // game exists. Previously nothing ever hid them; they were only ever masked
    // by MainMenu's own opaque backdrop, which the redesign's translucent menu
    // no longer provides ("fix the leak").
    this.hide();
  }

  private onSpeedChangeCb?: (speed: number) => void;
  private onTogglePauseCb?: () => void;

  /** Reveal HUD chrome once a game exists. Idempotent — safe to call every frame/command. */
  show(): void {
    this.topBar.show();
    this.toolRail.show();
    this.toasts.show();
    this.miniMap.show();
  }

  /** Hide HUD chrome — pre-game, and whenever the player returns to the main menu for good (Quit). */
  hide(): void {
    this.topBar.hide();
    this.toolRail.hide();
    this.toasts.hide();
    this.miniMap.hide();
  }

  get visible(): boolean { return this.topBar.visible; }

  setGameConsole(fn: GameConsoleFn): void {
    this.blastUI.setGameConsole(fn);
    this.preflightModal.setGameConsole(fn);
    this.contractsPanel.setGameConsole(fn);
    this.operationsPanel.setGameConsole(fn);
    this.buildMenu.setGameConsole(fn);
    this.fleetPanel.setGameConsole(fn);
    this.crewPanel.setGameConsole(fn);
    this.eventModal.setGameConsole(fn);
    this.surveyPanel.setGameConsole(fn);
    this.shadyPanel.setGameConsole(fn);
  }

  /** Hands the shared in-scene placement tool (P3) to every panel that arms it. Only one arms it at a time. */
  setPlacementKit(kit: PlacementKit): void {
    this.blastUI.setPlacementKit(kit);
    this.buildMenu.setPlacementKit(kit);
    this.surveyPanel.setPlacementKit(kit);
  }

  /** Wire the survey confidence overlay's player-facing visibility toggle (#496) — SurveyPanel's button drives this. */
  setSurveyOverlayToggleHandler(cb: (visible: boolean) => void): void {
    this.surveyPanel.setOverlayToggleHandler(cb);
  }

  /** Reflect the survey confidence overlay's current visibility preference in SurveyPanel's toggle button (#496). */
  setSurveyOverlayVisible(visible: boolean): void {
    this.surveyPanel.setOverlayVisible(visible);
  }

  setSpeedChangeHandler(cb: (speed: number) => void): void {
    this.onSpeedChangeCb = cb;
  }

  setTogglePauseHandler(cb: () => void): void {
    this.onTogglePauseCb = cb;
  }

  /** Return-to-main-menu, requested from Settings' own confirm-gated button. */
  setQuitHandler(cb: () => void): void {
    this.settingsPanel.setReturnToMenuHandler(cb);
  }

  setLanguageChangeHandler(cb: (lang: string) => void): void {
    this.onLanguageChange = cb;
  }

  /** Wire the top bar's Saves button and Settings' SAVE & LOAD button (SavesModal lives in main.ts, not here). */
  setOpenSavesHandler(cb: () => void): void {
    this.topBar.setOpenSavesHandler(cb);
    this.settingsPanel.setOpenSavesHandler(cb);
  }

  /** Wire Settings' REPLAY TUTORIAL button (TutorialOverlay lives in main.ts, not here). */
  setReplayTutorialHandler(cb: () => void): void {
    this.settingsPanel.setReplayTutorialHandler(cb);
  }

  setAudioManager(mgr: AudioManager): void {
    this.settingsPanel.setAudioManager(mgr);
  }

  /** Wire Settings' autosave-age-aware return-to-menu confirm (persistence lives in main.ts, not here). */
  setBackend(backend: SaveBackend): void {
    this.settingsPanel.setBackend(backend);
  }

  setGetState(fn: () => GameState | null): void {
    this.settingsPanel.setGetState(fn);
  }

  /** Wire the top bar's Site Map button (MainMenu lives in main.ts, not here). */
  setSiteMapHandler(cb: () => void): void {
    this.topBar.setSiteMapHandler(cb);
  }

  /** Wire the minimap's click-to-focus (main.ts owns the camera + surface-height lookup). */
  setMapFocusHandler(cb: (x: number, z: number) => void): void {
    this.miniMap.setFocusHandler(cb);
  }

  /** Wire the Fleet panel's per-row click-to-select (main.ts owns ScenePicking). */
  setSelectVehicleHandler(cb: (vehicleId: number) => void): void {
    this.fleetPanel.setSelectVehicleHandler(cb);
  }

  /** Register a notification: appears as a toast now, stays in the activity log. */
  notify(input: NotifyInput): void {
    this.notificationCenter.notify(input);
  }

  /**
   * Register an Esc-key layer. `checkAndHandle` runs on every Escape press,
   * most-recently-registered first, and should close itself + return true
   * only when it is actually open/active. Returns an unregister function.
   */
  registerEscLayer(checkAndHandle: () => boolean): () => void {
    this.escLayers.unshift(checkAndHandle);
    return () => {
      const idx = this.escLayers.indexOf(checkAndHandle);
      if (idx !== -1) this.escLayers.splice(idx, 1);
    };
  }

  /** Central Esc handler: popovers/modals/placement/selection close before the active panel does. */
  handleEscape(): void {
    for (const layer of this.escLayers) {
      if (layer()) return;
    }
    if (this.activePanel) this.hideAllPanels();
  }

  /**
   * Close overlays whose visibility is a stale carry-over from a previous
   * level's ended state, not something the player is mid-answering. Call
   * whenever ctx.state is replaced with a new object (new_game, campaign
   * transition, sandbox start, `load`) — a fresh new_game/campaign-transition
   * state's lastBlastReport is always null, but a `load`-ed state's is
   * whatever was last set before saving, structurally equal to but a
   * different reference from anything BlastReportModal has already shown.
   * Forwarding state.lastBlastReport into reset() stamps it as
   * already-shown, so BlastReportModal.update() doesn't mistake it for a
   * new report on its very next tick and re-arm (#571).
   * reset() drops both a visible report and a pending/armed-but-not-yet-open
   * one (#545) — a report queued right before a transition must not survive
   * into the next level's state.
   * PreflightModal/ConfirmModal are excluded on purpose: both are
   * request/response dialogs the player just triggered, never state-derived,
   * so a level transition mid-dialog is not this bug's shape. LevelEndScreen
   * is excluded too — its update() already closes itself the instant
   * state.levelEndReason reads null, which a fresh level's state always is.
   */
  closeStaleLevelOverlays(state: GameState): void {
    this.blastReportModal.reset(state.lastBlastReport);
  }

  /** Read-only accessor for tests (#504) — whether the BlastReportModal is currently open. */
  get blastReportModalVisible(): boolean { return this.blastReportModal.visible; }

  /** Read-only accessor for tests (#545) — whether a report is waiting out its open delay. */
  get blastReportModalPending(): boolean { return this.blastReportModal.pending; }

  /** Read-only accessor for the scenario harness's `ensureStep` action — which Blast Workshop step tab is active. */
  get blastActiveStep(): number { return this.blastUI.currentStep; }

  /** Re-render all owned panels' locale-dependent text after a language change. */
  refreshLocale(): void {
    this.topBar.refreshLocale();
    this.toolRail.refreshLocale();
    this.blastUI.refreshLocale();
    this.preflightModal.refreshLocale();
    this.blastReportModal.refreshLocale();
    this.confirmModal.refreshLocale();
    this.contractsPanel.refreshLocale();
    this.financesPanel.refreshLocale();
    this.operationsPanel.refreshLocale();
    this.buildMenu.refreshLocale();
    this.fleetPanel.refreshLocale();
    this.crewPanel.refreshLocale();
    this.surveyPanel.refreshLocale();
    this.shadyPanel.refreshLocale();
    this.settingsPanel.refreshLocale();
    this.miniMap.refreshLocale();
    this.eventModal.refreshLocale();
  }

  /**
   * Show a brief toast notification (game-over warnings, contract expiry, etc.).
   * @deprecated prefer notify({severity, title, body}) — kept so any caller
   * still passing a single string gets a sensible warn-severity toast.
   */
  showNotification(message: string): void {
    this.notify({ severity: 'warn', title: message, body: '' });
  }

  update(state: GameState, weatherCycle?: WeatherCycleState, rng?: Random, tutorialActive: boolean = false, blastPlaybackDurationS: number = 0): void {
    const weather = weatherCycle?.current;
    this.topBar.update(state, weatherCycle, rng, this.notificationCenter);
    this.toasts.update(this.notificationCenter);
    this.activityLog.update(this.notificationCenter);
    // setNavGrid before update() — otherwise the overlay draws against the
    // previous tick's navgrid for one frame after any navgrid change (new
    // game, fresh ramp, blast).
    this.miniMap.setNavGrid(state.navGrid ?? null);
    this.miniMap.update(state);
    this.toolRail.update(state);

    // Fires once, the same tick the rail icon itself reveals — never before
    // (nothing to open yet) and never again (the guard latches).
    if (!this.shadyRevealed && (state.corruption.level > 0 || state.corruption.mafiaUnlocked)) {
      this.shadyRevealed = true;
      this.notify({
        severity: 'warn', icon: 'shady',
        title: t('ui.shady.reveal_title'), body: t('ui.shady.reveal_body'),
        cta: t('ui.shady.reveal_cta'), onCta: () => this.showPanel('shady'),
      });
    }

    // Update active panel
    if (this.blastUI.visible) this.blastUI.update(state, weather, tutorialActive);
    // Unconditional, like eventModal below: each is cheap when not relevant
    // (PreflightModal no-ops while closed; BlastReportModal no-ops until
    // lastBlastReport's tick actually changes) and neither's visibility is
    // tied to blastUI's own, so gating on it here would miss real transitions.
    this.preflightModal.update(state, weather);
    this.blastReportModal.update(state, blastPlaybackDurationS);
    // Unconditional like settingsPanel below, same reason: contracts can
    // change (a blast finishing, a delivery landing) while the panel is
    // closed, and the player expects current offers the instant they open
    // it, not whatever rendered on the last frame it happened to be visible.
    this.contractsPanel.update(state);
    if (this.financesPanel.visible) this.financesPanel.update(state);
    if (this.operationsPanel.visible) this.operationsPanel.update(state);
    if (this.buildMenu.visible) this.buildMenu.update(state);
    if (this.fleetPanel.visible) this.fleetPanel.update(state);
    if (this.crewPanel.visible) this.crewPanel.update(state);
    if (this.surveyPanel.visible) this.surveyPanel.update(state);
    if (this.shadyPanel.visible) this.shadyPanel.update(state);
    // Cheap (one display toggle) and not tied to visibility — the session
    // section has to be fresh the instant the player opens the panel, not
    // one tick later, and this panel doesn't rebuild anything else per tick.
    this.settingsPanel.update(state);

    // Event modal — owns its own show/hide from state.events (unlike the
    // panels above). Deferred while BlastReportModal is up: both are
    // auto-triggered (a blast's scripted follow-up event can land the same
    // tick the report opens), and eventModal is mounted after it in the DOM,
    // so it would render on top and hide the report's own Close button
    // behind it. Re-checked every tick, so the event opens itself the moment
    // the report is closed.
    //
    // Also deferred once the level has ended: LevelEndScreen owns the whole
    // screen from the moment state.levelEndReason goes non-null (z-index
    // var(--bsx-z-menu), 9999), well above this modal's own shared
    // .bs-confirm-overlay tier (z-index 600, styles.ts) — opening underneath
    // it would render a dialog no click can ever reach, the exact same
    // unreachable-modal defect BlastReportModal.update() now guards against
    // for the same reason. A pending event is moot once play has stopped
    // anyway, so it simply never opens once the level is over — same as an
    // already-open BlastReportModal, this only gates a *new* open; if
    // eventModal is already visible, it keeps updating so an in-progress
    // decision the player made before the level ended can still resolve.
    if (this.eventModal.visible || (state.levelEndReason === null && !this.blastReportModal.visible && !this.blastReportModal.pending)) {
      this.eventModal.update(state);
    }
  }

  showPanel(name: PanelName): void {
    this.hideAllPanels();
    this.activePanel = name;
    switch (name) {
      case 'blast': this.blastUI.show(); break;
      case 'contracts': this.contractsPanel.show(); break;
      case 'finances': this.financesPanel.show(); break;
      case 'ops': this.operationsPanel.show(); break;
      case 'build': this.buildMenu.show(); break;
      case 'vehicles': this.fleetPanel.show(); break;
      case 'employees': this.crewPanel.show(); break;
      case 'survey': this.surveyPanel.show(); break;
      case 'shady': this.shadyPanel.show(); break;
      case 'settings': this.settingsPanel.show(); break;
    }
    this.toolRail.setActive(this.activePanel);
  }

  /** Open the Crew panel with a specific employee's card expanded — the DETAIL/TRAIN actions of the scene selection bar (src/ui/shell/SelectionBar.ts). */
  showEmployeeDetail(id: number): void {
    this.showPanel('employees');
    this.crewPanel.expandEmployee(id);
  }

  togglePanel(name: PanelName): void {
    if (this.activePanel === name) {
      this.hideAllPanels();
    } else {
      this.showPanel(name);
    }
  }

  /** Toggle the NavGrid overlay on the MiniMap. */
  toggleNavGridOverlay(): void {
    this.miniMap.setNavGridVisible(!this.miniMap.navGridVisible);
  }

  dispose(): void {
    this.topBar.dispose();
    this.toolRail.dispose();
    this.toasts.dispose();
    this.activityLog.dispose();
    this.blastUI.dispose();
    this.preflightModal.dispose();
    this.blastReportModal.dispose();
    this.confirmModal.dispose();
    this.contractsPanel.dispose();
    this.financesPanel.dispose();
    this.operationsPanel.dispose();
    this.buildMenu.dispose();
    this.fleetPanel.dispose();
    this.crewPanel.dispose();
    this.eventModal.dispose();
    this.surveyPanel.dispose();
    this.shadyPanel.dispose();
    this.settingsPanel.dispose();
    this.miniMap.dispose();
  }

  private hideAllPanels(): void {
    this.activePanel = null;
    this.blastUI.hide();
    this.contractsPanel.hide();
    this.financesPanel.hide();
    this.operationsPanel.hide();
    this.buildMenu.hide();
    this.fleetPanel.hide();
    this.crewPanel.hide();
    this.surveyPanel.hide();
    this.shadyPanel.hide();
    this.settingsPanel.hide();
    this.toolRail.setActive(null);
  }
}
