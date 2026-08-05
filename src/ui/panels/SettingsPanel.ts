// BlastSimulator2026 — Settings panel (redesign P10)
// Language, audio (real AudioManager gain nodes), keyboard reference (single
// source: KeyboardShortcuts.ts's own binding map via its existing shortcuts.*
// strings), and session controls (replay tutorial, open saves, return to
// menu). Site policy lives in Operations — see ui.settings.policy_moved.
//
// Reachable both pre-game (MainMenu's SETTINGS button) and mid-game (the
// tool rail's settings icon) — spec §6.15. The session controls need a
// running game, so they're hidden until update() has been called with a
// non-null state at least once; the constructor leaves them hidden by
// default so the pre-game path (where update() never fires) shows nothing
// it can't act on.

import { t, getLocale, setLocale } from '../../core/i18n/I18n.js';
import { el, button, sectionHeader } from '../dom.js';
import { iconEl } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import type { AudioManager, AudioCategory } from '../../audio/AudioManager.js';
import type { GameState } from '../../core/state/GameState.js';
import type { SaveBackend } from '../../core/state/SaveBackend.js';
import { AUTO_SAVE_SLOT, relativeTime } from './SavesModal.js';
import type { ConfirmModalConfig } from './ConfirmModal.js';

export type GetStateCallback = () => GameState | null;

const AUDIO_CHANNELS: readonly { channel: 'master' | AudioCategory; labelKey: string }[] = [
  { channel: 'master', labelKey: 'ui.settings.audio.master' },
  { channel: 'effects', labelKey: 'ui.settings.audio.effects' },
  { channel: 'ambient', labelKey: 'ui.settings.audio.ambient' },
  { channel: 'ui', labelKey: 'ui.settings.audio.ui' },
];

// Single source for the reference table: mirrors the bindings in
// KeyboardShortcuts.ts's constructor switch, one row per shortcuts.* string
// that already exists there (each string already carries both the key and
// what it does, e.g. "B: Blast Plan" — no separate key-cap column, so this
// stays a single reused key per row rather than forking new ones).
const SHORTCUT_KEYS: readonly string[] = [
  'shortcuts.pause', 'shortcuts.speed', 'shortcuts.blast', 'shortcuts.contracts',
  'shortcuts.build', 'shortcuts.vehicles', 'shortcuts.employees', 'shortcuts.survey',
  'shortcuts.navgrid', 'shortcuts.saves', 'shortcuts.settings',
];

export class SettingsPanel {
  private readonly el: HTMLElement;
  private readonly sessionSection: HTMLElement;
  private readonly volumeEls: Partial<Record<'master' | AudioCategory, { input: HTMLInputElement; readout: HTMLElement }>> = {};

  private onCloseCb?: () => void;
  private onLanguageChangeCb?: (lang: string) => void;
  private onConfirmRequestCb?: (config: ConfirmModalConfig) => void;
  private onReplayTutorialCb?: () => void;
  private onOpenSavesCb?: () => void;
  private onReturnToMenuCb?: () => void;
  private audioManager?: AudioManager;
  private backend: SaveBackend | null = null;
  private getState?: GetStateCallback;
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.el = el('div', { className: 'bsx-root', attrs: {
      id: 'bs-settings-panel',
      // Appended to the root container so its z-index beats the main menu
      // (var(--bsx-z-menu)) — inside leftCol's fixed stacking context it
      // would be capped relative to root, same reasoning as SavesModal.
      style: 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);'
        + 'width:372px;max-height:86vh;display:flex;flex-direction:column;'
        + 'border-radius:9px;background:var(--bsx-panel);border:1px solid var(--bsx-hairline-strong);'
        + `box-shadow:0 30px 80px rgba(0,0,0,.7);overflow:hidden;z-index:var(--bsx-z-menu-settings)`,
    } });
    this.el.style.display = 'none';

    const header = el('div', { attrs: {
      style: 'flex:0 0 auto;display:flex;align-items:center;gap:10px;height:46px;padding:0 12px;'
        + 'background:#1a2028;border-bottom:1px solid var(--bsx-hairline)',
    } });
    const iconChip = el('div', {
      attrs: { style: 'width:26px;height:26px;border-radius:5px;display:flex;align-items:center;'
        + 'justify-content:center;background:rgba(255,176,46,.14);color:var(--bsx-amber)' },
      children: [iconEl('settings', 15)],
    });
    const titleEl = this.locale.bindText(
      el('div', { attrs: { style: 'font:700 12px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-primary)' } }),
      'ui.settings.title',
    );
    const closeBtn = el('button', { attrs: {
      style: 'margin-left:auto;width:28px;height:28px;display:flex;align-items:center;justify-content:center;'
        + 'border:1px solid var(--bsx-hairline);border-radius:4px;background:transparent;color:var(--bsx-text-muted);cursor:pointer',
    } });
    closeBtn.appendChild(iconEl('x', 12));
    closeBtn.addEventListener('click', () => this.onCloseCb?.());
    header.append(iconChip, titleEl, closeBtn);

    const body = el('div', { attrs: { style: 'padding:12px;display:flex;flex-direction:column;gap:11px;overflow-y:auto' } });

    // ── Language ──
    const langHeader = sectionHeader('');
    this.locale.bindText(langHeader.querySelector('.bsx-section-label') as HTMLElement, 'ui.settings.language');
    const enBtn = el('button', { className: 'bsx-menu-lang-pill', attrs: { style: 'flex:1;text-align:center;padding:8px 5px' } });
    const frBtn = el('button', { className: 'bsx-menu-lang-pill', attrs: { style: 'flex:1;text-align:center;padding:8px 5px' } });
    this.locale.bindText(enBtn, 'ui.settings.english');
    this.locale.bindText(frBtn, 'ui.settings.french');
    const setLangPills = (lang: string) => {
      enBtn.classList.toggle('active', lang === 'en');
      frBtn.classList.toggle('active', lang === 'fr');
    };
    enBtn.addEventListener('click', () => { setLocale('en'); setLangPills('en'); this.onLanguageChangeCb?.('en'); });
    frBtn.addEventListener('click', () => { setLocale('fr'); setLangPills('fr'); this.onLanguageChangeCb?.('fr'); });
    setLangPills(getLocale());
    const langRow = el('div', {
      attrs: { style: 'display:flex;gap:3px;padding:3px;border-radius:5px;background:var(--bsx-well)' },
      children: [enBtn, frBtn],
    });

    // ── Audio ──
    const audioHeader = sectionHeader(t('ui.settings.audio'));
    this.locale.bindText(audioHeader.querySelector('.bsx-section-label') as HTMLElement, 'ui.settings.audio');
    const audioRows = AUDIO_CHANNELS.map(({ channel, labelKey }) => this.audioRow(channel, labelKey));

    // ── Keyboard ──
    const keyboardHeader = sectionHeader(t('ui.settings.keyboard'));
    this.locale.bindText(keyboardHeader.querySelector('.bsx-section-label') as HTMLElement, 'ui.settings.keyboard');
    // flex-shrink:0 is load-bearing: body is a flex column with less height
    // than its content wants at 11 shortcut rows, and a plain flex item here
    // would get silently squeezed by the flex algorithm — invisibly, since
    // overflow:hidden (for the rounded corners) hides the clipped rows
    // instead of scrolling them. body's own overflow-y:auto is what should
    // absorb the excess height, not this box shrinking under it.
    const keyboardBox = el('div', { attrs: { style: 'border-radius:5px;background:var(--bsx-well);overflow:hidden;flex-shrink:0' } });
    for (const key of SHORTCUT_KEYS) {
      const row = el('div', { attrs: { style: 'padding:6px 11px;border-bottom:1px solid var(--bsx-hairline)' } });
      const span = row.appendChild(el('span', { attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-muted)' } }));
      this.locale.bindText(span, key);
      keyboardBox.appendChild(row);
    }
    // Last row's border reads as a stray line under the box — drop it.
    (keyboardBox.lastElementChild as HTMLElement | null)?.style.setProperty('border-bottom', '0');

    // ── Session (game-dependent; hidden until update() sees a live game) ──
    const sessionHeader = sectionHeader(t('ui.settings.session'));
    this.locale.bindText(sessionHeader.querySelector('.bsx-section-label') as HTMLElement, 'ui.settings.session');
    const replayBtn = button('ghost', t('ui.settings.replay_tutorial'), { onClick: () => this.handleReplayTutorial() });
    replayBtn.style.width = '100%';
    this.locale.bindText(replayBtn.querySelector('span') as HTMLElement, 'ui.settings.replay_tutorial');
    const savesBtn = button('ghost', t('ui.settings.save_and_load'), { onClick: () => this.handleOpenSaves() });
    savesBtn.style.width = '100%';
    this.locale.bindText(savesBtn.querySelector('span') as HTMLElement, 'ui.settings.save_and_load');
    const returnBtn = button('danger', t('ui.settings.return_to_menu'), { onClick: () => this.handleReturnToMenu() });
    returnBtn.style.width = '100%';
    this.locale.bindText(returnBtn.querySelector('span') as HTMLElement, 'ui.settings.return_to_menu');

    this.sessionSection = el('div', {
      attrs: { style: 'display:none;flex-direction:column;gap:11px' },
      children: [sessionHeader, replayBtn, savesBtn, returnBtn],
    });

    const policyNote = el('span', {
      attrs: { style: 'font:400 10px/1.45 var(--bsx-font-ui);color:var(--bsx-text-micro)' },
    });
    this.locale.bindText(policyNote, 'ui.settings.policy_moved');

    body.append(
      langHeader, langRow,
      audioHeader, ...audioRows,
      keyboardHeader, keyboardBox,
      this.sessionSection,
      policyNote,
    );

    this.el.append(header, body);
    container.appendChild(this.el);
  }

  get root(): HTMLElement { return this.el; }

  setCloseHandler(cb: () => void): void { this.onCloseCb = cb; }
  setLanguageChangeHandler(cb: (lang: string) => void): void { this.onLanguageChangeCb = cb; }
  setConfirmHandler(cb: (config: ConfirmModalConfig) => void): void { this.onConfirmRequestCb = cb; }
  setReplayTutorialHandler(cb: () => void): void { this.onReplayTutorialCb = cb; }
  setOpenSavesHandler(cb: () => void): void { this.onOpenSavesCb = cb; }
  setReturnToMenuHandler(cb: () => void): void { this.onReturnToMenuCb = cb; }
  setBackend(backend: SaveBackend): void { this.backend = backend; }
  setGetState(fn: GetStateCallback): void { this.getState = fn; }

  setAudioManager(mgr: AudioManager): void {
    this.audioManager = mgr;
    for (const { channel } of AUDIO_CHANNELS) {
      const entry = this.volumeEls[channel];
      if (!entry) continue;
      const pct = Math.round(mgr.getVolume(channel) * 100);
      entry.input.value = String(pct);
      entry.readout.textContent = String(pct);
    }
  }

  /** Reveal/hide the game-dependent session controls. Cheap — call every tick. */
  update(state: GameState | null): void {
    this.sessionSection.style.display = state ? 'flex' : 'none';
  }

  show(): void { this.el.style.display = 'flex'; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  refreshLocale(): void { this.locale.refresh(); }

  dispose(): void { this.el.remove(); }

  private audioRow(channel: 'master' | AudioCategory, labelKey: string): HTMLElement {
    const label = el('span', { attrs: { style: 'font:400 11px/1 var(--bsx-font-ui);color:var(--bsx-text-secondary);width:74px;flex:0 0 74px' } });
    this.locale.bindText(label, labelKey);

    const input = el('input', { attrs: {
      type: 'range', min: '0', max: '100', value: '100',
      style: 'flex:1;accent-color:var(--bsx-amber)',
    } }) as HTMLInputElement;
    const readout = el('span', {
      text: '100',
      attrs: { style: 'font:500 10px/1 var(--bsx-font-mono);color:var(--bsx-text-muted);width:26px;text-align:right' },
    });
    input.addEventListener('input', () => {
      readout.textContent = input.value;
      this.audioManager?.setVolume(channel, Number(input.value) / 100);
    });
    this.volumeEls[channel] = { input, readout };

    return el('div', { attrs: { style: 'display:flex;align-items:center;gap:9px' }, children: [label, input, readout] });
  }

  private handleReplayTutorial(): void {
    this.onCloseCb?.();
    this.onReplayTutorialCb?.();
  }

  private handleOpenSaves(): void {
    this.onCloseCb?.();
    this.onOpenSavesCb?.();
  }

  private handleReturnToMenu(): void {
    void this.confirmReturnToMenu();
  }

  private async confirmReturnToMenu(): Promise<void> {
    const state = this.getState?.() ?? null;
    const body = await this.returnConfirmBody(state);
    this.onConfirmRequestCb?.({
      icon: 'warn',
      title: t('ui.settings.return_confirm_title'),
      body,
      confirmLabel: t('ui.settings.return_confirm_button'),
      onConfirm: () => {
        this.onCloseCb?.();
        this.onReturnToMenuCb?.();
      },
    });
  }

  private async returnConfirmBody(state: GameState | null): Promise<string> {
    if (!this.backend || !state) return t('ui.settings.return_confirm_body_none');
    try {
      const metas = await this.backend.list();
      const auto = metas.find(m => m.slotId === AUTO_SAVE_SLOT);
      if (!auto) return t('ui.settings.return_confirm_body_none');
      return t('ui.settings.return_confirm_body', { time: relativeTime(auto.timestamp) });
    } catch {
      return t('ui.settings.return_confirm_body_none');
    }
  }
}
