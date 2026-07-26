// BlastSimulator2026 — Settings Menu (10.9)
// Language, save/load, audio, and quit controls.

import { t, setLocale } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import type { ShiftMode } from '../core/entities/SitePolicy.js';

import type { CommandResult } from '../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

/** Shift modes accepted by `set_policy`. */
const SHIFT_MODES: ShiftMode[] = ['shift_8h', 'shift_12h', 'continuous', 'custom'];

export class SettingsMenu {
  private readonly el: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly shiftSelect: HTMLSelectElement;
  private readonly hungerInput: HTMLInputElement;
  private readonly fatigueInput: HTMLInputElement;
  private gameConsole?: GameConsoleFn;
  private onLanguageChange?: (lang: string) => void;
  private onQuit?: () => void;
  /** True once the player has touched a policy control — stops sync clobbering. */
  private policyDirty = false;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bs-settings-panel';
    this.el.classList.add('bs-ui', 'bs-panel');
    this.el.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'bs-panel-title';
    title.textContent = t('ui.settings.title');

    // Language
    const langLabel = this.makeLabel(t('ui.settings.language'));

    const langRow = document.createElement('div');
    langRow.style.cssText = 'display:flex;gap:4px;margin-bottom:8px';

    const enBtn = document.createElement('button');
    enBtn.className = 'bs-btn';
    enBtn.style.cssText = 'flex:1;padding:3px';
    enBtn.textContent = t('ui.settings.english');
    enBtn.addEventListener('click', () => {
      setLocale('en');
      this.onLanguageChange?.('en');
    });

    const frBtn = document.createElement('button');
    frBtn.className = 'bs-btn';
    frBtn.style.cssText = 'flex:1;padding:3px';
    frBtn.textContent = t('ui.settings.french');
    frBtn.addEventListener('click', () => {
      setLocale('fr');
      this.onLanguageChange?.('fr');
    });

    langRow.append(enBtn, frBtn);

    // Save/Load
    const saveBtn = document.createElement('button');
    saveBtn.className = 'bs-btn bs-btn-primary';
    saveBtn.style.cssText = 'width:100%;margin-bottom:4px';
    saveBtn.textContent = t('ui.settings.save');
    saveBtn.addEventListener('click', () => {
      this.gameConsole?.('save');
      this.setStatus(t('ui.settings.saved'));
    });

    const loadBtn = document.createElement('button');
    loadBtn.className = 'bs-btn';
    loadBtn.style.cssText = 'width:100%;margin-bottom:4px';
    loadBtn.textContent = t('ui.settings.load');
    loadBtn.addEventListener('click', () => {
      this.gameConsole?.('load');
      this.setStatus(t('ui.settings.loaded'));
    });

    const quitBtn = document.createElement('button');
    quitBtn.className = 'bs-btn bs-btn-danger';
    quitBtn.style.cssText = 'width:100%;margin-bottom:4px';
    quitBtn.textContent = t('ui.settings.quit');
    quitBtn.addEventListener('click', () => this.onQuit?.());

    this.statusEl = document.createElement('div');
    this.statusEl.style.cssText = 'font-size:10px;color:#80c080;min-height:14px;text-align:center';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bs-btn';
    closeBtn.style.cssText = 'width:100%;margin-top:6px';
    closeBtn.textContent = t('ui.settings.close');
    closeBtn.addEventListener('click', () => this.hide());

    // ── Site policy ──
    // Shift schedule and rest thresholds live here because they are site-wide
    // settings, and until now there was no way to change them outside the console.
    const policyHeader = document.createElement('div');
    policyHeader.className = 'bs-section-header';
    policyHeader.style.marginTop = '8px';
    policyHeader.textContent = t('ui.policy.title');

    this.shiftSelect = document.createElement('select');
    this.shiftSelect.className = 'bs-select';
    this.shiftSelect.id = 'bs-policy-shift';
    for (const mode of SHIFT_MODES) {
      const opt = document.createElement('option');
      opt.value = mode;
      opt.textContent = t(`ui.policy.${mode}`);
      this.shiftSelect.appendChild(opt);
    }
    this.shiftSelect.addEventListener('change', () => { this.policyDirty = true; });

    this.hungerInput = this.makeThresholdInput('bs-policy-hunger', 30);
    this.fatigueInput = this.makeThresholdInput('bs-policy-fatigue', 25);

    const applyBtn = document.createElement('button');
    applyBtn.className = 'bs-btn bs-btn-primary';
    applyBtn.id = 'bs-policy-apply';
    applyBtn.style.cssText = 'width:100%;margin-top:6px';
    applyBtn.textContent = t('ui.policy.apply');
    applyBtn.addEventListener('click', () => {
      const result = this.gameConsole?.(
        `set_policy mode:${this.shiftSelect.value}` +
        ` hunger:${this.hungerInput.value} fatigue:${this.fatigueInput.value}`,
      );
      this.policyDirty = false;
      this.setStatus(result?.success ? t('ui.policy.applied') : (result?.output ?? ''));
    });

    this.el.append(
      title, langLabel, langRow, saveBtn, loadBtn, quitBtn,
      policyHeader,
      this.makeLabel(t('ui.policy.shift_mode')), this.shiftSelect,
      this.makeLabel(t('ui.policy.hunger')), this.hungerInput,
      this.makeLabel(t('ui.policy.fatigue')), this.fatigueInput,
      applyBtn,
      this.statusEl, closeBtn,
    );
    container.appendChild(this.el);
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }
  setLanguageChangeHandler(cb: (lang: string) => void): void { this.onLanguageChange = cb; }
  setQuitHandler(cb: () => void): void { this.onQuit = cb; }

  show(): void { this.el.style.display = ''; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  /** Mirror the live site policy into the controls until the player edits them. */
  update(state: GameState): void {
    if (this.policyDirty) return;
    const policy = state.sitePolicy;
    if (!policy) return;
    this.shiftSelect.value = policy.shiftMode;
    this.hungerInput.value = String(policy.hungerRestThreshold);
    this.fatigueInput.value = String(policy.fatigueRestThreshold);
  }

  setStatus(msg: string): void {
    this.statusEl.textContent = msg;
    setTimeout(() => { if (this.statusEl.textContent === msg) this.statusEl.textContent = ''; }, 3000);
  }

  dispose(): void { this.el.remove(); }

  private makeThresholdInput(id: string, fallback: number): HTMLInputElement {
    const el = document.createElement('input');
    el.type = 'number';
    el.id = id;
    el.className = 'bs-input';
    el.min = '0';
    el.max = '100';
    el.step = '5';
    el.value = String(fallback);
    el.addEventListener('input', () => { this.policyDirty = true; });
    return el;
  }

  private makeLabel(text: string): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = 'font-size:10px;color:#908070;margin-bottom:2px;margin-top:4px';
    el.textContent = text;
    return el;
  }
}
