// BlastSimulator2026 — UI Manager (10.x, redesign P1)
// Orchestrates all UI panels. Wires game console, handles panel routing, drives per-tick updates.

import { injectStyles } from './styles.js';
import { injectTokens } from './tokens.js';
import { registerIcons } from './icons.js';
import { BlastPlanUI } from './BlastPlanUI.js';
import { ContractUI } from './ContractUI.js';
import { BuildMenu } from './BuildMenu.js';
import { VehiclePanel } from './VehiclePanel.js';
import { EmployeePanel } from './EmployeePanel.js';
import { EventDialog } from './EventDialog.js';
import { SurveyUI } from './SurveyUI.js';
import { SettingsMenu } from './SettingsMenu.js';
import { MiniMap } from './MiniMap.js';
import { TopBar } from './shell/TopBar.js';
import { ToolRail } from './shell/ToolRail.js';
import { Toasts } from './shell/Toasts.js';
import { ActivityLog } from './shell/ActivityLog.js';
import { NotificationCenter, type NotifyInput } from './notify/NotificationCenter.js';
import type { GameState } from '../core/state/GameState.js';
import type { WeatherState } from '../core/weather/WeatherCycle.js';

import type { CommandResult } from '../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

export type PanelName = 'blast' | 'contracts' | 'build' | 'vehicles' | 'employees' | 'survey' | 'settings';

export class UIManager {
  private readonly topBar: TopBar;
  private readonly toolRail: ToolRail;
  private readonly toasts: Toasts;
  private readonly activityLog: ActivityLog;
  private readonly notificationCenter = new NotificationCenter();
  private readonly blastUI: BlastPlanUI;
  private readonly contractUI: ContractUI;
  private readonly buildMenu: BuildMenu;
  private readonly vehiclePanel: VehiclePanel;
  private readonly employeePanel: EmployeePanel;
  private readonly eventDialog: EventDialog;
  private readonly surveyUI: SurveyUI;
  private readonly settingsMenu: SettingsMenu;
  private readonly miniMap: MiniMap;

  private activePanel: PanelName | null = null;
  private onLanguageChange?: (lang: string) => void;
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
    this.blastUI = new BlastPlanUI(leftCol);
    this.contractUI = new ContractUI(leftCol);
    this.buildMenu = new BuildMenu(leftCol);
    this.vehiclePanel = new VehiclePanel(leftCol);
    this.employeePanel = new EmployeePanel(leftCol);
    this.surveyUI = new SurveyUI(leftCol);
    // Settings appended to root container so its z-index:10000 beats the main menu (z-index:9999).
    // Inside leftCol's fixed stacking context it would be capped at z:100 relative to root.
    this.settingsMenu = new SettingsMenu(container);

    // Event dialog (modal, appended to container)
    this.eventDialog = new EventDialog(container);

    // MiniMap on right
    this.miniMap = new MiniMap(rightCol);

    // Esc cascade: activity log drawer closes before the active panel does.
    this.escLayers.push(() => {
      if (this.activityLog.visible) { this.activityLog.hide(); return true; }
      return false;
    });

    // A language switch inside the settings panel has to re-render every panel
    // already on screen, then let whoever else is listening (main.ts refreshes
    // the main menu behind the panel) react.
    this.settingsMenu.setLanguageChangeHandler((lang) => {
      this.refreshLocale();
      this.onLanguageChange?.(lang);
    });
  }

  private onSpeedChangeCb?: (speed: number) => void;
  private onTogglePauseCb?: () => void;

  setGameConsole(fn: GameConsoleFn): void {
    this.blastUI.setGameConsole(fn);
    this.contractUI.setGameConsole(fn);
    this.buildMenu.setGameConsole(fn);
    this.vehiclePanel.setGameConsole(fn);
    this.employeePanel.setGameConsole(fn);
    this.eventDialog.setGameConsole(fn);
    this.surveyUI.setGameConsole(fn);
    this.settingsMenu.setGameConsole(fn);
  }

  setSpeedChangeHandler(cb: (speed: number) => void): void {
    this.onSpeedChangeCb = cb;
  }

  setTogglePauseHandler(cb: () => void): void {
    this.onTogglePauseCb = cb;
  }

  setQuitHandler(cb: () => void): void {
    this.settingsMenu.setQuitHandler(cb);
  }

  setLanguageChangeHandler(cb: (lang: string) => void): void {
    this.onLanguageChange = cb;
  }

  /** Wire the top bar's Saves button (SaveLoadUI lives in main.ts, not here). */
  setOpenSavesHandler(cb: () => void): void {
    this.topBar.setOpenSavesHandler(cb);
  }

  /** Wire the top bar's Site Map button (MainMenu lives in main.ts, not here). */
  setSiteMapHandler(cb: () => void): void {
    this.topBar.setSiteMapHandler(cb);
  }

  /** Wire the minimap's click-to-focus (main.ts owns the camera + surface-height lookup). */
  setMapFocusHandler(cb: (x: number, z: number) => void): void {
    this.miniMap.setFocusHandler(cb);
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

  /** Re-render all owned panels' locale-dependent text after a language change. */
  refreshLocale(): void {
    this.topBar.refreshLocale();
    this.toolRail.refreshLocale();
    this.blastUI.refreshLocale();
    this.contractUI.refreshLocale();
    this.buildMenu.refreshLocale();
    this.vehiclePanel.refreshLocale();
    this.employeePanel.refreshLocale();
    this.surveyUI.refreshLocale();
    this.settingsMenu.refreshLocale();
    this.miniMap.refreshLocale();
    this.eventDialog.refreshLocale();
  }

  /**
   * Show a brief toast notification (game-over warnings, contract expiry, etc.).
   * @deprecated prefer notify({severity, title, body}) — kept so any caller
   * still passing a single string gets a sensible warn-severity toast.
   */
  showNotification(message: string): void {
    this.notify({ severity: 'warn', title: message, body: '' });
  }

  update(state: GameState, weather?: WeatherState): void {
    this.topBar.update(state, weather, this.notificationCenter);
    this.toasts.update(this.notificationCenter);
    this.activityLog.update(this.notificationCenter);
    // setNavGrid before update() — otherwise the overlay draws against the
    // previous tick's navgrid for one frame after any navgrid change (new
    // game, fresh ramp, blast).
    this.miniMap.setNavGrid(state.navGrid ?? null);
    this.miniMap.update(state);

    // Update active panel
    if (this.blastUI.visible) this.blastUI.update(state);
    if (this.contractUI.visible) this.contractUI.update(state);
    if (this.buildMenu.visible) this.buildMenu.update(state);
    if (this.vehiclePanel.visible) this.vehiclePanel.update(state);
    if (this.employeePanel.visible) this.employeePanel.update(state);
    if (this.surveyUI.visible) this.surveyUI.update(state);
    if (this.settingsMenu.visible) this.settingsMenu.update(state);

    // Event dialog — auto-show when pending event exists, keep open during outcome
    if (state.events.pendingEvent && !this.eventDialog.visible) {
      this.eventDialog.update(state);
      this.eventDialog.show();
    } else if (this.eventDialog.visible && !this.eventDialog.isShowingOutcome) {
      this.eventDialog.update(state);
    }
  }

  showPanel(name: PanelName): void {
    this.hideAllPanels();
    this.activePanel = name;
    switch (name) {
      case 'blast': this.blastUI.show(); break;
      case 'contracts': this.contractUI.show(); break;
      case 'build': this.buildMenu.show(); break;
      case 'vehicles': this.vehiclePanel.show(); break;
      case 'employees': this.employeePanel.show(); break;
      case 'survey': this.surveyUI.show(); break;
      case 'settings': this.settingsMenu.show(); break;
    }
    this.toolRail.setActive(this.activePanel);
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
    this.contractUI.dispose();
    this.buildMenu.dispose();
    this.vehiclePanel.dispose();
    this.employeePanel.dispose();
    this.eventDialog.dispose();
    this.surveyUI.dispose();
    this.settingsMenu.dispose();
    this.miniMap.dispose();
  }

  private hideAllPanels(): void {
    this.activePanel = null;
    this.blastUI.hide();
    this.contractUI.hide();
    this.buildMenu.hide();
    this.vehiclePanel.hide();
    this.employeePanel.hide();
    this.surveyUI.hide();
    this.settingsMenu.hide();
    this.toolRail.setActive(null);
  }
}
