// BlastSimulator2026 — UI Manager (10.x)
// Orchestrates all UI panels. Wires game console, handles toolbar, drives per-tick updates.

import { injectStyles } from './styles.js';
import { injectTokens } from './tokens.js';
import { registerIcons } from './icons.js';
import { HUD } from './HUD.js';
import { BlastPlanUI } from './BlastPlanUI.js';
import { ContractUI } from './ContractUI.js';
import { BuildMenu } from './BuildMenu.js';
import { VehiclePanel } from './VehiclePanel.js';
import { EmployeePanel } from './EmployeePanel.js';
import { EventDialog } from './EventDialog.js';
import { SurveyUI } from './SurveyUI.js';
import { SettingsMenu } from './SettingsMenu.js';
import { MiniMap } from './MiniMap.js';
import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import type { WeatherState } from '../core/weather/WeatherCycle.js';

import type { CommandResult } from '../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

export type PanelName = 'blast' | 'contracts' | 'build' | 'vehicles' | 'employees' | 'survey' | 'settings';

/** Toolbar buttons, in order: panel, icon, i18n key. Shared by buildToolbar()
 *  and refreshLocale() so the captions cannot drift apart. */
const TOOLBAR_BUTTONS: ReadonlyArray<readonly [PanelName, string, string]> = [
  ['blast',     '💣 ', 'ui.toolbar.blast'],
  ['contracts', '📋 ', 'ui.toolbar.contracts'],
  ['build',     '🏗 ',  'ui.toolbar.build'],
  ['vehicles',  '🚛 ', 'ui.toolbar.vehicles'],
  ['employees', '👷 ', 'ui.toolbar.employees'],
  ['survey',    '🔍 ', 'ui.toolbar.survey'],
  ['settings',  '⚙️ ',  'ui.toolbar.settings'],
];

export class UIManager {
  private readonly hud: HUD;
  private readonly blastUI: BlastPlanUI;
  private readonly contractUI: ContractUI;
  private readonly buildMenu: BuildMenu;
  private readonly vehiclePanel: VehiclePanel;
  private readonly employeePanel: EmployeePanel;
  private readonly eventDialog: EventDialog;
  private readonly surveyUI: SurveyUI;
  private readonly settingsMenu: SettingsMenu;
  private readonly miniMap: MiniMap;
  private readonly toolbar: HTMLElement;

  private activePanel: PanelName | null = null;
  private onLanguageChange?: (lang: string) => void;

  constructor(container: HTMLElement) {
    injectStyles();
    // Redesign foundation (P0): additive token stylesheet + icon registry.
    // Coexists with the legacy stylesheet until each surface migrates.
    injectTokens();
    registerIcons();

    // Left column — panels
    const leftCol = document.createElement('div');
    leftCol.id = 'bs-left-col';
    leftCol.style.cssText = 'position:fixed;top:70px;left:8px;z-index:100;display:flex;flex-direction:column;gap:6px;max-height:calc(100vh - 80px);overflow-y:auto;pointer-events:none';

    // Right column — minimap
    const rightCol = document.createElement('div');
    rightCol.id = 'bs-right-col';
    rightCol.style.cssText = 'position:fixed;top:70px;right:8px;z-index:100';

    container.appendChild(leftCol);
    container.appendChild(rightCol);

    // HUD (always visible at top)
    this.hud = new HUD(container);

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

    // Toolbar (right side, vertically centred — layout driven entirely by CSS #bs-toolbar)
    this.toolbar = document.createElement('div');
    this.toolbar.id = 'bs-toolbar';
    container.appendChild(this.toolbar);
    this.buildToolbar();

    // A language switch inside the settings panel has to re-render every panel
    // already on screen, then let whoever else is listening (main.ts refreshes
    // the main menu behind the panel) react.
    this.settingsMenu.setLanguageChangeHandler((lang) => {
      this.refreshLocale();
      this.onLanguageChange?.(lang);
    });
  }

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
    this.hud.setSpeedChangeHandler(cb);
  }

  setQuitHandler(cb: () => void): void {
    this.settingsMenu.setQuitHandler(cb);
  }

  setLanguageChangeHandler(cb: (lang: string) => void): void {
    this.onLanguageChange = cb;
  }

  /** Re-render all owned panels' locale-dependent text after a language change. */
  refreshLocale(): void {
    this.hud.refreshLocale();
    this.blastUI.refreshLocale();
    this.contractUI.refreshLocale();
    this.buildMenu.refreshLocale();
    this.vehiclePanel.refreshLocale();
    this.employeePanel.refreshLocale();
    this.surveyUI.refreshLocale();
    this.settingsMenu.refreshLocale();
    this.miniMap.refreshLocale();
    this.eventDialog.refreshLocale();

    // Toolbar captions are baked once at construction.
    for (const [name, icon, key] of TOOLBAR_BUTTONS) {
      const btn = this.toolbar.querySelector<HTMLButtonElement>(`.bs-toolbar-btn[data-panel="${name}"]`);
      if (btn) btn.textContent = icon + t(key);
    }
  }

  /**
   * Show a brief toast notification (game-over warnings, contract expiry, etc.).
   * Auto-dismisses after 6 seconds.
   */
  showNotification(message: string): void {
    const el = document.createElement('div');
    el.className = 'bs-notification';
    el.textContent = message;
    document.body.appendChild(el);
    // Fade out and remove
    setTimeout(() => {
      el.style.transition = 'opacity 0.5s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 500);
    }, 5500);
  }

  update(state: GameState, weather?: WeatherState): void {
    this.hud.update(state, weather);
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
    this.syncToolbarActive();
  }

  togglePanel(name: PanelName): void {
    if (this.activePanel === name) {
      this.hideAllPanels();
    } else {
      this.showPanel(name);
    }
    this.syncToolbarActive();
  }

  /** Toggle the NavGrid overlay on the MiniMap. */
  toggleNavGridOverlay(): void {
    this.miniMap.setNavGridVisible(!this.miniMap.navGridVisible);
  }

  dispose(): void {
    this.hud.dispose();
    this.blastUI.dispose();
    this.contractUI.dispose();
    this.buildMenu.dispose();
    this.vehiclePanel.dispose();
    this.employeePanel.dispose();
    this.eventDialog.dispose();
    this.surveyUI.dispose();
    this.settingsMenu.dispose();
    this.miniMap.dispose();
    this.toolbar.remove();
  }

  private syncToolbarActive(): void {
    this.toolbar.querySelectorAll<HTMLButtonElement>('.bs-toolbar-btn').forEach(b => {
      b.classList.toggle('active', b.dataset['panel'] === this.activePanel);
    });
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
  }

  private buildToolbar(): void {
    for (const [name, icon, key] of TOOLBAR_BUTTONS) {
      const btn = document.createElement('button');
      btn.className = 'bs-toolbar-btn';
      btn.textContent = icon + t(key);
      btn.dataset['panel'] = name;
      btn.addEventListener('click', () => {
        this.togglePanel(name);
        // Sync active state on all toolbar buttons
        this.toolbar.querySelectorAll<HTMLButtonElement>('.bs-toolbar-btn').forEach(b => {
          b.classList.toggle('active', b.dataset['panel'] === name && this.activePanel === name);
        });
      });
      this.toolbar.appendChild(btn);
    }
  }
}
