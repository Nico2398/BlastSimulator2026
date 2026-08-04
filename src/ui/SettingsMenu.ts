// BlastSimulator2026 — Settings Menu (10.9)
// Language, save/load, audio, and quit controls.

import { t, setLocale } from '../core/i18n/I18n.js';
import { LocaleTextRegistry } from './localeText.js';

import type { CommandResult } from '../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

export class SettingsMenu {
  private readonly el: HTMLElement;
  private readonly statusEl: HTMLElement;
  private gameConsole?: GameConsoleFn;
  private onLanguageChange?: (lang: string) => void;
  private onQuit?: () => void;
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bs-settings-panel';
    this.el.classList.add('bs-ui', 'bs-panel');
    this.el.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'bs-panel-title';
    this.locale.bindText(title, 'ui.settings.title');

    // Language
    const langLabel = this.makeLabel('ui.settings.language');

    const langRow = document.createElement('div');
    langRow.style.cssText = 'display:flex;gap:4px;margin-bottom:8px';

    const enBtn = document.createElement('button');
    enBtn.className = 'bs-btn';
    enBtn.style.cssText = 'flex:1;padding:3px';
    enBtn.dataset['lang'] = 'en';
    this.locale.bindText(enBtn, 'ui.settings.english');
    enBtn.addEventListener('click', () => {
      setLocale('en');
      this.onLanguageChange?.('en');
    });

    const frBtn = document.createElement('button');
    frBtn.className = 'bs-btn';
    frBtn.style.cssText = 'flex:1;padding:3px';
    frBtn.dataset['lang'] = 'fr';
    this.locale.bindText(frBtn, 'ui.settings.french');
    frBtn.addEventListener('click', () => {
      setLocale('fr');
      this.onLanguageChange?.('fr');
    });

    langRow.append(enBtn, frBtn);

    // Save/Load
    const saveBtn = document.createElement('button');
    saveBtn.className = 'bs-btn bs-btn-primary';
    saveBtn.style.cssText = 'width:100%;margin-bottom:4px';
    this.locale.bindText(saveBtn, 'ui.settings.save');
    saveBtn.addEventListener('click', () => {
      this.gameConsole?.('save');
      this.setStatus(t('ui.settings.saved'));
    });

    const loadBtn = document.createElement('button');
    loadBtn.className = 'bs-btn';
    loadBtn.style.cssText = 'width:100%;margin-bottom:4px';
    this.locale.bindText(loadBtn, 'ui.settings.load');
    loadBtn.addEventListener('click', () => {
      this.gameConsole?.('load');
      this.setStatus(t('ui.settings.loaded'));
    });

    const quitBtn = document.createElement('button');
    quitBtn.className = 'bs-btn bs-btn-danger';
    quitBtn.style.cssText = 'width:100%;margin-bottom:4px';
    this.locale.bindText(quitBtn, 'ui.settings.quit');
    quitBtn.addEventListener('click', () => this.onQuit?.());

    this.statusEl = document.createElement('div');
    this.statusEl.style.cssText = 'font-size:10px;color:#80c080;min-height:14px;text-align:center';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bs-btn';
    closeBtn.style.cssText = 'width:100%;margin-top:6px';
    this.locale.bindText(closeBtn, 'ui.settings.close');
    closeBtn.addEventListener('click', () => this.hide());

    const policyMovedNote = document.createElement('div');
    policyMovedNote.style.cssText = 'font-size:10px;color:#857b6b;margin-top:8px;line-height:1.4';
    this.locale.bindText(policyMovedNote, 'ui.settings.policy_moved');

    this.el.append(
      title, langLabel, langRow, saveBtn, loadBtn, quitBtn,
      this.statusEl, closeBtn, policyMovedNote,
    );
    container.appendChild(this.el);
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }
  setLanguageChangeHandler(cb: (lang: string) => void): void { this.onLanguageChange = cb; }
  setQuitHandler(cb: () => void): void { this.onQuit = cb; }

  /** Re-render locale-dependent text (title, labels, buttons) after a language change. */
  refreshLocale(): void {
    this.locale.refresh();
  }

  show(): void { this.el.style.display = ''; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  setStatus(msg: string): void {
    this.statusEl.textContent = msg;
    setTimeout(() => { if (this.statusEl.textContent === msg) this.statusEl.textContent = ''; }, 3000);
  }

  dispose(): void { this.el.remove(); }

  private makeLabel(key: string): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = 'font-size:10px;color:#908070;margin-bottom:2px;margin-top:4px';
    return this.locale.bindText(el, key);
  }
}
