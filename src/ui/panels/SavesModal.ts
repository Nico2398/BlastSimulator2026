// BlastSimulator2026 — Saves Modal (redesign P8)
// Replaces SaveLoadUI.ts's own panel rendering. Backend orchestration
// (autosave-on-tick, save/load/delete/export/import against a SaveBackend)
// is carried over unchanged; only the rendering is new — slot cards matching
// the Screens design comp instead of the old bs-panel list.
//
// Reachable both pre-game (MainMenu's LOAD button) and mid-game (TopBar's
// Saves button), so it sits above MainMenu's own z-index rather than using
// the shared .bs-confirm-overlay tier most modals share.

import { t } from '../../core/i18n/I18n.js';
import { el, button } from '../dom.js';
import { iconEl } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import type { GameState } from '../../core/state/GameState.js';
import { serialize, deserialize } from '../../core/state/SaveLoad.js';
import type { SaveBackend, SaveMeta } from '../../core/state/SaveBackend.js';
import { SAVE_SLOT_COUNT, AUTO_SAVE_INTERVAL_TICKS } from '../../core/config/balance.js';
import { getLevel } from '../../core/campaign/Level.js';

export type OnLoadCallback = (state: GameState) => void;
export type GetStateCallback = () => GameState | null;

const AUTO_SAVE_SLOT = 'auto';
const THUMB_STYLE = 'width:58px;height:40px;border-radius:4px;flex:0 0 auto;'
  + 'background:repeating-linear-gradient(135deg,#2a3038 0 6px,#1d232b 6px 12px)';

function relativeTime(timestampMs: number): string {
  const minutes = Math.floor((Date.now() - timestampMs) / 60000);
  if (minutes < 1) return t('ui.saves.ago_now');
  if (minutes < 60) return t('ui.saves.ago_minutes', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('ui.saves.ago_hours', { n: hours });
  return t('ui.saves.ago_days', { n: Math.floor(hours / 24) });
}

export class SavesModal {
  private readonly overlay: HTMLElement;
  private readonly slotList: HTMLElement;
  private readonly statusEl: HTMLElement;

  private backend: SaveBackend | null = null;
  private getState?: GetStateCallback;
  private onLoad?: OnLoadCallback;
  private lastAutoSaveTick = -AUTO_SAVE_INTERVAL_TICKS;
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.overlay = el('div', {
      className: 'bs-confirm-overlay',
      // Reachable from MainMenu (z-index var(--bsx-z-menu), 9999) as well as
      // mid-game, so this needs to sit above it — the shared
      // .bs-confirm-overlay tier (600) would render underneath the menu.
      attrs: { style: 'z-index:var(--bsx-z-menu-settings)' },
    });
    this.overlay.id = 'bs-saves-modal';
    this.overlay.style.display = 'none';

    const box = el('div', { attrs: {
      style: 'width:520px;max-width:92vw;max-height:82vh;display:flex;flex-direction:column;'
        + 'border-radius:9px;background:var(--bsx-panel);border:1px solid var(--bsx-hairline-strong);'
        + 'box-shadow:0 30px 80px rgba(0,0,0,.7);overflow:hidden',
    } });

    const header = el('div', { attrs: {
      style: 'padding:16px 20px;display:flex;align-items:center;gap:11px;border-bottom:1px solid var(--bsx-hairline)',
    } });
    const titleEl = el('span', { attrs: { style: 'font:800 13px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-primary)' } });
    this.locale.bindText(titleEl, 'ui.saves.title');
    const closeBtn = el('button', { attrs: {
      style: 'margin-left:auto;width:28px;height:28px;display:flex;align-items:center;justify-content:center;'
        + 'border:1px solid var(--bsx-hairline);border-radius:4px;background:transparent;color:var(--bsx-text-muted);cursor:pointer',
    } });
    closeBtn.appendChild(iconEl('x', 12));
    closeBtn.addEventListener('click', () => this.hide());
    header.append(iconEl('save', 16), titleEl, closeBtn);

    const body = el('div', { attrs: { style: 'padding:14px 20px;display:flex;flex-direction:column;gap:8px;overflow-y:auto' } });
    this.slotList = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:8px' } });

    this.statusEl = el('div', { attrs: { style: 'font:500 11px/1.4 var(--bsx-font-ui);color:var(--bsx-positive);min-height:14px' } });

    const exportBtn = button('ghost', t('ui.saves.export'), { onClick: () => this.exportSave() });
    exportBtn.style.flex = '1';
    this.locale.bindText(exportBtn, 'ui.saves.export');

    const importInput = el('input', { attrs: { type: 'file', accept: '.json', style: 'display:none' } }) as HTMLInputElement;
    importInput.addEventListener('change', () => this.handleImport(importInput));
    const importBtn = button('ghost', t('ui.saves.import'), { onClick: () => importInput.click() });
    importBtn.style.flex = '1';
    this.locale.bindText(importBtn, 'ui.saves.import');
    const footer = el('div', { attrs: { style: 'display:flex;gap:8px;padding-top:6px' }, children: [exportBtn, importBtn, importInput] });

    body.append(this.slotList, this.statusEl, footer);
    box.append(header, body);
    this.overlay.appendChild(box);
    container.appendChild(this.overlay);
  }

  get root(): HTMLElement { return this.overlay; }

  setBackend(backend: SaveBackend): void { this.backend = backend; }
  setGetState(fn: GetStateCallback): void { this.getState = fn; }
  setOnLoad(fn: OnLoadCallback): void { this.onLoad = fn; }

  /** Re-render locale-dependent text after a language change. */
  refreshLocale(): void {
    this.locale.refresh();
    if (this.visible) void this.refreshSlotList();
  }

  show(): void {
    this.overlay.style.display = '';
    void this.refreshSlotList();
  }
  hide(): void { this.overlay.style.display = 'none'; }
  get visible(): boolean { return this.overlay.style.display !== 'none'; }

  /** Called each tick to trigger auto-save. */
  onTick(state: GameState): void {
    if (state.tickCount - this.lastAutoSaveTick >= AUTO_SAVE_INTERVAL_TICKS) {
      this.lastAutoSaveTick = state.tickCount;
      void this.autoSave(state);
    }
  }

  dispose(): void { this.overlay.remove(); }

  private async autoSave(state: GameState): Promise<void> {
    if (!this.backend) return;
    try {
      const data = serialize(state);
      const summary = `$${state.cash.toLocaleString('en-US')} — Day ${Math.floor(state.tickCount / 24) + 1}`;
      await this.backend.save(AUTO_SAVE_SLOT, t('saveload.auto_name'), data, summary, state.campaign.activeLevelId);
    } catch {
      // Silent auto-save failure
    }
  }

  private async refreshSlotList(): Promise<void> {
    this.slotList.replaceChildren();
    if (!this.backend) {
      this.slotList.appendChild(el('div', {
        text: t('saveload.no_backend'),
        attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-muted)' },
      }));
      return;
    }

    const metas = await this.backend.list();
    const byId = new Map(metas.map(m => [m.slotId, m]));
    const slotIds = [AUTO_SAVE_SLOT, ...Array.from({ length: SAVE_SLOT_COUNT }, (_, i) => `slot_${i + 1}`)];

    for (const slotId of slotIds) {
      this.slotList.appendChild(this.slotCard(slotId, byId.get(slotId) ?? null));
    }
  }

  private slotCard(slotId: string, meta: SaveMeta | null): HTMLElement {
    const isAuto = slotId === AUTO_SAVE_SLOT;

    if (!meta) {
      const card = el('div', { attrs: {
        style: 'display:flex;align-items:center;gap:12px;padding:12px;border-radius:6px;'
          + 'border:1px dashed var(--bsx-hairline-strong)',
      } });
      card.dataset['slot'] = slotId;
      const thumb = el('div', { attrs: { style: 'width:58px;height:40px;border-radius:4px;flex:0 0 auto;border:1px dashed var(--bsx-hairline-strong)' } });
      // Auto-save is tick-driven only (onTick → autoSave) — there is no
      // manual "save here" action for it, so an empty auto slot gets its own
      // copy and no button, rather than falling into the SAVE HERE branch
      // below with a nonsense "Slot auto — empty" label.
      const label = el('span', {
        text: isAuto ? t('ui.saves.auto_empty') : t('ui.saves.slot_empty', { n: slotId.replace('slot_', '') }),
        attrs: { style: 'flex:1;font:400 12px/1 var(--bsx-font-ui);color:var(--bsx-text-muted)' },
      });
      card.append(thumb, label);
      if (!isAuto) {
        const saveHereBtn = button('ghost', t('ui.saves.save_here'), { onClick: () => void this.saveToSlot(slotId) });
        saveHereBtn.dataset['action'] = 'save-here';
        card.appendChild(saveHereBtn);
      }
      return card;
    }

    const card = el('div', { attrs: {
      style: `display:flex;align-items:center;gap:12px;padding:12px;border-radius:6px;${
        isAuto
          ? 'border:1px solid rgba(255,176,46,.34);background:rgba(255,176,46,.07)'
          : 'border:1px solid var(--bsx-hairline);background:var(--bsx-well)'
      }`,
    } });
    card.dataset['slot'] = slotId;
    const thumb = el('div', { attrs: { style: THUMB_STYLE } });

    const nameRow = el('div', { attrs: { style: 'display:flex;align-items:center;gap:7px' } });
    nameRow.appendChild(el('span', { text: meta.name, attrs: { style: 'font:600 12px/1 var(--bsx-font-ui);color:var(--bsx-text-primary)' } }));
    if (isAuto) {
      const chip = el('span', {
        text: t('ui.saves.auto_chip'),
        attrs: { style: 'padding:2px 6px;border-radius:3px;background:rgba(255,176,46,.2);color:var(--bsx-amber);font:700 10px/1.4 var(--bsx-font-ui);letter-spacing:.1em' },
      });
      nameRow.appendChild(chip);
    }

    const level = meta.levelId ? getLevel(meta.levelId) : undefined;
    const summaryText = [level ? t(level.nameKey) : null, meta.campaignSummary, relativeTime(meta.timestamp)]
      .filter((part): part is string => !!part)
      .join(' · ');
    const summary = el('span', { text: summaryText, attrs: { style: 'font:500 10px/1 var(--bsx-font-mono);color:var(--bsx-text-muted)' } });

    const info = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:0' }, children: [nameRow, summary] });

    const loadBtn = button('ghost', t('saveload.load'), { onClick: () => void this.loadFromSlot(slotId) });
    loadBtn.dataset['action'] = 'load';
    card.append(thumb, info, loadBtn);

    if (!isAuto) {
      const deleteBtn = el('button', { attrs: {
        style: 'width:28px;height:28px;display:flex;align-items:center;justify-content:center;'
          + 'border:1px solid rgba(255,91,76,.3);border-radius:4px;background:transparent;color:var(--bsx-critical-text);cursor:pointer',
      } });
      deleteBtn.dataset['action'] = 'delete';
      deleteBtn.appendChild(iconEl('trash', 11));
      deleteBtn.addEventListener('click', () => void this.deleteSlot(slotId));
      card.appendChild(deleteBtn);
    }

    return card;
  }

  private async saveToSlot(slotId: string): Promise<void> {
    if (!this.backend || !this.getState) return;
    const state = this.getState();
    if (!state) { this.setStatus(t('saveload.no_game')); return; }
    try {
      const data = serialize(state);
      const summary = `$${state.cash.toLocaleString('en-US')} — Day ${Math.floor(state.tickCount / 24) + 1}`;
      const slotNum = slotId.replace('slot_', '');
      await this.backend.save(slotId, t('saveload.slot_name', { n: slotNum }), data, summary, state.campaign.activeLevelId);
      this.setStatus(t('saveload.saved'));
      await this.refreshSlotList();
    } catch (e) {
      this.setStatus(t('saveload.error', { msg: String(e) }));
    }
  }

  /** Public: also used by MainMenu's CONTINUE button to resume the most recent save directly. */
  async loadFromSlot(slotId: string): Promise<void> {
    if (!this.backend || !this.onLoad) return;
    try {
      const slot = await this.backend.load(slotId);
      if (!slot) { this.setStatus(t('saveload.not_found')); return; }
      const state = deserialize(slot.data);
      this.onLoad(state);
      this.setStatus(t('saveload.loaded'));
      this.hide();
    } catch (e) {
      this.setStatus(t('saveload.error', { msg: String(e) }));
    }
  }

  private async deleteSlot(slotId: string): Promise<void> {
    if (!this.backend) return;
    await this.backend.delete(slotId);
    await this.refreshSlotList();
  }

  private exportSave(): void {
    if (!this.getState) return;
    const state = this.getState();
    if (!state) { this.setStatus(t('saveload.no_game')); return; }
    const data = serialize(state);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blastsim_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.setStatus(t('saveload.exported'));
  }

  private handleImport(input: HTMLInputElement): void {
    const file = input.files?.[0];
    if (!file || !this.onLoad) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const state = deserialize(reader.result as string);
        this.onLoad!(state);
        this.setStatus(t('saveload.imported'));
        this.hide();
      } catch (e) {
        this.setStatus(t('saveload.error', { msg: String(e) }));
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  private setStatus(msg: string): void {
    this.statusEl.textContent = msg;
    setTimeout(() => { if (this.statusEl.textContent === msg) this.statusEl.textContent = ''; }, 4000);
  }
}
