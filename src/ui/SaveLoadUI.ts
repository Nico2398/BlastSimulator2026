// BlastSimulator2026 — Save/Load UI (12.3)
// Slot-based save/load panel with metadata display, auto-save support,
// and download/upload fallback for browsers without IndexedDB access.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import { serialize, deserialize } from '../core/state/SaveLoad.js';
import type { SaveBackend, SaveMeta } from '../core/state/SaveBackend.js';
import { SAVE_SLOT_COUNT, AUTO_SAVE_INTERVAL_TICKS } from '../core/config/balance.js';

export type OnLoadCallback = (state: GameState) => void;
export type GetStateCallback = () => GameState | null;
import type { CommandResult } from '../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

const AUTO_SAVE_SLOT = 'auto';

export class SaveLoadUI {
  private readonly el: HTMLElement;
  private readonly slotList: HTMLElement;
  private readonly statusEl: HTMLElement;
  private backend: SaveBackend | null = null;
  private getState?: GetStateCallback;
  private onLoad?: OnLoadCallback;
  private lastAutoSaveTick = -AUTO_SAVE_INTERVAL_TICKS;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bs-save-panel';
    this.el.classList.add('bs-ui', 'bs-panel');
    this.el.style.display = 'none';
    this.el.style.maxHeight = '70vh';
    this.el.style.overflowY = 'auto';

    const title = document.createElement('div');
    title.className = 'bs-panel-title';
    title.textContent = t('saveload.title');

    this.slotList = document.createElement('div');

    this.statusEl = document.createElement('div');
    this.statusEl.style.cssText = 'font-size:10px;color:#80c080;min-height:14px;margin-top:4px';

    const exportBtn = document.createElement('button');
    exportBtn.className = 'bs-btn';
    exportBtn.style.cssText = 'width:100%;margin-top:6px';
    exportBtn.textContent = t('saveload.export');
    exportBtn.addEventListener('click', () => this.exportSave());

    const importLabel = document.createElement('label');
    importLabel.className = 'bs-btn';
    importLabel.style.cssText = 'display:block;width:100%;margin-top:4px;text-align:center;cursor:pointer';
    importLabel.textContent = t('saveload.import');
    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = '.json';
    importInput.style.display = 'none';
    importInput.addEventListener('change', () => this.handleImport(importInput));
    importLabel.appendChild(importInput);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bs-btn';
    closeBtn.style.cssText = 'width:100%;margin-top:6px';
    closeBtn.textContent = t('saveload.close');
    closeBtn.addEventListener('click', () => this.hide());

    this.el.append(title, this.slotList, this.statusEl, exportBtn, importLabel, closeBtn);
    container.appendChild(this.el);
  }

  setBackend(backend: SaveBackend): void { this.backend = backend; }
  setGetState(fn: GetStateCallback): void { this.getState = fn; }
  setOnLoad(fn: OnLoadCallback): void { this.onLoad = fn; }

  show(): void {
    this.el.style.display = '';
    void this.refreshSlotList();
  }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  /** Called each tick to trigger auto-save. */
  onTick(state: GameState): void {
    if (state.tickCount - this.lastAutoSaveTick >= AUTO_SAVE_INTERVAL_TICKS) {
      this.lastAutoSaveTick = state.tickCount;
      void this.autoSave(state);
    }
  }

  dispose(): void { this.el.remove(); }

  private async autoSave(state: GameState): Promise<void> {
    if (!this.backend) return;
    try {
      const data = serialize(state);
      const summary = `$${state.cash.toLocaleString()} — Day ${Math.floor(state.tickCount / 24) + 1}`;
      await this.backend.save(AUTO_SAVE_SLOT, t('saveload.auto_name'), data, summary);
    } catch {
      // Silent auto-save failure
    }
  }

  private async refreshSlotList(): Promise<void> {
    this.slotList.innerHTML = '';
    if (!this.backend) {
      const msg = document.createElement('div');
      msg.style.cssText = 'color:#806050;font-size:11px;margin:4px 0';
      msg.textContent = t('saveload.no_backend');
      this.slotList.appendChild(msg);
      return;
    }

    const metas = await this.backend.list();
    const slotIds = Array.from({ length: SAVE_SLOT_COUNT }, (_, i) => `slot_${i + 1}`);
    slotIds.unshift(AUTO_SAVE_SLOT);

    // Build slot rows in order, merging with saved data
    const byId = new Map(metas.map(m => [m.slotId, m]));

    for (const slotId of slotIds) {
      const meta = byId.get(slotId);
      this.slotList.appendChild(this.makeSlotRow(slotId, meta ?? null));
    }
  }

  private makeSlotRow(slotId: string, meta: SaveMeta | null): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;padding:6px;background:#2a1a0a;border-radius:4px';

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0';

    const name = document.createElement('div');
    name.style.cssText = 'font-size:11px;color:#d0b090;font-weight:bold';
    name.textContent = meta
      ? `${meta.name} — ${new Date(meta.timestamp).toLocaleDateString()}`
      : (slotId === AUTO_SAVE_SLOT ? t('saveload.auto_slot') : t('saveload.empty_slot', { n: slotId.replace('slot_', '') }));

    const summary = document.createElement('div');
    summary.style.cssText = 'font-size:10px;color:#806050';
    summary.textContent = meta ? meta.campaignSummary : '—';

    info.append(name, summary);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'bs-btn bs-btn-primary';
    saveBtn.style.cssText = 'padding:2px 6px;font-size:10px';
    saveBtn.textContent = t('saveload.save');
    saveBtn.disabled = slotId === AUTO_SAVE_SLOT; // auto-slot is read-only
    saveBtn.addEventListener('click', () => void this.saveToSlot(slotId));

    const loadBtn = document.createElement('button');
    loadBtn.className = 'bs-btn';
    loadBtn.style.cssText = 'padding:2px 6px;font-size:10px';
    loadBtn.textContent = t('saveload.load');
    loadBtn.disabled = !meta;
    loadBtn.addEventListener('click', () => void this.loadFromSlot(slotId));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'bs-btn bs-btn-danger';
    deleteBtn.style.cssText = 'padding:2px 4px;font-size:10px';
    deleteBtn.textContent = '✕';
    deleteBtn.disabled = !meta || slotId === AUTO_SAVE_SLOT;
    deleteBtn.addEventListener('click', () => void this.deleteSlot(slotId));

    row.append(info, saveBtn, loadBtn, deleteBtn);
    return row;
  }

  private async saveToSlot(slotId: string): Promise<void> {
    if (!this.backend || !this.getState) return;
    const state = this.getState();
    if (!state) { this.setStatus(t('saveload.no_game')); return; }
    try {
      const data = serialize(state);
      const summary = `$${state.cash.toLocaleString()} — Day ${Math.floor(state.tickCount / 24) + 1}`;
      const slotNum = slotId.replace('slot_', '');
      await this.backend.save(slotId, t('saveload.slot_name', { n: slotNum }), data, summary);
      this.setStatus(t('saveload.saved'));
      await this.refreshSlotList();
    } catch (e) {
      this.setStatus(t('saveload.error', { msg: String(e) }));
    }
  }

  private async loadFromSlot(slotId: string): Promise<void> {
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
