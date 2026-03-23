// BlastSimulator2026 — UI Manager (10.x)
// Orchestrates all UI panels. Wires game console, handles toolbar, drives per-tick updates.

import { injectStyles } from './styles.js';
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

export type GameConsoleFn = (cmd: string) => string;

type PanelName = 'blast' | 'contracts' | 'build' | 'vehicles' | 'employees' | 'survey' | 'settings';

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

  constructor(container: HTMLElement) {
    injectStyles();

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
    this.miniMap.update(state);

    // Update active panel
    if (this.blastUI.visible) this.blastUI.update(state);
    if (this.contractUI.visible) this.contractUI.update(state);
    if (this.buildMenu.visible) this.buildMenu.update(state);
    if (this.vehiclePanel.visible) this.vehiclePanel.update(state);
    if (this.employeePanel.visible) this.employeePanel.update(state);

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
    const buttons: [PanelName, string, string][] = [
      ['blast',     '💣 ' + t('ui.toolbar.blast'),     'blast'],
      ['contracts', '📋 ' + t('ui.toolbar.contracts'), 'contracts'],
      ['build',     '🏗 '  + t('ui.toolbar.build'),     'build'],
      ['vehicles',  '🚛 ' + t('ui.toolbar.vehicles'),  'vehicles'],
      ['employees', '👷 ' + t('ui.toolbar.employees'), 'employees'],
      ['survey',    '🔍 ' + t('ui.toolbar.survey'),    'survey'],
      ['settings',  '⚙️ '  + t('ui.toolbar.settings'),  'settings'],
    ];

    for (const [name, label] of buttons) {
      const btn = document.createElement('button');
      btn.className = 'bs-toolbar-btn';
      btn.textContent = label;
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
